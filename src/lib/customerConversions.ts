import { localCurrencySql } from './currency';
import sql from 'mssql';
import { db } from './db';
import { NotFoundError, ValidationError } from './errors';
import { APPR_STATUS, assertNotSynced } from './salesDocuments';
import { sapDatabase, sapTable } from './sapDb';
import { WENT_THROUGH_APPROVAL, createApprovalRequests, notifyFirstApprovers, templatesNeedingApproval, wentThroughApproval } from './approvalCheck';
import {
  FORM_COLUMNS,
  type ApplicationForm,
  type FormTables,
  getFormContacts,
  missingRequiredFields,
  parseApplicationForm,
  parseLeadName,
  parseSeries,
} from './leads';
import { assertSalesEmployeeExists } from './systemUsers';

// Convert to Customer (FTS11OCRD + contacts FTS11CRD1): the request to create an OPEN lead in SAP B1 as a customer.
//   Made from a lead: its application form is copied in and completed here, with the SAP BP Code and the Approved
//   Credit Limit keyed in. Save = DRAFT without a No.; Confirm = the form's * fields and the BP code checked, then the
//   approval templates (as the other documents): approval needed -> DRAFT + PENDING without a No.; none -> its No.,
//   OPEN. Once OPEN it is posted to SAP automatically (sapPosting.ts postConversionToSap); on SUCCESS the lead gets the
//   customer code and the form as posted.
//   One lead has at most one conversion on its way (sent for approval, or OPEN and not cancelled) at a time.
//   Rejected: it can be changed and confirmed again (the new approval is the next Round of FTS11WDD1).
//   Update Customer: a posted conversion gives a new one (BaseEntry = the latest posted one of that customer) with the
//   same SAP BP Code, filled from it; once approved it updates the SAP business partner instead of adding one. Its No.
//   is the BP Code with -2, -3, ... One update of a customer at a time.

/** Document type (FTS_vw_ObjType.Code): numbering series, approvals and attachments are kept under it */
export const OCRD_OBJTYPE = 'FTS11OCRD';
export const OCRD_STATUS = { draft: 'DRAFT', open: 'OPEN', canceled: 'CANCELED' } as const;
export const CONVERSION_TABLES: FormTables = { header: 'FTS11OCRD', contacts: 'FTS11CRD1' };
const LABEL = 'convert to customer';

/** OCRD.CardCode is up to 15 characters */
export const CARD_CODE_MAX = 15;

/** A function because the SAP database name (Sales Employee / payment term names) comes from .env.local */
export const conversionSelect = () => `
  SELECT c.DocEntry, c.DocNum, c.Series, n.Series AS SeriesCode, n.SeriesName,
         c.LeadEntry, ld.LeadCode, c.CardCode, c.LeadName, c.CreditLine,
         -- The lead's currency: the customer is created in it
         ISNULL(ld.Currency, ${localCurrencySql()}) AS Currency,
         c.SlpCode, (SELECT sp.SlpName FROM ${sapTable('OSLP')} sp WHERE sp.SlpCode = c.SlpCode) AS SlpName,
         c.GroupCode, (SELECT g.GroupName FROM ${sapTable('OCRG')} g WHERE g.GroupCode = c.GroupCode) AS GroupName,
         c.DocStatus, st.Name AS DocStatusName, c.ApprStatus, aps.Name AS ApprStatusName,
         c.PostStatus, pst.Name AS PostStatusName, c.ErrorDesc, c.Comments, c.ConfirmedBy, c.ConfirmedDate,
         c.CanceledBy, c.CanceledDate, c.CreatedBy, c.CreatedDate,
         -- Locked by approval while waiting and once approved; a rejected one can be changed and sent again
         CAST(CASE WHEN c.ApprStatus IN ('PENDING', 'APPROVED') THEN 1 ELSE 0 END AS BIT) AS ApprLocked,
         c.BaseEntry, (SELECT b.DocNum FROM FTS11OCRD b WHERE b.DocEntry = c.BaseEntry) AS BaseDocNum,
         ${FORM_COLUMNS.map((col) => `c.${col}`).join(', ')},
         (SELECT g.PymntGroup FROM ${sapTable('OCTG')} g WHERE g.GroupNum = c.GroupNum) AS PymntGroup
  FROM FTS11OCRD c
  JOIN FTS11LEAD ld ON ld.DocEntry = c.LeadEntry
  LEFT JOIN FTS11NNM1 n ON n.DocEntry = c.Series
  LEFT JOIN FTS_vw_DocStatus st ON st.Code = c.DocStatus
  LEFT JOIN FTS_vw_ApprStatus aps ON aps.Code = c.ApprStatus
  LEFT JOIN FTS_vw_PostStatus pst ON pst.Code = c.PostStatus`;

export async function getConversion(docEntry: number) {
  const rows = await db.query(`${conversionSelect()} WHERE c.DocEntry = @docEntry`, [{ name: 'docEntry', value: docEntry }]);
  if (rows.length === 0) throw new NotFoundError('Convert to Customer');
  return { ...rows[0], Contacts: await getFormContacts(CONVERSION_TABLES, docEntry), Addresses: await getConversionAddresses(docEntry) };
}

export interface ConversionFields extends ApplicationForm {
  /** The lead converted (FTS11LEAD.DocEntry) */
  leadEntry: number;
  leadName: string;
  /** SAP BP Code to create; may be empty on a draft (required on Confirm) */
  cardCode: string | null;
  /** Approved Credit Limit; empty = none */
  creditLine: number | null;
  slpCode: number | null;
  /** BP Group (SAP OCRG.GroupCode, a customer group); may be empty on a draft (required on Confirm) */
  groupCode: number | null;
  series: number | null;
  comments: string | null;
  addresses: ConversionAddress[];
}

/** Address types, as SAP B1 CRD1.AdresType: B = Bill To, S = Ship To */
export const ADDRESS_TYPES: Record<string, string> = { B: 'Bill To', S: 'Ship To' };
/** SAP CRD1.Address (the Address ID) is up to 50 characters */
const ADDRESS_ID_MAX = 50;

/** One of its addresses (FTS11CRD2) */
export interface ConversionAddress {
  /** The address's LineNum when it was loaded; null for one added on screen */
  lineNum: number | null;
  adresType: 'B' | 'S';
  /** Address ID */
  address: string;
  /** Address Lines 1-4: Street, StreetNo, Block, City (SAP CRD1) */
  street: string | null;
  streetNo: string | null;
  block: string | null;
  city: string | null;
  zipCode: string | null;
  state: string | null;
  country: string | null;
  /** Delivery Zone: Code of SAP UDT @DELIVERYZONE (CRD1.U_DeliveryZone) */
  deliveryZone: string | null;
  isDefault: boolean;
}

/** Text of an address field: trimmed, empty -> null, too long -> refused */
function addressText(a: Record<string, unknown>, key: string, label: string, max: number): string | null {
  const value = String(a[key] ?? '').trim();
  if (value.length > max) throw new ValidationError(`${label} must be ${max} characters or fewer`);
  return value || null;
}

/**
 * The addresses of a save request: each with its type and an Address ID unique within its type (SAP compares them
 * without case). One default per type: the first ticked one, or the type's first address when none is ticked.
 */
export function parseConversionAddresses(body: Record<string, unknown>): ConversionAddress[] {
  const raw = Array.isArray(body.addresses) ? (body.addresses as Record<string, unknown>[]) : [];
  const addresses = raw.map((a, i): ConversionAddress => {
    const row = `Address line ${i + 1}`;
    const adresType = String(a.adresType ?? '');
    if (!ADDRESS_TYPES[adresType]) throw new ValidationError(`${row}: choose Bill To or Ship To`);
    const address = String(a.address ?? '').trim();
    if (!address) throw new ValidationError(`${row}: Address ID is required`);
    if (address.length > ADDRESS_ID_MAX) throw new ValidationError(`${row}: Address ID must be ${ADDRESS_ID_MAX} characters or fewer`);
    const lineNum = a.lineNum === null || a.lineNum === undefined || a.lineNum === '' ? null : Number(a.lineNum);
    if (lineNum !== null && (!Number.isInteger(lineNum) || lineNum < 0)) throw new ValidationError(`${row}: line is not valid`);
    return {
      lineNum,
      adresType: adresType as 'B' | 'S',
      address,
      street: addressText(a, 'street', `${row}: Address Line 1`, 100),
      streetNo: addressText(a, 'streetNo', `${row}: Address Line 2`, 100),
      block: addressText(a, 'block', `${row}: Address Line 3`, 100),
      city: addressText(a, 'city', `${row}: Address Line 4`, 100),
      zipCode: addressText(a, 'zipCode', `${row}: Postcode`, 20),
      state: addressText(a, 'state', `${row}: State`, 3),
      country: addressText(a, 'country', `${row}: Country`, 3),
      deliveryZone: addressText(a, 'deliveryZone', `${row}: Delivery Zone`, 50),
      isDefault: a.isDefault === true,
    };
  });
  for (const type of Object.keys(ADDRESS_TYPES)) {
    const ofType = addresses.filter((a) => a.adresType === type);
    const seen = new Set<string>();
    for (const a of ofType) {
      const id = a.address.toLowerCase();
      if (seen.has(id)) throw new ValidationError(`${ADDRESS_TYPES[type]} Address ID "${a.address}" is used twice`);
      seen.add(id);
    }
    const chosen = ofType.find((a) => a.isDefault) ?? ofType[0];
    for (const a of ofType) a.isDefault = a === chosen;
  }
  return addresses;
}

/**
 * The default Bill To / Ship To kept in the application form's address columns (Bill* / Ship*), so the lead gets them
 * when the customer is created in SAP. No default Ship To: the delivery address is left empty.
 */
function withDefaultAddresses(fields: ApplicationForm, addresses: ConversionAddress[]): ApplicationForm {
  const bill = addresses.find((a) => a.adresType === 'B' && a.isDefault);
  const ship = addresses.find((a) => a.adresType === 'S' && a.isDefault);
  return {
    ...fields,
    form: {
      ...fields.form,
      BillStreet: bill?.street ?? null,
      BillStreetNo: bill?.streetNo ?? null,
      BillBlock: bill?.block ?? null,
      BillCity: bill?.city ?? null,
      BillZipCode: bill?.zipCode ?? null,
      BillState: bill?.state ?? null,
      BillCountry: bill?.country ?? null,
      ShipSameAsBill: false,
      ShipStreet: ship?.street ?? null,
      ShipStreetNo: ship?.streetNo ?? null,
      ShipBlock: ship?.block ?? null,
      ShipCity: ship?.city ?? null,
      ShipZipCode: ship?.zipCode ?? null,
      ShipState: ship?.state ?? null,
      ShipCountry: ship?.country ?? null,
    },
  };
}

/** Save its addresses (inside the save's transaction); LineNum kept for a saved address, as the contacts */
export async function saveConversionAddresses(docEntry: number, addresses: ConversionAddress[], transaction: sql.Transaction): Promise<void> {
  const key = [{ name: 'docEntry', value: docEntry }];
  const before = await db.query<{ LineNum: number }>(`SELECT LineNum FROM FTS11CRD2 WITH (UPDLOCK, HOLDLOCK) WHERE DocEntry = @docEntry`, key, transaction);
  const saved = new Set(before.map((b) => b.LineNum));
  let nextLineNum = before.reduce((max, b) => Math.max(max, b.LineNum + 1), 0);
  const taken = new Set<number>();
  await db.query(`DELETE FROM FTS11CRD2 WHERE DocEntry = @docEntry`, key, transaction);
  for (const [visOrder, a] of addresses.entries()) {
    const keep = a.lineNum != null && saved.has(a.lineNum) && !taken.has(a.lineNum);
    const lineNum = keep ? (a.lineNum as number) : nextLineNum++;
    taken.add(lineNum);
    await db.query(
      `INSERT INTO FTS11CRD2 (DocEntry, LineNum, VisOrder, AdresType, Address, Street, StreetNo, Block, City, ZipCode, State, Country, DeliveryZone, IsDefault)
       VALUES (@docEntry, @lineNum, @visOrder, @adresType, @address, @street, @streetNo, @block, @city, @zipCode, @state, @country, @deliveryZone, @isDefault)`,
      [
        ...key,
        { name: 'lineNum', value: lineNum },
        { name: 'visOrder', value: visOrder },
        { name: 'adresType', value: a.adresType },
        { name: 'address', value: a.address },
        { name: 'street', value: a.street },
        { name: 'streetNo', value: a.streetNo },
        { name: 'block', value: a.block },
        { name: 'city', value: a.city },
        { name: 'zipCode', value: a.zipCode },
        { name: 'state', value: a.state },
        { name: 'country', value: a.country },
        { name: 'deliveryZone', value: a.deliveryZone },
        { name: 'isDefault', type: sql.Bit, value: a.isDefault ? 1 : 0 },
      ],
      transaction
    );
  }
}

/** Its addresses, in their order on screen (VisOrder); LineNum is each address's permanent key */
export async function getConversionAddresses(docEntry: number, transaction?: sql.Transaction) {
  return db.query<{
    LineNum: number;
    AdresType: 'B' | 'S';
    Address: string;
    Street: string | null;
    StreetNo: string | null;
    Block: string | null;
    City: string | null;
    ZipCode: string | null;
    State: string | null;
    Country: string | null;
    DeliveryZone: string | null;
    IsDefault: boolean;
  }>(
    `SELECT LineNum, AdresType, Address, Street, StreetNo, Block, City, ZipCode, State, Country, DeliveryZone, IsDefault
     FROM FTS11CRD2 WHERE DocEntry = @docEntry ORDER BY VisOrder, LineNum`,
    [{ name: 'docEntry', value: docEntry }],
    transaction
  );
}

/** Validate a save request. A draft may be incomplete: the form's * fields and the BP code are checked on Confirm. */
export function parseConversionFields(body: Record<string, unknown>): ConversionFields {
  const leadEntry = Number(body.leadEntry);
  if (!Number.isInteger(leadEntry) || leadEntry <= 0) throw new ValidationError('Choose the Lead to convert');

  const cardCode = String(body.cardCode ?? '').trim();
  if (cardCode.length > CARD_CODE_MAX) throw new ValidationError(`SAP BP Code must be ${CARD_CODE_MAX} characters or fewer`);

  const creditLine = body.creditLine === null || body.creditLine === undefined || body.creditLine === '' ? null : Number(body.creditLine);
  if (creditLine !== null && (!Number.isFinite(creditLine) || creditLine < 0)) throw new ValidationError('Approved Credit Limit is not valid');

  const slpCode = body.slpCode === null || body.slpCode === undefined || body.slpCode === '' ? null : Number(body.slpCode);
  if (slpCode !== null && !Number.isInteger(slpCode)) throw new ValidationError('Sales Employee is not valid');

  const groupCode = body.groupCode === null || body.groupCode === undefined || body.groupCode === '' ? null : Number(body.groupCode);
  if (groupCode !== null && !Number.isInteger(groupCode)) throw new ValidationError('BP Group is not valid');

  const comments = String(body.comments ?? '').trim();
  if (comments.length > 254) throw new ValidationError('Remarks must be 254 characters or fewer');

  const addresses = parseConversionAddresses(body);
  return {
    leadEntry,
    leadName: parseLeadName(body, 'Company Name'),
    cardCode: cardCode || null,
    creditLine,
    slpCode,
    groupCode,
    series: parseSeries(body),
    comments: comments || null,
    ...withDefaultAddresses(parseApplicationForm(body), addresses),
    addresses,
  };
}

/**
 * The lead must be OPEN and not a customer yet (`savedLeadEntry`: the lead the document already had may stay even if
 * its state changed since), the series an active Convert to Customer one (checked while DRAFT), the sales employee
 * one of SAP's.
 */
export async function assertConversionReferences(fields: ConversionFields, checkSeries: boolean, savedLeadEntry: number | null = null) {
  if (fields.leadEntry !== savedLeadEntry) {
    const leads = await db.query<{ DocStatus: string; CardCode: string | null }>(`SELECT DocStatus, CardCode FROM FTS11LEAD WHERE DocEntry = @leadEntry`, [
      { name: 'leadEntry', value: fields.leadEntry },
    ]);
    if (leads.length === 0) throw new ValidationError('The lead was not found');
    if (leads[0].CardCode) throw new ValidationError(`This lead is already SAP customer ${leads[0].CardCode}`);
    if (leads[0].DocStatus !== OCRD_STATUS.open) throw new ValidationError('Only an OPEN (confirmed) lead can be converted to a customer');
  }
  if (checkSeries && fields.series !== null) {
    const found = await db.query(`SELECT DocEntry FROM FTS11NNM1 WHERE DocEntry = @series AND ObjType = @objType AND Active = 1`, [
      { name: 'series', value: fields.series },
      { name: 'objType', value: OCRD_OBJTYPE },
    ]);
    if (found.length === 0) throw new ValidationError('Series is not an active Convert to Customer series');
  }
  await assertSalesEmployeeExists(fields.slpCode);
  await assertCustomerGroupExists(fields.groupCode);
  await assertDeliveryZones(fields.addresses);
}

/**
 * Every address needs a Delivery Zone of SAP UDT @DELIVERYZONE. Not checked when the company database has no such
 * table (the drop-down is empty there).
 */
async function assertDeliveryZones(addresses: ConversionAddress[]) {
  if (addresses.length === 0) return;
  const zoneTable = `[${sapDatabase()}].dbo.[@DELIVERYZONE]`;
  const zones = await db.query<{ Code: string }>(
    `IF OBJECT_ID(@zoneTable, 'U') IS NOT NULL
       EXEC('SELECT Code FROM ${zoneTable}')
     ELSE
       SELECT CAST(NULL AS NVARCHAR(50)) AS Code WHERE 1 = 0`,
    [{ name: 'zoneTable', value: zoneTable }]
  );
  if (zones.length === 0) return;
  const codes = new Set(zones.map((z) => z.Code.toLowerCase()));
  addresses.forEach((a, i) => {
    const row = `Address line ${i + 1} (${a.address})`;
    if (!a.deliveryZone) throw new ValidationError(`${row}: Delivery Zone is required`);
    if (!codes.has(a.deliveryZone.toLowerCase())) throw new ValidationError(`${row}: Delivery Zone ${a.deliveryZone} is not in SAP`);
  });
}

/** BP Group: one of SAP's customer groups (OCRG, type Customer), not locked; empty passes (checked on Confirm) */
async function assertCustomerGroupExists(groupCode: number | null) {
  if (groupCode === null) return;
  const found = await db.query(`SELECT GroupCode FROM ${sapTable('OCRG')} WHERE GroupCode = @groupCode AND GroupType = 'C' AND Locked = 'N'`, [
    { name: 'groupCode', value: groupCode },
  ]);
  if (found.length === 0) throw new ValidationError('BP Group is not a customer group in SAP');
}

/** Parameters of the header fields. Untyped text: a typed text parameter isn't recognised by the driver here. */
export const conversionParams = (f: ConversionFields) => [
  { name: 'leadEntry', value: f.leadEntry },
  { name: 'leadName', value: f.leadName },
  { name: 'cardCode', value: f.cardCode },
  { name: 'creditLine', type: sql.Decimal(19, 6), value: f.creditLine },
  { name: 'slpCode', type: sql.Int, value: f.slpCode },
  { name: 'groupCode', type: sql.Int, value: f.groupCode },
  { name: 'series', type: sql.Int, value: f.series },
  { name: 'comments', value: f.comments },
];

/** The document's status, locked for the rest of the transaction; not found -> 404 */
export async function lockConversion(docEntry: number, transaction?: sql.Transaction) {
  const rows = await db.query<{
    DocStatus: string;
    ApprStatus: string;
    PostStatus: string;
    Series: number | null;
    LeadEntry: number;
    CardCode: string | null;
    BaseEntry: number | null;
  }>(
    `SELECT DocStatus, ApprStatus, PostStatus, Series, LeadEntry, CardCode, BaseEntry FROM FTS11OCRD WITH (UPDLOCK, HOLDLOCK) WHERE DocEntry = @docEntry`,
    [{ name: 'docEntry', value: docEntry }],
    transaction
  );
  if (rows.length === 0) throw new NotFoundError('Convert to Customer');
  return rows[0];
}

/**
 * Can't be changed: waiting for approval, approved, or synced to SAP. A rejected one can be changed and confirmed
 * again (sent for approval again).
 */
export function assertConversionChangeable(current: { ApprStatus: string; PostStatus: string }) {
  if (current.ApprStatus === APPR_STATUS.pending) throw new ValidationError("This convert to customer is waiting for approval and can't be changed");
  if (current.ApprStatus === APPR_STATUS.approved) throw new ValidationError("This convert to customer has been approved and can't be changed");
  assertNotSynced(LABEL, current.PostStatus);
}

/** The SAP business partner an Update Customer changes must still be in SAP */
async function assertCustomerInSap(cardCode: string, transaction?: sql.Transaction) {
  const found = await db.query(`SELECT CardCode FROM ${sapTable('OCRD')} WHERE CardCode = @cardCode`, [{ name: 'cardCode', value: cardCode }], transaction);
  if (found.length === 0) throw new ValidationError(`SAP business partner ${cardCode} was not found in SAP`);
}

/**
 * The No. of an Update Customer: the BP Code with -2, -3, ... (the conversion that created the customer has the BP Code
 * itself; numbers must be unique). Kept once given, also when it is sent for approval again.
 */
async function updateDocNum(docEntry: number, cardCode: string, transaction: sql.Transaction): Promise<string> {
  const rows = await db.query<{ DocNum: string | null; Taken: number }>(
    `SELECT DocNum,
            (SELECT COUNT(*) FROM FTS11OCRD o
             WHERE o.CardCode = @cardCode AND o.BaseEntry IS NOT NULL AND o.DocEntry <> @docEntry AND o.DocNum LIKE @prefix) AS Taken
     FROM FTS11OCRD WHERE DocEntry = @docEntry`,
    [
      { name: 'docEntry', value: docEntry },
      { name: 'cardCode', value: cardCode },
      { name: 'prefix', value: `${cardCode.replace(/[[%_]/g, '[$&]')}-%` },
    ],
    transaction
  );
  const own = rows[0]?.DocNum;
  if (own && own.startsWith(`${cardCode}-`)) return own;
  return `${cardCode}-${(rows[0]?.Taken ?? 0) + 2}`;
}

/**
 * Update Customer: a new DRAFT conversion of a customer already posted to SAP, filled from the latest posted
 * conversion of that customer (form, contacts, addresses), with the same lead and SAP BP Code and BaseEntry = that one.
 * One update of a customer at a time: if one is already on its way (not cancelled, not posted), that one is returned.
 */
export async function createCustomerUpdate(sourceEntry: number, userName: string): Promise<{ docEntry: number; existing: boolean }> {
  const transaction = await db.beginTransaction();
  try {
    const source = await db.query<{ CardCode: string | null; PostStatus: string; DocStatus: string }>(
      `SELECT CardCode, PostStatus, DocStatus FROM FTS11OCRD WITH (UPDLOCK, HOLDLOCK) WHERE DocEntry = @docEntry`,
      [{ name: 'docEntry', value: sourceEntry }],
      transaction
    );
    if (source.length === 0) throw new NotFoundError('Convert to Customer');
    const cardCode = source[0].CardCode;
    if (source[0].PostStatus !== 'SUCCESS' || source[0].DocStatus === OCRD_STATUS.canceled || !cardCode) {
      throw new ValidationError('Only a convert to customer posted to SAP can be updated');
    }
    const onItsWay = await db.query<{ DocEntry: number }>(
      `SELECT TOP 1 DocEntry FROM FTS11OCRD WITH (UPDLOCK, HOLDLOCK)
       WHERE CardCode = @cardCode AND DocStatus <> @canceled AND PostStatus <> 'SUCCESS'
       ORDER BY DocEntry DESC`,
      [
        { name: 'cardCode', value: cardCode },
        { name: 'canceled', value: OCRD_STATUS.canceled },
      ],
      transaction
    );
    if (onItsWay.length > 0) {
      await db.commitTransaction(transaction);
      return { docEntry: onItsWay[0].DocEntry, existing: true };
    }
    const latest = await db.query<{ DocEntry: number }>(
      `SELECT TOP 1 DocEntry FROM FTS11OCRD WHERE CardCode = @cardCode AND PostStatus = 'SUCCESS' ORDER BY DocEntry DESC`,
      [{ name: 'cardCode', value: cardCode }],
      transaction
    );
    const baseEntry = latest[0].DocEntry;
    // The form as last posted; Date = today
    const formColumns = FORM_COLUMNS.filter((col) => col !== 'DocDate');
    const inserted = await db.query<{ DocEntry: number }>(
      `INSERT INTO FTS11OCRD (LeadEntry, LeadName, CardCode, CreditLine, SlpCode, GroupCode, Series, Comments, BaseEntry, DocDate,
                              ${formColumns.join(', ')}, CreatedBy, CreatedDate, UpdatedBy, UpdatedDate)
       OUTPUT INSERTED.DocEntry
       SELECT LeadEntry, LeadName, CardCode, CreditLine, SlpCode, GroupCode, Series, Comments, DocEntry, CAST(GETDATE() AS DATE),
              ${formColumns.join(', ')}, @userName, GETDATE(), @userName, GETDATE()
       FROM FTS11OCRD WHERE DocEntry = @baseEntry`,
      [
        { name: 'baseEntry', value: baseEntry },
        { name: 'userName', value: userName },
      ],
      transaction
    );
    const docEntry = inserted[0].DocEntry;
    const keys = [
      { name: 'docEntry', value: docEntry },
      { name: 'baseEntry', value: baseEntry },
    ];
    await db.query(
      `INSERT INTO FTS11CRD1 (DocEntry, LineNum, VisOrder, Role, RoleDesc, Name, Tel, Email)
       SELECT @docEntry, LineNum, VisOrder, Role, RoleDesc, Name, Tel, Email FROM FTS11CRD1 WHERE DocEntry = @baseEntry`,
      keys,
      transaction
    );
    await db.query(
      `INSERT INTO FTS11CRD2 (DocEntry, LineNum, VisOrder, AdresType, Address, Street, StreetNo, Block, City, ZipCode, State, Country, DeliveryZone, IsDefault)
       SELECT @docEntry, LineNum, VisOrder, AdresType, Address, Street, StreetNo, Block, City, ZipCode, State, Country, DeliveryZone, IsDefault
       FROM FTS11CRD2 WHERE DocEntry = @baseEntry`,
      keys,
      transaction
    );
    await db.commitTransaction(transaction);
    return { docEntry, existing: false };
  } catch (error) {
    await db.rollbackTransaction(transaction);
    throw error;
  }
}

/**
 * The SAP BP Code must be free: not in SAP, not given to another lead, and not on another conversion on its way
 * (sent for approval, or OPEN). SAP compares codes without case (its collation), so ABC and abc are the same code.
 */
export async function assertCardCodeFree(cardCode: string, docEntry: number, leadEntry: number, transaction?: sql.Transaction) {
  const inSap = await db.query(`SELECT CardCode FROM ${sapTable('OCRD')} WHERE CardCode = @cardCode`, [{ name: 'cardCode', value: cardCode }], transaction);
  if (inSap.length > 0) throw new ValidationError(`SAP BP Code ${cardCode} already exists in SAP`);
  const otherLead = await db.query<{ LeadCode: string | null }>(
    `SELECT LeadCode FROM FTS11LEAD WHERE CardCode = @cardCode AND DocEntry <> @leadEntry`,
    [
      { name: 'cardCode', value: cardCode },
      { name: 'leadEntry', value: leadEntry },
    ],
    transaction
  );
  if (otherLead.length > 0) throw new ValidationError(`SAP BP Code ${cardCode} is already used by lead ${otherLead[0].LeadCode ?? ''}`.trim());
  const other = await db.query<{ DocNum: string | null }>(
    `SELECT DocNum FROM FTS11OCRD
     WHERE CardCode = @cardCode AND DocEntry <> @docEntry AND (DocStatus = @open OR ApprStatus = @pending)`,
    [
      { name: 'cardCode', value: cardCode },
      { name: 'docEntry', value: docEntry },
      { name: 'open', value: OCRD_STATUS.open },
      { name: 'pending', value: APPR_STATUS.pending },
    ],
    transaction
  );
  if (other.length > 0) {
    throw new ValidationError(`SAP BP Code ${cardCode} is already on Convert to Customer ${other[0].DocNum ?? '(waiting for approval)'}`);
  }
}

/**
 * Confirm a DRAFT conversion: the lead still OPEN and not a customer, no other conversion of it on its way, the form's
 * * fields filled (the default Bill To complete), at least one attachment and the SAP BP Code free; then the approval
 * templates (as on the other documents) — approval
 * needed: stays DRAFT + PENDING without a No.; none: its No., OPEN, NO-APPROVAL. Returns the ApprStatus afterwards.
 */
export async function confirmConversion(docEntry: number, userName: string, transaction: sql.Transaction): Promise<string> {
  const current = await lockConversion(docEntry, transaction);
  if (current.DocStatus !== OCRD_STATUS.draft) throw new ValidationError('Only a DRAFT convert to customer can be confirmed');
  assertConversionChangeable(current);
  if (current.BaseEntry !== null) return confirmCustomerUpdate(docEntry, current, userName, transaction);

  const leads = await db.query<{ DocStatus: string; CardCode: string | null; LeadCode: string | null }>(
    `SELECT DocStatus, CardCode, LeadCode FROM FTS11LEAD WITH (UPDLOCK, HOLDLOCK) WHERE DocEntry = @leadEntry`,
    [{ name: 'leadEntry', value: current.LeadEntry }],
    transaction
  );
  const lead = leads[0];
  if (!lead) throw new ValidationError('The lead was not found');
  if (lead.CardCode) throw new ValidationError(`Lead ${lead.LeadCode ?? ''} is already SAP customer ${lead.CardCode}`);
  if (lead.DocStatus !== OCRD_STATUS.open) throw new ValidationError(`Lead ${lead.LeadCode ?? ''} is ${lead.DocStatus}; only an OPEN lead can be converted`);
  const onItsWay = await db.query<{ DocNum: string | null }>(
    `SELECT DocNum FROM FTS11OCRD
     WHERE LeadEntry = @leadEntry AND DocEntry <> @docEntry AND (DocStatus = @open OR ApprStatus = @pending)`,
    [
      { name: 'leadEntry', value: current.LeadEntry },
      { name: 'docEntry', value: docEntry },
      { name: 'open', value: OCRD_STATUS.open },
      { name: 'pending', value: APPR_STATUS.pending },
    ],
    transaction
  );
  if (onItsWay.length > 0) {
    throw new ValidationError(`Lead ${lead.LeadCode ?? ''} is already on Convert to Customer ${onItsWay[0].DocNum ?? '(waiting for approval)'}`);
  }

  const rows = await db.query<{ CardCode: string | null; GroupCode: number | null }>(
    `SELECT CardCode, GroupCode FROM FTS11OCRD WHERE DocEntry = @docEntry`,
    [{ name: 'docEntry', value: docEntry }],
    transaction
  );
  const missing = await missingRequiredFields(CONVERSION_TABLES, docEntry, transaction);
  if (rows[0]?.GroupCode == null) missing.unshift('BP Group');
  if (!rows[0]?.CardCode) missing.unshift('SAP BP Code');
  // At least one attachment (e.g. the signed application form)
  const attached = await db.query<{ Files: number }>(
    `SELECT COUNT(*) AS Files FROM FTS11ATC1 WHERE ObjType = @objType AND DocEntry = @docEntry`,
    [
      { name: 'objType', value: OCRD_OBJTYPE },
      { name: 'docEntry', value: docEntry },
    ],
    transaction
  );
  if (!attached[0]?.Files) missing.push('Attachment');
  if (missing.length > 0) throw new ValidationError(`Fill in before confirming: ${missing.join(', ')}`);
  await assertCardCodeFree(rows[0].CardCode as string, docEntry, current.LeadEntry, transaction);
  // Its No. is the SAP BP Code: kept now, so it shows (and is reserved) while waiting for approval
  await db.query(`UPDATE FTS11OCRD SET DocNum = CardCode WHERE DocEntry = @docEntry`, [{ name: 'docEntry', value: docEntry }], transaction);
  return sendOrOpen(docEntry, userName, transaction);
}

/**
 * Confirm an Update Customer: the business partner still in SAP, no other update of it on its way, the form's
 * * fields filled (no attachment needed); its No. = BP Code-n; then approval as any conversion.
 */
async function confirmCustomerUpdate(
  docEntry: number,
  current: { CardCode: string | null },
  userName: string,
  transaction: sql.Transaction
): Promise<string> {
  const cardCode = current.CardCode;
  if (!cardCode) throw new ValidationError('SAP BP Code is required');
  await assertCustomerInSap(cardCode, transaction);
  const onItsWay = await db.query<{ DocNum: string | null }>(
    `SELECT DocNum FROM FTS11OCRD
     WHERE CardCode = @cardCode AND DocEntry <> @docEntry AND DocStatus <> @canceled AND PostStatus <> 'SUCCESS'
       AND (DocStatus = @open OR ApprStatus = @pending)`,
    [
      { name: 'cardCode', value: cardCode },
      { name: 'docEntry', value: docEntry },
      { name: 'canceled', value: OCRD_STATUS.canceled },
      { name: 'open', value: OCRD_STATUS.open },
      { name: 'pending', value: APPR_STATUS.pending },
    ],
    transaction
  );
  if (onItsWay.length > 0) {
    throw new ValidationError(`Customer ${cardCode} is already on Convert to Customer ${onItsWay[0].DocNum ?? '(waiting for approval)'}`);
  }
  const groups = await db.query<{ GroupCode: number | null }>(`SELECT GroupCode FROM FTS11OCRD WHERE DocEntry = @docEntry`, [{ name: 'docEntry', value: docEntry }], transaction);
  const missing = await missingRequiredFields(CONVERSION_TABLES, docEntry, transaction);
  if (groups[0]?.GroupCode == null) missing.unshift('BP Group');
  if (missing.length > 0) throw new ValidationError(`Fill in before confirming: ${missing.join(', ')}`);
  await db.query(`UPDATE FTS11OCRD SET DocNum = @docNum WHERE DocEntry = @docEntry`, [
    { name: 'docEntry', value: docEntry },
    { name: 'docNum', value: await updateDocNum(docEntry, cardCode, transaction) },
  ], transaction);
  return sendOrOpen(docEntry, userName, transaction);
}

/** After the checks of Confirm: the approval templates; approval needed -> PENDING (and the approvers told), else OPEN */
async function sendOrOpen(docEntry: number, userName: string, transaction: sql.Transaction): Promise<string> {
  const needing = await templatesNeedingApproval(OCRD_OBJTYPE, docEntry, transaction);
  if (needing.length > 0) {
    await createApprovalRequests(OCRD_OBJTYPE, docEntry, needing, transaction);
    // ConfirmedBy / Date = who sent it for approval, and when (kept when it is approved later)
    await db.query(
      `UPDATE FTS11OCRD SET ApprStatus = @pending, ConfirmedBy = @userName, ConfirmedDate = GETDATE(),
              UpdatedBy = @userName, UpdatedDate = GETDATE()
       WHERE DocEntry = @docEntry`,
      [
        { name: 'docEntry', value: docEntry },
        { name: 'pending', value: APPR_STATUS.pending },
        { name: 'userName', value: userName },
      ],
      transaction
    );
    await notifyFirstApprovers(OCRD_OBJTYPE, docEntry, transaction);
    return APPR_STATUS.pending;
  }
  await openConversion(docEntry, userName, APPR_STATUS.none, transaction);
  return APPR_STATUS.none;
}

/**
 * Set the conversion OPEN with `apprStatus` (NO-APPROVAL on Confirm, APPROVED once fully approved); its No. is its
 * SAP BP Code (checked free on Confirm). ConfirmedBy / Date: kept if already set.
 */
export async function openConversion(docEntry: number, userName: string, apprStatus: string, transaction: sql.Transaction) {
  const rows = await db.query<{ CardCode: string | null; DocNum: string | null; BaseEntry: number | null }>(
    `SELECT CardCode, DocNum, BaseEntry FROM FTS11OCRD WHERE DocEntry = @docEntry`,
    [{ name: 'docEntry', value: docEntry }],
    transaction
  );
  // An Update Customer keeps the No. it got on Confirm (BP Code-n)
  const docNum = rows[0]?.BaseEntry != null ? rows[0]?.DocNum : rows[0]?.CardCode;
  if (!docNum) throw new ValidationError('The convert to customer has no SAP BP Code');
  await db.query(
    `UPDATE FTS11OCRD
     SET DocNum = @docNum, DocStatus = @open, ApprStatus = @apprStatus,
         ConfirmedBy = ISNULL(ConfirmedBy, @userName), ConfirmedDate = ISNULL(ConfirmedDate, GETDATE()),
         UpdatedBy = @userName, UpdatedDate = GETDATE()
     WHERE DocEntry = @docEntry`,
    [
      { name: 'docEntry', value: docEntry },
      { name: 'docNum', value: docNum },
      { name: 'open', value: OCRD_STATUS.open },
      { name: 'apprStatus', value: apprStatus },
      { name: 'userName', value: userName },
    ],
    transaction
  );
}

/** Cancel Doc: a DRAFT or OPEN conversion not synced to SAP becomes CANCELED (also while waiting for approval) */
export async function cancelConversion(docEntry: number, userName: string, transaction: sql.Transaction): Promise<void> {
  const current = await lockConversion(docEntry, transaction);
  if (current.DocStatus !== OCRD_STATUS.draft && current.DocStatus !== OCRD_STATUS.open) {
    throw new ValidationError(`A ${current.DocStatus} convert to customer can't be cancelled`);
  }
  assertNotSynced(LABEL, current.PostStatus);
  await db.query(
    `UPDATE FTS11OCRD SET DocStatus = @canceled, CanceledBy = @userName, CanceledDate = GETDATE(),
            UpdatedBy = @userName, UpdatedDate = GETDATE()
     WHERE DocEntry = @docEntry`,
    [
      { name: 'docEntry', value: docEntry },
      { name: 'canceled', value: OCRD_STATUS.canceled },
      { name: 'userName', value: userName },
    ],
    transaction
  );
}

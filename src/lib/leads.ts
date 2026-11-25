import sql from 'mssql';
import { db } from './db';
import { NotFoundError, ValidationError } from './errors';
import { APPR_STATUS } from './salesDocuments';
import { keepManualNumber, numberForOpen } from './documentNumbering';
import type { NumberedTable } from './documentNumbering';
import { sapTable } from './sapDb';
import { getCurrencySettings, localCurrencySql } from './currency';
import { WENT_THROUGH_APPROVAL, createApprovalRequests, notifyFirstApprovers, templatesNeedingApproval, wentThroughApproval } from './approvalCheck';

// Leads (FTS11LEAD), kept as documents like the Sales Quotation - a short registration: Lead Name and Series.
//   Save = DRAFT without a Lead Code; Confirm = Lead Code from Document Numbering (a series of type Lead), OPEN.
//   With approval (as the quotation): Confirm leaves it DRAFT + PENDING without a Lead Code until approved.
// The New Account Application Form is filled in on Convert to Customer (FTS11OCRD, customerConversions.ts), which
// creates the lead in SAP B1 as a customer: CardCode / PostStatus are set on the lead by that posting, never typed.
// The form's helpers here are shared by both (a lead saved before Convert to Customer existed still has its form).

/** Document type of a lead (FTS_vw_ObjType.Code); its numbering series and attachments are kept under it */
export const LEAD_OBJTYPE = 'FTS11LEAD';

/** A lead's No. is its Lead Code */
export const LEAD_NUMBER: NumberedTable = { table: 'FTS11LEAD', column: 'LeadCode', label: 'lead', noLabel: 'Lead Code' };

/** Statuses (FTS_vw_DocStatus / FTS_vw_ApprStatus) */
const DRAFT = 'DRAFT';
const OPEN = 'OPEN';

/**
 * The New Account Application Form's fields (column names, the same on FTS11LEAD and FTS11OCRD; the API uses them
 * camel-cased). Approved Credit Limit (CreditLine) isn't one of them: it is keyed in on Convert to Customer.
 */
export const FORM_COLUMNS = [
  'DocDate', 'RegNo', 'YearsInBiz',
  'BillStreet', 'BillStreetNo', 'BillBlock', 'BillCity', 'BillZipCode', 'BillState', 'BillCountry',
  'ShipSameAsBill', 'ShipStreet', 'ShipStreetNo', 'ShipBlock', 'ShipCity', 'ShipZipCode', 'ShipState', 'ShipCountry',
  'Email', 'EInvEmail', 'NatureOfBiz', 'MainProducts', 'Supplier1', 'Supplier2',
  'RecCreditLine', 'GroupNum', 'MsicCode', 'TIN', 'SstNo',
] as const;

/** A function because the SAP database name (Sales Employee names, OSLP) comes from .env.local */
export const leadSelect = () => `
  SELECT l.DocEntry, l.LeadCode, l.LeadName, l.CardCode,
         l.SlpCode, (SELECT sp.SlpName FROM ${sapTable('OSLP')} sp WHERE sp.SlpCode = l.SlpCode) AS SlpName,
         l.Series, n.Series AS SeriesCode, n.SeriesName,
         l.DocStatus, st.Name AS DocStatusName, l.ApprStatus, aps.Name AS ApprStatusName,
         l.PostStatus, pst.Name AS PostStatusName, l.ErrorDesc, l.Comments, l.ConfirmedBy, l.ConfirmedDate,
         CAST(CASE WHEN ${WENT_THROUGH_APPROVAL(`'${LEAD_OBJTYPE}'`, 'l.DocEntry')} THEN 1 ELSE 0 END AS BIT) AS ApprLocked,
         ${FORM_COLUMNS.map((c) => `l.${c}`).join(', ')}, l.CreditLine,
         -- The lead's currency (local when none), fixed once it has a quotation (they are in it)
         ISNULL(l.Currency, ${localCurrencySql()}) AS Currency,
         CAST(CASE WHEN ${LEAD_HAS_QUOTATION('l')} THEN 1 ELSE 0 END AS BIT) AS CurrencyLocked,
         (SELECT g.PymntGroup FROM ${sapTable('OCTG')} g WHERE g.GroupNum = l.GroupNum) AS PymntGroup
  FROM FTS11LEAD l
  LEFT JOIN FTS11NNM1 n ON n.DocEntry = l.Series
  LEFT JOIN FTS_vw_DocStatus st ON st.Code = l.DocStatus
  LEFT JOIN FTS_vw_ApprStatus aps ON aps.Code = l.ApprStatus
  LEFT JOIN FTS_vw_PostStatus pst ON pst.Code = l.PostStatus`;

/** SQL: lead `alias` has a Sales Quotation (not cancelled) - its currency is then fixed */
function LEAD_HAS_QUOTATION(alias: string) {
  return `EXISTS (SELECT 1 FROM FTS11OQUT q WHERE q.CardCode = ${alias}.LeadCode AND q.DocStatus <> 'CANCELED')`;
}

/** Roles of a lead's contact persons (FTS11LED1) and how they read */
export const CONTACT_ROLES: Record<string, string> = {
  PURCHASING: 'Purchasing Dept',
  RECEIVING: 'Receiving Dept',
  ACCOUNT: 'Account Dept',
  DIRECTOR: 'Director / Boss',
  OTHERS: 'Others',
};

export interface LeadContact {
  /** The contact's LineNum when it was loaded; null for a contact added on screen */
  lineNum: number | null;
  role: string;
  roleDesc: string | null;
  name: string;
  tel: string | null;
  email: string | null;
}

/** The application form's values, by column name (FORM_COLUMNS) */
export type LeadForm = Record<(typeof FORM_COLUMNS)[number], string | number | boolean | null>;

export interface LeadFields {
  leadName: string;
  /** Numbering series (FTS11NNM1.DocEntry) the Lead Code is taken from on Confirm */
  series: number | null;
  /** Currency (SAP OCRN); null = the local one. Its quotations are in it; Convert to Customer creates the customer in it */
  currency: string | null;
}

/** The application form and its contacts, as sent by a screen */
export interface ApplicationForm {
  form: LeadForm;
  contacts: LeadContact[];
}

/**
 * Where an application form is kept: the header table and its contacts table. Always one of these two (from the
 * program, never from a request).
 */
export type FormTables = { header: 'FTS11LEAD'; contacts: 'FTS11LED1' } | { header: 'FTS11OCRD'; contacts: 'FTS11CRD1' };
export const LEAD_TABLES: FormTables = { header: 'FTS11LEAD', contacts: 'FTS11LED1' };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Text from the request: trimmed, empty -> null, too long -> refused */
function textOf(body: Record<string, unknown>, key: string, label: string, max: number): string | null {
  const value = String(body[key] ?? '').trim();
  if (value.length > max) throw new ValidationError(`${label} must be ${max} characters or fewer`);
  return value || null;
}

/** A number from the request: empty -> null */
function numberOf(body: Record<string, unknown>, key: string, label: string, integer = false): number | null {
  const raw = body[key];
  if (raw === null || raw === undefined || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || (integer && !Number.isInteger(n))) throw new ValidationError(`${label} is not valid`);
  return n;
}

/** Company Name: required, up to 100 characters */
export function parseLeadName(body: Record<string, unknown>, label = 'Lead Name'): string {
  const leadName = String(body.leadName ?? '').trim();
  if (!leadName) throw new ValidationError(`${label} is required`);
  if (leadName.length > 100) throw new ValidationError(`${label} must be 100 characters or fewer`);
  return leadName;
}

/** A numbering series from the request: empty -> null */
export function parseSeries(body: Record<string, unknown>): number | null {
  const series = body.series === null || body.series === undefined || body.series === '' ? null : Number(body.series);
  if (series !== null && (!Number.isInteger(series) || series <= 0)) throw new ValidationError('Series is not valid');
  return series;
}

/** Validate a lead's save request: its name, series and currency */
export function parseLeadFields(body: Record<string, unknown>): LeadFields {
  const currency = String(body.currency ?? '').trim().toUpperCase() || null;
  if (currency !== null && currency.length > 3) throw new ValidationError('Currency is not valid');
  return { leadName: parseLeadName(body), series: parseSeries(body), currency };
}

/**
 * The lead's currency (empty = the local one) must be an SAP currency - not All Currencies, not offered for now - and
 * can't change once the lead has a quotation (`docEntry`: the lead being changed). Returns it, local as null.
 */
export async function settleLeadCurrency(currency: string | null, docEntry?: number): Promise<string | null> {
  const s = await getCurrencySettings();
  const cur = currency && currency !== s.local ? currency : null;
  if (cur) {
    const known = await db.query(`SELECT CurrCode FROM ${sapTable('OCRN')} WHERE CurrCode = @currency`, [{ name: 'currency', value: cur }]);
    if (known.length === 0) throw new ValidationError(`Currency ${cur} is not a currency in SAP`);
  }
  if (docEntry !== undefined) {
    const rows = await db.query<{ Currency: string | null; HasQuotation: number }>(
      `SELECT l.Currency, CASE WHEN ${LEAD_HAS_QUOTATION('l')} THEN 1 ELSE 0 END AS HasQuotation FROM FTS11LEAD l WHERE l.DocEntry = @docEntry`,
      [{ name: 'docEntry', value: docEntry }]
    );
    const saved = rows[0]?.Currency && rows[0].Currency !== s.local ? rows[0].Currency : null;
    if (rows[0]?.HasQuotation && saved !== cur) {
      throw new ValidationError("Currency can't be changed: the lead already has a sales quotation (it is in the lead's currency)");
    }
  }
  return cur;
}

/** Validate the application form of a save request. A draft may be incomplete: the * fields are checked on Confirm. */
export function parseApplicationForm(body: Record<string, unknown>): ApplicationForm {
  const docDateText = String(body.docDate ?? '').trim();
  if (docDateText && Number.isNaN(Date.parse(docDateText))) throw new ValidationError('Date is not valid');

  const shipSameAsBill = body.shipSameAsBill !== false;
  const email = textOf(body, 'email', 'E-mail', 100);
  const eInvEmail = textOf(body, 'eInvEmail', 'E-mail (E-invoice)', 100);
  for (const [value, label] of [[email, 'E-mail'], [eInvEmail, 'E-mail (E-invoice)']] as const) {
    if (value && !EMAIL_RE.test(value)) throw new ValidationError(`${label} is not a valid e-mail address`);
  }
  const msicCode = textOf(body, 'msicCode', 'MSIC Code', 10);
  if (msicCode && !/^\d{5}$/.test(msicCode)) throw new ValidationError('MSIC Code must be 5 digits');

  const ship = (key: string, label: string, max: number) => (shipSameAsBill ? null : textOf(body, key, `Delivery ${label}`, max));
  const form: LeadForm = {
    DocDate: docDateText ? docDateText.slice(0, 10) : null,
    RegNo: textOf(body, 'regNo', 'Company Register No', 50),
    YearsInBiz: numberOf(body, 'yearsInBiz', 'Year in Business', true),
    BillStreet: textOf(body, 'billStreet', 'Address Line 1', 100),
    BillStreetNo: textOf(body, 'billStreetNo', 'Address Line 2', 100),
    BillBlock: textOf(body, 'billBlock', 'Address Line 3', 100),
    BillCity: textOf(body, 'billCity', 'Address Line 4', 100),
    BillZipCode: textOf(body, 'billZipCode', 'Postcode', 20),
    BillState: textOf(body, 'billState', 'State', 3),
    BillCountry: textOf(body, 'billCountry', 'Country', 3),
    ShipSameAsBill: shipSameAsBill,
    ShipStreet: ship('shipStreet', 'Address Line 1', 100),
    ShipStreetNo: ship('shipStreetNo', 'Address Line 2', 100),
    ShipBlock: ship('shipBlock', 'Address Line 3', 100),
    ShipCity: ship('shipCity', 'Address Line 4', 100),
    ShipZipCode: ship('shipZipCode', 'Postcode', 20),
    ShipState: ship('shipState', 'State', 3),
    ShipCountry: ship('shipCountry', 'Country', 3),
    Email: email,
    EInvEmail: eInvEmail,
    NatureOfBiz: textOf(body, 'natureOfBiz', 'Nature of Business', 254),
    MainProducts: textOf(body, 'mainProducts', 'Main Products', 254),
    Supplier1: textOf(body, 'supplier1', 'Major Supplier a.', 100),
    Supplier2: textOf(body, 'supplier2', 'Major Supplier b.', 100),
    RecCreditLine: numberOf(body, 'recCreditLine', 'Recommended Credit Limit'),
    GroupNum: body.groupNum === null || body.groupNum === undefined || body.groupNum === '' ? null : Number(body.groupNum),
    MsicCode: msicCode,
    TIN: textOf(body, 'tin', 'Tax Identification No. (TIN)', 20),
    SstNo: textOf(body, 'sstNo', 'SST No', 30),
  };
  if (form.GroupNum !== null && !Number.isInteger(form.GroupNum)) throw new ValidationError('Credit Term is not valid');

  const rawContacts = Array.isArray(body.contacts) ? (body.contacts as Record<string, unknown>[]) : [];
  const contacts = rawContacts.map((c, i): LeadContact => {
    const row = `Contact line ${i + 1}`;
    const role = String(c.role ?? '');
    if (!CONTACT_ROLES[role]) throw new ValidationError(`${row}: choose a Role`);
    const name = String(c.name ?? '').trim();
    if (!name) throw new ValidationError(`${row}: Name is required`);
    if (name.length > 100) throw new ValidationError(`${row}: Name must be 100 characters or fewer`);
    const contactEmail = textOf(c, 'email', `${row}: E-mail`, 100);
    if (contactEmail && !EMAIL_RE.test(contactEmail)) throw new ValidationError(`${row}: E-mail is not a valid e-mail address`);
    const lineNum = c.lineNum === null || c.lineNum === undefined || c.lineNum === '' ? null : Number(c.lineNum);
    if (lineNum !== null && (!Number.isInteger(lineNum) || lineNum < 0)) throw new ValidationError(`${row}: line is not valid`);
    return {
      lineNum,
      role,
      roleDesc: role === 'OTHERS' ? textOf(c, 'roleDesc', `${row}: Department`, 100) : null,
      name,
      tel: textOf(c, 'tel', `${row}: Contact No.`, 30),
      email: contactEmail,
    };
  });

  return { form, contacts };
}

/** The form's values and the contacts, saved with their document (inside the save's transaction) */
export async function saveApplicationForm(tables: FormTables, docEntry: number, fields: ApplicationForm, transaction: sql.Transaction): Promise<void> {
  const key = [{ name: 'docEntry', value: docEntry }];
  await db.query(
    `UPDATE ${tables.header} SET ${FORM_COLUMNS.map((c) => `${c} = @${c}`).join(', ')} WHERE DocEntry = @docEntry`,
    [
      ...key,
      ...FORM_COLUMNS.map((c) => {
        const value = fields.form[c];
        // Numbers and the date typed; text untyped (a typed text parameter isn't recognised by the driver here)
        if (c === 'YearsInBiz' || c === 'GroupNum') return { name: c, type: sql.Int, value };
        if (c === 'RecCreditLine') return { name: c, type: sql.Decimal(19, 6), value };
        if (c === 'DocDate') return { name: c, type: sql.Date, value };
        if (c === 'ShipSameAsBill') return { name: c, type: sql.Bit, value: value ? 1 : 0 };
        return { name: c, value };
      }),
    ],
    transaction
  );
  // LineNum is each contact's permanent key, as in SAP B1: a contact that was already saved keeps its LineNum, a new
  // one gets the next number after the highest one saved; VisOrder is the contact's position on screen
  const before = await db.query<{ LineNum: number }>(`SELECT LineNum FROM ${tables.contacts} WITH (UPDLOCK, HOLDLOCK) WHERE DocEntry = @docEntry`, key, transaction);
  const saved = new Set(before.map((b) => b.LineNum));
  let nextLineNum = before.reduce((max, b) => Math.max(max, b.LineNum + 1), 0);
  const taken = new Set<number>();
  await db.query(`DELETE FROM ${tables.contacts} WHERE DocEntry = @docEntry`, key, transaction);
  for (const [visOrder, c] of fields.contacts.entries()) {
    const keep = c.lineNum != null && saved.has(c.lineNum) && !taken.has(c.lineNum);
    const lineNum = keep ? (c.lineNum as number) : nextLineNum++;
    taken.add(lineNum);
    await db.query(
      `INSERT INTO ${tables.contacts} (DocEntry, LineNum, VisOrder, Role, RoleDesc, Name, Tel, Email)
       VALUES (@docEntry, @lineNum, @visOrder, @role, @roleDesc, @name, @tel, @email)`,
      [
        ...key,
        { name: 'lineNum', value: lineNum },
        { name: 'visOrder', value: visOrder },
        { name: 'role', value: c.role },
        { name: 'roleDesc', value: c.roleDesc },
        { name: 'name', value: c.name },
        { name: 'tel', value: c.tel },
        { name: 'email', value: c.email },
      ],
      transaction
    );
  }
}

/** A form's contact persons, in their order on screen (VisOrder); LineNum is each contact's permanent key */
export async function getFormContacts(tables: FormTables, docEntry: number, transaction?: sql.Transaction) {
  return db.query<{ LineNum: number; Role: string; RoleDesc: string | null; Name: string; Tel: string | null; Email: string | null }>(
    `SELECT LineNum, Role, RoleDesc, Name, Tel, Email FROM ${tables.contacts} WHERE DocEntry = @docEntry ORDER BY VisOrder, LineNum`,
    [{ name: 'docEntry', value: docEntry }],
    transaction
  );
}

/**
 * The application form's * fields (needed for e-invoicing), checked on Confirm of Convert to Customer: what is still
 * missing, by name. A draft may be saved without them.
 */
export async function missingRequiredFields(tables: FormTables, docEntry: number, transaction: sql.Transaction): Promise<string[]> {
  const rows = await db.query<Record<string, unknown>>(
    `SELECT LeadName, RegNo, BillStreet, BillStreetNo, BillBlock, BillCity, BillZipCode, BillState, BillCountry, EInvEmail, NatureOfBiz, MsicCode, TIN,
            (SELECT COUNT(*) FROM ${tables.contacts} c WHERE c.DocEntry = l.DocEntry AND c.Role = 'ACCOUNT' AND ISNULL(c.Tel, '') <> '') AS AccountTel
     FROM ${tables.header} l WHERE l.DocEntry = @docEntry`,
    [{ name: 'docEntry', value: docEntry }],
    transaction
  );
  const l = rows[0] ?? {};
  const blank = (col: string) => !String(l[col] ?? '').trim();
  // The Bill* columns hold the default Bill To address (Addresses tab); none at all is listed once
  const billing: [string, string][] = [
    ['BillStreet', 'Bill To Address Line 1'],
    ['BillCity', 'Bill To Address Line 4'],
    ['BillZipCode', 'Bill To Postcode'],
    ['BillState', 'Bill To State'],
    ['BillCountry', 'Bill To Country'],
  ];
  const noBilling = billing.every(([col]) => blank(col)) && blank('BillStreetNo') && blank('BillBlock');
  const required: [string, string][] = [
    ['LeadName', 'Company Name'],
    ['RegNo', 'Company Register No'],
    // (no such column: always listed)
    ...(noBilling ? ([['-', 'Bill To address (Addresses tab)']] as [string, string][]) : billing),
    ['EInvEmail', 'E-mail (E-invoice)'],
    ['NatureOfBiz', 'Nature of Business'],
    ['MsicCode', 'MSIC Code'],
    ['TIN', 'Tax Identification No. (TIN)'],
  ];
  const missing = required.filter(([col]) => blank(col)).map(([, label]) => label);  if (!Number(l.AccountTel)) missing.push('Account Dept contact no. (Contacts tab)');
  return missing;
}

/** The series must be an active Document Numbering series of type Lead */
export async function assertLeadSeries(series: number | null): Promise<void> {
  if (series === null) return;
  const found = await db.query(`SELECT DocEntry FROM FTS11NNM1 WHERE DocEntry = @series AND ObjType = @objType AND Active = 1`, [
    { name: 'series', value: series },
    { name: 'objType', value: LEAD_OBJTYPE },
  ]);
  if (found.length === 0) throw new ValidationError('Series is not an active Lead series');
}

export async function getLead(docEntry: number) {
  const rows = await db.query(`${leadSelect()} WHERE l.DocEntry = @docEntry`, [{ name: 'docEntry', value: docEntry }]);
  if (rows.length === 0) throw new NotFoundError('Lead');
  return { ...rows[0], Contacts: await getFormContacts(LEAD_TABLES, docEntry) };
}

/** The lead's status, locked for the rest of the transaction; not found -> 404 */
export async function lockLead(docEntry: number, transaction?: sql.Transaction) {
  const rows = await db.query<{ DocStatus: string; ApprStatus: string; PostStatus: string; Series: number | null }>(
    `SELECT DocStatus, ApprStatus, PostStatus, Series FROM FTS11LEAD WITH (UPDLOCK, HOLDLOCK) WHERE DocEntry = @docEntry`,
    [{ name: 'docEntry', value: docEntry }],
    transaction
  );
  if (rows.length === 0) throw new NotFoundError('Lead');
  return rows[0];
}

/** A lead waiting for approval, or that has been through it, can't be changed or confirmed again */
export async function assertLeadNotInApproval(docEntry: number, apprStatus: string, transaction?: sql.Transaction) {
  if (apprStatus === 'PENDING' || (await wentThroughApproval(LEAD_OBJTYPE, docEntry, transaction))) {
    throw new ValidationError("This lead is waiting for approval or approved; it can't be changed");
  }
}

/**
 * Confirm a DRAFT lead. The active Lead approval templates run first (as on the quotation):
 *   approval needed -> stays DRAFT, ApprStatus PENDING, no Lead Code yet (given when fully approved);
 *   none            -> Lead Code now, OPEN; ApprStatus stays NO-APPROVAL.
 * Returns the lead's ApprStatus afterwards.
 */
export async function confirmLead(docEntry: number, userName: string, transaction: sql.Transaction, manualNo?: unknown): Promise<string> {
  const lead = await lockLead(docEntry, transaction);
  if (lead.DocStatus !== DRAFT) throw new ValidationError('Only a DRAFT lead can be confirmed');
  await assertLeadNotInApproval(docEntry, lead.ApprStatus, transaction);
  if (lead.Series === null) throw new ValidationError('Choose a Series before confirming');
  // Manual series: the Lead Code keyed in is checked and kept now (also while waiting for approval)
  await keepManualNumber(LEAD_NUMBER, docEntry, lead.Series, manualNo, transaction);
  // Only the Lead Name is needed (required on Save); the application form's * fields are checked on Convert to Customer

  const needing = await templatesNeedingApproval(LEAD_OBJTYPE, docEntry, transaction);
  if (needing.length > 0) {
    await createApprovalRequests(LEAD_OBJTYPE, docEntry, needing, transaction);
    // ConfirmedBy / Date = who sent it for approval, and when (kept when it is approved later)
    await db.query(
      `UPDATE FTS11LEAD SET ApprStatus = 'PENDING', ConfirmedBy = @userName, ConfirmedDate = GETDATE() WHERE DocEntry = @docEntry`,
      [
        { name: 'docEntry', value: docEntry },
        { name: 'userName', value: userName },
      ],
      transaction
    );
    await notifyFirstApprovers(LEAD_OBJTYPE, docEntry, transaction);
    return 'PENDING';
  }
  await openLead(docEntry, userName, APPR_STATUS.none, transaction);
  return APPR_STATUS.none;
}

/**
 * Give a lead its Lead Code from its series and set it OPEN with `apprStatus`: NO-APPROVAL on Confirm, APPROVED once fully approved.
 * ConfirmedBy / Date: set now, unless already set when the lead was sent for approval.
 */
export async function openLead(
  docEntry: number,
  userName: string,
  apprStatus: string,
  transaction: sql.Transaction
): Promise<void> {
  const lead = await lockLead(docEntry, transaction);
  if (lead.Series === null) throw new ValidationError('The lead has no Series');
  const leadCode = await numberForOpen(LEAD_NUMBER, docEntry, lead.Series, new Date(), transaction);
  if (leadCode.length > 15) throw new ValidationError(`Lead Code ${leadCode} is longer than 15 characters; shorten the series' prefix / length`);

  await db.query(
    `UPDATE FTS11LEAD
     SET LeadCode = @leadCode, DocStatus = @open, ApprStatus = @apprStatus,
         ConfirmedBy = ISNULL(ConfirmedBy, @userName), ConfirmedDate = ISNULL(ConfirmedDate, GETDATE())
     WHERE DocEntry = @docEntry`,
    [
      { name: 'docEntry', value: docEntry },
      { name: 'userName', value: userName },
      { name: 'leadCode', value: leadCode },
      { name: 'open', value: OPEN },
      { name: 'apprStatus', value: apprStatus },
    ],
    transaction
  );
}

export const LEAD_STATUS = { draft: DRAFT, open: OPEN };

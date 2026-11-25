import sql from 'mssql';
import { WENT_THROUGH_APPROVAL, wentThroughApproval } from './approvalCheck';
import { db } from './db';
import { numberForOpen } from './documentNumbering';
import { sapColumnOr, sapTable } from './sapDb';
import { NotFoundError, ValidationError } from './errors';
import { recalcLine, calcDocTotals, SALES_TYPE_EXPORT } from './documentLines';
import { isSynced } from './postStatus';
import { getCurrencySettings, getDocumentRate, resolveDocumentCurrency, toLocal } from './currency';
import type { DocTotals } from './documentLines';
import type { SalesDocumentLine } from '@/types';

// Sales documents (Sales Quotation, Sales Order, ...) share the same fields, screens and rules;
// each type only has its own tables. Table names come from the fixed list below, never from requests.

export interface SalesDocType {
  /** Document type (FTS_vw_ObjType.Code), also the ObjType default of its header table */
  objType: string;
  /** Header table, e.g. FTS11OQUT */
  header: string;
  /** Lines table, e.g. FTS11QUT1 */
  lines: string;
  /** e.g. "Sales quotation" — used in messages */
  label: string;
  /** Document types its lines can be copied from (Copy From), e.g. a Sales Order from Sales Quotations */
  copyFrom?: SalesDocType[];
  /** Its customer may be a lead (FTS11LEAD) instead of an SAP customer — the Sales Quotation, as in SAP B1 */
  allowsLeads?: boolean;
  /** No Close Doc / Close Line (nothing stays open on it) — the Credit Memo: Cancel Doc only */
  noClose?: boolean;
  /** No Sales Type (hidden on its screen, saved empty) — the Credit Memo */
  noSalesType?: boolean;
  /** No Payment Terms (hidden on its screen, kept as saved) — the Credit Memo */
  noPaymentTerms?: boolean;
  /** No COA (hidden on its screen, kept as saved) — the Credit Memo */
  noCoa?: boolean;
  /** No Internal Remarks / T&C (hidden on its screen, kept as saved) — the Credit Memo */
  noExtraRemarks?: boolean;
  /** No Discount Type (hidden on its screen, kept as saved) — the Credit Memo */
  noDiscType?: boolean;
  /** No Bank Info (hidden on its screen, kept as saved) — the Credit Memo */
  noBankInfo?: boolean;
  /** No Delivery tab: Bill To / Ship To hidden on its screen, kept as saved — the Credit Memo */
  noAddresses?: boolean;
  /** Only rebate items (SAP OITM.U_Rebate = 'Y') on its lines — the Credit Memo */
  rebateItemsOnly?: boolean;
}

export const SALES_QUOTATION: SalesDocType = {
  objType: 'FTS11OQUT',
  header: 'FTS11OQUT',
  lines: 'FTS11QUT1',
  label: 'Sales quotation',
  allowsLeads: true,
};
export const SALES_ORDER: SalesDocType = {
  objType: 'FTS11ORDR',
  header: 'FTS11ORDR',
  lines: 'FTS11RDR1',
  label: 'Sales order',
  copyFrom: [SALES_QUOTATION],
};
export const CREDIT_MEMO: SalesDocType = {
  objType: 'FTS11ORIN',
  header: 'FTS11ORIN',
  lines: 'FTS11RIN1',
  label: 'Credit memo',
  noClose: true,
  noSalesType: true,
  noPaymentTerms: true,
  noCoa: true,
  noExtraRemarks: true,
  noDiscType: true,
  noBankInfo: true,
  noAddresses: true,
  rebateItemsOnly: true,
};

/** Every sales document type, by its ObjType (BaseType on a copied line names one of these) */
export const DOC_TYPES: Record<string, SalesDocType> = {
  [SALES_QUOTATION.objType]: SALES_QUOTATION,
  [SALES_ORDER.objType]: SALES_ORDER,
  [CREDIT_MEMO.objType]: CREDIT_MEMO,
};

/** Document statuses (FTS_vw_DocStatus.Code) */
export const DOC_STATUS = { draft: 'DRAFT', open: 'OPEN', closed: 'CLOSED', canceled: 'CANCELED' } as const;

/**
 * Approval statuses (FTS_vw_ApprStatus.Code). A document only gets PENDING / APPROVED / REJECTED by going through
 * approval; one confirmed without approval keeps NO-APPROVAL.
 */
export const APPR_STATUS = { none: 'NO-APPROVAL', pending: 'PENDING', approved: 'APPROVED', rejected: 'REJECTED' } as const;

/** A document synced to SAP B1 (or being synced) can't be changed; `label` e.g. "sales quotation" */
export function assertNotSynced(label: string, postStatus: string | null | undefined): void {
  if (isSynced(postStatus)) {
    throw new ValidationError(
      postStatus === 'PENDING'
        ? `This ${label} is being posted to SAP and can't be changed`
        : `This ${label} has been posted to SAP and can't be changed`
    );
  }
}

/**
 * A document waiting for approval or approved can't be edited — no edit, no line changes, no attachments, no Confirm.
 * (Still allowed: Cancel Doc, and once approved and OPEN also Copy To / Close Doc / Close Line.) A REJECTED one can be
 * changed and confirmed again: it goes through approval again from the first stage.
 */
export async function assertNotInApproval(
  doc: SalesDocType,
  docEntry: number,
  apprStatus: string | null | undefined,
  transaction?: sql.Transaction
): Promise<void> {
  if (apprStatus === APPR_STATUS.pending) {
    throw new ValidationError(`This ${doc.label.toLowerCase()} is waiting for approval and can't be changed`);
  }
  if (await wentThroughApproval(doc.objType, docEntry, transaction)) {
    throw new ValidationError(`This ${doc.label.toLowerCase()} has been approved and can't be changed`);
  }
}

/** Line statuses (LineStatus), the same words as DocStatus: OPEN while OpenQty > 0, CLOSED once fully copied */
export const LINE_STATUS = { open: 'OPEN', closed: 'CLOSED', canceled: 'CANCELED' } as const;
const lineStatusOf = (openQty: number) => (openQty > 0 ? LINE_STATUS.open : LINE_STATUS.closed);

// Closed by itself vs. closed by hand. A line closes by itself when everything was copied (OpenQty 0) and reopens
// when quantity is given back. A line closed by hand (Close Line / Close Doc) keeps the OpenQty it had — always more
// than 0, since only open lines can be closed — and never reopens. Nothing else needs to be stored to tell them apart.

/** SQL: line `alias` was closed by hand */
const CLOSED_BY_HAND = (alias: string) => `${alias}.LineStatus = '${LINE_STATUS.closed}' AND ${alias}.OpenQty > 0`;

/** SQL: document `alias` (its header) has a line closed by hand — when CLOSED, it was closed by hand and stays closed */
const DOC_CLOSED_BY_HAND = (doc: SalesDocType, alias: string) =>
  `EXISTS (SELECT 1 FROM ${doc.lines} m WHERE m.DocEntry = ${alias}.DocEntry AND ${CLOSED_BY_HAND('m')})`;

/**
 * SQL columns Moq, MoqUom: the Sales MOQ of the item on line `alias`, from the SAP item master (OITM.U_Sales_MOQ,
 * U_Sales_MOQ_UOM); NULL when the company database has no such field.
 */
export async function itemMoqSql(alias: string): Promise<string> {
  const moq = await sapColumnOr('OITM', 'U_Sales_MOQ', 'i');
  const moqUom = await sapColumnOr('OITM', 'U_Sales_MOQ_UOM', 'i');
  // COLLATE: the SAP company database and the portal's compare text differently (CP850 vs CP1)
  return `(SELECT ${moq} FROM ${sapTable('OITM')} i WHERE i.ItemCode = ${alias}.ItemCode COLLATE DATABASE_DEFAULT) AS Moq,
            (SELECT ${moqUom} FROM ${sapTable('OITM')} i WHERE i.ItemCode = ${alias}.ItemCode COLLATE DATABASE_DEFAULT) AS MoqUom`;
}

/**
 * Lines of a document, in their order on screen (VisOrder); LineNum is each line's permanent key.
 * IsFOC AS IsFoc / SalesUoM AS SalesUom: the API turns them into isFoc / salesUom, as the screens read them.
 * Moq / MoqUom: the item's MOQ as it is now in SAP (not kept on the line). Prices and LineTotal are in the document's
 * currency; LineTotalLC in the local currency.
 */
export async function getDocumentLines(doc: SalesDocType, docEntry: number) {
  return db.query(
    `SELECT l.LineNum, l.VisOrder, l.ItemCode, l.Dscription, l.Quantity, l.OpenQty, l.LineStatus, l.UomCode, l.PriceBefDi,
            l.DiscPrcnt, l.Price, l.VatGroup, l.VatPrcnt,
            -- In the document currency (TotalFrgn on a foreign-currency document), and in the local currency
            CASE WHEN l.TotalFrgn <> 0 THEN l.TotalFrgn ELSE l.LineTotal END AS LineTotal, l.LineTotal AS LineTotalLC,
            l.WhsCode, l.Text, l.BaseType, l.BaseEntry, l.BaseLine,
            l.BaseRef, l.IsFOC AS IsFoc, l.SalesQty, l.SalesUoM AS SalesUom, l.SalesPrice, ${await itemMoqSql('l')}
     FROM ${doc.lines} l
     WHERE l.DocEntry = @docEntry
     ORDER BY l.VisOrder, l.LineNum`,
    [{ name: 'docEntry', value: docEntry }]
  );
}

/**
 * Document header with the names looked up from SAP B1 (contact person from OCPR, sales employee from OSLP),
 * the document type name from FTS_vw_ObjType, the status names from FTS_vw_DocStatus / FTS_vw_ApprStatus /
 * FTS_vw_PostStatus and the numbering series from FTS11NNM1. Built per request because the SAP database name comes
 * from .env.local.
 */
export function documentSelect(doc: SalesDocType): string {
  return `
  SELECT q.DocEntry, q.DocNum, q.ObjType, v.Name AS ObjTypeName,
         q.DocStatus, st.Name AS DocStatusName, q.ApprStatus, aps.Name AS ApprStatusName,
         q.PostStatus, pst.Name AS PostStatusName, q.ErrorDesc, q.SAPDocNum,
         CAST(CASE WHEN ${WENT_THROUGH_APPROVAL('q.ObjType', 'q.DocEntry')} THEN 1 ELSE 0 END AS BIT) AS ApprLocked,
         -- Customer is a lead (quotations): its SAP customer once posted (Copy To Sales Order needs one)
         CAST(CASE WHEN ld.DocEntry IS NULL THEN 0 ELSE 1 END AS BIT) AS IsLead, ld.CardCode AS LeadCardCode,
         -- COLLATE: the SAP company database and the portal's compare text differently (CP850 vs CP1)
         (SELECT c.CardName FROM ${sapTable('OCRD')} c WHERE c.CardCode = ld.CardCode COLLATE DATABASE_DEFAULT) AS LeadCardName,
         q.Series, n.Series AS SeriesCode, n.SeriesName,
         q.SalesTyp, stp.Name AS SalesTypName,
         q.CardCode, q.CardName, q.CntctCode, cp.Name AS ContactName,
         q.GroupNum, (SELECT g.PymntGroup FROM ${sapTable('OCTG')} g WHERE g.GroupNum = q.GroupNum) AS PymntGroup,
         q.COA AS Coa, q.Branch, q.DiscType1, q.DiscType2, q.DiscType3, q.DiscType4, q.DiscType5, q.BankInfo,
         -- Delivery: Bill To / Ship To (the customer's SAP address names) and their text
         q.PayToCode, q.ShipToCode, q.Address, q.Address2,
         q.BillStreet, q.BillStreetNo, q.BillBlock, q.BillCity, q.BillDeliveryZone,
         q.ShipStreet, q.ShipStreetNo, q.ShipBlock, q.ShipCity, q.ShipDeliveryZone,
         (SELECT oc.OcrName FROM ${sapTable('OOCR')} oc WHERE oc.DimCode = 1 AND oc.OcrCode = q.Branch COLLATE DATABASE_DEFAULT) AS BranchName,
         q.NumAtCard, q.Comments, q.InComments, q.TAC AS Tac, q.DocDate, q.DocDueDate, q.TaxDate,
         q.SlpCode, sp.SlpName, q.ConfirmedBy, q.ConfirmedDate,
         q.DiscPrcnt, q.DiscSum, q.VatSum, q.DocTotal,
         -- Currency (NULL on documents made before currencies: the local one), SAP's rate, and the totals in it
         ISNULL(q.DocCur, (SELECT TOP 1 a.MainCurncy FROM ${sapTable('OADM')} a) COLLATE DATABASE_DEFAULT) AS DocCur,
         q.DocRate, q.DiscSumFC, q.VatSumFC, q.DocTotalFC,
         (SELECT c.Currency FROM ${sapTable('OCRD')} c WHERE c.CardCode = q.CardCode COLLATE DATABASE_DEFAULT) AS CardCurrency
  FROM ${doc.header} q
  LEFT JOIN FTS_vw_ObjType v ON v.Code = q.ObjType
  LEFT JOIN FTS_vw_DocStatus st ON st.Code = q.DocStatus
  LEFT JOIN FTS_vw_ApprStatus aps ON aps.Code = q.ApprStatus
  LEFT JOIN FTS_vw_PostStatus pst ON pst.Code = q.PostStatus
  LEFT JOIN FTS11LEAD ld ON ld.LeadCode = q.CardCode
  LEFT JOIN FTS_vw_SalesTyp stp ON stp.Code = q.SalesTyp
  LEFT JOIN FTS11NNM1 n ON n.DocEntry = q.Series
  LEFT JOIN ${sapTable('OCPR')} cp ON cp.CntctCode = q.CntctCode
  LEFT JOIN ${sapTable('OSLP')} sp ON sp.SlpCode = q.SlpCode`;
}

/** A document with its lines, shaped for the API */
export async function getDocumentDetail(doc: SalesDocType, docEntry: number) {
  const rows = await db.query(`${documentSelect(doc)} WHERE q.DocEntry = @docEntry`, [
    { name: 'docEntry', value: docEntry },
  ]);
  if (rows.length === 0) throw new NotFoundError(doc.label);
  return { ...rows[0], Lines: await getDocumentLines(doc, docEntry) };
}

// ---------------------------------------------------------------------------
// Save (create / update)
// ---------------------------------------------------------------------------

/** Where a copied line came from (Copy From) */
export interface LineBase {
  baseType: string;
  baseEntry: number;
  baseLine: number;
}

export interface DocumentLineFields extends SalesDocumentLine {
  /** LineNum the line had when loaded (keeps what isn't on screen); null for a new line */
  origLineNum: number | null;
  /** A new line copied from another document (Copy From); checked against that document on save */
  copiedFrom: LineBase | null;
}

/**
 * Bill To / Ship To parts (094), as on Convert to Customer: Address Line 1 .. 4 = SAP Street / StreetNo / Block / City,
 * and the Delivery Zone. field = the API / screen name, column = the header table's column.
 */
export const ADDRESS_PARTS = [
  { field: 'billStreet', column: 'BillStreet', label: 'Bill To Address Line 1', max: 100 },
  { field: 'billStreetNo', column: 'BillStreetNo', label: 'Bill To Address Line 2', max: 100 },
  { field: 'billBlock', column: 'BillBlock', label: 'Bill To Address Line 3', max: 100 },
  { field: 'billCity', column: 'BillCity', label: 'Bill To Address Line 4', max: 100 },
  { field: 'billDeliveryZone', column: 'BillDeliveryZone', label: 'Bill To Delivery Zone', max: 50 },
  { field: 'shipStreet', column: 'ShipStreet', label: 'Ship To Address Line 1', max: 100 },
  { field: 'shipStreetNo', column: 'ShipStreetNo', label: 'Ship To Address Line 2', max: 100 },
  { field: 'shipBlock', column: 'ShipBlock', label: 'Ship To Address Line 3', max: 100 },
  { field: 'shipCity', column: 'ShipCity', label: 'Ship To Address Line 4', max: 100 },
  { field: 'shipDeliveryZone', column: 'ShipDeliveryZone', label: 'Ship To Delivery Zone', max: 50 },
] as const;
export type AddressPartField = (typeof ADDRESS_PARTS)[number]['field'];
export type AddressParts = Record<AddressPartField, string | null>;

export interface DocumentFields {
  series: number | null;
  /** Sales Type (FTS_vw_SalesTyp.Code) — mandatory; null on a document type without one (noSalesType) */
  salesTyp: string | null;
  cardCode: string;
  cardName: string | null;
  cntctCode: number | null;
  numAtCard: string | null;
  /** Payment Terms (SAP OCTG.GroupNum); null = the customer's own in SAP */
  groupNum: number | null;
  /** COA (SAP UDF U_COA): 'Y' / 'N'; null = not chosen */
  coa: string | null;
  /** Branch: SAP cost centre of Dimension 1 (OOCR.OcrCode); null = none. Posted as every line's cost centre */
  branch: string | null;
  /** Trade Remarks (SAP Comments) */
  comments: string | null;
  /** Internal Remarks (SAP UDF U_InComments) */
  inComments: string | null;
  /** T&C (SAP UDF U_TAC) */
  tac: string | null;
  /** Discount Type 1 .. 5: Codes of SAP's user table @DISCOUNTTYPE, each one at most once; null = none */
  discType1: string | null;
  discType2: string | null;
  discType3: string | null;
  discType4: string | null;
  discType5: string | null;
  /** Bank Info: a Code of SAP's user table @SELLERBANK; null = none */
  bankInfo: string | null;
  /** Bill To / Ship To: the customer's SAP address names (CRD1.Address); null = none chosen (always for a lead) */
  payToCode: string | null;
  shipToCode: string | null;
  /** Bill To / Ship To address text: filled from the chosen address and editable; free text for a lead */
  address: string | null;
  address2: string | null;
  /** Bill To / Ship To Address Line 1 .. 4 and Delivery Zone (ADDRESS_PARTS) */
  addressParts: AddressParts;
  /** yyyymmdd — a format SQL Server reads the same whatever its language setting */
  docDate: string;
  docDueDate: string;
  taxDate: string | null;
  slpCode: number | null;
  lines: DocumentLineFields[];
  /** Worked out here from the lines and the discount %, never trusted from the screen */
  totals: DocTotals;
  /** Currency: as chosen on screen (null = the customer's default) until applyDocumentCurrency settles it */
  docCur: string | null;
  /** SAP's rate for the currency on the Posting Date (applyDocumentCurrency); 1 for the local currency */
  docRate: number;
  /** Discount, tax and total in the document currency; 0 when it is the local currency (applyDocumentCurrency) */
  totalsFC: { discSum: number; vatSum: number; docTotal: number };
}

const optionalText = (value: unknown, label: string, max: number): string | null => {
  const text = String(value ?? '').trim();
  if (text.length > max) throw new ValidationError(`${label} must be ${max} characters or fewer`);
  return text || null;
};

const optionalInt = (value: unknown, label: string): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isInteger(n)) throw new ValidationError(`${label} is not valid`);
  return n;
};

const optionalNumber = (value: unknown, label: string): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) throw new ValidationError(`${label} is not valid`);
  return n;
};

/** 'YYYY-MM-DD' from the screen -> 'YYYYMMDD' for SQL Server */
const parseDate = (value: unknown, label: string, required: boolean): string | null => {
  const text = String(value ?? '').trim();
  if (!text) {
    if (required) throw new ValidationError(`${label} is required`);
    return null;
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  const date = match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : null;
  if (!match || !date || date.getMonth() !== Number(match[2]) - 1) throw new ValidationError(`${label} is not a valid date`);
  return `${match[1]}${match[2]}${match[3]}`;
};

function parseLine(raw: Record<string, unknown>, index: number): DocumentLineFields {
  const label = `Line ${index + 1}`;
  const itemCode = String(raw.itemCode ?? '').trim();
  if (!itemCode) throw new ValidationError(`${label}: Item is required`);
  if (itemCode.length > 50) throw new ValidationError(`${label}: Item No. is too long`);

  const quantity = Number(raw.quantity);
  if (!Number.isFinite(quantity) || quantity <= 0) throw new ValidationError(`${label}: Quantity must be more than 0`);

  // FOC (free of charge): Unit Price 0, no discount, whatever the screen sent
  const isFoc = raw.isFoc === true;
  const priceBefDi = isFoc ? 0 : optionalNumber(raw.priceBefDi, `${label}: Unit Price`) ?? 0;
  const discPrcnt = isFoc ? 0 : optionalNumber(raw.discPrcnt, `${label}: Discount %`) ?? 0;
  if (priceBefDi < 0) throw new ValidationError(`${label}: Unit Price can't be negative`);
  if (discPrcnt < 0 || discPrcnt > 100) throw new ValidationError(`${label}: Discount % must be from 0 to 100`);
  // Export Qty / Export UoM / Export Unit Price (SAP line UDFs U_SalesQty / U_SalesUoM / U_SalesPrice); the UoM is
  // checked in SAP. Kept only on a Sales Type EXPORT document (parseDocumentFields empties them otherwise)
  const salesQty = optionalNumber(raw.salesQty, `${label}: Export Qty`);
  if (salesQty !== null && salesQty < 0) throw new ValidationError(`${label}: Export Qty can't be negative`);
  const salesPrice = optionalNumber(raw.salesPrice, `${label}: Export Unit Price`);
  if (salesPrice !== null && salesPrice < 0) throw new ValidationError(`${label}: Export Unit Price can't be negative`);

  const line: SalesDocumentLine = {
    // Its position for messages; the LineNum saved is the line's own (origLineNum), given in saveDocumentLines
    lineNum: index,
    itemCode,
    dscription: optionalText(raw.dscription, `${label}: Item Description`, 200),
    quantity,
    uomCode: optionalText(raw.uomCode, `${label}: UoM Code`, 20),
    priceBefDi,
    discPrcnt,
    price: optionalNumber(raw.price, `${label}: Price after Discount`),
    vatGroup: optionalText(raw.vatGroup, `${label}: Tax Code`, 8),
    vatPrcnt: optionalNumber(raw.vatPrcnt, `${label}: Tax %`),
    lineTotal: null,
    whsCode: optionalText(raw.whsCode, `${label}: Warehouse`, 8),
    text: optionalText(raw.text, `${label}: Item Details`, 100000),
    isFoc,
    salesQty,
    salesUom: optionalText(raw.salesUom, `${label}: Export UoM`, 10),
    salesPrice,
  };

  // A new line copied from another document names its source line; BaseRef is looked up, not taken from the screen
  const baseEntry = optionalInt(raw.baseEntry, `${label}: copied from`);
  const baseLine = optionalInt(raw.baseLine, `${label}: copied from`);
  const baseType = optionalText(raw.baseType, `${label}: copied from`, 20);
  const copiedFrom = baseType && baseEntry !== null && baseLine !== null ? { baseType, baseEntry, baseLine } : null;

  // Price after Discount and Total are worked out here again, never trusted from the screen
  return {
    ...recalcLine(line, 'discPrcnt'),
    origLineNum: optionalInt(raw.origLineNum, `${label}: line`),
    copiedFrom,
  };
}

/** Validate a create / update request body for a sales document */
export function parseDocumentFields(doc: SalesDocType, body: Record<string, unknown>): DocumentFields {
  const salesTyp = doc.noSalesType ? null : String(body.salesTyp ?? '').trim();
  if (salesTyp !== null && !salesTyp) throw new ValidationError('Sales Type is required');
  if (salesTyp !== null && salesTyp.length > 20) throw new ValidationError('Sales Type is not valid');

  const cardCode = String(body.cardCode ?? '').trim();
  if (!cardCode) throw new ValidationError('Customer is required');
  if (cardCode.length > 100) throw new ValidationError('Customer code is too long');

  const rawLines = Array.isArray(body.lines) ? (body.lines as Record<string, unknown>[]) : [];
  const lines = rawLines.map(parseLine);
  // Export Qty / UoM / Unit Price belong to an EXPORT document only
  if (salesTyp !== SALES_TYPE_EXPORT) for (const l of lines) Object.assign(l, { salesQty: null, salesUom: null, salesPrice: null });

  // The % is what's kept (as in SAP B1); the discount amount follows from it
  const discPrcnt = optionalNumber(body.discPrcnt, 'Discount %') ?? 0;
  if (discPrcnt < 0 || discPrcnt > 100) throw new ValidationError('Discount % must be from 0 to 100');

  // COA: Y / N, as SAP's U_COA valid values
  const coa = doc.noCoa ? null : optionalText(body.coa, 'COA', 1);
  if (coa !== null && coa !== 'Y' && coa !== 'N') throw new ValidationError('COA must be Yes or No');

  return {
    series: optionalInt(body.series, 'Series'),
    salesTyp,
    cardCode,
    cardName: optionalText(body.cardName, 'Name', 200),
    cntctCode: optionalInt(body.cntctCode, 'Contact Person'),
    numAtCard: optionalText(body.numAtCard, 'Customer Ref. No.', 200),
    groupNum: doc.noPaymentTerms ? null : optionalInt(body.groupNum, 'Payment Terms'),
    coa,
    branch: optionalText(body.branch, 'Branch', 8),
    comments: optionalText(body.comments, doc.noExtraRemarks ? 'Remarks' : 'Trade Remarks', 254),
    inComments: doc.noExtraRemarks ? null : optionalText(body.inComments, 'Internal Remarks', 254),
    tac: doc.noExtraRemarks ? null : optionalText(body.tac, 'T&C', 254),
    discType1: doc.noDiscType ? null : optionalText(body.discType1, 'Discount Type 1', 50),
    discType2: doc.noDiscType ? null : optionalText(body.discType2, 'Discount Type 2', 50),
    discType3: doc.noDiscType ? null : optionalText(body.discType3, 'Discount Type 3', 50),
    discType4: doc.noDiscType ? null : optionalText(body.discType4, 'Discount Type 4', 50),
    discType5: doc.noDiscType ? null : optionalText(body.discType5, 'Discount Type 5', 50),
    bankInfo: doc.noBankInfo ? null : optionalText(body.bankInfo, 'Bank Info', 50),
    payToCode: doc.noAddresses ? null : optionalText(body.payToCode, 'Bill To', 50),
    shipToCode: doc.noAddresses ? null : optionalText(body.shipToCode, 'Ship To', 50),
    address: doc.noAddresses ? null : optionalText(body.address, 'Bill To address', 254),
    address2: doc.noAddresses ? null : optionalText(body.address2, 'Ship To address', 254),
    addressParts: Object.fromEntries(
      ADDRESS_PARTS.map((p) => [p.field, doc.noAddresses ? null : optionalText(body[p.field], p.label, p.max)])
    ) as AddressParts,
    docDate: parseDate(body.docDate, 'Posting Date', true) as string,
    docDueDate: parseDate(body.docDueDate, 'Delivery Date', true) as string,
    taxDate: parseDate(body.taxDate, 'Document Date', false),
    slpCode: optionalInt(body.slpCode, 'Sales Employee'),
    lines,
    totals: calcDocTotals(lines, { by: 'prcnt', value: discPrcnt }),
    docCur: optionalText(body.docCur, 'Currency', 3),
    docRate: 1,
    totalsFC: { discSum: 0, vatSum: 0, docTotal: 0 },
  };
}

const roundTo = (value: number, decimals: number) => Math.round(value * 10 ** decimals) / 10 ** decimals;

/**
 * Settle the document's currency and turn the amounts into SAP's: the prices and the totals worked out from the
 * screen are in the document currency. In a foreign currency they become the FC amounts (totalsFC, each line's
 * totalFrgn) and the local ones (totals, lineTotal) follow at SAP's rate for the Posting Date, as SAP B1 stores them.
 * `keep`: a confirmed document keeps its currency and rate.
 */
export async function applyDocumentCurrency(fields: DocumentFields, keep?: { docCur: string; docRate: number }): Promise<void> {
  const settings = await getCurrencySettings();
  const docCur = await resolveDocumentCurrency(fields.cardCode, fields.docCur, settings);
  if (keep && docCur !== keep.docCur) throw new ValidationError("Currency can't be changed after confirming");
  const isLocal = docCur === settings.local;
  const docRate = isLocal ? 1 : keep ? keep.docRate : await getDocumentRate(docCur, fields.docDate, settings);
  fields.docCur = docCur;
  fields.docRate = docRate;
  if (isLocal) {
    fields.totalsFC = { discSum: 0, vatSum: 0, docTotal: 0 };
    for (const line of fields.lines) line.totalFrgn = 0;
    return;
  }
  const local = (amount: number) => roundTo(toLocal(amount, docRate, settings.direct), 2);
  const t = fields.totals;
  fields.totalsFC = { discSum: t.discSum, vatSum: t.vatSum, docTotal: t.docTotal };
  fields.totals = { ...t, totalBefDisc: local(t.totalBefDisc), discSum: local(t.discSum), vatSum: local(t.vatSum), docTotal: local(t.docTotal) };
  for (const line of fields.lines) {
    line.totalFrgn = Number(line.lineTotal) || 0;
    line.lineTotal = local(line.totalFrgn);
  }
}

/**
 * Query parameters for the totals and currency columns (DiscPrcnt, DiscSum, VatSum, DocTotal in the local currency;
 * DocCur, DocRate, DiscSumFC, VatSumFC, DocTotalFC) - after applyDocumentCurrency
 */
export const totalsParams = (fields: Pick<DocumentFields, 'totals' | 'docCur' | 'docRate' | 'totalsFC'>) => [
  { name: 'discPrcnt', value: fields.totals.discPrcnt },
  { name: 'discSum', value: fields.totals.discSum },
  { name: 'vatSum', value: fields.totals.vatSum },
  { name: 'docTotal', value: fields.totals.docTotal },
  { name: 'docCur', type: sql.NVarChar(3), value: fields.docCur },
  { name: 'docRate', type: sql.Decimal(19, 6), value: fields.docRate },
  { name: 'discSumFC', type: sql.Decimal(19, 6), value: fields.totalsFC.discSum },
  { name: 'vatSumFC', type: sql.Decimal(19, 6), value: fields.totalsFC.vatSum },
  { name: 'docTotalFC', type: sql.Decimal(19, 6), value: fields.totalsFC.docTotal },
];

/** Sales Type must be one of FTS_vw_SalesTyp (a view can't carry a foreign key) */
export async function assertSalesTypeExists(salesTyp: string | null): Promise<void> {
  if (salesTyp === null) return;
  const found = await db.query(`SELECT Code FROM FTS_vw_SalesTyp WHERE Code = @code`, [{ name: 'code', value: salesTyp }]);
  if (found.length === 0) throw new ValidationError('Sales Type is not valid');
}

/** Branch must be an active SAP cost centre of Dimension 1 (OOCR) */
export async function assertDocumentBranch(branch: string | null): Promise<void> {
  if (branch === null) return;
  const found = await db.query(
    `SELECT OcrCode FROM ${sapTable('OOCR')} WHERE DimCode = 1 AND ISNULL(Active, 'Y') = 'Y' AND OcrCode = @branch`,
    [{ name: 'branch', value: branch }]
  );
  if (found.length === 0) throw new ValidationError('Branch is not an active SAP cost centre of Dimension 1');
}

/** Payment Terms must be one of SAP's (OCTG) */
export async function assertPaymentTermsExist(groupNum: number | null): Promise<void> {
  if (groupNum === null) return;
  const found = await db.query(`SELECT GroupNum FROM ${sapTable('OCTG')} WHERE GroupNum = @groupNum`, [
    { name: 'groupNum', value: groupNum },
  ]);
  if (found.length === 0) throw new ValidationError('Payment Terms is not valid');
}

/** Each line's Sales UoM must be one of SAP's units of measure (OUOM) */
export async function assertSalesUoms(lines: DocumentLineFields[]): Promise<void> {
  const codes = [...new Set(lines.map((l) => l.salesUom).filter((c): c is string => !!c))];
  if (codes.length === 0) return;
  const found = await db.query<{ UomCode: string }>(
    `SELECT UomCode FROM ${sapTable('OUOM')} WHERE UomCode IN (${codes.map((_, i) => `@u${i}`).join(', ')})`,
    codes.map((code, i) => ({ name: `u${i}`, value: code }))
  );
  const known = new Set(found.map((f) => f.UomCode.toUpperCase()));
  const bad = lines.findIndex((l) => l.salesUom && !known.has(l.salesUom.toUpperCase()));
  if (bad >= 0) throw new ValidationError(`Line ${bad + 1}: Export UoM "${lines[bad].salesUom}" is not a unit of measure in SAP`);
}

/** A document type for rebate items only (Credit Memo): every line's item must have U_Rebate = 'Y' in SAP */
export async function assertRebateItems(doc: SalesDocType, lines: DocumentLineFields[]): Promise<void> {
  if (!doc.rebateItemsOnly) return;
  const itemCodes = [...new Set(lines.map((l) => l.itemCode))];
  if (itemCodes.length === 0) return;
  // A company database without the U_Rebate field has no rebate items
  const rebateColumn = await sapColumnOr('OITM', 'U_Rebate', 'i');
  const rebate = await db.query<{ ItemCode: string }>(
    `SELECT i.ItemCode FROM ${sapTable('OITM')} i WHERE ${rebateColumn} = 'Y' AND i.ItemCode IN (${itemCodes.map((_, i) => `@item${i}`).join(', ')})`,
    itemCodes.map((code, i) => ({ name: `item${i}`, value: code }))
  );
  const found = new Set(rebate.map((r) => r.ItemCode.toUpperCase()));
  const others = itemCodes.filter((c) => !found.has(c.toUpperCase()));
  if (others.length > 0) {
    throw new ValidationError(`A ${doc.label.toLowerCase()} can only have rebate items; not a rebate item: ${others.join(', ')}`);
  }
}

/** The customer must exist in SAP B1 */
export async function assertCustomerExists(
  cardCode: string,
  doc?: SalesDocType,
  savedCardCode?: string | null
): Promise<void> {
  const found = await db.query(`SELECT CardCode FROM ${sapTable('OCRD')} WHERE CardCode = @cardCode`, [
    { name: 'cardCode', value: cardCode },
  ]);
  if (found.length > 0) return;
  // A Sales Quotation may be for a lead (FTS11LEAD): an OPEN one — or the lead it was already saved with
  if (doc?.allowsLeads) {
    const lead = await db.query<{ DocStatus: string }>(`SELECT DocStatus FROM FTS11LEAD WHERE LeadCode = @cardCode`, [
      { name: 'cardCode', value: cardCode },
    ]);
    if (lead.length > 0 && (lead[0].DocStatus === DOC_STATUS.open || cardCode === savedCardCode)) return;
    if (lead.length > 0) throw new ValidationError(`Lead ${cardCode} is ${lead[0].DocStatus}; only an OPEN lead can be chosen`);
  }
  throw new ValidationError('Customer does not exist in SAP');
}

/** The series must be an active series of this document type */
export async function assertDocumentSeries(doc: SalesDocType, series: number | null): Promise<void> {
  if (series === null) return;
  const found = await db.query(
    `SELECT DocEntry FROM FTS11NNM1 WHERE DocEntry = @series AND ObjType = @objType AND Active = 1`,
    [
      { name: 'series', value: series },
      { name: 'objType', value: doc.objType },
    ]
  );
  if (found.length === 0) throw new ValidationError(`Series is not an active ${doc.label} series`);
}

const baseKey = (b: LineBase) => `${b.baseType}|${b.baseEntry}|${b.baseLine}`;

/** Document types whose lines can be copied from `doc` (e.g. Sales Orders copy from a Sales Quotation) */
const targetsOf = (doc: SalesDocType) =>
  Object.values(DOC_TYPES).filter((t) => t.copyFrom?.some((s) => s.objType === doc.objType));

/** How much of each line of a document has been copied into later documents (all their lines added up), by LineNum */
async function copiedQuantities(doc: SalesDocType, docEntry: number, transaction: sql.Transaction): Promise<Map<number, number>> {
  const copied = new Map<number, number>();
  for (const target of targetsOf(doc)) {
    // Lines of canceled documents gave their quantity back
    const rows = await db.query<{ BaseLine: number; Qty: number }>(
      `SELECT BaseLine, SUM(Quantity) AS Qty FROM ${target.lines} WITH (UPDLOCK, HOLDLOCK)
       WHERE BaseType = @objType AND BaseEntry = @docEntry AND LineStatus <> '${LINE_STATUS.canceled}'
       GROUP BY BaseLine`,
      [
        { name: 'objType', value: doc.objType },
        { name: 'docEntry', value: docEntry },
      ],
      transaction
    );
    for (const row of rows) copied.set(row.BaseLine, (copied.get(row.BaseLine) ?? 0) + Number(row.Qty));
  }
  return copied;
}

/**
 * Check the source lines a document's lines are copied from (Copy From / Copy To), locking them meanwhile:
 * they must still exist, be for the same customer and item; a line copied for the first time needs an OPEN
 * source document with something still open on that line. Returns each source document's No. (BaseRef).
 */
async function checkSourceLines(
  doc: SalesDocType,
  cardCode: string,
  bases: Map<string, { base: LineBase; itemCode: string; isNew: boolean }>,
  transaction: sql.Transaction
): Promise<Map<string, string | null>> {
  const baseRefs = new Map<string, string | null>();
  for (const [key, { base, itemCode, isNew }] of bases) {
    const source = DOC_TYPES[base.baseType];
    if (!source || !doc.copyFrom?.some((t) => t.objType === source.objType)) {
      throw new ValidationError(`${doc.label} lines can't be copied from ${base.baseType}`);
    }
    const rows = await db.query<{
      LineStatus: string | null;
      OpenQty: number;
      ItemCode: string;
      DocStatus: string;
      CardCode: string;
      DocNum: string | null;
      IsLead: number;
      LeadCardCode: string | null;
    }>(
      // A source made for a lead (a quotation) belongs to the SAP customer the lead was posted as (its CardCode)
      `SELECT l.LineStatus, l.OpenQty, l.ItemCode, h.DocStatus, h.CardCode, h.DocNum,
              CASE WHEN ld.DocEntry IS NULL THEN 0 ELSE 1 END AS IsLead, ld.CardCode AS LeadCardCode
       FROM ${source.lines} l WITH (UPDLOCK, HOLDLOCK)
       JOIN ${source.header} h WITH (UPDLOCK, HOLDLOCK) ON h.DocEntry = l.DocEntry
       LEFT JOIN FTS11LEAD ld ON ld.LeadCode = h.CardCode
       WHERE l.DocEntry = @docEntry AND l.LineNum = @lineNum`,
      [
        { name: 'docEntry', value: base.baseEntry },
        { name: 'lineNum', value: base.baseLine },
      ],
      transaction
    );
    const line = rows[0];
    const sourceName = `${source.label} ${line?.DocNum ?? base.baseEntry}`;
    if (!line) throw new ValidationError(`The copied line of ${sourceName} no longer exists`);
    if (line.IsLead === 1 && !line.LeadCardCode) {
      throw new ValidationError(
        `${sourceName} is for lead ${line.CardCode}, which is not an SAP customer yet (Convert to Customer), so it can't be copied to a ${doc.label.toLowerCase()}`
      );
    }
    const sourceCustomer = line.IsLead === 1 ? line.LeadCardCode : line.CardCode;
    if (sourceCustomer !== cardCode) throw new ValidationError(`${sourceName} is for another customer`);
    if (itemCode !== line.ItemCode) throw new ValidationError(`The item of a line copied from ${sourceName} can't be changed`);
    if (isNew) {
      if (line.DocStatus !== DOC_STATUS.open) throw new ValidationError(`${sourceName} is ${line.DocStatus} and can't be copied`);
      // A line can be copied only while it is OPEN and still has quantity open
      if (line.LineStatus !== LINE_STATUS.open) {
        throw new ValidationError(`Item ${line.ItemCode} on ${sourceName} is ${line.LineStatus} and can't be copied`);
      }
      if (!(Number(line.OpenQty) > 0)) {
        throw new ValidationError(`Item ${line.ItemCode} on ${sourceName} has nothing open to copy`);
      }
    }
    baseRefs.set(key, line.DocNum);
  }
  return baseRefs;
}

/**
 * Work the source lines' OpenQty out again from scratch, once the copying lines are saved:
 *   OpenQty = Quantity - everything copied from it (all later documents' lines added up), and never below 0.
 * Like SAP B1, a later document may take more than was open; the source line then just stays at 0.
 * LineStatus follows: CLOSED at 0, OPEN otherwise. A source document closes when all its lines are CLOSED, and opens
 * again when one is OPEN.
 * ClosedBy / ClosedDate (line and document) = the user whose save closed it, and when; cleared when it opens again.
 */
async function refreshSourceLines(bases: LineBase[], userName: string, transaction: sql.Transaction): Promise<void> {
  const touched = new Map<string, { source: SalesDocType; docEntry: number }>();
  for (const base of bases) {
    const source = DOC_TYPES[base.baseType];
    if (!source) continue;
    let copied = 0;
    for (const target of targetsOf(source)) {
      const rows = await db.query<{ Qty: number | null }>(
        `SELECT SUM(Quantity) AS Qty FROM ${target.lines}
         WHERE BaseType = @baseType AND BaseEntry = @baseEntry AND BaseLine = @baseLine
           AND LineStatus <> '${LINE_STATUS.canceled}'`,
        [
          { name: 'baseType', value: base.baseType },
          { name: 'baseEntry', value: base.baseEntry },
          { name: 'baseLine', value: base.baseLine },
        ],
        transaction
      );
      copied += Number(rows[0]?.Qty ?? 0);
    }
    // In SET, LineStatus / ClosedBy / ClosedDate still read the values from before this update:
    // closing now -> this user and now; already closed -> kept; open -> cleared.
    // Left alone: canceled lines, lines closed by hand, and documents closed by hand / canceled (they never reopen).
    await db.query(
      `UPDATE l
       SET OpenQty = CASE WHEN l.Quantity - @copied > 0 THEN l.Quantity - @copied ELSE 0 END,
           LineStatus = CASE WHEN l.Quantity - @copied > 0 THEN @lineOpen ELSE @lineClosed END,
           ClosedBy = CASE WHEN l.Quantity - @copied > 0 THEN NULL
                           WHEN l.LineStatus = @lineClosed THEN l.ClosedBy ELSE @userName END,
           ClosedDate = CASE WHEN l.Quantity - @copied > 0 THEN NULL
                             WHEN l.LineStatus = @lineClosed THEN l.ClosedDate ELSE GETDATE() END
       FROM ${source.lines} l
       JOIN ${source.header} h ON h.DocEntry = l.DocEntry
       WHERE l.DocEntry = @baseEntry AND l.LineNum = @baseLine
         AND l.LineStatus <> '${LINE_STATUS.canceled}' AND NOT (${CLOSED_BY_HAND('l')})
         AND h.DocStatus <> '${DOC_STATUS.canceled}'
         AND NOT (h.DocStatus = '${DOC_STATUS.closed}' AND ${DOC_CLOSED_BY_HAND(source, 'h')})`,
      [
        { name: 'copied', value: copied },
        { name: 'lineOpen', value: LINE_STATUS.open },
        { name: 'lineClosed', value: LINE_STATUS.closed },
        { name: 'userName', value: userName },
        { name: 'baseEntry', value: base.baseEntry },
        { name: 'baseLine', value: base.baseLine },
      ],
      transaction
    );
    touched.set(`${source.objType}|${base.baseEntry}`, { source, docEntry: base.baseEntry });
  }

  for (const { source, docEntry } of touched.values()) await refreshDocStatus(source, docEntry, userName, transaction);
}

/**
 * An OPEN / CLOSED document's status from its lines: CLOSED when all are CLOSED, OPEN when one is OPEN, with
 * ClosedBy / ClosedDate = the user whose save closed it (cleared when it opens again). Drafts are left alone.
 */
async function refreshDocStatus(doc: SalesDocType, docEntry: number, userName: string, transaction: sql.Transaction) {
  // In SET, DocStatus / ClosedBy / ClosedDate still read the values from before this update
  await db.query(
    `DECLARE @newStatus NVARCHAR(20) =
       CASE WHEN EXISTS (SELECT 1 FROM ${doc.lines} WHERE DocEntry = @docEntry AND LineStatus = @lineOpen)
            THEN @open ELSE @closed END;
     UPDATE h
     SET ClosedBy = CASE WHEN @newStatus = @open THEN NULL WHEN h.DocStatus = @closed THEN h.ClosedBy ELSE @userName END,
         ClosedDate = CASE WHEN @newStatus = @open THEN NULL WHEN h.DocStatus = @closed THEN h.ClosedDate ELSE GETDATE() END,
         DocStatus = @newStatus
     FROM ${doc.header} h
     WHERE h.DocEntry = @docEntry
       -- OPEN, or CLOSED by itself (everything copied); a document closed by hand stays closed
       AND (h.DocStatus = @open OR (h.DocStatus = @closed AND NOT ${DOC_CLOSED_BY_HAND(doc, 'h')}))`,
    [
      { name: 'docEntry', value: docEntry },
      { name: 'open', value: DOC_STATUS.open },
      { name: 'closed', value: DOC_STATUS.closed },
      { name: 'lineOpen', value: LINE_STATUS.open },
      { name: 'userName', value: userName },
    ],
    transaction
  );
}

/**
 * Replace a document's lines inside a transaction.
 * LineNum is each line's permanent key, as in SAP B1: a line that was already saved keeps its LineNum wherever it now
 * is, a new line gets the next number after the highest one saved, and VisOrder is the line's position on screen.
 * Lines that were already saved keep what isn't on screen: CreatedBy / CreatedDate and BaseType / BaseEntry /
 * BaseLine / BaseRef. A new line copied from another document (Copy From / Copy To) gets BaseType / BaseEntry /
 * BaseLine from it and BaseRef = that document's No.
 * OpenQty is always worked out from what has been copied on (Quantity - copied, never below 0): for this document's
 * own lines, and — after saving — for the source lines it copies from (so removing / reducing a copied line gives
 * the quantity back). A line that has been copied on can't be removed or reduced below what was copied; the later
 * documents' links (BaseLine) point at its LineNum, so moving it doesn't change them.
 * Every saved line gets UpdatedBy / UpdatedDate.
 */
export async function saveDocumentLines(
  doc: SalesDocType,
  docEntry: number,
  cardCode: string,
  lines: DocumentLineFields[],
  userName: string,
  transaction: sql.Transaction
): Promise<void> {
  const existing = await db.query<{
    LineNum: number;
    VisOrder: number;
    Quantity: number;
    CreatedBy: string | null;
    CreatedDate: Date | null;
    BaseType: string | null;
    BaseEntry: number | null;
    BaseLine: number | null;
    BaseRef: string | null;
    OpenQty: number;
    LineStatus: string;
    ClosedBy: string | null;
    ClosedDate: Date | null;
    CanceledBy: string | null;
    CanceledDate: Date | null;
  }>(
    `SELECT LineNum, VisOrder, Quantity, CreatedBy, CreatedDate, BaseType, BaseEntry, BaseLine, BaseRef,
            OpenQty, LineStatus, ClosedBy, ClosedDate, CanceledBy, CanceledDate
     FROM ${doc.lines} WITH (UPDLOCK, HOLDLOCK) WHERE DocEntry = @docEntry`,
    [{ name: 'docEntry', value: docEntry }],
    transaction
  );
  const saved = new Map(existing.map((row) => [row.LineNum, row]));

  // ---- Each line's LineNum: kept for a saved line (only once, should the screen send it twice), next number for a new one ----
  let nextLineNum = existing.reduce((max, row) => Math.max(max, row.LineNum + 1), 0);
  const taken = new Set<number>();
  lines = lines.map((line) => {
    if (line.origLineNum !== null && saved.has(line.origLineNum) && !taken.has(line.origLineNum)) {
      taken.add(line.origLineNum);
      return line;
    }
    return { ...line, origLineNum: null };
  });
  const lineNumOf = lines.map((line) => line.origLineNum ?? nextLineNum++);

  // ---- This document's own lines that were copied on to later documents ----
  const copiedOn = await copiedQuantities(doc, docEntry, transaction);
  for (const row of existing) {
    const copied = copiedOn.get(row.LineNum) ?? 0;
    if (copied <= 0) continue;
    const kept = lines.find((l) => l.origLineNum === row.LineNum);
    if (!kept) throw new ValidationError(`Line ${row.VisOrder + 1} was copied to a later document and can't be removed`);
    // Can't go below what was copied (a later document that took more than this line had keeps it at its quantity)
    const least = Math.min(copied, Number(row.Quantity));
    if (kept.quantity < least) {
      throw new ValidationError(`Line ${kept.lineNum + 1}: ${least} was already copied to a later document, so Quantity can't be less`);
    }
  }

  // ---- Lines of this document copied from other documents ----
  const baseOf = (line: DocumentLineFields): LineBase | null => {
    const before = line.origLineNum !== null ? saved.get(line.origLineNum) : undefined;
    if (before) {
      return before.BaseType && before.BaseEntry !== null && before.BaseLine !== null
        ? { baseType: before.BaseType, baseEntry: before.BaseEntry, baseLine: before.BaseLine }
        : null;
    }
    return line.copiedFrom;
  };
  const referencedBefore = new Set(
    existing
      .filter((r) => r.BaseType && r.BaseEntry !== null && r.BaseLine !== null)
      .map((r) => baseKey({ baseType: r.BaseType as string, baseEntry: r.BaseEntry as number, baseLine: r.BaseLine as number }))
  );
  const bases = new Map<string, { base: LineBase; itemCode: string; isNew: boolean }>();
  for (const line of lines) {
    const base = baseOf(line);
    if (base) bases.set(baseKey(base), { base, itemCode: line.itemCode, isNew: !referencedBefore.has(baseKey(base)) });
  }
  const baseRefs = bases.size > 0 ? await checkSourceLines(doc, cardCode, bases, transaction) : new Map<string, string | null>();

  // ---- Save the lines ----
  await db.query(`DELETE FROM ${doc.lines} WHERE DocEntry = @docEntry`, [{ name: 'docEntry', value: docEntry }], transaction);

  for (const [index, line] of lines.entries()) {
    const before = line.origLineNum !== null ? saved.get(line.origLineNum) : undefined;
    const base = baseOf(line);
    const copied = line.origLineNum !== null ? (copiedOn.get(line.origLineNum) ?? 0) : 0;
    // A canceled line, or one closed by hand, keeps its status and OpenQty; otherwise the status follows OpenQty
    const frozen =
      before?.LineStatus === LINE_STATUS.canceled ||
      (before?.LineStatus === LINE_STATUS.closed && Number(before.OpenQty) > 0);
    const openQty = frozen ? Number(before?.OpenQty) : Math.max(0, line.quantity - copied);
    const lineStatus = frozen ? (before?.LineStatus as string) : lineStatusOf(openQty);
    // Closed by this save -> this user and now; closed before -> kept; open -> none
    const closedBefore = before?.LineStatus === LINE_STATUS.closed;
    const closed = lineStatus === LINE_STATUS.closed;
    const closedBy = closed ? (closedBefore ? before?.ClosedBy ?? null : userName) : null;
    const closedDate = closed ? (closedBefore ? before?.ClosedDate ?? null : new Date()) : null;
    await db.query(
      `INSERT INTO ${doc.lines} (DocEntry, LineNum, VisOrder, ItemCode, Dscription, Quantity, OpenQty, LineStatus, UomCode, PriceBefDi, DiscPrcnt, Price,
                                 VatGroup, VatPrcnt, LineTotal, WhsCode, Text, BaseType, BaseEntry, BaseLine, BaseRef, IsFOC,
                                 SalesQty, SalesUoM, SalesPrice, TotalFrgn, ClosedBy, ClosedDate, CanceledBy, CanceledDate,
                                 CreatedBy, CreatedDate, UpdatedBy, UpdatedDate)
       VALUES (@docEntry, @lineNum, @visOrder, @itemCode, @dscription, @quantity, @openQty, @lineStatus, @uomCode, @priceBefDi, @discPrcnt, @price,
               @vatGroup, @vatPrcnt, @lineTotal, @whsCode, @text, @baseType, @baseEntry, @baseLine, @baseRef, @isFoc,
               @salesQty, @salesUom, @salesPrice, @totalFrgn, @closedBy, @closedDate, @canceledBy, @canceledDate,
               ISNULL(@createdBy, @userName), ISNULL(@createdDate, GETDATE()), @userName, GETDATE())`,
      [
        { name: 'docEntry', value: docEntry },
        { name: 'lineNum', value: lineNumOf[index] },
        { name: 'visOrder', value: index },
        { name: 'itemCode', value: line.itemCode },
        { name: 'dscription', value: line.dscription },
        { name: 'quantity', value: line.quantity },
        { name: 'openQty', value: openQty },
        { name: 'lineStatus', value: lineStatus },
        { name: 'uomCode', value: line.uomCode },
        { name: 'priceBefDi', value: line.priceBefDi },
        { name: 'discPrcnt', value: line.discPrcnt },
        { name: 'price', value: line.price },
        { name: 'vatGroup', value: line.vatGroup },
        { name: 'vatPrcnt', value: line.vatPrcnt },
        { name: 'lineTotal', value: line.lineTotal },
        { name: 'whsCode', value: line.whsCode },
        { name: 'text', value: line.text },
        { name: 'isFoc', type: sql.Bit, value: line.isFoc ? 1 : 0 },
        { name: 'salesQty', type: sql.Decimal(19, 6), value: line.salesQty ?? null },
        { name: 'salesUom', type: sql.NVarChar(10), value: line.salesUom ?? null },
        { name: 'salesPrice', type: sql.Decimal(19, 6), value: line.salesPrice ?? null },
        { name: 'totalFrgn', type: sql.Decimal(19, 6), value: line.totalFrgn ?? 0 },
        { name: 'baseType', type: sql.NVarChar(20), value: base?.baseType ?? null },
        { name: 'baseEntry', type: sql.Int, value: base?.baseEntry ?? null },
        { name: 'baseLine', type: sql.Int, value: base?.baseLine ?? null },
        // BaseRef = the source document's No.
        { name: 'baseRef', type: sql.NVarChar(20), value: base ? (baseRefs.get(baseKey(base)) ?? before?.BaseRef ?? null) : null },
        // Typed: an untyped empty value would make ISNULL(...) a 1-character text instead of a date / user name
        { name: 'createdBy', type: sql.NVarChar(50), value: before?.CreatedBy ?? null },
        { name: 'createdDate', type: sql.DateTime, value: before?.CreatedDate ?? null },
        { name: 'closedBy', type: sql.NVarChar(50), value: closedBy },
        { name: 'closedDate', type: sql.DateTime, value: closedDate },
        { name: 'canceledBy', type: sql.NVarChar(50), value: before?.CanceledBy ?? null },
        { name: 'canceledDate', type: sql.DateTime, value: before?.CanceledDate ?? null },
        { name: 'userName', value: userName },
      ],
      transaction
    );
  }

  // ---- Source lines this document copies from (now and before this save): OpenQty and status again ----
  const allBases = new Map<string, LineBase>();
  for (const row of existing) {
    if (row.BaseType && row.BaseEntry !== null && row.BaseLine !== null) {
      const b = { baseType: row.BaseType, baseEntry: row.BaseEntry, baseLine: row.BaseLine };
      allBases.set(baseKey(b), b);
    }
  }
  for (const { base } of bases.values()) allBases.set(baseKey(base), base);
  if (allBases.size > 0) await refreshSourceLines([...allBases.values()], userName, transaction);

  // ---- This document itself: closed when its own lines all are (e.g. reduced to what was already copied) ----
  await refreshDocStatus(doc, docEntry, userName, transaction);
}

// ---------------------------------------------------------------------------
// Open (Confirm / approved)
// ---------------------------------------------------------------------------

/**
 * Open a DRAFT document: its No. from the series, status OPEN (Posting Date then locked) and its approval status.
 * Used by Confirm when no approval is needed, and by the approval step once the last stage approves.
 * ConfirmedBy / Date: set now, unless already set when the document was sent for approval.
 */
export async function openDocument(
  doc: SalesDocType,
  docEntry: number,
  userName: string,
  apprStatus: string,
  transaction: sql.Transaction
): Promise<void> {
  const rows = await db.query<{ Series: number; DocDate: Date }>(
    `SELECT Series, DocDate FROM ${doc.header} WHERE DocEntry = @docEntry`,
    [{ name: 'docEntry', value: docEntry }],
    transaction
  );
  const docNum = await numberForOpen({ table: doc.header, column: 'DocNum', label: doc.label.toLowerCase() }, docEntry, rows[0].Series, rows[0].DocDate, transaction);

  await db.query(
    `UPDATE ${doc.header}
     SET DocNum = @docNum, DocStatus = @open, ApprStatus = @apprStatus,
         ConfirmedBy = ISNULL(ConfirmedBy, @userName), ConfirmedDate = ISNULL(ConfirmedDate, GETDATE()),
         UpdatedBy = @userName, UpdatedDate = GETDATE()
     WHERE DocEntry = @docEntry`,
    [
      { name: 'docEntry', value: docEntry },
      { name: 'docNum', value: docNum },
      { name: 'open', value: DOC_STATUS.open },
      { name: 'apprStatus', value: apprStatus },
      { name: 'userName', value: userName },
    ],
    transaction
  );
}

// ---------------------------------------------------------------------------
// Close / Cancel (as in SAP B1)
// ---------------------------------------------------------------------------

/** The document's status, locked for the rest of the transaction; not found -> 404 */
async function lockDocument(doc: SalesDocType, docEntry: number, transaction: sql.Transaction): Promise<string> {
  const rows = await db.query<{ DocStatus: string }>(
    `SELECT DocStatus FROM ${doc.header} WITH (UPDLOCK, HOLDLOCK) WHERE DocEntry = @docEntry`,
    [{ name: 'docEntry', value: docEntry }],
    transaction
  );
  if (rows.length === 0) throw new NotFoundError(doc.label);
  return rows[0].DocStatus;
}

/**
 * Close Doc: an OPEN document and all its open lines become CLOSED (ClosedBy / ClosedDate), by hand — they never
 * reopen and can't be edited or copied any more. Quantity already copied to later documents stays copied.
 */
export async function closeDocument(doc: SalesDocType, docEntry: number, userName: string, transaction: sql.Transaction) {
  if (doc.noClose) throw new ValidationError(`A ${doc.label.toLowerCase()} can't be closed; use Cancel Doc`);
  const status = await lockDocument(doc, docEntry, transaction);
  if (status !== DOC_STATUS.open) throw new ValidationError(`Only an OPEN ${doc.label.toLowerCase()} can be closed`);
  const params = [
    { name: 'docEntry', value: docEntry },
    { name: 'userName', value: userName },
  ];
  await db.query(
    `UPDATE ${doc.lines}
     SET LineStatus = '${LINE_STATUS.closed}', ClosedBy = @userName, ClosedDate = GETDATE()
     WHERE DocEntry = @docEntry AND LineStatus = '${LINE_STATUS.open}'`,
    params,
    transaction
  );
  await db.query(
    `UPDATE ${doc.header}
     SET DocStatus = '${DOC_STATUS.closed}', ClosedBy = @userName, ClosedDate = GETDATE(),
         UpdatedBy = @userName, UpdatedDate = GETDATE()
     WHERE DocEntry = @docEntry`,
    params,
    transaction
  );
}

/**
 * Cancel Doc: a DRAFT or OPEN document that nothing has been copied from yet becomes CANCELED, with all its lines
 * (CanceledBy / CanceledDate). What its lines had copied from other documents is given back to them, which may
 * reopen those lines and documents (unless they were closed by hand).
 */
export async function cancelDocument(doc: SalesDocType, docEntry: number, userName: string, transaction: sql.Transaction) {
  const status = await lockDocument(doc, docEntry, transaction);
  if (status !== DOC_STATUS.draft && status !== DOC_STATUS.open) {
    throw new ValidationError(`A ${status} ${doc.label.toLowerCase()} can't be canceled`);
  }
  const copiedOn = await copiedQuantities(doc, docEntry, transaction);
  if ([...copiedOn.values()].some((qty) => qty > 0)) {
    const targets = targetsOf(doc).map((t) => t.label.toLowerCase()).join(' / ');
    throw new ValidationError(`This ${doc.label.toLowerCase()} has been copied to a ${targets} and can't be canceled`);
  }

  // Source lines this document copied from, to give their quantity back once its lines are canceled
  const baseRows = await db.query<{ BaseType: string; BaseEntry: number; BaseLine: number }>(
    `SELECT DISTINCT BaseType, BaseEntry, BaseLine FROM ${doc.lines}
     WHERE DocEntry = @docEntry AND BaseType IS NOT NULL AND BaseEntry IS NOT NULL AND BaseLine IS NOT NULL`,
    [{ name: 'docEntry', value: docEntry }],
    transaction
  );

  const params = [
    { name: 'docEntry', value: docEntry },
    { name: 'userName', value: userName },
  ];
  await db.query(
    `UPDATE ${doc.lines}
     SET LineStatus = '${LINE_STATUS.canceled}', CanceledBy = @userName, CanceledDate = GETDATE()
     WHERE DocEntry = @docEntry`,
    params,
    transaction
  );
  await db.query(
    `UPDATE ${doc.header}
     SET DocStatus = '${DOC_STATUS.canceled}', CanceledBy = @userName, CanceledDate = GETDATE(),
         UpdatedBy = @userName, UpdatedDate = GETDATE()
     WHERE DocEntry = @docEntry`,
    params,
    transaction
  );

  if (baseRows.length > 0) {
    const bases = baseRows.map((r) => ({ baseType: r.BaseType, baseEntry: r.BaseEntry, baseLine: r.BaseLine }));
    await refreshSourceLines(bases, userName, transaction);
  }
}

/**
 * Close Line: the chosen OPEN lines of an OPEN document become CLOSED by hand (ClosedBy / ClosedDate), keeping their
 * OpenQty; they can't be copied any more and never reopen. The document closes when no open line is left.
 * Returns how many lines were closed (lines already closed are skipped).
 */
export async function closeDocumentLines(
  doc: SalesDocType,
  docEntry: number,
  lineNums: number[],
  userName: string,
  transaction: sql.Transaction
): Promise<number> {
  const wanted = [...new Set(lineNums)].filter((n) => Number.isInteger(n) && n >= 0);
  if (doc.noClose) throw new ValidationError(`Lines of a ${doc.label.toLowerCase()} can't be closed; use Cancel Doc`);
  if (wanted.length === 0) throw new ValidationError('Tick the lines to close');
  const status = await lockDocument(doc, docEntry, transaction);
  if (status !== DOC_STATUS.open) throw new ValidationError(`Lines can only be closed on an OPEN ${doc.label.toLowerCase()}`);

  const result = await db.query<{ LineNum: number }>(
    `UPDATE ${doc.lines}
     SET LineStatus = '${LINE_STATUS.closed}', ClosedBy = @userName, ClosedDate = GETDATE()
     OUTPUT INSERTED.LineNum
     WHERE DocEntry = @docEntry AND LineStatus = '${LINE_STATUS.open}'
       AND LineNum IN (${wanted.map((_, i) => `@line${i}`).join(', ')})`,
    [
      { name: 'docEntry', value: docEntry },
      { name: 'userName', value: userName },
      ...wanted.map((n, i) => ({ name: `line${i}`, value: n })),
    ],
    transaction
  );
  if (result.length === 0) throw new ValidationError('The ticked lines are already closed');

  await refreshDocStatus(doc, docEntry, userName, transaction);
  return result.length;
}

/**
 * Lines that can be copied into a new document of `doc` (Copy From): the OPEN lines with quantity open of OPEN documents
 * of the types it copies from, for one customer, oldest first.
 */
export async function getCopySourceLines(doc: SalesDocType, cardCode: string) {
  const results = [];
  for (const source of doc.copyFrom ?? []) {
    const rows = await db.query(
      `SELECT h.ObjType AS BaseType, h.DocEntry AS BaseEntry, l.LineNum AS BaseLine, l.VisOrder AS BaseVisOrder, h.DocNum AS BaseRef, h.DocDate,
              l.ItemCode, l.Dscription, l.Quantity, l.OpenQty, l.UomCode, l.PriceBefDi, l.DiscPrcnt, l.Price,
              l.VatGroup, l.VatPrcnt, l.WhsCode, l.Text, l.IsFOC AS IsFoc, l.SalesQty, l.SalesUoM AS SalesUom, l.SalesPrice,
              ${await itemMoqSql('l')}, h.DiscPrcnt AS BaseDiscPrcnt,
              ISNULL(h.DocCur, (SELECT TOP 1 a.MainCurncy FROM ${sapTable('OADM')} a) COLLATE DATABASE_DEFAULT) AS BaseDocCur
       FROM ${source.header} h
       JOIN ${source.lines} l ON l.DocEntry = h.DocEntry
       -- The customer's own documents, and those made for a lead that was posted to SAP as this customer
       WHERE (h.CardCode = @cardCode OR h.CardCode IN (SELECT LeadCode FROM FTS11LEAD WHERE CardCode = @cardCode))
         AND h.DocStatus = @open AND l.LineStatus = @lineOpen AND l.OpenQty > 0
       ORDER BY h.DocDate, h.DocEntry, l.VisOrder, l.LineNum`,
      [
        { name: 'cardCode', value: cardCode },
        { name: 'open', value: DOC_STATUS.open },
        { name: 'lineOpen', value: LINE_STATUS.open },
      ]
    );
    results.push(...rows);
  }
  return results;
}


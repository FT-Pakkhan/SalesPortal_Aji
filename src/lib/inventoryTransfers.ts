import type sql from 'mssql';
import { db } from './db';
import { NotFoundError, ValidationError } from './errors';
import { sapTable } from './sapDb';
import { assertUomsValid, uomColumns, uomFactor, uomItemJoin } from './sapUom';
import { APPR_STATUS, assertNotSynced } from './salesDocuments';
import { keepManualNumber, numberForOpen } from './documentNumbering';
import type { NumberedTable } from './documentNumbering';
import { WENT_THROUGH_APPROVAL, createApprovalRequests, notifyFirstApprovers, templatesNeedingApproval, wentThroughApproval } from './approvalCheck';

// Inventory Transfers (FTS11OWTR header, FTS11WTR1 lines), mirroring SAP B1 OWTR / WTR1: stock moved from one
// warehouse to another.
//   Save = DRAFT without a No.; Confirm = approval templates first (as on the other documents), then the No. from
//   Document Numbering (a series of type Inventory Transfer) and OPEN — refused if a From warehouse hasn't the stock
//   in SAP B1 (OITW.OnHand). Cancel Doc = CANCELED. SAP B1 doesn't close transfers, so there is no Close.
//   A new line's From is the item's default warehouse (or else SAP's default warehouse), its To the header's To;
//   each line keeps its own. The header's From Warehouse is optional (shown in the list and on layouts).
//   Quantities are in the item's inventory unit (OITM.InvntryUom).

/** Document type (FTS_vw_ObjType.Code): numbering series, approvals, attachments and layouts are kept under it */
export const OWTR_OBJTYPE = 'FTS11OWTR';

export const OWTR_NUMBER: NumberedTable = { table: 'FTS11OWTR', column: 'DocNum', label: 'inventory transfer' };
export const OWTR_STATUS = { draft: 'DRAFT', open: 'OPEN', canceled: 'CANCELED' } as const;
const LABEL = 'inventory transfer';

/** A function because the SAP database name (warehouse / sales employee names) comes from .env.local */
export const transferSelect = () => `
  SELECT t.DocEntry, t.DocNum, t.Series, n.Series AS SeriesCode, n.SeriesName, t.ObjType,
         t.CardCode, t.CardName, t.DocDate, t.TaxDate,
         t.Filler, (SELECT w.WhsName FROM ${sapTable('OWHS')} w WHERE w.WhsCode = t.Filler COLLATE DATABASE_DEFAULT) AS FillerName,
         t.ToWhsCode, (SELECT w.WhsName FROM ${sapTable('OWHS')} w WHERE w.WhsCode = t.ToWhsCode COLLATE DATABASE_DEFAULT) AS ToWhsName,
         t.SlpCode, (SELECT sp.SlpName FROM ${sapTable('OSLP')} sp WHERE sp.SlpCode = t.SlpCode) AS SlpName,
         t.Comments, t.DocStatus, st.Name AS DocStatusName, t.ApprStatus, aps.Name AS ApprStatusName,
         t.PostStatus, pst.Name AS PostStatusName, t.ErrorDesc, t.SAPDocNum,
         t.ConfirmedBy, t.ConfirmedDate, t.CanceledBy, t.CanceledDate, t.CreatedBy, t.UpdatedBy,
         CAST(CASE WHEN ${WENT_THROUGH_APPROVAL(`'${OWTR_OBJTYPE}'`, 't.DocEntry')} THEN 1 ELSE 0 END AS BIT) AS ApprLocked,
         (SELECT COUNT(*) FROM FTS11WTR1 l WHERE l.DocEntry = t.DocEntry) AS LineCount,
         (SELECT SUM(l.Quantity) FROM FTS11WTR1 l WHERE l.DocEntry = t.DocEntry) AS TotalQuantity
  FROM FTS11OWTR t
  LEFT JOIN FTS11NNM1 n ON n.DocEntry = t.Series
  LEFT JOIN FTS_vw_DocStatus st ON st.Code = t.DocStatus
  LEFT JOIN FTS_vw_ApprStatus aps ON aps.Code = t.ApprStatus
  LEFT JOIN FTS_vw_PostStatus pst ON pst.Code = t.PostStatus`;

/** A transfer with its lines (and each line's stock in its From warehouse now, from SAP B1) */
export async function getTransfer(docEntry: number) {
  const rows = await db.query(`${transferSelect()} WHERE t.DocEntry = @docEntry`, [{ name: 'docEntry', value: docEntry }]);
  if (rows.length === 0) throw new NotFoundError('Inventory transfer');
  const lines = await db.query(
    `SELECT l.LineNum, l.VisOrder, l.ItemCode, l.Dscription, l.Quantity, l.UomCode, l.FromWhsCod, l.WhsCode, l.Text,
            (SELECT s.OnHand FROM ${sapTable('OITW')} s
             WHERE s.ItemCode = l.ItemCode COLLATE DATABASE_DEFAULT AND s.WhsCode = l.FromWhsCod COLLATE DATABASE_DEFAULT) AS OnHand
     FROM FTS11WTR1 l WHERE l.DocEntry = @docEntry ORDER BY l.VisOrder, l.LineNum`,
    [{ name: 'docEntry', value: docEntry }]
  );
  return { ...rows[0], Lines: lines };
}

// ============================================
// Input
// ============================================

export interface TransferLineInput {
  /** The line's permanent key when it was loaded; null for a line added on screen */
  lineNum: number | null;
  itemCode: string;
  dscription: string | null;
  quantity: number;
  uomCode: string | null;
  fromWhsCod: string;
  whsCode: string;
  text: string | null;
}

export interface TransferFields {
  series: number | null;
  cardCode: string | null;
  cardName: string | null;
  /** yyyy-mm-dd */
  docDate: string;
  taxDate: string | null;
  filler: string | null;
  toWhsCode: string | null;
  slpCode: number | null;
  comments: string | null;
  lines: TransferLineInput[];
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const text = (value: unknown, max: number, label: string): string | null => {
  const t = String(value ?? '').trim();
  if (t.length > max) throw new ValidationError(`${label} must be ${max} characters or fewer`);
  return t || null;
};

/** Validate a save request */
export function parseTransferFields(body: Record<string, unknown>): TransferFields {
  const series = body.series === null || body.series === undefined || body.series === '' ? null : Number(body.series);
  if (series !== null && (!Number.isInteger(series) || series <= 0)) throw new ValidationError('Series is not valid');
  const docDate = String(body.docDate ?? '');
  if (!DATE.test(docDate)) throw new ValidationError('Posting Date is required');
  const taxDate = body.taxDate ? String(body.taxDate) : null;
  if (taxDate && !DATE.test(taxDate)) throw new ValidationError('Document Date is not valid');
  const slpCode = body.slpCode === null || body.slpCode === undefined || body.slpCode === '' ? null : Number(body.slpCode);
  if (slpCode !== null && !Number.isInteger(slpCode)) throw new ValidationError('Sales Employee is not valid');
  const filler = text(body.filler, 8, 'From Warehouse');
  const toWhsCode = text(body.toWhsCode, 8, 'To Warehouse');
  if (filler && toWhsCode && filler === toWhsCode) throw new ValidationError('From and To Warehouse must be different');

  const rawLines = Array.isArray(body.lines) ? (body.lines as Record<string, unknown>[]) : [];
  const lines = rawLines.map((l, i) => {
    const n = i + 1;
    const itemCode = text(l.itemCode, 50, `Line ${n}: Item No.`);
    if (!itemCode) throw new ValidationError(`Line ${n}: choose an item`);
    const quantity = Number(l.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) throw new ValidationError(`Line ${n} (${itemCode}): Quantity must be more than 0`);
    const fromWhsCod = text(l.fromWhsCod, 8, `Line ${n}: From Warehouse`);
    const whsCode = text(l.whsCode, 8, `Line ${n}: To Warehouse`);
    if (!fromWhsCod) throw new ValidationError(`Line ${n} (${itemCode}): From Warehouse is required`);
    if (!whsCode) throw new ValidationError(`Line ${n} (${itemCode}): To Warehouse is required`);
    if (fromWhsCod === whsCode) throw new ValidationError(`Line ${n} (${itemCode}): From and To Warehouse must be different`);
    const lineNum = l.lineNum === null || l.lineNum === undefined || l.lineNum === '' ? null : Number(l.lineNum);
    if (lineNum !== null && (!Number.isInteger(lineNum) || lineNum < 0)) throw new ValidationError(`Line ${n}: line is not valid`);
    return {
      lineNum,
      itemCode,
      dscription: text(l.dscription, 200, `Line ${n}: Description`),
      quantity: Math.round(quantity * 1e6) / 1e6,
      uomCode: text(l.uomCode, 20, `Line ${n}: UoM`),
      fromWhsCod,
      whsCode,
      text: String(l.text ?? '').trim() || null,
    };
  });

  return {
    series,
    cardCode: text(body.cardCode, 100, 'Business Partner'),
    cardName: text(body.cardName, 200, 'Name'),
    docDate,
    taxDate,
    filler,
    toWhsCode,
    slpCode,
    comments: text(body.comments, 254, 'Remarks'),
    lines,
  };
}

/** Series, business partner, warehouses, items and sales employee must exist (in the portal / SAP B1) */
export async function assertTransferReferences(fields: TransferFields, checkSeries: boolean): Promise<void> {
  if (checkSeries && fields.series !== null) {
    const found = await db.query(`SELECT DocEntry FROM FTS11NNM1 WHERE DocEntry = @series AND ObjType = @objType AND Active = 1`, [
      { name: 'series', value: fields.series },
      { name: 'objType', value: OWTR_OBJTYPE },
    ]);
    if (found.length === 0) throw new ValidationError('Series is not an active Inventory Transfer series');
  }
  if (fields.cardCode) {
    const bp = await db.query(`SELECT CardCode FROM ${sapTable('OCRD')} WHERE CardCode = @cardCode`, [{ name: 'cardCode', value: fields.cardCode }]);
    if (bp.length === 0) throw new ValidationError('Business Partner does not exist in SAP');
  }
  if (fields.slpCode !== null) {
    const sp = await db.query(`SELECT SlpCode FROM ${sapTable('OSLP')} WHERE SlpCode = @slpCode`, [{ name: 'slpCode', value: fields.slpCode }]);
    if (sp.length === 0) throw new ValidationError('Sales Employee does not exist in SAP');
  }
  const warehouses = [...new Set([fields.filler, fields.toWhsCode, ...fields.lines.flatMap((l) => [l.fromWhsCod, l.whsCode])].filter(Boolean))] as string[];
  if (warehouses.length > 0) {
    const found = await db.query<{ WhsCode: string }>(
      `SELECT WhsCode FROM ${sapTable('OWHS')} WHERE WhsCode IN (${warehouses.map((_, i) => `@w${i}`).join(', ')})`,
      warehouses.map((w, i) => ({ name: `w${i}`, value: w }))
    );
    const known = new Set(found.map((w) => w.WhsCode.toUpperCase()));
    const missing = warehouses.find((w) => !known.has(w.toUpperCase()));
    if (missing) throw new ValidationError(`Warehouse ${missing} does not exist in SAP`);
  }
  const items = [...new Set(fields.lines.map((l) => l.itemCode))];
  if (items.length > 0) {
    const found = await db.query<{ ItemCode: string; InvntItem: string }>(
      `SELECT ItemCode, InvntItem FROM ${sapTable('OITM')} WHERE ItemCode IN (${items.map((_, i) => `@i${i}`).join(', ')})`,
      items.map((code, i) => ({ name: `i${i}`, value: code }))
    );
    const byCode = new Map(found.map((f) => [f.ItemCode.toUpperCase(), f]));
    for (const code of items) {
      const item = byCode.get(code.toUpperCase());
      if (!item) throw new ValidationError(`Item ${code} does not exist in SAP`);
      if (item.InvntItem !== 'Y') throw new ValidationError(`Item ${code} is not an inventory item, so it can't be transferred`);
    }
  }
}

/** Parameters of the header fields. Untyped: types set from this shared file aren't recognised by the driver. */
export const transferParams = (f: TransferFields) => [
  { name: 'series', value: f.series },
  { name: 'cardCode', value: f.cardCode },
  { name: 'cardName', value: f.cardName },
  { name: 'docDate', value: f.docDate },
  { name: 'taxDate', value: f.taxDate },
  { name: 'filler', value: f.filler },
  { name: 'toWhsCode', value: f.toWhsCode },
  { name: 'slpCode', value: f.slpCode },
  { name: 'comments', value: f.comments },
];

/**
 * Replace the lines (inside the save's transaction). LineNum is each line's permanent key, as in SAP B1: a line that
 * was already saved keeps its LineNum (and who added it) wherever it now is, a new line gets the next number after the
 * highest one saved, and VisOrder is the line's position on screen.
 */
export async function saveTransferLines(docEntry: number, lines: TransferLineInput[], userName: string, transaction: sql.Transaction) {
  const before = await db.query<{ LineNum: number; CreatedBy: string | null; CreatedDate: Date | null }>(
    `SELECT LineNum, CreatedBy, CreatedDate FROM FTS11WTR1 WITH (UPDLOCK, HOLDLOCK) WHERE DocEntry = @docEntry`,
    [{ name: 'docEntry', value: docEntry }],
    transaction
  );
  const saved = new Map(before.map((b) => [b.LineNum, b]));
  let nextLineNum = before.reduce((max, b) => Math.max(max, b.LineNum + 1), 0);
  const taken = new Set<number>();
  await db.query(`DELETE FROM FTS11WTR1 WHERE DocEntry = @docEntry`, [{ name: 'docEntry', value: docEntry }], transaction);
  for (const [visOrder, l] of lines.entries()) {
    // A saved line keeps its number (only once, should the screen send it twice); a new one gets the next
    const keep = l.lineNum !== null && saved.has(l.lineNum) && !taken.has(l.lineNum);
    const lineNum = keep ? (l.lineNum as number) : nextLineNum++;
    taken.add(lineNum);
    const kept = keep ? saved.get(lineNum) : undefined;
    await db.query(
      `INSERT INTO FTS11WTR1 (DocEntry, LineNum, VisOrder, ItemCode, Dscription, Quantity, UomCode, FromWhsCod, WhsCode, Text,
                              CreatedBy, CreatedDate, UpdatedBy, UpdatedDate)
       VALUES (@docEntry, @lineNum, @visOrder, @itemCode, @dscription, @quantity, @uomCode, @fromWhsCod, @whsCode, @text,
               @createdBy, CASE WHEN @createdDate IS NULL THEN GETDATE() ELSE @createdDate END, @userName, GETDATE())`,
      [
        { name: 'docEntry', value: docEntry },
        { name: 'lineNum', value: lineNum },
        { name: 'visOrder', value: visOrder },
        { name: 'itemCode', value: l.itemCode },
        { name: 'dscription', value: l.dscription },
        { name: 'quantity', value: l.quantity },
        { name: 'uomCode', value: l.uomCode },
        { name: 'fromWhsCod', value: l.fromWhsCod },
        { name: 'whsCode', value: l.whsCode },
        { name: 'text', value: l.text },
        { name: 'createdBy', value: kept?.CreatedBy ?? userName },
        { name: 'createdDate', value: kept?.CreatedDate ?? null },
        { name: 'userName', value: userName },
      ],
      transaction
    );
  }
}

// ============================================
// Status
// ============================================

/** The transfer's status, locked for the rest of the transaction; not found -> 404 */
export async function lockTransfer(docEntry: number, transaction?: sql.Transaction) {
  const rows = await db.query<{ DocStatus: string; ApprStatus: string; PostStatus: string; Series: number | null }>(
    `SELECT DocStatus, ApprStatus, PostStatus, Series FROM FTS11OWTR WITH (UPDLOCK, HOLDLOCK) WHERE DocEntry = @docEntry`,
    [{ name: 'docEntry', value: docEntry }],
    transaction
  );
  if (rows.length === 0) throw new NotFoundError('Inventory transfer');
  return rows[0];
}

/** Can't be changed: waiting for approval, been through it, or synced to SAP */
export async function assertTransferChangeable(docEntry: number, current: { ApprStatus: string; PostStatus: string }, transaction?: sql.Transaction) {
  if (current.ApprStatus === APPR_STATUS.pending || (await wentThroughApproval(OWTR_OBJTYPE, docEntry, transaction))) {
    throw new ValidationError("This inventory transfer is waiting for approval or approved, and can't be changed");
  }
  assertNotSynced(LABEL, current.PostStatus);
}

/**
 * Stock check: each line's unit must be one SAP takes for the item (see sapUom); then for each item and From
 * warehouse, the total quantity on the transfer in stock units (e.g. 1 Carton = 24) must not be more than SAP B1's
 * stock there now (OITW.OnHand). Refused with the item, warehouse and quantity available.
 */
async function assertStockAvailable(docEntry: number, transaction: sql.Transaction): Promise<void> {
  const uoms = await db.query<Record<string, unknown>>(
    `SELECT l.ItemCode, ${uomColumns('l', 'i')} FROM FTS11WTR1 l ${uomItemJoin('l', 'i')} WHERE l.DocEntry = @docEntry`,
    [{ name: 'docEntry', value: docEntry }],
    transaction
  );
  assertUomsValid(uoms);

  const short = await db.query<{ ItemCode: string; FromWhsCod: string; Needed: number; OnHand: number | null }>(
    `SELECT x.ItemCode, x.FromWhsCod, SUM(x.StockQty) AS Needed, MAX(s.OnHand) AS OnHand
     FROM (SELECT l.ItemCode, l.FromWhsCod, l.Quantity * ${uomFactor('l', 'i')} AS StockQty
           FROM FTS11WTR1 l
           ${uomItemJoin('l', 'i')}
           WHERE l.DocEntry = @docEntry) x
     LEFT JOIN ${sapTable('OITW')} s ON s.ItemCode = x.ItemCode COLLATE DATABASE_DEFAULT AND s.WhsCode = x.FromWhsCod COLLATE DATABASE_DEFAULT
     GROUP BY x.ItemCode, x.FromWhsCod
     HAVING SUM(x.StockQty) > ISNULL(MAX(s.OnHand), 0)
     ORDER BY x.ItemCode`,
    [{ name: 'docEntry', value: docEntry }],
    transaction
  );
  if (short.length > 0) {
    const s = short[0];
    const fmt = (n: number | null) => Number(n ?? 0).toLocaleString('en-US', { maximumFractionDigits: 6 });
    throw new ValidationError(
      `Not enough stock: item ${s.ItemCode} needs ${fmt(s.Needed)} from warehouse ${s.FromWhsCod}, but only ${fmt(s.OnHand)} is in stock` +
        (short.length > 1 ? ` (and ${short.length - 1} more line(s) short)` : '')
    );
  }
}

/**
 * Confirm a DRAFT transfer: at least one line and enough stock; then the approval templates (as on the other
 * documents) — approval needed: stays DRAFT + PENDING without a No.; none: its No., OPEN, NO-APPROVAL.
 * Returns the ApprStatus afterwards.
 */
export async function confirmTransfer(docEntry: number, userName: string, transaction: sql.Transaction, manualNo?: unknown): Promise<string> {
  const current = await lockTransfer(docEntry, transaction);
  if (current.DocStatus !== OWTR_STATUS.draft) throw new ValidationError('Only a DRAFT inventory transfer can be confirmed');
  await assertTransferChangeable(docEntry, current, transaction);
  if (current.Series === null) throw new ValidationError('Choose a Series before confirming');
  const lines = await db.query<{ N: number }>(`SELECT COUNT(*) AS N FROM FTS11WTR1 WHERE DocEntry = @docEntry`, [{ name: 'docEntry', value: docEntry }], transaction);
  if ((lines[0]?.N ?? 0) === 0) throw new ValidationError('Add at least one line before confirming');
  await assertStockAvailable(docEntry, transaction);
  // Manual series: the No. keyed in is checked and kept now (also while waiting for approval)
  await keepManualNumber(OWTR_NUMBER, docEntry, current.Series, manualNo, transaction);

  const needing = await templatesNeedingApproval(OWTR_OBJTYPE, docEntry, transaction);
  if (needing.length > 0) {
    await createApprovalRequests(OWTR_OBJTYPE, docEntry, needing, transaction);
    // ConfirmedBy / Date = who sent it for approval, and when (kept when it is approved later)
    await db.query(
      `UPDATE FTS11OWTR SET ApprStatus = @pending, ConfirmedBy = @userName, ConfirmedDate = GETDATE(),
              UpdatedBy = @userName, UpdatedDate = GETDATE()
       WHERE DocEntry = @docEntry`,
      [
        { name: 'docEntry', value: docEntry },
        { name: 'pending', value: APPR_STATUS.pending },
        { name: 'userName', value: userName },
      ],
      transaction
    );
    await notifyFirstApprovers(OWTR_OBJTYPE, docEntry, transaction);
    return APPR_STATUS.pending;
  }
  await openTransfer(docEntry, userName, APPR_STATUS.none, transaction);
  return APPR_STATUS.none;
}

/**
 * Give the transfer its No. from its series (month / year parts from its Posting Date) and set it OPEN with
 * `apprStatus`: NO-APPROVAL on Confirm, APPROVED once fully approved. ConfirmedBy / Date: kept if already set.
 */
export async function openTransfer(docEntry: number, userName: string, apprStatus: string, transaction: sql.Transaction) {
  const rows = await db.query<{ Series: number | null; DocDate: Date }>(
    `SELECT Series, DocDate FROM FTS11OWTR WHERE DocEntry = @docEntry`,
    [{ name: 'docEntry', value: docEntry }],
    transaction
  );
  if (!rows[0]?.Series) throw new ValidationError('The inventory transfer has no Series');
  const docNum = await numberForOpen(OWTR_NUMBER, docEntry, rows[0].Series, rows[0].DocDate, transaction);
  await db.query(
    `UPDATE FTS11OWTR
     SET DocNum = @docNum, DocStatus = @open, ApprStatus = @apprStatus,
         ConfirmedBy = ISNULL(ConfirmedBy, @userName), ConfirmedDate = ISNULL(ConfirmedDate, GETDATE()),
         UpdatedBy = @userName, UpdatedDate = GETDATE()
     WHERE DocEntry = @docEntry`,
    [
      { name: 'docEntry', value: docEntry },
      { name: 'docNum', value: docNum },
      { name: 'open', value: OWTR_STATUS.open },
      { name: 'apprStatus', value: apprStatus },
      { name: 'userName', value: userName },
    ],
    transaction
  );
}

/** Cancel Doc: a DRAFT or OPEN transfer not synced to SAP becomes CANCELED (also while waiting for approval) */
export async function cancelTransfer(docEntry: number, userName: string, transaction: sql.Transaction): Promise<void> {
  const current = await lockTransfer(docEntry, transaction);
  if (current.DocStatus !== OWTR_STATUS.draft && current.DocStatus !== OWTR_STATUS.open) {
    throw new ValidationError(`A ${current.DocStatus} inventory transfer can't be cancelled`);
  }
  assertNotSynced(LABEL, current.PostStatus);
  await db.query(
    `UPDATE FTS11OWTR SET DocStatus = @canceled, CanceledBy = @userName, CanceledDate = GETDATE(),
            UpdatedBy = @userName, UpdatedDate = GETDATE()
     WHERE DocEntry = @docEntry`,
    [
      { name: 'docEntry', value: docEntry },
      { name: 'canceled', value: OWTR_STATUS.canceled },
      { name: 'userName', value: userName },
    ],
    transaction
  );
}

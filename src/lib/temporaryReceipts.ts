import sql from 'mssql';
import { db } from './db';
import { NotFoundError, ValidationError } from './errors';
import { sapTable } from './sapDb';
import { assertTransferBank, parsePaymentMeans, round2, savePaymentMeans } from './paymentMeans';
import type { PaymentMeans } from './paymentMeans';
import { closeRequestIfDone, reopenRequestIfShort } from './receiptRequests';
import { APPR_STATUS } from './salesDocuments';
import { keepManualNumber, numberForOpen } from './documentNumbering';
import type { NumberedTable } from './documentNumbering';
import { convertAmount, getCurrencySettings, getRates, localCurrencySql, settleReceiptCurrency } from './currency';
import { WENT_THROUGH_APPROVAL, createApprovalRequests, notifyFirstApprovers, templatesNeedingApproval, wentThroughApproval } from './approvalCheck';

// Temporary Receipts (FTS11TMPR): a payment received from a customer, kept as a document like an incoming payment:
//   Save = DRAFT without a No.; Confirm = DocNum from Document Numbering (a series of type Temporary Receipt), OPEN.
//   With approval (as the quotation): Confirm leaves it DRAFT + PENDING without a No. until approved.

/** Document type (FTS_vw_ObjType.Code); its numbering series are kept under it */
export const TMPR_OBJTYPE = 'FTS11TMPR';

export const TMPR_NUMBER: NumberedTable = { table: 'FTS11TMPR', column: 'DocNum', label: 'temporary receipt' };

const DRAFT = 'DRAFT';
const OPEN = 'OPEN';
export const TMPR_STATUS = { draft: DRAFT, open: OPEN };

/** A function because the SAP database name (bank account names) is the current company's, known only per request */
export const tmprSelect = () => `
  SELECT t.DocEntry, t.DocNum, t.Series, n.Series AS SeriesCode, n.SeriesName, t.DocDate, t.TaxDate,
         t.CardCode, t.CardName, t.PayTyp, pt.Name AS PayTypName,
         -- Amount in the receipt's currency (DocTotal itself is kept in the local one), the currency and SAP's rate
         CASE WHEN t.DocTotalFC <> 0 THEN t.DocTotalFC ELSE t.DocTotal END AS DocTotal, t.DocTotal AS DocTotalLC,
         ISNULL(t.DocCur, ${localCurrencySql()}) AS DocCur, t.DocRate,
         (SELECT c.Currency FROM ${sapTable('OCRD')} c WHERE c.CardCode = t.CardCode COLLATE DATABASE_DEFAULT) AS CardCurrency,
         t.DocStatus, st.Name AS DocStatusName, t.ApprStatus, aps.Name AS ApprStatusName,
         t.PostStatus, pst.Name AS PostStatusName, t.ErrorDesc, t.SAPDocNum, t.SAPDocEntry, t.Comments, t.ConfirmedBy, t.ConfirmedDate, t.NoDocSum,
         CAST(CASE WHEN ${WENT_THROUGH_APPROVAL(`'${TMPR_OBJTYPE}'`, 't.DocEntry')} THEN 1 ELSE 0 END AS BIT) AS ApprLocked,
         t.CheckSum, t.TrsfrSum, t.TrsfrBank, t.CreditSum, t.CashSum, t.BcgSum,
         (SELECT CONCAT(b.BankCode, ' - ', b.Account) FROM ${sapTable('DSC1')} b WHERE b.AbsEntry = t.TrsfrBank) AS TrsfrBankName,
         -- Copied from a Temporary Receipt Request (Copy To)
         t.BaseType, t.BaseEntry, (SELECT q.DocNum FROM FTS11OTRQ q WHERE q.DocEntry = t.BaseEntry) AS BaseDocNum
  FROM FTS11TMPR t
  LEFT JOIN FTS11NNM1 n ON n.DocEntry = t.Series
  LEFT JOIN FTS_vw_PayTyp pt ON pt.Code = t.PayTyp
  LEFT JOIN FTS_vw_DocStatus st ON st.Code = t.DocStatus
  LEFT JOIN FTS_vw_ApprStatus aps ON aps.Code = t.ApprStatus
  LEFT JOIN FTS_vw_PostStatus pst ON pst.Code = t.PostStatus`;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface ReceiptFields {
  series: number | null;
  /** Posting Date (yyyy-mm-dd): locked once confirmed (the No. is made from it) */
  docDate: string;
  /** Document Date (yyyy-mm-dd); empty = the Posting Date in SAP */
  taxDate: string | null;
  cardCode: string;
  cardName: string | null;
  /** Set from the payment means: the one used, or MP (Multiple Type) */
  payTyp: string;
  /** Amount = the payment means + bank charge */
  docTotal: number;
  /** Remarks */
  comments: string | null;
  means: PaymentMeans;
  /** The Temporary Receipt Request it was copied from (FTS11OTRQ.DocEntry) */
  baseEntry: number | null;
  /** Currency as chosen (null = the customer's default) until applyReceiptCurrency settles it; docTotal is in it */
  docCur: string | null;
  /** SAP's rate for the Posting Date; the Amount in the local currency (DocTotal) and in the receipt's (DocTotalFC) */
  docRate: number;
  docTotalLC: number;
  docTotalFC: number;
}

/**
 * Validate a save request. Payment Type and Amount aren't typed: they come from the payment means.
 * baseEntry: the Temporary Receipt Request it is copied from (Copy To), if any.
 */
export function parseReceiptFields(body: Record<string, unknown>): ReceiptFields {
  const series = body.series === null || body.series === undefined || body.series === '' ? null : Number(body.series);
  if (series !== null && (!Number.isInteger(series) || series <= 0)) throw new ValidationError('Series is not valid');

  const docDate = String(body.docDate ?? '');
  if (!DATE.test(docDate)) throw new ValidationError('Posting Date is required');
  const taxDate = body.taxDate ? String(body.taxDate) : null;
  if (taxDate && !DATE.test(taxDate)) throw new ValidationError('Document Date is not valid');

  const cardCode = String(body.cardCode ?? '').trim();
  if (!cardCode) throw new ValidationError('Customer is required');
  if (cardCode.length > 100) throw new ValidationError('Customer is not valid');
  const cardName = String(body.cardName ?? '').trim().slice(0, 200) || null;

  const { means, payTyp, docTotal } = parsePaymentMeans(body);

  const comments = String(body.comments ?? '').trim();
  if (comments.length > 254) throw new ValidationError('Remarks must be 254 characters or fewer');

  const baseEntry = body.baseEntry === null || body.baseEntry === undefined || body.baseEntry === '' ? null : Number(body.baseEntry);
  if (baseEntry !== null && (!Number.isInteger(baseEntry) || baseEntry <= 0)) throw new ValidationError('The request it is copied from is not valid');

  const docCur = String(body.docCur ?? '').trim().toUpperCase().slice(0, 3) || null;
  return {
    series, docDate, taxDate, cardCode, cardName, payTyp, docTotal, comments: comments || null, means, baseEntry,
    docCur, docRate: 1, docTotalLC: docTotal, docTotalFC: 0,
  };
}

/**
 * Settle the receipt's currency and rate (see settleReceiptCurrency); its payment means and lines are in that currency.
 * `keep`: a confirmed receipt (or one being changed by its approver) keeps its currency and rate.
 */
export async function applyReceiptCurrency(fields: ReceiptFields, keep?: { docCur: string; docRate: number }): Promise<void> {
  Object.assign(fields, await settleReceiptCurrency(fields.cardCode, fields.docCur, fields.docDate, fields.docTotal, keep));
}

/** Save the payment means on the receipt and replace its cheques (inside the save's transaction) */
export async function saveReceiptMeans(docEntry: number, means: PaymentMeans, transaction: sql.Transaction): Promise<void> {
  await savePaymentMeans('FTS11TMPR', 'FTS11TMP2', docEntry, means, transaction);
}

/** Series must be an active Temporary Receipt series; the customer must exist in SAP; the payment type in FTS_vw_PayTyp */
export async function assertReceiptReferences(fields: ReceiptFields, checkSeries: boolean): Promise<void> {
  if (checkSeries && fields.series !== null) {
    const found = await db.query(`SELECT DocEntry FROM FTS11NNM1 WHERE DocEntry = @series AND ObjType = @objType AND Active = 1`, [
      { name: 'series', value: fields.series },
      { name: 'objType', value: TMPR_OBJTYPE },
    ]);
    if (found.length === 0) throw new ValidationError('Series is not an active Temporary Receipt series');
  }
  const customer = await db.query(`SELECT CardCode FROM ${sapTable('OCRD')} WHERE CardCode = @cardCode`, [
    { name: 'cardCode', value: fields.cardCode },
  ]);
  if (customer.length === 0) throw new ValidationError('Customer does not exist in SAP');
  const payTyp = await db.query(`SELECT Code FROM FTS_vw_PayTyp WHERE Code = @payTyp`, [{ name: 'payTyp', value: fields.payTyp }]);
  if (payTyp.length === 0) throw new ValidationError('Payment Type is not valid');
  await assertTransferBank(fields.means);
}

/**
 * Parameters of the editable fields. Untyped on purpose: types set from this shared file aren't recognised by the
 * database driver ("type.validate is not a function"); empty Series / Name simply go in as NULL.
 */
export const receiptParams = (fields: ReceiptFields) => [
  { name: 'series', value: fields.series },
  { name: 'docDate', value: fields.docDate },
  { name: 'taxDate', value: fields.taxDate },
  { name: 'cardCode', value: fields.cardCode },
  { name: 'cardName', value: fields.cardName },
  { name: 'payTyp', value: fields.payTyp },
  // DocTotal in the local currency; the receipt's own currency, rate and Amount in it (after applyReceiptCurrency)
  { name: 'docTotal', value: fields.docTotalLC },
  { name: 'docCur', value: fields.docCur },
  { name: 'docRate', value: fields.docRate },
  { name: 'docTotalFC', value: fields.docTotalFC },
  { name: 'comments', value: fields.comments },
];

/** A receipt with its lines (the documents it pays) */
export async function getReceipt(docEntry: number) {
  const rows = await db.query(`${tmprSelect()} WHERE t.DocEntry = @docEntry`, [{ name: 'docEntry', value: docEntry }]);
  if (rows.length === 0) throw new NotFoundError('Temporary receipt');
  const lines = await db.query(
    `SELECT LineNum, TransType, OriTransType, ${DOC_TYPE_NAME('TransType')} AS DocType, DocNum, OriDocEntry,
            TransId, Line_ID AS LineId, PostingDate, DueDate, BalanceDue, SumApplied,
            -- The paid document's own currency (BalanceDue / SumApplied are in the receipt's)
            ISNULL(DocCur, ${localCurrencySql()}) AS ItemCur
     FROM FTS11TMP1 WHERE DocEntry = @docEntry ORDER BY VisOrder, LineNum`,
    [{ name: 'docEntry', value: docEntry }]
  );
  // Payment Means > Cheque tab
  const cheques = await db.query(`SELECT CheckNum, CheckSum FROM FTS11TMP2 WHERE DocEntry = @docEntry ORDER BY LineNum`, [
    { name: 'docEntry', value: docEntry },
  ]);
  return { ...rows[0], Lines: lines, Cheques: cheques };
}

// ============================================
// Lines (FTS11TMP1): the open SAP items the receipt pays, chosen from FTS_fn_UnreconciledDocs
// ============================================

/** Document type name of a TransType, as FTS_fn_UnreconciledDocs names it */
const DOC_TYPE_NAME = (column: string) =>
  `CASE ${column} WHEN '13' THEN 'A/R Invoice' WHEN '14' THEN 'A/R Credit Memo' WHEN '203' THEN 'A/R Down Payment Invoice' ELSE 'Journal Entry' END`;

/**
 * SQL: a receipt (alias r) still holds the open items on its lines — not cancelled, not rejected, not posted to SAP
 * yet. Once posted, SAP itself shows what is left open on them.
 */
const HOLDS_ITS_ITEMS = `r.DocStatus <> 'CANCELED' AND r.ApprStatus <> 'REJECTED' AND r.PostStatus <> 'SUCCESS'`;

/**
 * The customer's open items that this receipt may pay: FTS_fn_UnreconciledDocs, less the items held by another
 * receipt. `docEntry` = this receipt (its own lines stay choosable), null for a new one.
 * `receipt` (its currency and Posting Date): only items in that currency or in the local currency (a local-currency
 * receipt: any), with BalanceDue in
 * the receipt's currency - an item in another currency converted at SAP's rates that day, as SAP's Incoming Payment
 * shows it (none that day: not offered). ItemCur = the item's own currency.
 */
export async function getOpenItems(
  cardCode: string,
  docEntry: number | null,
  transaction?: sql.Transaction,
  receipt?: { currency: string; date: string }
): Promise<OpenItem[]> {
  const rows = await db.query<OpenItem & { FCCurrency: string | null; BalanceDueFC: number | null }>(
    `SELECT f.TransType, f.OriTransType, f.DocType, f.DocNum, f.OriDocEntry, f.TransId, f.Line_ID AS LineId,
            f.PostingDate, f.DueDate, f.DaysOverdue, f.BalanceDue, f.Remarks, f.FCCurrency, f.BalanceDueFC
     FROM dbo.FTS_fn_UnreconciledDocs(@cardCode) f
     WHERE NOT EXISTS (
       SELECT 1 FROM FTS11TMP1 l JOIN FTS11TMPR r ON r.DocEntry = l.DocEntry
       WHERE l.TransId = f.TransId AND l.Line_ID = f.Line_ID AND r.DocEntry <> @docEntry AND ${HOLDS_ITS_ITEMS})
     ORDER BY f.PostingDate, f.TransId, f.Line_ID`,
    [
      { name: 'cardCode', value: cardCode },
      { name: 'docEntry', value: docEntry ?? 0 },
    ],
    transaction
  );
  const settings = await getCurrencySettings();
  const curOf = (r: { FCCurrency: string | null }) => (r.FCCurrency ?? '').trim() || settings.local;
  const items = rows.map(({ FCCurrency, BalanceDueFC, ...r }) => ({ ...r, ItemCur: curOf({ FCCurrency }), BalanceDueFC }));
  if (!receipt) return items.map(({ BalanceDueFC: _fc, ...r }) => r);
  const rates = await getRates([receipt.currency, ...items.map((i) => i.ItemCur)], receipt.date, settings);
  const out: OpenItem[] = [];
  for (const { BalanceDueFC, ...item } of items) {
    // A document in the receipt's currency or the local one; a local-currency receipt also pays foreign-currency ones
    if (item.ItemCur !== receipt.currency && item.ItemCur !== settings.local && receipt.currency !== settings.local) continue;
    const own = item.ItemCur === settings.local ? Number(item.BalanceDue) : Number(BalanceDueFC);
    const balance = convertAmount(own, item.ItemCur, receipt.currency, rates, settings);
    if (balance === null) continue;
    out.push({ ...item, BalanceDue: round2(balance) });
  }
  return out;
}

interface OpenItem {
  TransType: string;
  OriTransType: string;
  DocType: string;
  DocNum: string | null;
  OriDocEntry: number;
  TransId: number;
  LineId: number;
  PostingDate: Date | null;
  DueDate: Date | null;
  BalanceDue: number;
  /** The item's own currency */
  ItemCur: string;
}

/** A line as the screen sends it: which SAP journal line, and how much is paid on it */
export interface ReceiptLineInput {
  transId: number;
  lineId: number;
  sumApplied: number;
}

const itemKey = (transId: number, lineId: number) => `${transId}/${lineId}`;

/** Validate the lines of a save request (their amounts are checked against SAP in saveReceiptLines) */
export function parseReceiptLines(body: Record<string, unknown>): ReceiptLineInput[] {
  const raw = body.lines ?? [];
  if (!Array.isArray(raw)) throw new ValidationError('Lines are not valid');
  const seen = new Set<string>();
  return raw.map((l: Record<string, unknown>) => {
    const transId = Number(l.transId);
    const lineId = Number(l.lineId);
    const sumApplied = round2(Number(l.sumApplied));
    if (!Number.isInteger(transId) || !Number.isInteger(lineId)) throw new ValidationError('A line is not valid');
    if (!Number.isFinite(sumApplied)) throw new ValidationError('Amount Applied is not valid');
    const key = itemKey(transId, lineId);
    if (seen.has(key)) throw new ValidationError('The same document is on the receipt twice');
    seen.add(key);
    return { transId, lineId, sumApplied };
  });
}

/**
 * Replace the receipt's lines and keep On Account (NoDocSum) up to date, in `transaction`:
 *   - every line must still be one of the customer's open items in SAP, and not held by another receipt;
 *   - Amount Applied: not 0, the same sign as the balance due (a credit item is applied as a minus), never more
 *     than the balance due (part payment allowed);
 *   - On Account = Amount - total Amount Applied, and can't be below 0.
 * The item's No. / type / dates / balance due are copied from SAP as they are now. Amounts are in the receipt's
 * currency (`receipt`); an item in another currency (the local one) is converted at SAP's rate that day.
 */
export async function saveReceiptLines(
  docEntry: number,
  cardCode: string,
  docTotal: number,
  lines: ReceiptLineInput[],
  userName: string,
  transaction: sql.Transaction,
  receipt: { currency: string; date: string }
): Promise<void> {
  // Balances in the receipt's currency; only items in it or in the local currency
  const open = new Map(
    (await getOpenItems(cardCode, docEntry, transaction, receipt)).map((item) => [itemKey(item.TransId, item.LineId), item])
  );
  // Kept on lines that stay (the same SAP item): their LineNum, who added them, and their No. for messages about
  // items no longer open
  const before = new Map(
    (
      await db.query<{ LineNum: number; TransId: number; Line_ID: number; DocNum: string | null; CreatedBy: string | null; CreatedDate: Date | null }>(
        `SELECT LineNum, TransId, Line_ID, DocNum, CreatedBy, CreatedDate FROM FTS11TMP1 WITH (UPDLOCK, HOLDLOCK) WHERE DocEntry = @docEntry`,
        [{ name: 'docEntry', value: docEntry }],
        transaction
      )
    ).map((l) => [itemKey(l.TransId, l.Line_ID), l])
  );

  // Why an item can't be paid here: on another receipt (which one), or not open for this customer in SAP any more
  const notPayable = async (line: ReceiptLineInput) => {
    const held = await db.query<{ DocType: string; DocNum: string | null; Receipt: string }>(
      `SELECT TOP 1 ${DOC_TYPE_NAME('l.TransType')} AS DocType, l.DocNum,
              ISNULL(r.DocNum, 'draft ' + CAST(r.DocEntry AS NVARCHAR(20))) AS Receipt
       FROM FTS11TMP1 l JOIN FTS11TMPR r ON r.DocEntry = l.DocEntry
       WHERE l.TransId = @transId AND l.Line_ID = @lineId AND r.DocEntry <> @docEntry AND ${HOLDS_ITS_ITEMS}`,
      [
        { name: 'transId', value: line.transId },
        { name: 'lineId', value: line.lineId },
        { name: 'docEntry', value: docEntry },
      ],
      transaction
    );
    if (held[0]) {
      return new ValidationError(
        `${held[0].DocType} ${held[0].DocNum ?? ''} is already on Temporary Receipt ${held[0].Receipt}`.replace('  ', ' ')
      );
    }
    const no = before.get(itemKey(line.transId, line.lineId))?.DocNum;
    return new ValidationError(
      `${no ? `No. ${no}` : `Journal entry ${line.transId}`} is no longer open for this customer in SAP`
    );
  };

  let applied = 0;
  for (const line of lines) {
    if (!open.has(itemKey(line.transId, line.lineId))) throw await notPayable(line);
  }
  const rows = lines.map((line) => {
    const key = itemKey(line.transId, line.lineId);
    const item = open.get(key) as OpenItem;
    const balance = round2(Number(item.BalanceDue));
    const label = `${item.DocType} ${item.DocNum ?? ''}`.trim();
    if (line.sumApplied === 0) throw new ValidationError(`${label}: Amount Applied can't be 0`);
    if (Math.sign(line.sumApplied) !== Math.sign(balance)) {
      throw new ValidationError(`${label}: Amount Applied must be ${balance < 0 ? 'a minus' : 'a plus'} amount, as its balance due`);
    }
    if (Math.abs(line.sumApplied) > Math.abs(balance)) {
      throw new ValidationError(`${label}: Amount Applied is more than its balance due (${balance.toFixed(2)})`);
    }
    applied = round2(applied + line.sumApplied);
    return { item, sumApplied: line.sumApplied, kept: before.get(key) };
  });

  const noDocSum = round2(docTotal - applied);
  if (noDocSum < 0) {
    throw new ValidationError(`Total Amount Applied (${applied.toFixed(2)}) is more than the Amount (${docTotal.toFixed(2)})`);
  }

  // LineNum is each line's permanent key, as in SAP B1: a line of an item that was already on the receipt keeps its
  // LineNum, a new one gets the next number after the highest one saved; VisOrder is the line's position on screen
  let nextLineNum = [...before.values()].reduce((max, b) => Math.max(max, b.LineNum + 1), 0);
  const taken = new Set<number>();
  await db.query(`DELETE FROM FTS11TMP1 WHERE DocEntry = @docEntry`, [{ name: 'docEntry', value: docEntry }], transaction);
  for (const [visOrder, row] of rows.entries()) {
    const keep = row.kept !== undefined && !taken.has(row.kept.LineNum);
    const lineNum = keep ? (row.kept as { LineNum: number }).LineNum : nextLineNum++;
    taken.add(lineNum);
    await db.query(
      `INSERT INTO FTS11TMP1 (DocEntry, LineNum, VisOrder, TransType, OriTransType, OriDocEntry, DocNum, TransId, Line_ID,
                              PostingDate, DueDate, BalanceDue, SumApplied, DocCur, CreatedBy, CreatedDate, UpdatedBy, UpdatedDate)
       VALUES (@docEntry, @lineNum, @visOrder, @transType, @oriTransType, @oriDocEntry, @docNum, @transId, @lineId,
               @postingDate, @dueDate, @balanceDue, @sumApplied, @itemCur, @createdBy,
               CASE WHEN @createdDate IS NULL THEN GETDATE() ELSE @createdDate END, @userName, GETDATE())`,
      // Untyped: types set from this shared file aren't recognised by the database driver
      [
        { name: 'docEntry', value: docEntry },
        { name: 'lineNum', value: lineNum },
        { name: 'visOrder', value: visOrder },
        { name: 'transType', value: row.item.TransType },
        { name: 'oriTransType', value: row.item.OriTransType },
        { name: 'oriDocEntry', value: row.item.OriDocEntry },
        { name: 'docNum', value: row.item.DocNum },
        { name: 'transId', value: row.item.TransId },
        { name: 'lineId', value: row.item.LineId },
        { name: 'postingDate', value: row.item.PostingDate },
        { name: 'dueDate', value: row.item.DueDate },
        { name: 'balanceDue', value: Number(row.item.BalanceDue) },
        { name: 'sumApplied', value: row.sumApplied },
        { name: 'itemCur', value: row.item.ItemCur },
        { name: 'createdBy', value: row.kept?.CreatedBy ?? userName },
        { name: 'createdDate', value: row.kept?.CreatedDate ?? null },
        { name: 'userName', value: userName },
      ],
      transaction
    );
  }
  await db.query(
    `UPDATE FTS11TMPR SET NoDocSum = @noDocSum WHERE DocEntry = @docEntry`,
    [
      { name: 'docEntry', value: docEntry },
      { name: 'noDocSum', value: noDocSum },
    ],
    transaction
  );
}

/** The receipt's status and series, locked for the rest of the transaction; not found -> 404 */
export async function lockReceipt(docEntry: number, transaction?: sql.Transaction) {
  const rows = await db.query<{
    DocStatus: string;
    ApprStatus: string;
    PostStatus: string;
    Series: number | null;
    CardCode: string;
    DocDate: Date;
    /** yyyy-mm-dd */
    DocDateText: string;
    DocCur: string | null;
    DocRate: number;
  }>(
    `SELECT DocStatus, ApprStatus, PostStatus, Series, CardCode, DocDate, CONVERT(char(10), DocDate, 23) AS DocDateText, DocCur, DocRate
     FROM FTS11TMPR WITH (UPDLOCK, HOLDLOCK) WHERE DocEntry = @docEntry`,
    [{ name: 'docEntry', value: docEntry }],
    transaction
  );
  if (rows.length === 0) throw new NotFoundError('Temporary receipt');
  return rows[0];
}

/** A receipt waiting for approval, or approved, can't be changed or confirmed again (a rejected one can) */
export async function assertReceiptNotInApproval(docEntry: number, apprStatus: string, transaction?: sql.Transaction) {
  if (apprStatus === 'PENDING' || (await wentThroughApproval(TMPR_OBJTYPE, docEntry, transaction))) {
    throw new ValidationError("This temporary receipt is waiting for approval or approved; it can't be changed");
  }
}

/**
 * A rejected receipt sent again: while rejected its items were free for other receipts, so each of its lines must
 * still not be on another receipt
 */
async function assertLinesStillFree(docEntry: number, transaction: sql.Transaction) {
  const held = await db.query<{ DocType: string; DocNum: string | null; Receipt: string }>(
    `SELECT TOP 1 ${DOC_TYPE_NAME('l.TransType')} AS DocType, l.DocNum,
            ISNULL(r.DocNum, 'draft ' + CAST(r.DocEntry AS NVARCHAR(20))) AS Receipt
     FROM FTS11TMP1 m
     JOIN FTS11TMP1 l ON l.TransId = m.TransId AND l.Line_ID = m.Line_ID AND l.DocEntry <> m.DocEntry
     JOIN FTS11TMPR r ON r.DocEntry = l.DocEntry
     WHERE m.DocEntry = @docEntry AND ${HOLDS_ITS_ITEMS}`,
    [{ name: 'docEntry', value: docEntry }],
    transaction
  );
  if (held[0]) {
    throw new ValidationError(
      `${held[0].DocType} ${held[0].DocNum ?? ''} is now on Temporary Receipt ${held[0].Receipt}: take it off this receipt's lines first`.replace('  ', ' ')
    );
  }
}

/**
 * Confirm a DRAFT receipt. The active Temporary Receipt approval templates run first (as on the quotation):
 *   approval needed -> stays DRAFT, ApprStatus PENDING, no No. yet (given when fully approved);
 *   none            -> No. now, OPEN; ApprStatus stays NO-APPROVAL.
 * Returns the receipt's ApprStatus afterwards.
 */
export async function confirmReceipt(docEntry: number, userName: string, transaction: sql.Transaction, manualNo?: unknown): Promise<string> {
  const receipt = await lockReceipt(docEntry, transaction);
  if (receipt.DocStatus !== DRAFT) throw new ValidationError('Only a DRAFT temporary receipt can be confirmed');
  await assertReceiptNotInApproval(docEntry, receipt.ApprStatus, transaction);
  if (receipt.ApprStatus === APPR_STATUS.rejected) await assertLinesStillFree(docEntry, transaction);
  if (receipt.Series === null) throw new ValidationError('Choose a Series before confirming');
  // Manual series: the No. keyed in is checked and kept now (also while waiting for approval)
  await keepManualNumber(TMPR_NUMBER, docEntry, receipt.Series, manualNo, transaction);

  const needing = await templatesNeedingApproval(TMPR_OBJTYPE, docEntry, transaction);
  if (needing.length > 0) {
    await createApprovalRequests(TMPR_OBJTYPE, docEntry, needing, transaction);
    // ConfirmedBy / Date = who sent it for approval, and when (kept when it is approved later)
    await db.query(
      `UPDATE FTS11TMPR SET ApprStatus = 'PENDING', ConfirmedBy = @userName, ConfirmedDate = GETDATE() WHERE DocEntry = @docEntry`,
      [
        { name: 'docEntry', value: docEntry },
        { name: 'userName', value: userName },
      ],
      transaction
    );
    await notifyFirstApprovers(TMPR_OBJTYPE, docEntry, transaction);
    return 'PENDING';
  }
  await openReceipt(docEntry, userName, APPR_STATUS.none, transaction);
  return APPR_STATUS.none;
}

/**
 * Give a receipt its No. from its series and set it OPEN with `apprStatus`: NO-APPROVAL on Confirm, APPROVED once fully approved.
 * ConfirmedBy / Date: set now, unless already set when the receipt was sent for approval.
 */
export async function openReceipt(
  docEntry: number,
  userName: string,
  apprStatus: string,
  transaction: sql.Transaction
): Promise<void> {
  const receipt = await lockReceipt(docEntry, transaction);
  if (receipt.Series === null) throw new ValidationError('The temporary receipt has no Series');
  const docNum = await numberForOpen(TMPR_NUMBER, docEntry, receipt.Series, receipt.DocDate, transaction);

  await db.query(
    `UPDATE FTS11TMPR
     SET DocNum = @docNum, DocStatus = @open, ApprStatus = @apprStatus,
         ConfirmedBy = ISNULL(ConfirmedBy, @userName), ConfirmedDate = ISNULL(ConfirmedDate, GETDATE())
     WHERE DocEntry = @docEntry`,
    [
      { name: 'docEntry', value: docEntry },
      { name: 'userName', value: userName },
      { name: 'docNum', value: docNum },
      { name: 'open', value: OPEN },
      { name: 'apprStatus', value: apprStatus },
    ],
    transaction
  );
  // Copied from a request: the request closes once its confirmed receipts reach its Amount
  const base = await db.query<{ BaseEntry: number | null }>(
    `SELECT BaseEntry FROM FTS11TMPR WHERE DocEntry = @docEntry AND BaseType = 'FTS11OTRQ'`,
    [{ name: 'docEntry', value: docEntry }],
    transaction
  );
  if (base[0]?.BaseEntry) await closeRequestIfDone(base[0].BaseEntry, userName, transaction);
}

/**
 * Cancel Doc: a DRAFT or OPEN receipt becomes CANCELED (also while waiting for approval, and once posted to SAP —
 * the route then cancels SAP's incoming payment in the same transaction). Not while it is being posted. Its open
 * items are free again for other receipts; copied from a request, its amount goes back to the request, which reopens
 * if it had closed.
 */
export async function cancelReceipt(docEntry: number, userName: string, transaction: sql.Transaction): Promise<void> {
  const current = await lockReceipt(docEntry, transaction);
  if (current.DocStatus !== DRAFT && current.DocStatus !== OPEN) {
    throw new ValidationError(`A ${current.DocStatus} temporary receipt can't be cancelled`);
  }
  if (current.PostStatus === 'PENDING') throw new ValidationError('This temporary receipt is being posted to SAP; try again when posting has finished');
  await db.query(
    `UPDATE FTS11TMPR SET DocStatus = 'CANCELED', CanceledBy = @userName, CanceledDate = GETDATE() WHERE DocEntry = @docEntry`,
    [
      { name: 'docEntry', value: docEntry },
      { name: 'userName', value: userName },
    ],
    transaction
  );
  const base = await db.query<{ BaseEntry: number | null }>(
    `SELECT BaseEntry FROM FTS11TMPR WHERE DocEntry = @docEntry AND BaseType = 'FTS11OTRQ'`,
    [{ name: 'docEntry', value: docEntry }],
    transaction
  );
  if (base[0]?.BaseEntry) await reopenRequestIfShort(base[0].BaseEntry, userName, transaction);
}

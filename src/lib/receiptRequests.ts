import type sql from 'mssql';
import { db } from './db';
import { NotFoundError, ValidationError } from './errors';
import { sapTable } from './sapDb';
import { assertTransferBank, parsePaymentMeans, round2, savePaymentMeans } from './paymentMeans';
import type { PaymentMeans } from './paymentMeans';
import { APPR_STATUS } from './salesDocuments';
import { keepManualNumber, numberForOpen } from './documentNumbering';
import type { NumberedTable } from './documentNumbering';
import { localCurrencySql, settleReceiptCurrency } from './currency';
import { WENT_THROUGH_APPROVAL, createApprovalRequests, notifyFirstApprovers, templatesNeedingApproval, wentThroughApproval } from './approvalCheck';

// Temporary Receipt Requests (FTS11OTRQ header, FTS11TRQ1 cheques): a payment noted down before the Temporary Receipt
// is made - header and Payment Means only (no documents to pay, no posting to SAP).
//   Save = DRAFT without a No.; Confirm = approval templates first (as the other documents), then the No. from Document
//   Numbering (a series of type Temporary Receipt Request) and OPEN. Cancel Doc = CANCELED (not once copied).
//   Known Customer ticked: the customer is chosen from SAP; not ticked: only the name is typed.
//   Copy To Temporary Receipt: a request may be split into several receipts (FTS11TMPR.BaseEntry); together they can't
//   be more than the request. It becomes CLOSED when its CONFIRMED (OPEN) receipts reach its Amount; until then it stays
//   OPEN and can be copied again. A request copied into a receipt can no longer be changed or cancelled.

/** Document type (FTS_vw_ObjType.Code): numbering series, approvals, attachments and layouts are kept under it */
export const TRQ_OBJTYPE = 'FTS11OTRQ';

export const TRQ_NUMBER: NumberedTable = { table: 'FTS11OTRQ', column: 'DocNum', label: 'temporary receipt request' };
export const TRQ_STATUS = { draft: 'DRAFT', open: 'OPEN', closed: 'CLOSED', canceled: 'CANCELED' } as const;

/** SQL: a request's / receipt's (alias) Amount in its own currency (DocTotal is kept in the local one) */
const DOC_AMOUNT = (alias: string) => `CASE WHEN ${alias}.DocTotalFC <> 0 THEN ${alias}.DocTotalFC ELSE ${alias}.DocTotal END`;

/** SQL: a receipt (alias r) copied from a request still counts (not rejected in approval) */
const LIVE_RECEIPT = (alias: string) => `${alias}.BaseType = 'FTS11OTRQ' AND ${alias}.ApprStatus <> 'REJECTED' AND ${alias}.DocStatus <> 'CANCELED'`;

/** A function because the SAP database name (customer / bank / sales employee names) comes from the settings */
export const requestSelect = () => `
  SELECT q.DocEntry, q.DocNum, q.Series, n.Series AS SeriesCode, n.SeriesName, q.ObjType, q.DocDate,
         q.KnownCust, q.CardCode, q.CardName,
         q.SlpCode, (SELECT sp.SlpName FROM ${sapTable('OSLP')} sp WHERE sp.SlpCode = q.SlpCode) AS SlpName,
         q.PayTyp, pt.Name AS PayTypName,
         -- Amount in the request's currency (DocTotal itself is kept in the local one), the currency and SAP's rate
         ${DOC_AMOUNT('q')} AS DocTotal, q.DocTotal AS DocTotalLC, ISNULL(q.DocCur, ${localCurrencySql()}) AS DocCur, q.DocRate,
         (SELECT c.Currency FROM ${sapTable('OCRD')} c WHERE c.CardCode = q.CardCode COLLATE DATABASE_DEFAULT) AS CardCurrency,
         q.CheckSum, q.TrsfrSum, q.TrsfrBank, q.CreditSum, q.CashSum, q.BcgSum,
         (SELECT CONCAT(b.BankCode, ' - ', b.Account) FROM ${sapTable('DSC1')} b WHERE b.AbsEntry = q.TrsfrBank) AS TrsfrBankName,
         q.Comments, q.DocStatus, st.Name AS DocStatusName, q.ApprStatus, aps.Name AS ApprStatusName,
         q.ConfirmedBy, q.ConfirmedDate, q.CanceledBy, q.CanceledDate, q.CreatedBy, q.UpdatedBy,
         CAST(CASE WHEN ${WENT_THROUGH_APPROVAL(`'${TRQ_OBJTYPE}'`, 'q.DocEntry')} THEN 1 ELSE 0 END AS BIT) AS ApprLocked,
         -- Copied into receipts: all that still count, and the confirmed ones (they close it)
         ISNULL((SELECT SUM(${DOC_AMOUNT('r')}) FROM FTS11TMPR r WHERE r.BaseEntry = q.DocEntry AND ${LIVE_RECEIPT('r')}), 0) AS CopiedTotal,
         ISNULL((SELECT SUM(${DOC_AMOUNT('r')}) FROM FTS11TMPR r WHERE r.BaseEntry = q.DocEntry AND ${LIVE_RECEIPT('r')} AND r.DocStatus IN ('OPEN', 'CLOSED')), 0) AS ConfirmedTotal,
         (SELECT COUNT(*) FROM FTS11TMPR r WHERE r.BaseEntry = q.DocEntry AND ${LIVE_RECEIPT('r')}) AS ReceiptCount
  FROM FTS11OTRQ q
  LEFT JOIN FTS11NNM1 n ON n.DocEntry = q.Series
  LEFT JOIN FTS_vw_PayTyp pt ON pt.Code = q.PayTyp
  LEFT JOIN FTS_vw_DocStatus st ON st.Code = q.DocStatus
  LEFT JOIN FTS_vw_ApprStatus aps ON aps.Code = q.ApprStatus`;

/** A request with its cheques and the receipts copied from it */
export async function getRequest(docEntry: number) {
  const rows = await db.query(`${requestSelect()} WHERE q.DocEntry = @docEntry`, [{ name: 'docEntry', value: docEntry }]);
  if (rows.length === 0) throw new NotFoundError('Temporary receipt request');
  const cheques = await db.query(`SELECT CheckNum, CheckSum FROM FTS11TRQ1 WHERE DocEntry = @docEntry ORDER BY LineNum`, [
    { name: 'docEntry', value: docEntry },
  ]);
  const receipts = await db.query(
    `SELECT r.DocEntry, r.DocNum, r.CardCode, ${DOC_AMOUNT('r')} AS DocTotal, ISNULL(r.DocCur, ${localCurrencySql()}) AS DocCur,
            r.DocStatus, r.ApprStatus
     FROM FTS11TMPR r WHERE r.BaseType = 'FTS11OTRQ' AND r.BaseEntry = @docEntry ORDER BY r.DocEntry`,
    [{ name: 'docEntry', value: docEntry }]
  );
  return { ...rows[0], Cheques: cheques, Receipts: receipts };
}

// ============================================
// Input
// ============================================

export interface RequestFields {
  series: number | null;
  /** yyyy-mm-dd */
  docDate: string;
  knownCust: boolean;
  /** Only when knownCust */
  cardCode: string | null;
  cardName: string;
  slpCode: number | null;
  comments: string | null;
  payTyp: string;
  /** Amount, in the request's currency */
  docTotal: number;
  means: PaymentMeans;
  /** Currency as chosen (null = the customer's default) until applyRequestCurrency settles it */
  docCur: string | null;
  docRate: number;
  docTotalLC: number;
  docTotalFC: number;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Validate a save request */
export function parseRequestFields(body: Record<string, unknown>): RequestFields {
  const series = body.series === null || body.series === undefined || body.series === '' ? null : Number(body.series);
  if (series !== null && (!Number.isInteger(series) || series <= 0)) throw new ValidationError('Series is not valid');
  const docDate = String(body.docDate ?? '');
  if (!DATE.test(docDate)) throw new ValidationError('Posting Date is required');

  // Known Customer: chosen from SAP; otherwise only the name is typed
  const knownCust = body.knownCust === true;
  const cardCode = knownCust ? String(body.cardCode ?? '').trim() : '';
  if (knownCust && !cardCode) throw new ValidationError('Choose the customer (Known Customer is ticked)');
  if (cardCode.length > 100) throw new ValidationError('Customer is not valid');
  const cardName = String(body.cardName ?? '').trim();
  if (!cardName) throw new ValidationError('Name is required');
  if (cardName.length > 200) throw new ValidationError('Name must be 200 characters or fewer');

  const slpCode = body.slpCode === null || body.slpCode === undefined || body.slpCode === '' ? null : Number(body.slpCode);
  if (slpCode !== null && !Number.isInteger(slpCode)) throw new ValidationError('Sales Employee is not valid');
  const comments = String(body.comments ?? '').trim();
  if (comments.length > 254) throw new ValidationError('Remarks must be 254 characters or fewer');

  const { means, payTyp, docTotal } = parsePaymentMeans(body);
  const docCur = String(body.docCur ?? '').trim().toUpperCase().slice(0, 3) || null;
  return {
    series, docDate, knownCust, cardCode: cardCode || null, cardName, slpCode, comments: comments || null, payTyp, docTotal, means,
    docCur, docRate: 1, docTotalLC: docTotal, docTotalFC: 0,
  };
}

/** Settle the request's currency and rate, as a receipt's (settleReceiptCurrency); `keep` = a confirmed one keeps them */
export async function applyRequestCurrency(fields: RequestFields, keep?: { docCur: string; docRate: number }): Promise<void> {
  Object.assign(fields, await settleReceiptCurrency(fields.cardCode, fields.docCur, fields.docDate, fields.docTotal, keep));
}

/** Series (of type Temporary Receipt Request), customer, sales employee and bank must exist */
export async function assertRequestReferences(fields: RequestFields, checkSeries: boolean): Promise<void> {
  if (checkSeries && fields.series !== null) {
    const found = await db.query(`SELECT DocEntry FROM FTS11NNM1 WHERE DocEntry = @series AND ObjType = @objType AND Active = 1`, [
      { name: 'series', value: fields.series },
      { name: 'objType', value: TRQ_OBJTYPE },
    ]);
    if (found.length === 0) throw new ValidationError('Series is not an active Temporary Receipt Request series');
  }
  if (fields.cardCode) {
    const bp = await db.query(`SELECT CardCode FROM ${sapTable('OCRD')} WHERE CardCode = @cardCode`, [{ name: 'cardCode', value: fields.cardCode }]);
    if (bp.length === 0) throw new ValidationError('Customer does not exist in SAP');
  }
  if (fields.slpCode !== null) {
    const sp = await db.query(`SELECT SlpCode FROM ${sapTable('OSLP')} WHERE SlpCode = @slpCode`, [{ name: 'slpCode', value: fields.slpCode }]);
    if (sp.length === 0) throw new ValidationError('Sales Employee does not exist in SAP');
  }
  await assertTransferBank(fields.means);
}

/** Parameters of the header fields. Untyped: types set from this shared file aren't recognised by the driver. */
export const requestParams = (f: RequestFields) => [
  { name: 'series', value: f.series },
  { name: 'docDate', value: f.docDate },
  { name: 'knownCust', value: f.knownCust ? 1 : 0 },
  { name: 'cardCode', value: f.cardCode },
  { name: 'cardName', value: f.cardName },
  { name: 'slpCode', value: f.slpCode },
  { name: 'comments', value: f.comments },
  { name: 'payTyp', value: f.payTyp },
  // DocTotal in the local currency; the request's own currency, rate and Amount in it (after applyRequestCurrency)
  { name: 'docTotal', value: f.docTotalLC },
  { name: 'docCur', value: f.docCur },
  { name: 'docRate', value: f.docRate },
  { name: 'docTotalFC', value: f.docTotalFC },
];

/** Save the payment means and replace the cheques (inside the save's transaction) */
export async function saveRequestMeans(docEntry: number, means: PaymentMeans, transaction: sql.Transaction): Promise<void> {
  await savePaymentMeans('FTS11OTRQ', 'FTS11TRQ1', docEntry, means, transaction);
}

// ============================================
// Status
// ============================================

/** The request's status, locked for the rest of the transaction; not found -> 404 */
export async function lockRequest(docEntry: number, transaction?: sql.Transaction) {
  const rows = await db.query<{ DocStatus: string; ApprStatus: string; Series: number | null; CardCode: string | null; DocCur: string | null; DocRate: number }>(
    `SELECT DocStatus, ApprStatus, Series, CardCode, DocCur, DocRate FROM FTS11OTRQ WITH (UPDLOCK, HOLDLOCK) WHERE DocEntry = @docEntry`,
    [{ name: 'docEntry', value: docEntry }],
    transaction
  );
  if (rows.length === 0) throw new NotFoundError('Temporary receipt request');
  return rows[0];
}

/** Receipts copied from the request that still count */
async function liveReceiptCount(docEntry: number, transaction?: sql.Transaction): Promise<number> {
  const rows = await db.query<{ N: number }>(
    `SELECT COUNT(*) AS N FROM FTS11TMPR r WHERE r.BaseEntry = @docEntry AND ${LIVE_RECEIPT('r')}`,
    [{ name: 'docEntry', value: docEntry }],
    transaction
  );
  return rows[0]?.N ?? 0;
}

/** Can't be changed: waiting for approval, been through it, or already copied into a receipt */
export async function assertRequestChangeable(docEntry: number, apprStatus: string, transaction?: sql.Transaction) {
  if (apprStatus === APPR_STATUS.pending || (await wentThroughApproval(TRQ_OBJTYPE, docEntry, transaction))) {
    throw new ValidationError("This temporary receipt request is waiting for approval or approved, and can't be changed");
  }
  if ((await liveReceiptCount(docEntry, transaction)) > 0) {
    throw new ValidationError("This temporary receipt request has been copied to a temporary receipt and can't be changed");
  }
}

/**
 * Confirm a DRAFT request: approval templates first — approval needed: stays DRAFT + PENDING without a No.; none:
 * its No., OPEN, NO-APPROVAL. Returns the ApprStatus afterwards.
 */
export async function confirmRequest(docEntry: number, userName: string, transaction: sql.Transaction, manualNo?: unknown): Promise<string> {
  const current = await lockRequest(docEntry, transaction);
  if (current.DocStatus !== TRQ_STATUS.draft) throw new ValidationError('Only a DRAFT temporary receipt request can be confirmed');
  await assertRequestChangeable(docEntry, current.ApprStatus, transaction);
  if (current.Series === null) throw new ValidationError('Choose a Series before confirming');
  // Manual series: the No. keyed in is checked and kept now (also while waiting for approval)
  await keepManualNumber(TRQ_NUMBER, docEntry, current.Series, manualNo, transaction);

  const needing = await templatesNeedingApproval(TRQ_OBJTYPE, docEntry, transaction);
  if (needing.length > 0) {
    await createApprovalRequests(TRQ_OBJTYPE, docEntry, needing, transaction);
    // ConfirmedBy / Date = who sent it for approval, and when (kept when it is approved later)
    await db.query(
      `UPDATE FTS11OTRQ SET ApprStatus = @pending, ConfirmedBy = @userName, ConfirmedDate = GETDATE(),
              UpdatedBy = @userName, UpdatedDate = GETDATE()
       WHERE DocEntry = @docEntry`,
      [
        { name: 'docEntry', value: docEntry },
        { name: 'pending', value: APPR_STATUS.pending },
        { name: 'userName', value: userName },
      ],
      transaction
    );
    await notifyFirstApprovers(TRQ_OBJTYPE, docEntry, transaction);
    return APPR_STATUS.pending;
  }
  await openRequest(docEntry, userName, APPR_STATUS.none, transaction);
  return APPR_STATUS.none;
}

/**
 * Give the request its No. from its series (month / year parts from its Date) and set it OPEN with `apprStatus`:
 * NO-APPROVAL on Confirm, APPROVED once fully approved. ConfirmedBy / Date: kept if already set.
 */
export async function openRequest(docEntry: number, userName: string, apprStatus: string, transaction: sql.Transaction) {
  const rows = await db.query<{ Series: number | null; DocDate: Date }>(
    `SELECT Series, DocDate FROM FTS11OTRQ WHERE DocEntry = @docEntry`,
    [{ name: 'docEntry', value: docEntry }],
    transaction
  );
  if (!rows[0]?.Series) throw new ValidationError('The temporary receipt request has no Series');
  const docNum = await numberForOpen(TRQ_NUMBER, docEntry, rows[0].Series, rows[0].DocDate, transaction);
  await db.query(
    `UPDATE FTS11OTRQ
     SET DocNum = @docNum, DocStatus = @open, ApprStatus = @apprStatus,
         ConfirmedBy = ISNULL(ConfirmedBy, @userName), ConfirmedDate = ISNULL(ConfirmedDate, GETDATE()),
         UpdatedBy = @userName, UpdatedDate = GETDATE()
     WHERE DocEntry = @docEntry`,
    [
      { name: 'docEntry', value: docEntry },
      { name: 'docNum', value: docNum },
      { name: 'open', value: TRQ_STATUS.open },
      { name: 'apprStatus', value: apprStatus },
      { name: 'userName', value: userName },
    ],
    transaction
  );
}

/** Cancel Doc: a DRAFT or OPEN request not copied into a receipt yet becomes CANCELED (also while waiting for approval) */
export async function cancelRequest(docEntry: number, userName: string, transaction: sql.Transaction): Promise<void> {
  const current = await lockRequest(docEntry, transaction);
  if (current.DocStatus !== TRQ_STATUS.draft && current.DocStatus !== TRQ_STATUS.open) {
    throw new ValidationError(`A ${current.DocStatus} temporary receipt request can't be cancelled`);
  }
  if ((await liveReceiptCount(docEntry, transaction)) > 0) {
    throw new ValidationError("This temporary receipt request has been copied to a temporary receipt and can't be cancelled");
  }
  await db.query(
    `UPDATE FTS11OTRQ SET DocStatus = @canceled, CanceledBy = @userName, CanceledDate = GETDATE(),
            UpdatedBy = @userName, UpdatedDate = GETDATE()
     WHERE DocEntry = @docEntry`,
    [
      { name: 'docEntry', value: docEntry },
      { name: 'canceled', value: TRQ_STATUS.canceled },
      { name: 'userName', value: userName },
    ],
    transaction
  );
}

// ============================================
// Copy To Temporary Receipt
// ============================================

/**
 * What is still left on an OPEN request to copy into a receipt: its customer (if known), and its payment means less
 * what its other receipts (that still count) already took — cheques not used by them, and the rest of each amount.
 * `exceptReceipt`: a receipt being edited, which doesn't count against itself.
 */
export async function getRequestRemaining(docEntry: number, exceptReceipt?: number, transaction?: sql.Transaction) {
  const req = await db.query<Record<string, unknown> & { DocStatus: string; ApprStatus: string; DocTotal: number }>(
    `SELECT q.DocEntry, q.DocNum, q.DocStatus, q.ApprStatus, q.KnownCust, q.CardCode, q.CardName, q.Comments, ${DOC_AMOUNT('q')} AS DocTotal,
            ISNULL(q.DocCur, ${localCurrencySql()}) AS DocCur, q.CheckSum, q.TrsfrSum, q.TrsfrBank, q.CreditSum, q.CashSum, q.BcgSum
     FROM FTS11OTRQ q WHERE q.DocEntry = @docEntry`,
    [{ name: 'docEntry', value: docEntry }],
    transaction
  );
  if (req.length === 0) throw new NotFoundError('Temporary receipt request');
  const r = req[0];
  const params = [
    { name: 'docEntry', value: docEntry },
    { name: 'except', value: exceptReceipt ?? 0 },
  ];
  const used = await db.query<{ CheckSum: number; TrsfrSum: number; CreditSum: number; CashSum: number; BcgSum: number; DocTotal: number }>(
    `SELECT ISNULL(SUM(r.CheckSum), 0) AS CheckSum, ISNULL(SUM(r.TrsfrSum), 0) AS TrsfrSum, ISNULL(SUM(r.CreditSum), 0) AS CreditSum,
            ISNULL(SUM(r.CashSum), 0) AS CashSum, ISNULL(SUM(r.BcgSum), 0) AS BcgSum, ISNULL(SUM(${DOC_AMOUNT('r')}), 0) AS DocTotal
     FROM FTS11TMPR r WHERE r.BaseEntry = @docEntry AND r.DocEntry <> @except AND ${LIVE_RECEIPT('r')}`,
    params,
    transaction
  );
  const usedCheques = await db.query<{ CheckNum: string }>(
    `SELECT c.CheckNum FROM FTS11TMP2 c JOIN FTS11TMPR r ON r.DocEntry = c.DocEntry
     WHERE r.BaseEntry = @docEntry AND r.DocEntry <> @except AND ${LIVE_RECEIPT('r')}`,
    params,
    transaction
  );
  const cheques = await db.query<{ CheckNum: string; CheckSum: number }>(
    `SELECT CheckNum, CheckSum FROM FTS11TRQ1 WHERE DocEntry = @docEntry ORDER BY LineNum`,
    [{ name: 'docEntry', value: docEntry }],
    transaction
  );
  const usedNums = new Set(usedCheques.map((c) => c.CheckNum.toLowerCase()));
  const u = used[0];
  const left = (all: unknown, taken: unknown) => Math.max(round2(Number(all) - Number(taken)), 0);
  return {
    request: r,
    remainingTotal: left(r.DocTotal, u.DocTotal),
    means: {
      cheques: cheques.filter((c) => !usedNums.has(c.CheckNum.toLowerCase())).map((c) => ({ checkNum: c.CheckNum, checkSum: Number(c.CheckSum) })),
      trsfrSum: left(r.TrsfrSum, u.TrsfrSum),
      trsfrBank: left(r.TrsfrSum, u.TrsfrSum) > 0 ? (r.TrsfrBank as number | null) : null,
      creditSum: left(r.CreditSum, u.CreditSum),
      cashSum: left(r.CashSum, u.CashSum),
      bcgSum: left(r.BcgSum, u.BcgSum),
    },
  };
}

/**
 * A receipt saved as copied from a request: the request must be OPEN (confirmed, approved if needed); a known
 * customer must stay that customer; and the request's receipts together can't be more than the request.
 */
export async function assertReceiptFitsRequest(
  baseEntry: number,
  receipt: { cardCode: string; docTotal: number; docCur: string | null },
  exceptReceipt: number | undefined,
  transaction: sql.Transaction
): Promise<void> {
  const current = await lockRequest(baseEntry, transaction);
  if (current.DocStatus !== TRQ_STATUS.open) {
    throw new ValidationError(`The temporary receipt request is ${current.DocStatus}: only an OPEN request can be copied to a receipt`);
  }
  if (current.CardCode && current.CardCode.toLowerCase() !== receipt.cardCode.toLowerCase()) {
    throw new ValidationError(`The request is for customer ${current.CardCode}: the receipt must be for the same customer`);
  }
  const { remainingTotal, request } = await getRequestRemaining(baseEntry, exceptReceipt, transaction);
  // The same money: the receipt is in the request's currency
  if (receipt.docCur && request.DocCur && receipt.docCur !== request.DocCur) {
    throw new ValidationError(`The request is in ${request.DocCur}: the receipt must be in ${request.DocCur} too`);
  }
  if (receipt.docTotal > remainingTotal + 0.005) {
    throw new ValidationError(
      `The receipt's Amount (${receipt.docTotal.toFixed(2)}) is more than what is left on the request (${remainingTotal.toFixed(2)})`
    );
  }
}

/**
 * A receipt copied from a request was confirmed (OPEN): the request becomes CLOSED once its confirmed receipts reach
 * its Amount. Called inside the confirm / approval transaction.
 */
export async function closeRequestIfDone(baseEntry: number, userName: string, transaction: sql.Transaction): Promise<void> {
  const rows = await db.query<{ DocTotal: number; Confirmed: number; DocStatus: string }>(
    `SELECT ${DOC_AMOUNT('q')} AS DocTotal, q.DocStatus,
            ISNULL((SELECT SUM(${DOC_AMOUNT('r')}) FROM FTS11TMPR r
                    WHERE r.BaseEntry = q.DocEntry AND ${LIVE_RECEIPT('r')} AND r.DocStatus IN ('OPEN', 'CLOSED')), 0) AS Confirmed
     FROM FTS11OTRQ q WITH (UPDLOCK, HOLDLOCK) WHERE q.DocEntry = @docEntry`,
    [{ name: 'docEntry', value: baseEntry }],
    transaction
  );
  const q = rows[0];
  if (!q || q.DocStatus !== TRQ_STATUS.open) return;
  if (Number(q.Confirmed) + 0.005 >= Number(q.DocTotal)) {
    await db.query(
      `UPDATE FTS11OTRQ SET DocStatus = @closed, UpdatedBy = @userName, UpdatedDate = GETDATE() WHERE DocEntry = @docEntry`,
      [
        { name: 'docEntry', value: baseEntry },
        { name: 'closed', value: TRQ_STATUS.closed },
        { name: 'userName', value: userName },
      ],
      transaction
    );
  }
}

/**
 * A receipt copied from a request was cancelled: a CLOSED request whose confirmed receipts no longer reach its Amount
 * is OPEN again, so the rest can be copied to another receipt. Called inside the cancel transaction.
 */
export async function reopenRequestIfShort(baseEntry: number, userName: string, transaction: sql.Transaction): Promise<void> {
  const rows = await db.query<{ DocTotal: number; Confirmed: number; DocStatus: string }>(
    `SELECT ${DOC_AMOUNT('q')} AS DocTotal, q.DocStatus,
            ISNULL((SELECT SUM(${DOC_AMOUNT('r')}) FROM FTS11TMPR r
                    WHERE r.BaseEntry = q.DocEntry AND ${LIVE_RECEIPT('r')} AND r.DocStatus IN ('OPEN', 'CLOSED')), 0) AS Confirmed
     FROM FTS11OTRQ q WITH (UPDLOCK, HOLDLOCK) WHERE q.DocEntry = @docEntry`,
    [{ name: 'docEntry', value: baseEntry }],
    transaction
  );
  const q = rows[0];
  if (!q || q.DocStatus !== TRQ_STATUS.closed) return;
  if (Number(q.Confirmed) + 0.005 < Number(q.DocTotal)) {
    await db.query(
      `UPDATE FTS11OTRQ SET DocStatus = @open, UpdatedBy = @userName, UpdatedDate = GETDATE() WHERE DocEntry = @docEntry`,
      [
        { name: 'docEntry', value: baseEntry },
        { name: 'open', value: TRQ_STATUS.open },
        { name: 'userName', value: userName },
      ],
      transaction
    );
  }
}

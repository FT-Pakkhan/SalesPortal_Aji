import sql from 'mssql';
import { db } from './db';
import { ValidationError } from './errors';
import { sapTable } from './sapDb';

// Payment Means (as in SAP B1's Incoming Payment), shared by the Temporary Receipt (FTS11TMPR + cheques FTS11TMP2)
// and the Temporary Receipt Request (FTS11OTRQ + cheques FTS11TRQ1): cheques (each No. + amount), Bank Transfer
// (amount + the company's bank account), Credit Card, Cash, and one Bank Charge for the whole document.
// Payment Type and Amount aren't typed: Payment Type = the one mean used or MP (Multiple Type);
// Amount = the means + the bank charge (the bank kept it, but it still settles the customer's items).

export interface PaymentMeans {
  /** The cheques, each with its No. and amount */
  cheques: { checkNum: string; checkSum: number }[];
  /** Their total */
  checkSum: number;
  trsfrSum: number;
  /** SAP house bank account (DSC1.AbsEntry) the transfer went to */
  trsfrBank: number | null;
  creditSum: number;
  cashSum: number;
  /** Bank Charge: one for the whole document, as in SAP B1 */
  bcgSum: number;
}

export const round2 = (n: number) => Math.round(n * 100) / 100;

/** An amount from the request: empty = 0; never negative */
export function amountOf(body: Record<string, unknown>, key: string, label: string): number {
  const raw = body[key];
  if (raw === null || raw === undefined || raw === '') return 0;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) throw new ValidationError(`${label} is not a valid amount`);
  if (n >= 1e13) throw new ValidationError(`${label} is too large`);
  return round2(n);
}

/**
 * The Payment Type follows the payment means keyed in: the only one used (Cheque CH, Bank Transfer BT, Credit Card CC,
 * Cash CA), or MP (Multiple Type) when more than one is used. The bank charge doesn't count as a payment mean.
 */
export function payTypeOf(means: PaymentMeans): string {
  const used = [
    ['CH', means.checkSum],
    ['BT', means.trsfrSum],
    ['CC', means.creditSum],
    ['CA', means.cashSum],
  ].filter(([, amount]) => Number(amount) > 0);
  return used.length === 1 ? (used[0][0] as string) : 'MP';
}

/** Validate the Payment Means of a save request; returns them with the Payment Type and Amount they give */
export function parsePaymentMeans(body: Record<string, unknown>): { means: PaymentMeans; payTyp: string; docTotal: number } {
  // Cheques: each with its own No. (not twice on one document) and an amount above 0
  const rawCheques = Array.isArray(body.cheques) ? (body.cheques as Record<string, unknown>[]) : [];
  const cheques = rawCheques.map((c, i) => {
    const row = `Payment Means, cheque ${i + 1}`;
    const checkNum = String(c.checkNum ?? '').trim();
    if (!checkNum) throw new ValidationError(`${row}: key in the Cheque No.`);
    if (checkNum.length > 20) throw new ValidationError(`${row}: Cheque No. must be 20 characters or fewer`);
    const checkSum = amountOf(c, 'checkSum', `${row}: amount`);
    if (checkSum <= 0) throw new ValidationError(`${row}: key in the amount`);
    return { checkNum, checkSum };
  });
  const twice = cheques.find((c, i) => cheques.findIndex((x) => x.checkNum.toLowerCase() === c.checkNum.toLowerCase()) !== i);
  if (twice) throw new ValidationError(`Payment Means: cheque ${twice.checkNum} is listed twice`);

  const trsfrBank = body.trsfrBank === null || body.trsfrBank === undefined || body.trsfrBank === '' ? null : Number(body.trsfrBank);
  if (trsfrBank !== null && !Number.isInteger(trsfrBank)) throw new ValidationError('Bank is not valid');
  const means: PaymentMeans = {
    cheques,
    checkSum: round2(cheques.reduce((sum, c) => sum + c.checkSum, 0)),
    trsfrSum: amountOf(body, 'trsfrSum', 'Bank Transfer amount'),
    trsfrBank,
    creditSum: amountOf(body, 'creditSum', 'Credit Card amount'),
    cashSum: amountOf(body, 'cashSum', 'Cash amount'),
    bcgSum: amountOf(body, 'bcgSum', 'Bank Charge'),
  };
  // A bank transfer needs its bank; one not used keeps none
  if (means.trsfrSum > 0 && means.trsfrBank === null) throw new ValidationError('Payment Means: choose the Bank for the bank transfer');
  if (means.trsfrSum === 0) means.trsfrBank = null;

  const paid = round2(means.checkSum + means.trsfrSum + means.creditSum + means.cashSum);
  if (paid <= 0) throw new ValidationError('Key in the amount received in Payment Means');
  const docTotal = round2(paid + means.bcgSum);
  if (docTotal >= 1e13) throw new ValidationError('Amount is too large');
  return { means, payTyp: payTypeOf(means), docTotal };
}

/** The transfer's bank must be one of the company's bank accounts in SAP (DSC1) */
export async function assertTransferBank(means: PaymentMeans): Promise<void> {
  if (means.trsfrBank === null) return;
  const bank = await db.query(`SELECT AbsEntry FROM ${sapTable('DSC1')} WHERE AbsEntry = @bank`, [{ name: 'bank', value: means.trsfrBank }]);
  if (bank.length === 0) throw new ValidationError('The bank chosen for the bank transfer is not a house bank account in SAP');
}

/**
 * Save the payment means on a document and replace its cheques (inside the save's transaction).
 * `header` / `chequeTable` come from the program (FTS11TMPR + FTS11TMP2, FTS11OTRQ + FTS11TRQ1), never from a request.
 */
export async function savePaymentMeans(
  header: 'FTS11TMPR' | 'FTS11OTRQ',
  chequeTable: 'FTS11TMP2' | 'FTS11TRQ1',
  docEntry: number,
  means: PaymentMeans,
  transaction: sql.Transaction
): Promise<void> {
  await db.query(`DELETE FROM ${chequeTable} WHERE DocEntry = @docEntry`, [{ name: 'docEntry', value: docEntry }], transaction);
  for (const [i, c] of means.cheques.entries()) {
    await db.query(
      `INSERT INTO ${chequeTable} (DocEntry, LineNum, CheckNum, CheckSum) VALUES (@docEntry, @lineNum, @checkNum, @checkSum)`,
      [
        { name: 'docEntry', value: docEntry },
        { name: 'lineNum', value: i },
        { name: 'checkNum', value: c.checkNum },
        { name: 'checkSum', type: sql.Decimal(19, 6), value: c.checkSum },
      ],
      transaction
    );
  }
  await db.query(
    `UPDATE ${header}
     SET CheckSum = @checkSum, TrsfrSum = @trsfrSum, TrsfrBank = @trsfrBank,
         CreditSum = @creditSum, CashSum = @cashSum, BcgSum = @bcgSum
     WHERE DocEntry = @docEntry`,
    [
      { name: 'docEntry', value: docEntry },
      { name: 'checkSum', type: sql.Decimal(19, 6), value: means.checkSum },
      { name: 'trsfrSum', type: sql.Decimal(19, 6), value: means.trsfrSum },
      { name: 'trsfrBank', type: sql.Int, value: means.trsfrBank },
      { name: 'creditSum', type: sql.Decimal(19, 6), value: means.creditSum },
      { name: 'cashSum', type: sql.Decimal(19, 6), value: means.cashSum },
      { name: 'bcgSum', type: sql.Decimal(19, 6), value: means.bcgSum },
    ],
    transaction
  );
}

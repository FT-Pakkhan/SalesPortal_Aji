import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { authenticateRequest } from '@/lib/auth';
import { successResponse, errorResponse } from '@/lib/apiResponse';
import { confirmReceipt, getReceipt } from '@/lib/temporaryReceipts';
import { autoPostToSap, withPostResult } from '@/lib/sapPosting';
import { assertReceiptFitsRequest } from '@/lib/receiptRequests';

interface RouteContext {
  params: Promise<{ id: string }>;
}

// POST /api/temporary-receipts/[id]/confirm - Confirm a DRAFT receipt: its No. and OPEN, or (approval needed) PENDING.
// A rejected one sent again, copied from a request: it must still fit what is left on the request (other receipts may
// have been made from it while it was rejected).
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const user = authenticateRequest(request);
    const { id } = await context.params;
    const docEntry = parseInt(id);
    // { docNum }: the No. keyed in, for a manual series (no body otherwise)
    const body = (await request.json().catch(() => ({}))) as { docNum?: unknown };

    const transaction = await db.beginTransaction();
    let apprStatus: string;
    try {
      // Its Amount in its own currency (DocTotal is kept in the local one)
      const rows = await db.query<{ ApprStatus: string; BaseEntry: number | null; CardCode: string; DocTotal: number; DocCur: string | null }>(
        `SELECT ApprStatus, CASE WHEN BaseType = 'FTS11OTRQ' THEN BaseEntry END AS BaseEntry, CardCode,
                CASE WHEN DocTotalFC <> 0 THEN DocTotalFC ELSE DocTotal END AS DocTotal, DocCur
         FROM FTS11TMPR WHERE DocEntry = @docEntry`,
        [{ name: 'docEntry', value: docEntry }],
        transaction
      );
      const r = rows[0];
      if (r && r.ApprStatus === 'REJECTED' && r.BaseEntry) {
        await assertReceiptFitsRequest(r.BaseEntry, { cardCode: r.CardCode, docTotal: Number(r.DocTotal), docCur: r.DocCur }, docEntry, transaction);
      }
      apprStatus = await confirmReceipt(docEntry, user.userName, transaction, body.docNum);
      await db.commitTransaction(transaction);
    } catch (error) {
      await db.rollbackTransaction(transaction);
      throw error;
    }
    // Confirmed (no approval needed): posted to SAP straight away (FAILED with the reason if not)
    const post = apprStatus === 'PENDING' ? null : await autoPostToSap('FTS11TMPR', docEntry, user.userId);
    const receipt = await getReceipt(docEntry);
    return successResponse(
      receipt,
      apprStatus === 'PENDING'
        ? 'Temporary receipt sent for approval'
        : withPostResult(`Temporary receipt confirmed: No. ${(receipt as { DocNum?: string }).DocNum}`, post)
    );
  } catch (error) {
    return errorResponse(error);
  }
}

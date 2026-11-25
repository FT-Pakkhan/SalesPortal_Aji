import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { authenticateRequest } from '@/lib/auth';
import { successResponse, errorResponse } from '@/lib/apiResponse';
import { ValidationError } from '@/lib/errors';
import { assertNotSynced } from '@/lib/salesDocuments';
import {
  parseReceiptFields,
  parseReceiptLines,
  saveReceiptLines,
  saveReceiptMeans,
  assertReceiptReferences,
  receiptParams,
  getReceipt,
  lockReceipt,
  assertReceiptNotInApproval,
  applyReceiptCurrency,
  TMPR_STATUS,
  TMPR_NUMBER,
} from '@/lib/temporaryReceipts';
import { saveDraftNumber } from '@/lib/documentNumbering';
import { assertReceiptFitsRequest } from '@/lib/receiptRequests';
import { isApproverNow } from '@/lib/approvalCheck';
import { notifyApprovalChange } from '@/lib/notifications';
import { TMPR_OBJTYPE } from '@/lib/temporaryReceipts';
import { getCurrencySettings } from '@/lib/currency';

interface RouteContext {
  params: Promise<{ id: string }>;
}

// GET /api/temporary-receipts/[id] - One receipt; CanApproverEdit = waiting for this user's approval now, so they may
// change it while approving
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const user = authenticateRequest(request);
    const { id } = await context.params;
    const docEntry = parseInt(id);
    const receipt = (await getReceipt(docEntry)) as Record<string, unknown>;
    const canApproverEdit = receipt.ApprStatus === 'PENDING' && (await isApproverNow(TMPR_OBJTYPE, docEntry, user.userId));
    return successResponse({ ...receipt, CanApproverEdit: canApproverEdit });
  } catch (error) {
    return errorResponse(error);
  }
}

// PUT /api/temporary-receipts/[id] - Change a DRAFT or OPEN receipt and its lines; Series and Customer are fixed once
// confirmed. While it waits for approval only an approver whose turn it is may change it (Series and Customer fixed);
// the change and its reason (body.changeReason) are kept in FTS11WDD2 and the sender is told. Approvals given so far
// still count and the approval templates are not run again.
export async function PUT(request: NextRequest, context: RouteContext) {
  try {
    const user = authenticateRequest(request);
    const { id } = await context.params;
    const docEntry = parseInt(id);
    const body = await request.json();
    const fields = parseReceiptFields(body);
    const lines = parseReceiptLines(body);

    const transaction = await db.beginTransaction();
    try {
      // Locked so two saves of the same receipt can't mix their lines
      const current = await lockReceipt(docEntry, transaction);
      if (current.DocStatus !== TMPR_STATUS.draft && current.DocStatus !== TMPR_STATUS.open) {
        throw new ValidationError(`A ${current.DocStatus} temporary receipt can't be changed`);
      }
      const byApprover = current.ApprStatus === 'PENDING' && (await isApproverNow(TMPR_OBJTYPE, docEntry, user.userId, transaction));
      if (!byApprover) await assertReceiptNotInApproval(docEntry, current.ApprStatus, transaction);
      assertNotSynced('temporary receipt', current.PostStatus);
      const isOpen = current.DocStatus === TMPR_STATUS.open;
      if ((isOpen || byApprover) && fields.series !== current.Series) {
        throw new ValidationError(`Series can't be changed ${byApprover ? 'while approving' : 'after confirming'}`);
      }
      if ((isOpen || byApprover) && fields.cardCode !== current.CardCode) {
        throw new ValidationError(`Customer can't be changed ${byApprover ? 'while approving' : 'after confirming'}`);
      }
      const changeReason = String(body.changeReason ?? '').trim();
      if (changeReason.length > 254) throw new ValidationError('Reason for change must be 254 characters or fewer');
      await assertReceiptReferences(fields, !isOpen && !byApprover);
      // Its currency and rate: kept once confirmed and while approving (the Posting Date is fixed too then); a draft's
      // rate is SAP's for its Posting Date. One made before currencies (no DocCur) is in the local currency.
      const keepCurrency = isOpen || byApprover;
      await applyReceiptCurrency(fields, keepCurrency ? { docCur: current.DocCur ?? (await getCurrencySettings()).local, docRate: Number(current.DocRate) || 1 } : undefined);
      // Copied from a request: it stays linked to it, and must still fit what is left on it (not counting itself)
      const base = await db.query<{ BaseEntry: number | null }>(
        `SELECT BaseEntry FROM FTS11TMPR WHERE DocEntry = @docEntry AND BaseType = 'FTS11OTRQ'`,
        [{ name: 'docEntry', value: docEntry }],
        transaction
      );
      if (base[0]?.BaseEntry) await assertReceiptFitsRequest(base[0].BaseEntry, fields, docEntry, transaction);

      // Posting Date: kept as confirmed once OPEN (the No. was made from it)
      await db.query(
        `UPDATE FTS11TMPR
         SET Series = @series, DocDate = CASE WHEN DocStatus = 'DRAFT' THEN @docDate ELSE DocDate END, TaxDate = @taxDate, CardCode = @cardCode, CardName = @cardName, PayTyp = @payTyp, DocTotal = @docTotal,
             DocCur = @docCur, DocRate = @docRate, DocTotalFC = @docTotalFC, Comments = @comments
         WHERE DocEntry = @docEntry`,
        [{ name: 'docEntry', value: docEntry }, ...receiptParams(fields)],
        transaction
      );
      await saveReceiptMeans(docEntry, fields.means, transaction);
      await saveReceiptLines(docEntry, fields.cardCode, fields.docTotal, lines, user.userName, transaction, {
        currency: fields.docCur as string,
        // The balances at SAP's rate on the Posting Date it keeps (fixed once confirmed)
        date: current.DocStatus === TMPR_STATUS.draft ? fields.docDate : current.DocDateText,
      });
      // A draft on a manual series: the No. typed in the No. field (checked on Confirm); nothing once confirmed or sent
      // for approval (a manual No. was kept when it was sent)
      if (!byApprover) await saveDraftNumber(TMPR_NUMBER, docEntry, fields.series, body.docNum, transaction);
      if (byApprover) {
        await db.query(
          `INSERT INTO FTS11WDD2 (ObjType, DocEntry, UserID, Remarks) VALUES (@objType, @docEntry, @userId, @remarks)`,
          [
            { name: 'objType', value: TMPR_OBJTYPE },
            { name: 'docEntry', value: docEntry },
            { name: 'userId', value: user.userId },
            { name: 'remarks', value: changeReason || null },
          ],
          transaction
        );
        await notifyApprovalChange(TMPR_OBJTYPE, docEntry, user, changeReason || null, transaction);
      }
      await db.commitTransaction(transaction);
    } catch (error) {
      await db.rollbackTransaction(transaction);
      throw error;
    }
    const receipt = (await getReceipt(docEntry)) as Record<string, unknown>;
    const canApproverEdit = receipt.ApprStatus === 'PENDING' && (await isApproverNow(TMPR_OBJTYPE, docEntry, user.userId));
    return successResponse({ ...receipt, CanApproverEdit: canApproverEdit }, 'Temporary receipt updated');
  } catch (error) {
    return errorResponse(error);
  }
}

import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { authenticateRequest } from '@/lib/auth';
import { successResponse, errorResponse } from '@/lib/apiResponse';
import { confirmTransfer, getTransfer } from '@/lib/inventoryTransfers';
import { autoPostToSap, withPostResult } from '@/lib/sapPosting';

interface RouteContext {
  params: Promise<{ id: string }>;
}

// POST /api/inventory-transfers/[id]/confirm - Confirm a DRAFT transfer: stock checked, then its No. and OPEN, or
// (approval needed) PENDING approval
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
      apprStatus = await confirmTransfer(docEntry, user.userName, transaction, body.docNum);
      await db.commitTransaction(transaction);
    } catch (error) {
      await db.rollbackTransaction(transaction);
      throw error;
    }
    // Confirmed (no approval needed): posted to SAP straight away (FAILED with the reason if not)
    const post = apprStatus === 'PENDING' ? null : await autoPostToSap('FTS11OWTR', docEntry, user.userId);
    const transfer = await getTransfer(docEntry);
    return successResponse(
      transfer,
      apprStatus === 'PENDING'
        ? 'Inventory transfer sent for approval'
        : withPostResult(`Inventory transfer confirmed: No. ${(transfer as { DocNum?: string }).DocNum}`, post)
    );
  } catch (error) {
    return errorResponse(error);
  }
}

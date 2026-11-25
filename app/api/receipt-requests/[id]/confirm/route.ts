import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { authenticateRequest } from '@/lib/auth';
import { successResponse, errorResponse } from '@/lib/apiResponse';
import { confirmRequest, getRequest } from '@/lib/receiptRequests';

interface RouteContext {
  params: Promise<{ id: string }>;
}

// POST /api/receipt-requests/[id]/confirm - Confirm a DRAFT request: its No. and OPEN, or (approval needed) PENDING
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
      apprStatus = await confirmRequest(docEntry, user.userName, transaction, body.docNum);
      await db.commitTransaction(transaction);
    } catch (error) {
      await db.rollbackTransaction(transaction);
      throw error;
    }
    const req = await getRequest(docEntry);
    return successResponse(
      req,
      apprStatus === 'PENDING'
        ? 'Temporary receipt request sent for approval'
        : `Temporary receipt request confirmed: No. ${(req as { DocNum?: string }).DocNum}`
    );
  } catch (error) {
    return errorResponse(error);
  }
}

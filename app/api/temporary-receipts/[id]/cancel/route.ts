import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { authenticateRequest } from '@/lib/auth';
import { successResponse, errorResponse } from '@/lib/apiResponse';
import { cancelReceipt, getReceipt } from '@/lib/temporaryReceipts';
import { cancelReceiptInSap } from '@/lib/sapPosting';

interface RouteContext {
  params: Promise<{ id: string }>;
}

// POST /api/temporary-receipts/[id]/cancel - Cancel Doc: a DRAFT / OPEN receipt becomes CANCELED. Posted to SAP: its
// incoming payment is cancelled there too, last, before the portal's change is committed (SAP refusing rolls it back).
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const user = authenticateRequest(request);
    const { id } = await context.params;
    const docEntry = parseInt(id);

    const transaction = await db.beginTransaction();
    try {
      await cancelReceipt(docEntry, user.userName, transaction);
      await cancelReceiptInSap(docEntry, transaction);
      await db.commitTransaction(transaction);
    } catch (error) {
      await db.rollbackTransaction(transaction);
      throw error;
    }
    return successResponse(await getReceipt(docEntry), 'Temporary receipt cancelled');
  } catch (error) {
    return errorResponse(error);
  }
}

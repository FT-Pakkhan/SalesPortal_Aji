import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { authenticateRequest } from '@/lib/auth';
import { successResponse, errorResponse } from '@/lib/apiResponse';
import { cancelRequest, getRequest } from '@/lib/receiptRequests';

interface RouteContext {
  params: Promise<{ id: string }>;
}

// POST /api/receipt-requests/[id]/cancel - Cancel Doc: a DRAFT or OPEN request not copied into a receipt -> CANCELED
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const user = authenticateRequest(request);
    const { id } = await context.params;
    const docEntry = parseInt(id);

    const transaction = await db.beginTransaction();
    try {
      await cancelRequest(docEntry, user.userName, transaction);
      await db.commitTransaction(transaction);
    } catch (error) {
      await db.rollbackTransaction(transaction);
      throw error;
    }
    return successResponse(await getRequest(docEntry), 'Temporary receipt request cancelled');
  } catch (error) {
    return errorResponse(error);
  }
}

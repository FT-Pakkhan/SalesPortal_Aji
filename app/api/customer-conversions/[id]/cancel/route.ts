import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { authenticateRequest } from '@/lib/auth';
import { successResponse, errorResponse } from '@/lib/apiResponse';
import { cancelConversion, getConversion } from '@/lib/customerConversions';

interface RouteContext {
  params: Promise<{ id: string }>;
}

// POST /api/customer-conversions/[id]/cancel - Cancel Doc: a DRAFT or OPEN one not synced to SAP -> CANCELED
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const user = authenticateRequest(request);
    const { id } = await context.params;
    const docEntry = parseInt(id);

    const transaction = await db.beginTransaction();
    try {
      await cancelConversion(docEntry, user.userName, transaction);
      await db.commitTransaction(transaction);
    } catch (error) {
      await db.rollbackTransaction(transaction);
      throw error;
    }
    return successResponse(await getConversion(docEntry), 'Convert to customer cancelled');
  } catch (error) {
    return errorResponse(error);
  }
}

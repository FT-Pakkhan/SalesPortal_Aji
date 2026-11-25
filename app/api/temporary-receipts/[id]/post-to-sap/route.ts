import { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/auth';
import { successResponse, errorResponse } from '@/lib/apiResponse';
import { getReceipt } from '@/lib/temporaryReceipts';
import { postReceiptToSap } from '@/lib/sapPosting';

interface RouteContext {
  params: Promise<{ id: string }>;
}

// POST /api/temporary-receipts/[id]/post-to-sap - create the receipt in SAP as an Incoming Payment.
// Answers { posted, message, receipt }: posted = false means SAP refused it (the receipt is now FAILED with the reason).
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const user = authenticateRequest(request);
    const { id } = await context.params;
    const docEntry = parseInt(id);

    const result = await postReceiptToSap(docEntry, user.userId);
    const receipt = await getReceipt(docEntry);
    return successResponse({ posted: result.success, message: result.message, receipt }, result.message);
  } catch (error) {
    return errorResponse(error);
  }
}

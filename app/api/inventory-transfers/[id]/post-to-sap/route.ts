import { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/auth';
import { successResponse, errorResponse } from '@/lib/apiResponse';
import { getTransfer } from '@/lib/inventoryTransfers';
import { postTransferToSap } from '@/lib/sapPosting';

interface RouteContext {
  params: Promise<{ id: string }>;
}

// POST /api/inventory-transfers/[id]/post-to-sap - create the transfer in SAP as an Inventory Transfer.
// Answers { posted, message, transfer }: posted = false means SAP refused it (the transfer is now FAILED with the reason).
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const user = authenticateRequest(request);
    const { id } = await context.params;
    const docEntry = parseInt(id);

    const result = await postTransferToSap(docEntry, user.userId);
    const transfer = await getTransfer(docEntry);
    return successResponse({ posted: result.success, message: result.message, transfer }, result.message);
  } catch (error) {
    return errorResponse(error);
  }
}

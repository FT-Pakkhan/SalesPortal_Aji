import { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/auth';
import { successResponse, errorResponse } from '@/lib/apiResponse';
import { SALES_ORDER, getDocumentDetail } from '@/lib/salesDocuments';
import { postSalesOrderToSap } from '@/lib/sapPosting';

interface RouteContext {
  params: Promise<{ id: string }>;
}

// POST /api/sales-orders/[id]/post-to-sap - create the sales order in SAP.
// Answers { posted, message, document }: posted = false means SAP refused it (the order is now FAILED with the reason).
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const user = authenticateRequest(request);
    const { id } = await context.params;
    const docEntry = parseInt(id);

    const result = await postSalesOrderToSap(docEntry, user.userId);
    const document = await getDocumentDetail(SALES_ORDER, docEntry);
    return successResponse({ posted: result.success, message: result.message, document }, result.message);
  } catch (error) {
    return errorResponse(error);
  }
}

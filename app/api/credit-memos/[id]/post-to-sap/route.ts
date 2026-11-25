import { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/auth';
import { successResponse, errorResponse } from '@/lib/apiResponse';
import { CREDIT_MEMO, getDocumentDetail } from '@/lib/salesDocuments';
import { postCreditMemoToSap } from '@/lib/sapPosting';

interface RouteContext {
  params: Promise<{ id: string }>;
}

// POST /api/credit-memos/[id]/post-to-sap - create the credit memo in SAP as an A/R credit memo.
// Answers { posted, message, document }: posted = false means SAP refused it (the credit memo is now FAILED with the reason).
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const user = authenticateRequest(request);
    const { id } = await context.params;
    const docEntry = parseInt(id);

    const result = await postCreditMemoToSap(docEntry, user.userId);
    const document = await getDocumentDetail(CREDIT_MEMO, docEntry);
    return successResponse({ posted: result.success, message: result.message, document }, result.message);
  } catch (error) {
    return errorResponse(error);
  }
}

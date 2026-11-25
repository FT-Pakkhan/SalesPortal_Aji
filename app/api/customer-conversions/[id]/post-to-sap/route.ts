import { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/auth';
import { successResponse, errorResponse } from '@/lib/apiResponse';
import { getConversion } from '@/lib/customerConversions';
import { postConversionToSap } from '@/lib/sapPosting';

interface RouteContext {
  params: Promise<{ id: string }>;
}

// POST /api/customer-conversions/[id]/post-to-sap - post again after a FAILED posting: create the lead in SAP as a
// customer with the SAP BP Code keyed in. Answers { posted, message, conversion }: posted = false means SAP refused
// it (it is FAILED again with the reason).
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const user = authenticateRequest(request);
    const { id } = await context.params;
    const docEntry = parseInt(id);

    const result = await postConversionToSap(docEntry, user.userId);
    const conversion = await getConversion(docEntry);
    return successResponse({ posted: result.success, message: result.message, conversion }, result.message);
  } catch (error) {
    return errorResponse(error);
  }
}

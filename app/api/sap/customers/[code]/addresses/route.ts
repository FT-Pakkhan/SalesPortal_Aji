import { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/auth';
import { successResponse, errorResponse } from '@/lib/apiResponse';
import { getCustomerAddresses } from '@/lib/customerAddresses';

interface RouteContext {
  params: Promise<{ code: string }>;
}

// GET /api/sap/customers/[code]/addresses - A SAP B1 customer's Bill To / Ship To addresses (CRD1) laid out as text,
// with its default ones (OCRD.BillToDef / ShipToDef), for a sales document's Delivery tab. A lead has none.
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    authenticateRequest(request);
    const { code } = await context.params;
    return successResponse(await getCustomerAddresses(decodeURIComponent(code)));
  } catch (error) {
    return errorResponse(error);
  }
}

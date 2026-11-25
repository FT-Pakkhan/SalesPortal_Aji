import { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/auth';
import { successResponse, errorResponse } from '@/lib/apiResponse';
import { createCustomerUpdate } from '@/lib/customerConversions';

interface RouteContext {
  params: Promise<{ id: string }>;
}

// POST /api/customer-conversions/[id]/update-customer - Update Customer on a conversion posted to SAP: a new DRAFT
// conversion filled from the customer's latest posted one (same lead and SAP BP Code). If an update of that customer
// is already on its way, that one is answered instead (existing: true).
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const user = authenticateRequest(request);
    const { id } = await context.params;
    const result = await createCustomerUpdate(parseInt(id), user.userName);
    return successResponse(
      result,
      result.existing ? 'An update of this customer is already on its way: it is opened' : 'Update Customer created as draft',
      result.existing ? 200 : 201
    );
  } catch (error) {
    return errorResponse(error);
  }
}

import { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/auth';
import { successResponse, errorResponse } from '@/lib/apiResponse';
import { getDiscountTypes } from '@/lib/discountTypes';

// GET /api/sap/discount-types - SAP's Discount Types (user table @DISCOUNTTYPE: Code, Name), for a sales document's
// Discount Type; none when the company database has no such table
export async function GET(request: NextRequest) {
  try {
    authenticateRequest(request);
    return successResponse(await getDiscountTypes());
  } catch (error) {
    return errorResponse(error);
  }
}

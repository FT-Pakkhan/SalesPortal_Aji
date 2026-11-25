import { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/auth';
import { successResponse, errorResponse } from '@/lib/apiResponse';
import { getSellerBanks } from '@/lib/sellerBanks';

// GET /api/sap/seller-banks - SAP's Seller Banks (user table @SELLERBANK: Code, Name), for a sales document's
// Bank Info; none when the company database has no such table
export async function GET(request: NextRequest) {
  try {
    authenticateRequest(request);
    return successResponse(await getSellerBanks());
  } catch (error) {
    return errorResponse(error);
  }
}

import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { authenticateRequest } from '@/lib/auth';
import { successResponse, errorResponse } from '@/lib/apiResponse';
import { sapTable } from '@/lib/sapDb';

// GET /api/sap/tax-codes - Active sales (output) tax codes from SAP B1 (OVTG, Category 'O')
export async function GET(request: NextRequest) {
  try {
    authenticateRequest(request);
    const data = await db.query(
      `SELECT Code, Name, Rate
       FROM ${sapTable('OVTG')}
       WHERE Category = 'O' AND ISNULL(Inactive, 'N') <> 'Y'
       ORDER BY Code`
    );
    return successResponse(data);
  } catch (error) {
    return errorResponse(error);
  }
}

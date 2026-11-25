import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { authenticateRequest } from '@/lib/auth';
import { successResponse, errorResponse } from '@/lib/apiResponse';
import { sapTable } from '@/lib/sapDb';

// GET /api/sap/sales-employees - Active SAP B1 sales employees (OSLP)
export async function GET(request: NextRequest) {
  try {
    authenticateRequest(request);
    const data = await db.query(
      `SELECT SlpCode, SlpName
       FROM ${sapTable('OSLP')}
       WHERE ISNULL(Active, 'Y') = 'Y'
       ORDER BY SlpName`
    );
    return successResponse(data);
  } catch (error) {
    return errorResponse(error);
  }
}

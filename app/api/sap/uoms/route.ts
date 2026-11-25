import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { authenticateRequest } from '@/lib/auth';
import { successResponse, errorResponse } from '@/lib/apiResponse';
import { sapTable } from '@/lib/sapDb';

// GET /api/sap/uoms - SAP B1's units of measure (OUOM), for the lines' Sales UoM
export async function GET(request: NextRequest) {
  try {
    authenticateRequest(request);
    const data = await db.query(
      `SELECT UomCode, UomName
       FROM ${sapTable('OUOM')}
       ORDER BY UomCode`
    );
    return successResponse(data);
  } catch (error) {
    return errorResponse(error);
  }
}

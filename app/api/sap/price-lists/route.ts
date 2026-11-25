import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { authenticateRequest } from '@/lib/auth';
import { successResponse, errorResponse } from '@/lib/apiResponse';
import { sapTable } from '@/lib/sapDb';

// GET /api/sap/price-lists - SAP B1's price lists (OPLN), for General Settings > Default Price List
export async function GET(request: NextRequest) {
  try {
    authenticateRequest(request);
    const data = await db.query(`SELECT ListNum, ListName FROM ${sapTable('OPLN')} ORDER BY ListNum`);
    return successResponse(data);
  } catch (error) {
    return errorResponse(error);
  }
}

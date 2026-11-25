import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { authenticateRequest } from '@/lib/auth';
import { successResponse, errorResponse } from '@/lib/apiResponse';

// GET /api/pay-types - Payment types (FTS_vw_PayTyp), for the Temporary Receipt's Payment Type
export async function GET(request: NextRequest) {
  try {
    authenticateRequest(request);
    return successResponse(await db.query(`SELECT Code, Name FROM FTS_vw_PayTyp ORDER BY Name`));
  } catch (error) {
    return errorResponse(error);
  }
}

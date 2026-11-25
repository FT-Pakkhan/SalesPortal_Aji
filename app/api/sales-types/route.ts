import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { authenticateRequest } from '@/lib/auth';
import { successResponse, errorResponse } from '@/lib/apiResponse';

// GET /api/sales-types - Sales Types (FTS_vw_SalesTyp) for the sales documents' Sales Type drop-down
export async function GET(request: NextRequest) {
  try {
    authenticateRequest(request);
    return successResponse(await db.query(`SELECT Code, Name FROM FTS_vw_SalesTyp`));
  } catch (error) {
    return errorResponse(error);
  }
}

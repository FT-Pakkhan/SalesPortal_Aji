import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { authenticateRequest } from '@/lib/auth';
import { successResponse, errorResponse } from '@/lib/apiResponse';

// GET /api/server-types - SAP B1 database server types (FTS_vw_SvrTyp), for General Settings
export async function GET(request: NextRequest) {
  try {
    authenticateRequest(request);
    return successResponse(await db.query(`SELECT Code, Name FROM FTS_vw_SvrTyp ORDER BY Code`));
  } catch (error) {
    return errorResponse(error);
  }
}

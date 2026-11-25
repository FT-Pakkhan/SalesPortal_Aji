import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { authenticateRequest } from '@/lib/auth';
import { successResponse, errorResponse } from '@/lib/apiResponse';

// GET /api/document-types - Document types from FTS_vw_ObjType (Code, Name)
export async function GET(request: NextRequest) {
  try {
    authenticateRequest(request);
    const data = await db.query(`SELECT Code, Name FROM FTS_vw_ObjType ORDER BY Name`);
    return successResponse(data);
  } catch (error) {
    return errorResponse(error);
  }
}

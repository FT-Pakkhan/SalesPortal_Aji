import { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/auth';
import { successResponse, errorResponse } from '@/lib/apiResponse';
import { getEmailLog } from '@/lib/reportEmail';

// GET /api/email-log - Reports e-mailed from the portal, newest first (?limit=, default 1000)
export async function GET(request: NextRequest) {
  try {
    authenticateRequest(request);
    const limit = Math.min(Math.max(Number(request.nextUrl.searchParams.get('limit')) || 1000, 1), 5000);
    return successResponse(await getEmailLog(limit));
  } catch (error) {
    return errorResponse(error);
  }
}

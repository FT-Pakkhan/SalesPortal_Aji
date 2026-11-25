import { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/auth';
import { successResponse, errorResponse } from '@/lib/apiResponse';
import { getMyReports } from '@/lib/reports';

// GET /api/reports - The active reports the logged-in user may run (one of the report's roles, or an admin role)
export async function GET(request: NextRequest) {
  try {
    const user = authenticateRequest(request);
    return successResponse(await getMyReports(user.userId));
  } catch (error) {
    return errorResponse(error);
  }
}

import { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/auth';
import { successResponse, errorResponse } from '@/lib/apiResponse';
import { getMyApprovals } from '@/lib/approvals';

// GET /api/approvals - Documents waiting for the logged-in user's approval (their turn: current stage)
export async function GET(request: NextRequest) {
  try {
    const user = authenticateRequest(request);
    return successResponse(await getMyApprovals(user.userId));
  } catch (error) {
    return errorResponse(error);
  }
}

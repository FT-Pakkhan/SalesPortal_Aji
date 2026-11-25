import { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/auth';
import { successResponse, errorResponse } from '@/lib/apiResponse';
import { getUserAccess } from '@/lib/roles';

// GET /api/my-access - What the logged-in user may do: { isAdmin, screens: { LEAD: 'FULL', OQUT: 'READ', ... } }
// (screen codes are sent as they are, not camel-cased)
export async function GET(request: NextRequest) {
  try {
    const user = authenticateRequest(request);
    const access = await getUserAccess(user.userId);
    return successResponse({ isAdmin: access.isAdmin, screenList: Object.entries(access.screens).map(([code, level]) => ({ code, level })) });
  } catch (error) {
    return errorResponse(error);
  }
}

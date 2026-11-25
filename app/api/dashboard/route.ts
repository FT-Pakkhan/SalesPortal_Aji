import { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/auth';
import { successResponse, errorResponse } from '@/lib/apiResponse';
import { getMyWidgets, getMyWork } from '@/lib/dashboard';

// GET /api/dashboard - The Dashboard for the logged-in user: the My Work tiles (counts and their documents) and the
// widgets they see (definitions; each widget's data comes from /api/dashboard/widgets/[id])
export async function GET(request: NextRequest) {
  try {
    const user = authenticateRequest(request);
    const [myWork, widgets] = await Promise.all([getMyWork(user.userId, user.userName), getMyWidgets(user.userId)]);
    return successResponse({ myWork, widgets });
  } catch (error) {
    return errorResponse(error);
  }
}

import { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/auth';
import { successResponse, errorResponse } from '@/lib/apiResponse';
import { getWidgetData } from '@/lib/dashboard';

interface RouteContext {
  params: Promise<{ id: string }>;
}

// GET /api/dashboard/widgets/[id] - A widget's data for the logged-in user: { columnList, rowList, truncated }
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const user = authenticateRequest(request);
    const { id } = await context.params;
    return successResponse(await getWidgetData(parseInt(id), user.userId, user.userName));
  } catch (error) {
    return errorResponse(error);
  }
}

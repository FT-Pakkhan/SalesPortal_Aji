import { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/auth';
import { successResponse, errorResponse } from '@/lib/apiResponse';
import { getVisit, updateVisitText } from '@/lib/salesCheckIns';

interface RouteContext {
  params: Promise<{ id: string }>;
}

// GET /api/sales-check-ins/[id] - One visit (only if it is my Sales Employee's)
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const user = authenticateRequest(request);
    const { id } = await context.params;
    return successResponse(await getVisit(parseInt(id), user.userId));
  } catch (error) {
    return errorResponse(error);
  }
}

// PUT /api/sales-check-ins/[id] - Change Purpose / Remarks of my own visit: { purpose, comments }
export async function PUT(request: NextRequest, context: RouteContext) {
  try {
    const user = authenticateRequest(request);
    const { id } = await context.params;
    const docEntry = parseInt(id);
    await updateVisitText(docEntry, await request.json(), user);
    return successResponse(await getVisit(docEntry, user.userId), 'Sales check-in updated');
  } catch (error) {
    return errorResponse(error);
  }
}

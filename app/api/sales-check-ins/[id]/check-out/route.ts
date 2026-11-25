import { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/auth';
import { successResponse, errorResponse } from '@/lib/apiResponse';
import { checkOut, getVisit } from '@/lib/salesCheckIns';

interface RouteContext {
  params: Promise<{ id: string }>;
}

// POST /api/sales-check-ins/[id]/check-out - Check Out of my own OPEN visit: { location: { lat, lng, accuracy }, comments? }
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const user = authenticateRequest(request);
    const { id } = await context.params;
    const docEntry = parseInt(id);
    await checkOut(docEntry, await request.json(), user);
    return successResponse(await getVisit(docEntry, user.userId), 'Checked out');
  } catch (error) {
    return errorResponse(error);
  }
}

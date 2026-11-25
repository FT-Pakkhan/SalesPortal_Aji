import { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/auth';
import { successResponse, errorResponse } from '@/lib/apiResponse';
import { stagesOfApprover } from '@/lib/approvalStages';

interface RouteContext {
  params: Promise<{ id: string }>;
}

// GET /api/users/[id]/approval-stages - The approval stages this user approves in (to warn before deactivating them)
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    authenticateRequest(request);
    const { id } = await context.params;
    return successResponse(await stagesOfApprover(parseInt(id)));
  } catch (error) {
    return errorResponse(error);
  }
}

import { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/auth';
import { successResponse, errorResponse } from '@/lib/apiResponse';
import { getEmailDraft } from '@/lib/reportEmail';

interface RouteContext {
  params: Promise<{ id: string }>;
}

// POST /api/reports/[id]/email-draft - { values }: the E-mail form filled in from the report's E-mail tab
// (To, CC, Subject, Body, FileName, MyEmail) for these parameter values
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const user = authenticateRequest(request);
    const { id } = await context.params;
    return successResponse(await getEmailDraft(parseInt(id), user.userId, await request.json()));
  } catch (error) {
    return errorResponse(error);
  }
}

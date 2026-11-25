import { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/auth';
import { successResponse, errorResponse } from '@/lib/apiResponse';
import { getLayoutEmailDraft } from '@/lib/layoutEmail';

interface RouteContext {
  params: Promise<{ id: string }>;
}

// POST /api/print-layouts/[id]/email-draft - { objType, docEntry }: the E-mail form filled in for the document
// (To = the customer's e-mail, CC, Subject, Body, FileName, MyEmail)
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const user = authenticateRequest(request);
    const { id } = await context.params;
    return successResponse(await getLayoutEmailDraft(parseInt(id), user.userId, await request.json()));
  } catch (error) {
    return errorResponse(error);
  }
}

import { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/auth';
import { successResponse, errorResponse } from '@/lib/apiResponse';
import { sendLayoutEmail } from '@/lib/layoutEmail';

interface RouteContext {
  params: Promise<{ id: string }>;
}

// POST /api/print-layouts/[id]/email - { objType, docEntry, to, cc, subject, body, fileName, copyMe }: print the
// document with the layout, e-mail the PDF and log it. Answers { sent, message } (a mail server refusal is sent = false).
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const user = authenticateRequest(request);
    const { id } = await context.params;
    const result = await sendLayoutEmail(parseInt(id), user.userId, await request.json());
    return successResponse(result, result.message);
  } catch (error) {
    return errorResponse(error);
  }
}

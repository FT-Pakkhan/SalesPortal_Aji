import { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/auth';
import { successResponse, errorResponse } from '@/lib/apiResponse';
import { sendReportEmail } from '@/lib/reportEmail';

interface RouteContext {
  params: Promise<{ id: string }>;
}

// POST /api/reports/[id]/email - { values, to, cc, subject, body, fileName, copyMe }: run the report with the values,
// e-mail the PDF and log it. Answers { sent, message } (a mail server refusal is sent = false, also logged).
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const user = authenticateRequest(request);
    const { id } = await context.params;
    const result = await sendReportEmail(parseInt(id), user.userId, await request.json());
    return successResponse(result, result.message);
  } catch (error) {
    return errorResponse(error);
  }
}

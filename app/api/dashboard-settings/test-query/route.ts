import { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/auth';
import { successResponse, errorResponse } from '@/lib/apiResponse';
import { runWidgetQuery } from '@/lib/dashboard';

// POST /api/dashboard-settings/test-query - { query, widgetType, useSapConn }: run a widget query as typed (not saved
// yet), with the logged-in user's @variables, always rolled back. Answers like a widget: { columnList, rowList, truncated }.
export async function POST(request: NextRequest) {
  try {
    const user = authenticateRequest(request);
    const body = await request.json();
    return successResponse(
      await runWidgetQuery(String(body.query ?? ''), String(body.widgetType ?? 'TABLE'), body.useSapConn === true, user.userId, user.userName)
    );
  } catch (error) {
    return errorResponse(error);
  }
}

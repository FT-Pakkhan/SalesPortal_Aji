import { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/auth';
import { successResponse, errorResponse } from '@/lib/apiResponse';
import { getNotifications, getNotificationSummary, markNotificationsRead } from '@/lib/notifications';

// GET /api/notifications - My notifications, newest first (?limit=20 for the bell; the View all page asks for more)
// GET /api/notifications?summary=1 - Only my unread count and the newest one's time (the bell's 60-second check)
export async function GET(request: NextRequest) {
  try {
    const user = authenticateRequest(request);
    if (request.nextUrl.searchParams.get('summary') === '1') return successResponse(await getNotificationSummary(user.userId));
    const limit = Math.min(Math.max(Number(request.nextUrl.searchParams.get('limit')) || 20, 1), 1000);
    return successResponse(await getNotifications(user.userId, limit));
  } catch (error) {
    return errorResponse(error);
  }
}

// POST /api/notifications - Mark read: { ids: [1, 2] } or { all: true }
export async function POST(request: NextRequest) {
  try {
    const user = authenticateRequest(request);
    const body = (await request.json()) as { ids?: unknown[]; all?: boolean };
    const ids = body.all === true ? 'ALL' : (Array.isArray(body.ids) ? body.ids : []).map(Number).filter((n) => Number.isInteger(n) && n > 0);
    await markNotificationsRead(user.userId, ids);
    return successResponse(null);
  } catch (error) {
    return errorResponse(error);
  }
}

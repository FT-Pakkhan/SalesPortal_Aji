import { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/auth';
import { successResponse, errorResponse } from '@/lib/apiResponse';
import { checkIn, getVisit, listVisits } from '@/lib/salesCheckIns';

// GET /api/sales-check-ins - The visits of my Sales Employee (all, if I have none), newest first
export async function GET(request: NextRequest) {
  try {
    const user = authenticateRequest(request);
    return successResponse(await listVisits(user.userId));
  } catch (error) {
    return errorResponse(error);
  }
}

// POST /api/sales-check-ins - Check In: { series, cardCode, cardName, purpose, comments, location: { lat, lng, accuracy } }
export async function POST(request: NextRequest) {
  try {
    const user = authenticateRequest(request);
    const docEntry = await checkIn(await request.json(), user);
    const visit = await getVisit(docEntry, user.userId);
    return successResponse(visit, `Checked in: visit ${(visit as { DocNum?: string }).DocNum}`, 201);
  } catch (error) {
    return errorResponse(error);
  }
}

import { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/auth';
import { successResponse, errorResponse } from '@/lib/apiResponse';
import { getDiApiLogon } from '@/lib/generalSettings';
import { testDiApiConnection } from '@/lib/diApi';

// POST /api/general-settings/test-connection - Log on to SAP through DI API with the SAP DI API settings sent
// (as typed on the screen, not yet saved); an empty password means the saved one. Logs off again straight away.
export async function POST(request: NextRequest) {
  try {
    authenticateRequest(request);
    const logon = await getDiApiLogon(await request.json());
    return successResponse(await testDiApiConnection(logon));
  } catch (error) {
    return errorResponse(error);
  }
}

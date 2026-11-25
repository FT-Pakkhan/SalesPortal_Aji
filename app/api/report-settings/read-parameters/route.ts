import { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/auth';
import { successResponse, errorResponse } from '@/lib/apiResponse';
import { readReportParameters } from '@/lib/crystal';
import { assertReportFileExists, assertReportPath } from '@/lib/reports';

// POST /api/report-settings/read-parameters - { reportPath }: the parameters found in that .rpt file
// (main report only; parameters linked to subreports are filled by Crystal itself)
export async function POST(request: NextRequest) {
  try {
    authenticateRequest(request);
    const body = await request.json();
    const reportPath = String(body.reportPath ?? '').trim();
    assertReportPath(reportPath);
    await assertReportFileExists(reportPath);
    return successResponse(await readReportParameters(reportPath));
  } catch (error) {
    return errorResponse(error);
  }
}

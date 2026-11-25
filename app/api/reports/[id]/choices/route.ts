import { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/auth';
import { successResponse, errorResponse } from '@/lib/apiResponse';
import { ValidationError } from '@/lib/errors';
import { getRunnableReport, runListQuery } from '@/lib/reports';

interface RouteContext {
  params: Promise<{ id: string }>;
}

// GET /api/reports/[id]/choices?line=0 - The choices of a Choose from List parameter: [{ value, description }]
// (its query's 1st and 2nd columns)
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const user = authenticateRequest(request);
    const { id } = await context.params;
    const line = Number(request.nextUrl.searchParams.get('line'));
    const report = await getRunnableReport(parseInt(id), user.userId);
    const param = report.Params.find((p) => p.LineNum === line);
    if (!param || param.InputType !== 'LIST' || !param.Query) throw new ValidationError('This parameter has no list to choose from');
    // In the SAP company database when the report uses the SAP DB connection
    const result = await runListQuery(param.Query, report.UseSapConn);
    return successResponse(result.choices);
  } catch (error) {
    return errorResponse(error);
  }
}

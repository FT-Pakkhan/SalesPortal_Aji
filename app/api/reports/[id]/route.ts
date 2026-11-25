import { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/auth';
import { successResponse, errorResponse } from '@/lib/apiResponse';
import { getRunnableReport } from '@/lib/reports';

interface RouteContext {
  params: Promise<{ id: string }>;
}

// GET /api/reports/[id] - A report the user may run, with the parameters to fill in (no file path, no queries)
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const user = authenticateRequest(request);
    const { id } = await context.params;
    const report = await getRunnableReport(parseInt(id), user.userId);
    return successResponse({
      DocEntry: report.DocEntry,
      ReportCode: report.ReportCode,
      ReportName: report.ReportName,
      Category: report.Category,
      Remarks: report.Remarks,
      // The run screen offers E-mail after Run
      EmailAllowed: report.EmailAllowed,
      Params: report.Params.map((p) => ({
        LineNum: p.LineNum,
        ParamName: p.ParamName,
        Caption: p.Caption,
        ParamType: p.ParamType,
        InputType: p.InputType,
        AllowMulti: p.AllowMulti,
        IsRange: p.IsRange,
        Mandatory: p.Mandatory,
        DefaultValue: p.DefaultValue,
      })),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

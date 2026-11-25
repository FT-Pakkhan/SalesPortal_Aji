import { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/auth';
import { errorResponse } from '@/lib/apiResponse';
import { renderReportPdf } from '@/lib/crystal';
import type { ReportConnection } from '@/lib/crystal';
import { getSapDbLogon } from '@/lib/generalSettings';
import { assertReportFileExists, buildRunValues, getRunnableReport } from '@/lib/reports';

interface RouteContext {
  params: Promise<{ id: string }>;
}

// POST /api/reports/[id]/run - { values: { [paramName]: value | value[] | { from, to } } }: the report as a PDF
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const user = authenticateRequest(request);
    const { id } = await context.params;
    const report = await getRunnableReport(parseInt(id), user.userId);
    const body = await request.json();
    const values = buildRunValues(report.Params, (body.values ?? {}) as Record<string, unknown>);
    await assertReportFileExists(report.ReportPath);
    // The report's connection: the SAP DI API setting (General Settings), or the portal's database setting
    const connection: ReportConnection = report.UseSapConn ? { kind: 'SAP', logon: await getSapDbLogon() } : { kind: 'PORTAL' };
    const pdf = await renderReportPdf(report.ReportPath, values, connection);

    // Shown in the browser (inline), so it can be printed or saved from there
    return new Response(new Uint8Array(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Length': String(pdf.length),
        'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(`${report.ReportName}.pdf`)}`,
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

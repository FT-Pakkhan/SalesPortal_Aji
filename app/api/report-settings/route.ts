import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { authenticateRequest } from '@/lib/auth';
import { successResponse, errorResponse } from '@/lib/apiResponse';
import {
  REPORT_SELECT,
  parseReportFields,
  assertReportCodeAvailable,
  assertReportFileExists,
  assertRolesExist,
  saveReportLines,
  getReportDetail,
} from '@/lib/reports';

// GET /api/report-settings - Every report set up (Report Settings list)
export async function GET(request: NextRequest) {
  try {
    authenticateRequest(request);
    return successResponse(await db.query(`${REPORT_SELECT} ORDER BY ISNULL(r.Category, ''), r.ReportName`));
  } catch (error) {
    return errorResponse(error);
  }
}

// POST /api/report-settings - Add a report with its parameters and roles (the .rpt file must exist on the server)
export async function POST(request: NextRequest) {
  try {
    const user = authenticateRequest(request);
    const fields = parseReportFields(await request.json());
    await assertReportCodeAvailable(fields.reportCode);
    await assertReportFileExists(fields.reportPath);
    await assertRolesExist(fields.roleIds);

    const transaction = await db.beginTransaction();
    let docEntry: number;
    try {
      const rows = await db.query<{ DocEntry: number }>(
        `INSERT INTO FTS11SRPT (ReportCode, ReportName, ReportPath, Category, Remarks, IsActive, UseSapConn, CreatedBy, CreatedDate, UpdatedBy, UpdatedDate)
         OUTPUT INSERTED.DocEntry
         VALUES (@reportCode, @reportName, @reportPath, @category, @remarks, @isActive, @useSapConn, @userName, GETDATE(), @userName, GETDATE())`,
        [
          { name: 'reportCode', value: fields.reportCode },
          { name: 'reportName', value: fields.reportName },
          { name: 'reportPath', value: fields.reportPath },
          { name: 'category', value: fields.category },
          { name: 'remarks', value: fields.remarks },
          { name: 'isActive', value: fields.isActive ? 1 : 0 },
          { name: 'useSapConn', value: fields.useSapConn ? 1 : 0 },
          { name: 'userName', value: user.userName },
        ],
        transaction
      );
      docEntry = rows[0].DocEntry;
      await saveReportLines(docEntry, fields, transaction);
      await db.commitTransaction(transaction);
    } catch (error) {
      await db.rollbackTransaction(transaction);
      throw error;
    }
    return successResponse(await getReportDetail(docEntry), 'Report created', 201);
  } catch (error) {
    return errorResponse(error);
  }
}

import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { authenticateRequest } from '@/lib/auth';
import { successResponse, errorResponse } from '@/lib/apiResponse';
import { NotFoundError } from '@/lib/errors';
import {
  parseReportFields,
  assertReportCodeAvailable,
  assertReportFileExists,
  assertRolesExist,
  saveReportLines,
  getReportDetail,
} from '@/lib/reports';

interface RouteContext {
  params: Promise<{ id: string }>;
}

// GET /api/report-settings/[id] - A report with its parameters and roles
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    authenticateRequest(request);
    const { id } = await context.params;
    return successResponse(await getReportDetail(parseInt(id)));
  } catch (error) {
    return errorResponse(error);
  }
}

// PUT /api/report-settings/[id] - Update a report and replace its parameters and roles
export async function PUT(request: NextRequest, context: RouteContext) {
  try {
    const user = authenticateRequest(request);
    const { id } = await context.params;
    const docEntry = parseInt(id);
    const fields = parseReportFields(await request.json());

    const existing = await db.query(`SELECT DocEntry FROM FTS11SRPT WHERE DocEntry = @docEntry`, [{ name: 'docEntry', value: docEntry }]);
    if (existing.length === 0) throw new NotFoundError('Report');
    await assertReportCodeAvailable(fields.reportCode, docEntry);
    await assertReportFileExists(fields.reportPath);
    await assertRolesExist(fields.roleIds);

    const transaction = await db.beginTransaction();
    try {
      await db.query(
        `UPDATE FTS11SRPT
         SET ReportCode = @reportCode, ReportName = @reportName, ReportPath = @reportPath, Category = @category,
             Remarks = @remarks, IsActive = @isActive, UseSapConn = @useSapConn, UpdatedBy = @userName, UpdatedDate = GETDATE()
         WHERE DocEntry = @docEntry`,
        [
          { name: 'docEntry', value: docEntry },
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
      await saveReportLines(docEntry, fields, transaction);
      await db.commitTransaction(transaction);
    } catch (error) {
      await db.rollbackTransaction(transaction);
      throw error;
    }
    return successResponse(await getReportDetail(docEntry), 'Report updated');
  } catch (error) {
    return errorResponse(error);
  }
}

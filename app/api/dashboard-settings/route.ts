import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { authenticateRequest } from '@/lib/auth';
import { successResponse, errorResponse } from '@/lib/apiResponse';
import { assertRolesExist } from '@/lib/reports';
import { WIDGET_SELECT, assertWidgetCodeAvailable, getWidgetDetail, parseWidgetFields, saveWidgetRoles, widgetParams } from '@/lib/dashboard';

// GET /api/dashboard-settings - Every widget set up (Dashboard Settings list), in Dashboard order
export async function GET(request: NextRequest) {
  try {
    authenticateRequest(request);
    return successResponse(await db.query(`${WIDGET_SELECT} ORDER BY d.Sequence, d.DocEntry`));
  } catch (error) {
    return errorResponse(error);
  }
}

// POST /api/dashboard-settings - Add a widget with its roles
export async function POST(request: NextRequest) {
  try {
    const user = authenticateRequest(request);
    const fields = parseWidgetFields(await request.json());
    await assertWidgetCodeAvailable(fields.widgetCode);
    await assertRolesExist(fields.roleIds);

    const transaction = await db.beginTransaction();
    let docEntry: number;
    try {
      const rows = await db.query<{ DocEntry: number }>(
        `INSERT INTO FTS11ODSH (WidgetCode, Title, WidgetType, Query, UseSapConn, Width, Sequence, ValueFormat, LinkPath, Remarks, IsActive,
                                CreatedBy, CreatedDate, UpdatedBy, UpdatedDate)
         OUTPUT INSERTED.DocEntry
         VALUES (@widgetCode, @title, @widgetType, @query, @useSapConn, @width, @sequence, @valueFormat, @linkPath, @remarks, @isActive,
                 @userName, GETDATE(), @userName, GETDATE())`,
        widgetParams(fields, user.userName),
        transaction
      );
      docEntry = rows[0].DocEntry;
      await saveWidgetRoles(docEntry, fields.roleIds, transaction);
      await db.commitTransaction(transaction);
    } catch (error) {
      await db.rollbackTransaction(transaction);
      throw error;
    }
    return successResponse(await getWidgetDetail(docEntry), 'Widget created', 201);
  } catch (error) {
    return errorResponse(error);
  }
}

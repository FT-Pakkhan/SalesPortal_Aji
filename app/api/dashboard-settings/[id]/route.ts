import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { authenticateRequest } from '@/lib/auth';
import { successResponse, errorResponse } from '@/lib/apiResponse';
import { NotFoundError } from '@/lib/errors';
import { assertRolesExist } from '@/lib/reports';
import { assertWidgetCodeAvailable, getWidgetDetail, parseWidgetFields, saveWidgetRoles, widgetParams } from '@/lib/dashboard';

interface RouteContext {
  params: Promise<{ id: string }>;
}

// GET /api/dashboard-settings/[id] - A widget with its roles
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    authenticateRequest(request);
    const { id } = await context.params;
    return successResponse(await getWidgetDetail(parseInt(id)));
  } catch (error) {
    return errorResponse(error);
  }
}

// PUT /api/dashboard-settings/[id] - Update a widget and replace its roles
export async function PUT(request: NextRequest, context: RouteContext) {
  try {
    const user = authenticateRequest(request);
    const { id } = await context.params;
    const docEntry = parseInt(id);
    const fields = parseWidgetFields(await request.json());

    const existing = await db.query(`SELECT DocEntry FROM FTS11ODSH WHERE DocEntry = @docEntry`, [{ name: 'docEntry', value: docEntry }]);
    if (existing.length === 0) throw new NotFoundError('Widget');
    await assertWidgetCodeAvailable(fields.widgetCode, docEntry);
    await assertRolesExist(fields.roleIds);

    const transaction = await db.beginTransaction();
    try {
      await db.query(
        `UPDATE FTS11ODSH
         SET WidgetCode = @widgetCode, Title = @title, WidgetType = @widgetType, Query = @query, UseSapConn = @useSapConn,
             Width = @width, Sequence = @sequence, ValueFormat = @valueFormat, LinkPath = @linkPath, Remarks = @remarks,
             IsActive = @isActive, UpdatedBy = @userName, UpdatedDate = GETDATE()
         WHERE DocEntry = @docEntry`,
        [...widgetParams(fields, user.userName), { name: 'docEntry', value: docEntry }],
        transaction
      );
      await saveWidgetRoles(docEntry, fields.roleIds, transaction);
      await db.commitTransaction(transaction);
    } catch (error) {
      await db.rollbackTransaction(transaction);
      throw error;
    }
    return successResponse(await getWidgetDetail(docEntry), 'Widget updated');
  } catch (error) {
    return errorResponse(error);
  }
}

import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { authenticateRequest } from '@/lib/auth';
import { successResponse, errorResponse } from '@/lib/apiResponse';
import {
  parseLayoutFields,
  assertLayoutDocumentType,
  assertLayoutNameAvailable,
  assertLayoutFileExists,
  getLayout,
  friendlyLayoutSaveError,
} from '@/lib/printLayouts';

interface RouteContext {
  params: Promise<{ id: string }>;
}

// GET /api/print-layouts/[id] - One layout
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    authenticateRequest(request);
    const { id } = await context.params;
    return successResponse(await getLayout(parseInt(id)));
  } catch (error) {
    return errorResponse(error);
  }
}

// PUT /api/print-layouts/[id] - Change a layout (the .rpt file must exist on the server)
export async function PUT(request: NextRequest, context: RouteContext) {
  try {
    const user = authenticateRequest(request);
    const { id } = await context.params;
    const docEntry = parseInt(id);
    await getLayout(docEntry);

    const fields = parseLayoutFields(await request.json());
    await assertLayoutDocumentType(fields.objDoc);
    await assertLayoutNameAvailable(fields, docEntry);
    await assertLayoutFileExists(fields.layoutPath);

    await db.query(
      `UPDATE FTS11SLYT
       SET LayoutName = @layoutName, LayoutPath = @layoutPath, ObjDoc = @objDoc, IsActive = @isActive, EmailAllowed = @emailAllowed,
           UpdatedBy = @userName, UpdatedDate = GETDATE()
       WHERE DocEntry = @docEntry`,
      [
        { name: 'docEntry', value: docEntry },
        { name: 'layoutName', value: fields.layoutName },
        { name: 'layoutPath', value: fields.layoutPath },
        { name: 'objDoc', value: fields.objDoc },
        { name: 'isActive', value: fields.isActive ? 1 : 0 },
        { name: 'emailAllowed', value: fields.emailAllowed ? 1 : 0 },
        { name: 'userName', value: user.userName },
      ]
    );
    return successResponse(await getLayout(docEntry), 'Layout updated');
  } catch (error) {
    return errorResponse(friendlyLayoutSaveError(error));
  }
}

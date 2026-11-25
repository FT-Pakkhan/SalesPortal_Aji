import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { authenticateRequest } from '@/lib/auth';
import { successResponse, errorResponse } from '@/lib/apiResponse';
import {
  LAYOUT_SELECT,
  parseLayoutFields,
  assertLayoutDocumentType,
  assertLayoutNameAvailable,
  assertLayoutFileExists,
  getLayout,
  friendlyLayoutSaveError,
} from '@/lib/printLayouts';

// GET /api/print-layouts - Print layouts; ?objDoc=FTS11OQUT&active=1 = the active layouts of one document type (Print)
export async function GET(request: NextRequest) {
  try {
    authenticateRequest(request);
    const objDoc = request.nextUrl.searchParams.get('objDoc');
    const activeOnly = request.nextUrl.searchParams.get('active') === '1';
    const where: string[] = ['1 = 1'];
    const params: { name: string; value: unknown }[] = [];
    if (objDoc) {
      where.push('l.ObjDoc = @objDoc');
      params.push({ name: 'objDoc', value: objDoc });
    }
    if (activeOnly) where.push('l.IsActive = 1');
    return successResponse(await db.query(`${LAYOUT_SELECT} WHERE ${where.join(' AND ')} ORDER BY v.Name, l.LayoutName`, params));
  } catch (error) {
    return errorResponse(error);
  }
}

// POST /api/print-layouts - Add a layout (the .rpt file must exist on the server)
export async function POST(request: NextRequest) {
  try {
    const user = authenticateRequest(request);
    const fields = parseLayoutFields(await request.json());
    await assertLayoutDocumentType(fields.objDoc);
    await assertLayoutNameAvailable(fields);
    await assertLayoutFileExists(fields.layoutPath);

    const result = await db.query<{ DocEntry: number }>(
      `INSERT INTO FTS11SLYT (LayoutName, LayoutPath, ObjDoc, IsActive, EmailAllowed, CreatedBy, CreatedDate, UpdatedBy, UpdatedDate)
       OUTPUT INSERTED.DocEntry
       VALUES (@layoutName, @layoutPath, @objDoc, @isActive, @emailAllowed, @userName, GETDATE(), @userName, GETDATE())`,
      [
        { name: 'layoutName', value: fields.layoutName },
        { name: 'layoutPath', value: fields.layoutPath },
        { name: 'objDoc', value: fields.objDoc },
        { name: 'isActive', value: fields.isActive ? 1 : 0 },
        { name: 'emailAllowed', value: fields.emailAllowed ? 1 : 0 },
        { name: 'userName', value: user.userName },
      ]
    );
    return successResponse(await getLayout(result[0].DocEntry), 'Layout created', 201);
  } catch (error) {
    return errorResponse(friendlyLayoutSaveError(error));
  }
}

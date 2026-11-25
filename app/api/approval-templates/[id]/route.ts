import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { authenticateRequest } from '@/lib/auth';
import { successResponse, errorResponse } from '@/lib/apiResponse';
import { NotFoundError } from '@/lib/errors';
import {
  parseTemplateFields,
  assertTemplateCodeAvailable,
  assertDocumentTypeExists,
  assertStagesExist,
  saveTemplateStages,
  getTemplateDetail,
} from '@/lib/approvalTemplates';
import { assertTemplateQueryRuns } from '@/lib/approvalCheck';

interface RouteContext {
  params: Promise<{ id: string }>;
}

// GET /api/approval-templates/[id] - A template with its query and stages
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    authenticateRequest(request);
    const { id } = await context.params;
    return successResponse(await getTemplateDetail(parseInt(id)));
  } catch (error) {
    return errorResponse(error);
  }
}

// PUT /api/approval-templates/[id] - Update a template and replace its stages
export async function PUT(request: NextRequest, context: RouteContext) {
  try {
    const user = authenticateRequest(request);
    const { id } = await context.params;
    const docEntry = parseInt(id);
    const fields = parseTemplateFields(await request.json());

    const existing = await db.query(`SELECT DocEntry FROM FTS11OWTM WHERE DocEntry = @docEntry`, [
      { name: 'docEntry', value: docEntry },
    ]);
    if (existing.length === 0) throw new NotFoundError('Approval template');

    await assertTemplateCodeAvailable(fields.wtmCode, docEntry);
    await assertDocumentTypeExists(fields.objDoc);
    await assertStagesExist(fields.stageIds);
    // The query must run (it is tried with @DocEntry = 0 and rolled back), so Confirm doesn't fail on it later
    await assertTemplateQueryRuns(fields.query);

    const transaction = await db.beginTransaction();
    try {
      await db.query(
        `UPDATE FTS11OWTM
         SET WtmCode = @wtmCode, WtmName = @wtmName, ObjDoc = @objDoc, Query = @query, Active = @active,
             UpdatedBy = @updatedBy, UpdatedDate = GETDATE()
         WHERE DocEntry = @docEntry`,
        [
          { name: 'docEntry', value: docEntry },
          { name: 'wtmCode', value: fields.wtmCode },
          { name: 'wtmName', value: fields.wtmName },
          { name: 'objDoc', value: fields.objDoc },
          { name: 'query', value: fields.query },
          { name: 'active', value: fields.active ? 1 : 0 },
          { name: 'updatedBy', value: user.userName },
        ],
        transaction
      );
      await saveTemplateStages(docEntry, fields.stageIds, transaction);
      await db.commitTransaction(transaction);
    } catch (error) {
      await db.rollbackTransaction(transaction);
      throw error;
    }

    return successResponse(await getTemplateDetail(docEntry), 'Approval template updated');
  } catch (error) {
    return errorResponse(error);
  }
}

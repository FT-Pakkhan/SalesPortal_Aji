import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { authenticateRequest } from '@/lib/auth';
import { successResponse, errorResponse } from '@/lib/apiResponse';
import {
  TEMPLATE_SELECT,
  parseTemplateFields,
  assertTemplateCodeAvailable,
  assertDocumentTypeExists,
  assertStagesExist,
  saveTemplateStages,
  getTemplateDetail,
} from '@/lib/approvalTemplates';
import { assertTemplateQueryRuns } from '@/lib/approvalCheck';

// GET /api/approval-templates - List approval templates
export async function GET(request: NextRequest) {
  try {
    authenticateRequest(request);
    const data = await db.query(`${TEMPLATE_SELECT} ORDER BY h.WtmCode`);
    return successResponse(data);
  } catch (error) {
    return errorResponse(error);
  }
}

// POST /api/approval-templates - Create a template with its stages
export async function POST(request: NextRequest) {
  try {
    const user = authenticateRequest(request);
    const fields = parseTemplateFields(await request.json());

    await assertTemplateCodeAvailable(fields.wtmCode);
    await assertDocumentTypeExists(fields.objDoc);
    await assertStagesExist(fields.stageIds);
    // The query must run (it is tried with @DocEntry = 0 and rolled back), so Confirm doesn't fail on it later
    await assertTemplateQueryRuns(fields.query);

    const transaction = await db.beginTransaction();
    let docEntry: number;
    try {
      const result = await db.query<{ DocEntry: number }>(
        `INSERT INTO FTS11OWTM (WtmCode, WtmName, ObjDoc, Query, Active, CreatedBy, CreatedDate, UpdatedBy, UpdatedDate)
         OUTPUT INSERTED.DocEntry
         VALUES (@wtmCode, @wtmName, @objDoc, @query, @active, @createdBy, GETDATE(), @createdBy, GETDATE())`,
        [
          { name: 'wtmCode', value: fields.wtmCode },
          { name: 'wtmName', value: fields.wtmName },
          { name: 'objDoc', value: fields.objDoc },
          { name: 'query', value: fields.query },
          { name: 'active', value: fields.active ? 1 : 0 },
          { name: 'createdBy', value: user.userName },
        ],
        transaction
      );
      docEntry = result[0].DocEntry;
      await saveTemplateStages(docEntry, fields.stageIds, transaction);
      await db.commitTransaction(transaction);
    } catch (error) {
      await db.rollbackTransaction(transaction);
      throw error;
    }

    return successResponse(await getTemplateDetail(docEntry), 'Approval template created', 201);
  } catch (error) {
    return errorResponse(error);
  }
}

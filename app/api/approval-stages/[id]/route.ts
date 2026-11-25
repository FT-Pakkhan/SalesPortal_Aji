import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { authenticateRequest } from '@/lib/auth';
import { successResponse, errorResponse } from '@/lib/apiResponse';
import { NotFoundError } from '@/lib/errors';
import {
  parseStageFields,
  assertStageCodeAvailable,
  assertApproversExist,
  saveApprovers,
  getStageDetail,
} from '@/lib/approvalStages';

interface RouteContext {
  params: Promise<{ id: string }>;
}

// GET /api/approval-stages/[id] - A stage with its approvers
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    authenticateRequest(request);
    const { id } = await context.params;
    return successResponse(await getStageDetail(parseInt(id)));
  } catch (error) {
    return errorResponse(error);
  }
}

// PUT /api/approval-stages/[id] - Update a stage and replace its approvers
export async function PUT(request: NextRequest, context: RouteContext) {
  try {
    const user = authenticateRequest(request);
    const { id } = await context.params;
    const docEntry = parseInt(id);
    const fields = parseStageFields(await request.json());

    const existing = await db.query(`SELECT DocEntry FROM FTS11OWST WHERE DocEntry = @docEntry`, [
      { name: 'docEntry', value: docEntry },
    ]);
    if (existing.length === 0) throw new NotFoundError('Approval stage');

    await assertStageCodeAvailable(fields.wstCode, docEntry);
    await assertApproversExist(fields.approverIds);

    const transaction = await db.beginTransaction();
    try {
      await db.query(
        `UPDATE FTS11OWST
         SET WstCode = @wstCode, WstName = @wstName, MaxReqr = @maxReqr,
             UpdatedBy = @updatedBy, UpdatedDate = GETDATE()
         WHERE DocEntry = @docEntry`,
        [
          { name: 'docEntry', value: docEntry },
          { name: 'wstCode', value: fields.wstCode },
          { name: 'wstName', value: fields.wstName },
          { name: 'maxReqr', value: fields.maxReqr },
          { name: 'updatedBy', value: user.userName },
        ],
        transaction
      );
      await saveApprovers(docEntry, fields.approverIds, transaction);
      await db.commitTransaction(transaction);
    } catch (error) {
      await db.rollbackTransaction(transaction);
      throw error;
    }

    return successResponse(await getStageDetail(docEntry), 'Approval stage updated');
  } catch (error) {
    return errorResponse(error);
  }
}

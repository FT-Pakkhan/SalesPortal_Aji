import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { authenticateRequest } from '@/lib/auth';
import { successResponse, errorResponse } from '@/lib/apiResponse';
import {
  STAGE_SELECT,
  parseStageFields,
  assertStageCodeAvailable,
  assertApproversExist,
  saveApprovers,
  getStageDetail,
} from '@/lib/approvalStages';

// GET /api/approval-stages - List approval stages
export async function GET(request: NextRequest) {
  try {
    authenticateRequest(request);
    const data = await db.query(`${STAGE_SELECT} ORDER BY WstCode`);
    return successResponse(data);
  } catch (error) {
    return errorResponse(error);
  }
}

// POST /api/approval-stages - Create a stage with its approvers
export async function POST(request: NextRequest) {
  try {
    const user = authenticateRequest(request);
    const fields = parseStageFields(await request.json());

    await assertStageCodeAvailable(fields.wstCode);
    await assertApproversExist(fields.approverIds);

    const transaction = await db.beginTransaction();
    let docEntry: number;
    try {
      const result = await db.query<{ DocEntry: number }>(
        `INSERT INTO FTS11OWST (WstCode, WstName, MaxReqr, CreatedBy, CreatedDate, UpdatedBy, UpdatedDate)
         OUTPUT INSERTED.DocEntry
         VALUES (@wstCode, @wstName, @maxReqr, @createdBy, GETDATE(), @createdBy, GETDATE())`,
        [
          { name: 'wstCode', value: fields.wstCode },
          { name: 'wstName', value: fields.wstName },
          { name: 'maxReqr', value: fields.maxReqr },
          { name: 'createdBy', value: user.userName },
        ],
        transaction
      );
      docEntry = result[0].DocEntry;
      await saveApprovers(docEntry, fields.approverIds, transaction);
      await db.commitTransaction(transaction);
    } catch (error) {
      await db.rollbackTransaction(transaction);
      throw error;
    }

    return successResponse(await getStageDetail(docEntry), 'Approval stage created', 201);
  } catch (error) {
    return errorResponse(error);
  }
}

import type sql from 'mssql';
import { db } from './db';
import { NotFoundError, ValidationError } from './errors';

/** Stage header columns (FTS11OWST) */
export const STAGE_SELECT = `
  SELECT DocEntry, WstCode, WstName, MaxReqr
  FROM FTS11OWST`;

export interface StageFields {
  wstCode: string;
  wstName: string;
  maxReqr: number;
  approverIds: number[];
}

/** Validate a create / update request body for an approval stage */
export function parseStageFields(body: Record<string, unknown>): StageFields {
  const wstCode = String(body.wstCode ?? '').trim();
  if (!wstCode) throw new ValidationError('Stage code is required');
  if (wstCode.length > 100) throw new ValidationError('Stage code must be 100 characters or fewer');

  const wstName = String(body.wstName ?? '').trim();
  if (!wstName) throw new ValidationError('Description is required');
  if (wstName.length > 100) throw new ValidationError('Description must be 100 characters or fewer');

  const rawIds = Array.isArray(body.approverIds) ? body.approverIds : [];
  const approverIds = [...new Set(rawIds.map((id) => Number(id)))];
  if (approverIds.some((id) => !Number.isInteger(id) || id <= 0)) {
    throw new ValidationError('Approver list is not valid');
  }
  if (approverIds.length === 0) throw new ValidationError('Add at least one approver');

  const maxReqr = Number(body.maxReqr);
  if (!Number.isInteger(maxReqr) || maxReqr < 1) {
    throw new ValidationError('Approval required must be a whole number of at least 1');
  }
  if (maxReqr > approverIds.length) {
    throw new ValidationError(
      `Approval required (${maxReqr}) cannot be more than the number of approvers (${approverIds.length})`
    );
  }

  return { wstCode, wstName, maxReqr, approverIds };
}

/** FTS11OWST.WstCode must be unique; checked here for a friendly message (the table also enforces it) */
export async function assertStageCodeAvailable(wstCode: string, excludeDocEntry?: number): Promise<void> {
  const existing = await db.query(
    `SELECT DocEntry FROM FTS11OWST WHERE WstCode = @wstCode AND DocEntry <> @excludeDocEntry`,
    [
      { name: 'wstCode', value: wstCode },
      { name: 'excludeDocEntry', value: excludeDocEntry ?? 0 },
    ]
  );
  if (existing.length > 0) throw new ValidationError('Stage code already exists');
}

/** Every approver must be an existing user */
export async function assertApproversExist(approverIds: number[]): Promise<void> {
  const found = await db.query<{ DocEntry: number }>(
    `SELECT DocEntry FROM SystemUsers WHERE DocEntry IN (${approverIds.map((_, i) => `@u${i}`).join(', ')})`,
    approverIds.map((id, i) => ({ name: `u${i}`, value: id }))
  );
  if (found.length !== approverIds.length) throw new ValidationError('One or more approvers no longer exist');
}

/** Replace a stage's approvers (FTS11WST1) inside a transaction */
export async function saveApprovers(docEntry: number, approverIds: number[], transaction: sql.Transaction): Promise<void> {
  await db.query(`DELETE FROM FTS11WST1 WHERE DocEntry = @docEntry`, [{ name: 'docEntry', value: docEntry }], transaction);
  for (const userId of approverIds) {
    await db.query(
      `INSERT INTO FTS11WST1 (DocEntry, UserID) VALUES (@docEntry, @userId)`,
      [
        { name: 'docEntry', value: docEntry },
        { name: 'userId', value: userId },
      ],
      transaction
    );
  }
}

/** A stage with its approvers, shaped for the API */
export async function getStageDetail(docEntry: number) {
  const stages = await db.query(`${STAGE_SELECT} WHERE DocEntry = @docEntry`, [{ name: 'docEntry', value: docEntry }]);
  if (stages.length === 0) throw new NotFoundError('Approval stage');

  const approvers = await db.query(
    `SELECT u.DocEntry AS UserId, u.UserName, u.DisplayName
     FROM FTS11WST1 a
     JOIN SystemUsers u ON u.DocEntry = a.UserID
     WHERE a.DocEntry = @docEntry
     ORDER BY u.UserName`,
    [{ name: 'docEntry', value: docEntry }]
  );

  return { ...stages[0], Approvers: approvers };
}

/**
 * The approval stages this user approves in: how many active approvers each has now (this user included), how many
 * approvals it needs, and the active templates that use it — so deactivating the user can warn first.
 */
export async function stagesOfApprover(userId: number) {
  return db.query<{ WstCode: string; WstName: string; MaxReqr: number; ActiveApprovers: number; Templates: string | null }>(
    `SELECT s.WstCode, s.WstName, s.MaxReqr,
            (SELECT COUNT(*) FROM FTS11WST1 a2 JOIN SystemUsers u ON u.DocEntry = a2.UserID
             WHERE a2.DocEntry = s.DocEntry AND u.IsActive = 1) AS ActiveApprovers,
            (SELECT STRING_AGG(t.WtmCode, ', ') WITHIN GROUP (ORDER BY t.WtmCode)
             FROM FTS11WTM1 w JOIN FTS11OWTM t ON t.DocEntry = w.DocEntry
             WHERE w.WstDocEntry = s.DocEntry AND t.Active = 1) AS Templates
     FROM FTS11WST1 a
     JOIN FTS11OWST s ON s.DocEntry = a.DocEntry
     WHERE a.UserID = @userId
     ORDER BY s.WstCode`,
    [{ name: 'userId', value: userId }]
  );
}
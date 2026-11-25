import sql from 'mssql';
import { db } from './db';
import { ValidationError } from './errors';
import { stageWithoutApprovers } from './approvalTemplates';
import { syncWaitingNotifications } from './notifications';

// Approval templates (FTS11OWTM): each has a user query for one document type (ObjDoc), written with @DocEntry,
// e.g.  SELECT 1 FROM FTS11OQUT WHERE DocEntry = @DocEntry AND DocTotal > 10000
// When a document is confirmed, every active template of its type runs with @DocEntry = that document's DocEntry
// (passed as a real parameter, never pasted into the text). A query that returns a row means approval is needed.

/** How long a template query may run */
const QUERY_TIMEOUT_MS = 15_000;

/**
 * Run a template query inside `transaction` with @DocEntry, behind a savepoint that is always rolled back — so the
 * query sees the document as it is being confirmed, but can never change anything (even if it holds an UPDATE).
 * Returns whether it gave at least one row.
 */
async function queryReturnsRows(query: string, docEntry: number, transaction: sql.Transaction): Promise<boolean> {
  await db.query('SAVE TRANSACTION ApprovalCheck', [], transaction);
  try {
    const request = new sql.Request(transaction);
    (request as unknown as { timeout: number }).timeout = QUERY_TIMEOUT_MS;
    request.input('DocEntry', sql.Int, docEntry);
    const result = await request.query(query);
    const sets = (result.recordsets ?? []) as unknown as unknown[][];
    return sets.some((rows) => rows.length > 0);
  } finally {
    // Undo anything the query did; skipped if the error already ended the transaction
    await db
      .query('IF XACT_STATE() = 1 ROLLBACK TRANSACTION ApprovalCheck', [], transaction)
      .catch(() => undefined);
  }
}

/**
 * Which active approval templates of this document type need approval for this document (their query returned a
 * row), as FTS11OWTM.DocEntry. Empty -> no approval needed. A template whose query fails stops the Confirm.
 */
export async function templatesNeedingApproval(
  objType: string,
  docEntry: number,
  transaction: sql.Transaction
): Promise<number[]> {
  const templates = await db.query<{ DocEntry: number; WtmCode: string; Query: string }>(
    `SELECT DocEntry, WtmCode, Query FROM FTS11OWTM WHERE ObjDoc = @objType AND Active = 1 ORDER BY WtmCode`,
    [{ name: 'objType', value: objType }],
    transaction
  );
  const needing: number[] = [];
  for (const t of templates) {
    try {
      if (await queryReturnsRows(t.Query, docEntry, transaction)) needing.push(t.DocEntry);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new ValidationError(`Approval template ${t.WtmCode}: its query failed — ${reason}`);
    }
  }
  return needing;
}

/**
 * SQL: approval row `alias` belongs to the latest time its document was sent for approval (FTS11WDD1.Round). Only
 * that round counts for the stages; earlier rounds (a rejected Convert to Customer sent again) are history.
 */
export const IN_LATEST_ROUND = (alias: string) =>
  `${alias}.Round = (SELECT MAX(r.Round) FROM FTS11WDD1 r WHERE r.ObjType = ${alias}.ObjType AND r.DocEntry = ${alias}.DocEntry)`;

/**
 * SQL (CTEs) for the stages of every document's approval: StageState = approvals so far per template stage,
 * CurrentStage = the first stage of each template that doesn't have enough approvals yet.
 */
export const STAGE_CTES = `
  StageState AS (
    SELECT ObjType, DocEntry, WtmDocEntry, StageNo, MAX(MaxReqr) AS MaxReqr,
           SUM(CASE WHEN ApprStatus = 'APPROVED' THEN 1 ELSE 0 END) AS Approved
    FROM FTS11WDD1 w0
    WHERE ${IN_LATEST_ROUND('w0')}
    GROUP BY ObjType, DocEntry, WtmDocEntry, StageNo
  ),
  CurrentStage AS (
    SELECT ObjType, DocEntry, WtmDocEntry, MIN(StageNo) AS StageNo
    FROM StageState
    WHERE Approved < MaxReqr
    GROUP BY ObjType, DocEntry, WtmDocEntry
  )`;

/** This user's PENDING rows in the document's current stages (what an Approve / Reject acts on) */
export async function myCurrentRows(objType: string, docEntry: number, userId: number, transaction?: sql.Transaction) {
  return db.query<{ AbsEntry: number }>(
    `WITH ${STAGE_CTES}
     SELECT w.AbsEntry
     FROM FTS11WDD1 w
     JOIN CurrentStage c ON c.ObjType = w.ObjType AND c.DocEntry = w.DocEntry AND c.WtmDocEntry = w.WtmDocEntry
                        AND c.StageNo = w.StageNo
     WHERE w.ObjType = @objType AND w.DocEntry = @docEntry AND w.UserID = @userId AND w.ApprStatus = 'PENDING'
       AND ${IN_LATEST_ROUND('w')}`,
    [
      { name: 'objType', value: objType },
      { name: 'docEntry', value: docEntry },
      { name: 'userId', value: userId },
    ],
    transaction
  );
}

/** This user can approve / reject the document now (it is PENDING and their row is in a current stage) */
export async function isApproverNow(objType: string, docEntry: number, userId: number, transaction?: sql.Transaction): Promise<boolean> {
  return (await myCurrentRows(objType, docEntry, userId, transaction)).length > 0;
}

/**
 * Send a document for approval: one FTS11WDD1 row (PENDING) for every approver of every stage of each template
 * that needs it, with the stage's order in the template (StageNo) and its approvals required (MaxReqr) as they are now.
 * Sent again (after a rejection): the rows get the next Round.
 */
export async function createApprovalRequests(
  objType: string,
  docEntry: number,
  templateIds: number[],
  transaction: sql.Transaction
): Promise<void> {
  const ids = templateIds.map((_, i) => `@t${i}`).join(', ');
  const idParams = templateIds.map((id, i) => ({ name: `t${i}`, value: id }));

  // Every template that applies must be able to finish: it has stages, and each stage enough active approvers
  // (approvers may have been made inactive since the template was saved). Otherwise Confirm stops — no number used —
  // instead of the document waiting for ever.
  const noStages = await db.query<{ WtmCode: string }>(
    `SELECT t.WtmCode FROM FTS11OWTM t
     WHERE t.DocEntry IN (${ids}) AND NOT EXISTS (SELECT 1 FROM FTS11WTM1 w WHERE w.DocEntry = t.DocEntry)`,
    idParams,
    transaction
  );
  if (noStages.length > 0) {
    throw new ValidationError(`Approval template ${noStages[0].WtmCode} has no approval stage: fix it in Approval Template first`);
  }
  const problem = await stageWithoutApprovers(
    `s.DocEntry IN (SELECT w.WstDocEntry FROM FTS11WTM1 w WHERE w.DocEntry IN (${ids}))`,
    idParams,
    transaction
  );
  if (problem) throw new ValidationError(problem);

  await db.query(
    `INSERT INTO FTS11WDD1 (ObjType, DocEntry, WtmDocEntry, WstDocEntry, StageNo, MaxReqr, UserID, ApprStatus, Round)
     SELECT @objType, @docEntry, w.DocEntry, w.WstDocEntry, w.StageNo, s.MaxReqr, a.UserID, 'PENDING',
            ISNULL((SELECT MAX(r.Round) FROM FTS11WDD1 r WHERE r.ObjType = @objType AND r.DocEntry = @docEntry), 0) + 1
     FROM FTS11WTM1 w
     JOIN FTS11OWST s ON s.DocEntry = w.WstDocEntry
     JOIN FTS11WST1 a ON a.DocEntry = s.DocEntry
     WHERE w.DocEntry IN (${templateIds.map((_, i) => `@t${i}`).join(', ')})`,
    [
      { name: 'objType', value: objType },
      { name: 'docEntry', value: docEntry },
      ...templateIds.map((id, i) => ({ name: `t${i}`, value: id })),
    ],
    transaction
  );
}

/**
 * After a document is sent for approval (its header now PENDING, in the same transaction): the approvers of the
 * first stage get "Waiting for your approval" in the portal's bell
 */
export async function notifyFirstApprovers(objType: string, docEntry: number, transaction: sql.Transaction): Promise<void> {
  await syncWaitingNotifications(objType, docEntry, transaction);
}

/**
 * SQL: the document is locked by approval — it has been sent for approval and its latest round (FTS11WDD1.Round) has
 * no rejection, i.e. it is still PENDING or was APPROVED. A REJECTED document can be changed and confirmed again (sent
 * for approval again as the next round). `objType` / `docEntry` are SQL expressions.
 */
export const WENT_THROUGH_APPROVAL = (objType: string, docEntry: string) =>
  `(EXISTS (SELECT 1 FROM FTS11WDD1 a WHERE a.ObjType = ${objType} AND a.DocEntry = ${docEntry})
    AND NOT EXISTS (SELECT 1 FROM FTS11WDD1 a WHERE a.ObjType = ${objType} AND a.DocEntry = ${docEntry}
                    AND a.ApprStatus = 'REJECTED' AND ${IN_LATEST_ROUND('a')}))`;

/** Whether the document is locked by approval: pending or approved, not rejected (see WENT_THROUGH_APPROVAL) */
export async function wentThroughApproval(objType: string, docEntry: number, transaction?: sql.Transaction): Promise<boolean> {
  const rows = await db.query<{ Locked: number }>(
    `SELECT CASE WHEN ${WENT_THROUGH_APPROVAL('@objType', '@docEntry')} THEN 1 ELSE 0 END AS Locked`,
    [
      { name: 'objType', value: objType },
      { name: 'docEntry', value: docEntry },
    ],
    transaction
  );
  return rows[0]?.Locked === 1;
}

/**
 * Check a template query when the template is saved: it is run once with @DocEntry = 0 (no document) in a
 * transaction that is rolled back, so a mistake shows up now rather than when a document is confirmed.
 */
export async function assertTemplateQueryRuns(query: string): Promise<void> {
  const transaction = await db.beginTransaction();
  try {
    await queryReturnsRows(query, 0, transaction);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new ValidationError(`The query has an error: ${reason}`);
  } finally {
    await db.rollbackTransaction(transaction).catch(() => undefined);
  }
}

import type sql from 'mssql';
import { db } from './db';
import { currentCompany } from './companyContext';
import { EMAILED_TYPES, emailNotifications } from './approvalEmail';

// Portal notifications (FTS11ONTF, the bell): written in the same transaction as the event that causes them.
//   APPR_WAITING   a document waits for this user's approval (their stage's turn)  -> the stage's approvers
//   APPR_STAGE     approved at one stage, the next stage is next                    -> who sent it for approval
//   APPR_DONE      fully approved: the document got its No.                         -> who sent it
//   APPR_REJECTED  rejected (with the approver's remarks)                           -> who sent it
//   APPR_CHANGED   an approver changed it while approving (with the reason)         -> who sent it
//   POST_FAILED    Post to SAP failed (with SAP's error)                            -> who clicked Post to SAP
// A "waiting" notification is marked read once that user can no longer act on it (they decided, their stage got
// enough approvals, or the document was approved / rejected), so an unread one always means "still waiting for you".
// With General Settings > SMTP > E-mail approval notifications on, the approval ones (not "Stage n of m") are also
// e-mailed: see approvalEmail.ts.
// Housekeeping: at most once a day, notifications older than KEEP_DAYS go (unread "waiting" ones stay).

export type NotificationType = 'APPR_WAITING' | 'APPR_STAGE' | 'APPR_DONE' | 'APPR_REJECTED' | 'APPR_CHANGED' | 'POST_FAILED';

/** Notifications are kept this many days (fixed, the user's choice) */
const KEEP_DAYS = 60;

/**
 * What a notification says about a document, per document type: a short description from its header (a sales
 * document's total in its own currency).
 * The header table is named as the document type (FTS11OQUT, FTS11ORDR, FTS11ORIN, FTS11LEAD, FTS11OCRD, FTS11TMPR, FTS11OWTR).
 */
const DESCRIBE: Record<string, string> = {
  FTS11OQUT: `CONCAT(ISNULL(h.DocNum, 'Draft'), ' - ', h.CardCode, ' ', ISNULL(h.CardName, ''), ', ', CASE WHEN h.DocCur IS NULL THEN '' ELSE CONCAT(h.DocCur, ' ') END, FORMAT(CASE WHEN h.DocTotalFC <> 0 THEN h.DocTotalFC ELSE h.DocTotal END, 'N2'))`,
  FTS11ORDR: `CONCAT(ISNULL(h.DocNum, 'Draft'), ' - ', h.CardCode, ' ', ISNULL(h.CardName, ''), ', ', CASE WHEN h.DocCur IS NULL THEN '' ELSE CONCAT(h.DocCur, ' ') END, FORMAT(CASE WHEN h.DocTotalFC <> 0 THEN h.DocTotalFC ELSE h.DocTotal END, 'N2'))`,
  FTS11ORIN: `CONCAT(ISNULL(h.DocNum, 'Draft'), ' - ', h.CardCode, ' ', ISNULL(h.CardName, ''), ', ', CASE WHEN h.DocCur IS NULL THEN '' ELSE CONCAT(h.DocCur, ' ') END, FORMAT(CASE WHEN h.DocTotalFC <> 0 THEN h.DocTotalFC ELSE h.DocTotal END, 'N2'))`,
  FTS11TMPR: `CONCAT(ISNULL(h.DocNum, 'Draft'), ' - ', h.CardCode, ' ', ISNULL(h.CardName, ''), ', ', CASE WHEN h.DocCur IS NULL THEN '' ELSE CONCAT(h.DocCur, ' ') END, FORMAT(CASE WHEN h.DocTotalFC <> 0 THEN h.DocTotalFC ELSE h.DocTotal END, 'N2'))`,
  FTS11OWTR: `CONCAT(ISNULL(h.DocNum, 'Draft'), CASE WHEN h.CardCode IS NULL THEN '' ELSE CONCAT(' - ', h.CardCode, ' ', ISNULL(h.CardName, '')) END)`,
  FTS11LEAD: `CONCAT(ISNULL(h.LeadCode, 'Draft'), ' - ', h.LeadName)`,
  FTS11OCRD: `CONCAT(ISNULL(h.DocNum, 'Draft'), ' - ', CASE WHEN h.CardCode IS NULL THEN '' ELSE CONCAT(h.CardCode, ' ') END, h.LeadName)`,
  // The customer may only be a typed name
  FTS11OTRQ: `CONCAT(ISNULL(h.DocNum, 'Draft'), ' - ', CASE WHEN h.CardCode IS NULL THEN '' ELSE CONCAT(h.CardCode, ' ') END, h.CardName, ', ', CASE WHEN h.DocCur IS NULL THEN '' ELSE CONCAT(h.DocCur, ' ') END, FORMAT(CASE WHEN h.DocTotalFC <> 0 THEN h.DocTotalFC ELSE h.DocTotal END, 'N2'))`,
};

/** "Sales order SO00002 - C23900 Parameter Technology, 3,663.00" (the document type's name from FTS_vw_ObjType) */
async function describe(objType: string, docEntry: number, transaction?: sql.Transaction): Promise<{ typeName: string; text: string; docNum: string | null }> {
  const expr = DESCRIBE[objType];
  if (!expr) return { typeName: objType, text: `${objType} ${docEntry}`, docNum: null };
  const docNumCol = objType === 'FTS11LEAD' ? 'h.LeadCode' : 'h.DocNum';
  const rows = await db.query<{ TypeName: string | null; Text: string; DocNum: string | null }>(
    `SELECT (SELECT v.Name FROM FTS_vw_ObjType v WHERE v.Code = @objType) AS TypeName, ${expr} AS Text, ${docNumCol} AS DocNum
     FROM ${objType} h WHERE h.DocEntry = @docEntry`,
    [
      { name: 'objType', value: objType },
      { name: 'docEntry', value: docEntry },
    ],
    transaction
  );
  return { typeName: rows[0]?.TypeName ?? objType, text: rows[0]?.Text ?? '', docNum: rows[0]?.DocNum ?? null };
}

async function insert(
  userIds: number[],
  type: NotificationType,
  title: string,
  message: string,
  objType: string,
  docEntry: number,
  createdBy: string | null,
  transaction?: sql.Transaction
): Promise<void> {
  const toEmail: number[] = [];
  for (const userId of [...new Set(userIds)]) {
    const rows = await db.query<{ AbsEntry: number }>(
      `INSERT INTO FTS11ONTF (UserID, NtfType, Title, Message, ObjType, DocEntry, CreatedBy)
       OUTPUT INSERTED.AbsEntry
       VALUES (@userId, @type, @title, @message, @objType, @docEntry, @createdBy)`,
      [
        { name: 'userId', value: userId },
        { name: 'type', value: type },
        { name: 'title', value: title.slice(0, 200) },
        { name: 'message', value: message.slice(0, 500) },
        { name: 'objType', value: objType },
        { name: 'docEntry', value: docEntry },
        { name: 'createdBy', value: createdBy },
      ],
      transaction
    );
    if (rows[0] && EMAILED_TYPES.has(type)) toEmail.push(rows[0].AbsEntry);
  }
  // Also by e-mail when switched on (in the background, once this transaction is committed)
  emailNotifications(toEmail);
}

/** SQL (CTEs): approvals so far per template stage, and each template's current stage (the first not done) */
const STAGE_CTES = `
  StageState AS (
    SELECT ObjType, DocEntry, WtmDocEntry, StageNo, MAX(MaxReqr) AS MaxReqr,
           SUM(CASE WHEN ApprStatus = 'APPROVED' THEN 1 ELSE 0 END) AS Approved
    FROM FTS11WDD1 w0 WHERE w0.ObjType = @objType AND w0.DocEntry = @docEntry
      -- Only the latest time it was sent for approval counts (FTS11WDD1.Round)
      AND w0.Round = (SELECT MAX(r.Round) FROM FTS11WDD1 r WHERE r.ObjType = @objType AND r.DocEntry = @docEntry)
    GROUP BY ObjType, DocEntry, WtmDocEntry, StageNo
  ),
  CurrentStage AS (
    SELECT ObjType, DocEntry, WtmDocEntry, MIN(StageNo) AS StageNo
    FROM StageState WHERE Approved < MaxReqr
    GROUP BY ObjType, DocEntry, WtmDocEntry
  )`;

/** Users who can approve the document now: PENDING in a current stage, the document still PENDING */
async function usersWhoCanAct(objType: string, docEntry: number, transaction?: sql.Transaction): Promise<number[]> {
  const rows = await db.query<{ UserID: number }>(
    `WITH ${STAGE_CTES}
     SELECT DISTINCT w.UserID
     FROM FTS11WDD1 w
     JOIN CurrentStage c ON c.WtmDocEntry = w.WtmDocEntry AND c.StageNo = w.StageNo
     JOIN ${objType} h ON h.DocEntry = w.DocEntry
     WHERE w.ObjType = @objType AND w.DocEntry = @docEntry AND w.ApprStatus = 'PENDING' AND h.ApprStatus = 'PENDING'
       AND w.Round = (SELECT MAX(r.Round) FROM FTS11WDD1 r WHERE r.ObjType = @objType AND r.DocEntry = @docEntry)`,
    [
      { name: 'objType', value: objType },
      { name: 'docEntry', value: docEntry },
    ],
    transaction
  );
  return rows.map((r) => r.UserID);
}

/**
 * Bring the "waiting for your approval" notifications of a document up to date: a new one for every user who can
 * act now and hasn't one unread yet; the unread ones of users who can no longer act are marked read.
 * Called when a document is sent for approval and after every Approve / Reject.
 */
export async function syncWaitingNotifications(objType: string, docEntry: number, transaction?: sql.Transaction): Promise<void> {
  if (!DESCRIBE[objType]) return;
  const canAct = await usersWhoCanAct(objType, docEntry, transaction);
  const params = [
    { name: 'objType', value: objType },
    { name: 'docEntry', value: docEntry },
  ];
  await db.query(
    `UPDATE FTS11ONTF SET IsRead = 1, ReadDate = GETDATE()
     WHERE NtfType = 'APPR_WAITING' AND ObjType = @objType AND DocEntry = @docEntry AND IsRead = 0
       ${canAct.length > 0 ? `AND UserID NOT IN (${canAct.map((_, i) => `@u${i}`).join(', ')})` : ''}`,
    [...params, ...canAct.map((id, i) => ({ name: `u${i}`, value: id }))],
    transaction
  );
  if (canAct.length === 0) return;
  const notified = await db.query<{ UserID: number }>(
    `SELECT DISTINCT UserID FROM FTS11ONTF
     WHERE NtfType = 'APPR_WAITING' AND ObjType = @objType AND DocEntry = @docEntry AND IsRead = 0`,
    params,
    transaction
  );
  const already = new Set(notified.map((n) => n.UserID));
  const toNotify = canAct.filter((id) => !already.has(id));
  if (toNotify.length === 0) return;
  const doc = await describe(objType, docEntry, transaction);
  await insert(toNotify, 'APPR_WAITING', 'Waiting for your approval', `${doc.typeName} ${doc.text}`, objType, docEntry, null, transaction);
}

/** Who sent the document for approval (its ConfirmedBy user), if still a user */
async function senderOf(objType: string, docEntry: number, transaction?: sql.Transaction): Promise<number | null> {
  const rows = await db.query<{ DocEntry: number }>(
    `SELECT u.DocEntry FROM ${objType} h JOIN SystemUsers u ON u.UserName = h.ConfirmedBy WHERE h.DocEntry = @docEntry`,
    [{ name: 'docEntry', value: docEntry }],
    transaction
  );
  return rows[0]?.DocEntry ?? null;
}

/**
 * Tell the sender what an approver's decision did. `stage`: the stage the approver acted in, and how many stages
 * its template has (for "Stage 1 of 2"); only told when that stage now has all the approvals it needs.
 * The approver isn't told about their own decision on their own document.
 */
export async function notifyApprovalDecision(
  objType: string,
  docEntry: number,
  outcome: 'STAGE' | 'APPROVED' | 'REJECTED',
  approver: { userId: number; userName: string },
  detail: { remarks?: string | null; stageNo?: number; stageCount?: number },
  transaction?: sql.Transaction
): Promise<void> {
  if (!DESCRIBE[objType]) return;
  const sender = await senderOf(objType, docEntry, transaction);
  if (sender === null || sender === approver.userId) return;
  const doc = await describe(objType, docEntry, transaction);
  if (outcome === 'REJECTED') {
    await insert(
      [sender],
      'APPR_REJECTED',
      `Rejected by ${approver.userName}`,
      `${doc.typeName} ${doc.text}${detail.remarks ? `. Reason: ${detail.remarks}` : ''}`,
      objType,
      docEntry,
      approver.userName,
      transaction
    );
  } else if (outcome === 'APPROVED') {
    await insert([sender], 'APPR_DONE', 'Approved - now OPEN', `${doc.typeName} ${doc.text}`, objType, docEntry, approver.userName, transaction);
  } else {
    await insert(
      [sender],
      'APPR_STAGE',
      `Approved by ${approver.userName} (Stage ${detail.stageNo} of ${detail.stageCount})`,
      `${doc.typeName} ${doc.text} - now waiting for the next stage`,
      objType,
      docEntry,
      approver.userName,
      transaction
    );
  }
}

/** An approver changed the document while approving it: tell the sender (not when the approver sent it themselves) */
export async function notifyApprovalChange(
  objType: string,
  docEntry: number,
  approver: { userId: number; userName: string },
  reason: string | null,
  transaction?: sql.Transaction
): Promise<void> {
  if (!DESCRIBE[objType]) return;
  const sender = await senderOf(objType, docEntry, transaction);
  if (sender === null || sender === approver.userId) return;
  const doc = await describe(objType, docEntry, transaction);
  await insert(
    [sender],
    'APPR_CHANGED',
    `Changed by ${approver.userName} while approving`,
    `${doc.typeName} ${doc.text}${reason ? `. Reason: ${reason}` : ''}`,
    objType,
    docEntry,
    approver.userName,
    transaction
  );
}

/** Post to SAP failed: tell the user who clicked Post */
export async function notifyPostFailed(objType: string, docEntry: number, userId: number, error: string): Promise<void> {
  const doc = await describe(objType, docEntry);
  await insert([userId], 'POST_FAILED', 'Post to SAP failed', `${doc.typeName} ${doc.text}: ${error}`, objType, docEntry, null);
}

// ---------------------------------------------------------------------------
// The bell

/** Unread count and the newest notification's time (the bell's 60-second check) */
export async function getNotificationSummary(userId: number) {
  void cleanUpIfDue();
  const rows = await db.query<{ Unread: number; Latest: Date | null }>(
    `SELECT SUM(CASE WHEN IsRead = 0 THEN 1 ELSE 0 END) AS Unread, MAX(CreatedDate) AS Latest
     FROM FTS11ONTF WHERE UserID = @userId`,
    [{ name: 'userId', value: userId }]
  );
  return { Unread: rows[0]?.Unread ?? 0, Latest: rows[0]?.Latest ?? null };
}

/** This user's notifications, newest first */
export async function getNotifications(userId: number, limit: number) {
  return db.query(
    `SELECT TOP (@limit) n.AbsEntry, n.NtfType, n.Title, n.Message, n.ObjType, v.Name AS ObjTypeName, n.DocEntry,
            n.IsRead, n.ReadDate, n.CreatedBy, n.CreatedDate
     FROM FTS11ONTF n
     LEFT JOIN FTS_vw_ObjType v ON v.Code = n.ObjType
     WHERE n.UserID = @userId
     ORDER BY n.CreatedDate DESC, n.AbsEntry DESC`,
    [
      { name: 'userId', value: userId },
      { name: 'limit', value: limit },
    ]
  );
}

/** Mark some (ids) or all of this user's notifications read */
export async function markNotificationsRead(userId: number, ids: number[] | 'ALL'): Promise<void> {
  if (ids !== 'ALL' && ids.length === 0) return;
  await db.query(
    `UPDATE FTS11ONTF SET IsRead = 1, ReadDate = GETDATE()
     WHERE UserID = @userId AND IsRead = 0
       ${ids === 'ALL' ? '' : `AND AbsEntry IN (${ids.map((_, i) => `@n${i}`).join(', ')})`}`,
    [{ name: 'userId', value: userId }, ...(ids === 'ALL' ? [] : ids.map((id, i) => ({ name: `n${i}`, value: id })))]
  );
}

// When the last clean-up ran, per company database (this server process; kept across hot reloads in development)
const globalForCleanup = globalThis as unknown as { notificationCleanupAt?: Map<string, number> };

/**
 * Housekeeping, at most once a day: notifications older than KEEP_DAYS are deleted, except unread "waiting for your
 * approval" ones (those are marked read as soon as the user can no longer act, so unread = the document still waits)
 */
async function cleanUpIfDue(): Promise<void> {
  const now = Date.now();
  if (!(globalForCleanup.notificationCleanupAt instanceof Map)) globalForCleanup.notificationCleanupAt = new Map<string, number>();
  const cleanedAt = globalForCleanup.notificationCleanupAt;
  const company = currentCompany()?.database ?? '';
  const last = cleanedAt.get(company);
  if (last && now - last < 24 * 60 * 60 * 1000) return;
  cleanedAt.set(company, now);
  try {
    await db.query(
      `DELETE FROM FTS11ONTF
       WHERE CreatedDate < DATEADD(DAY, -${KEEP_DAYS}, GETDATE())
         AND NOT (NtfType = 'APPR_WAITING' AND IsRead = 0)`
    );
  } catch {
    // Try again tomorrow; the bell keeps working meanwhile
  }
}

import sql from 'mssql';
import { db } from './db';
import { NotFoundError, ValidationError } from './errors';
import { APPR_STATUS, DOC_STATUS, DOC_TYPES, getDocumentDetail, openDocument } from './salesDocuments';
import { LEAD_OBJTYPE, getLead, openLead } from './leads';
import { OCRD_OBJTYPE, getConversion, openConversion } from './customerConversions';
import { TMPR_OBJTYPE, getReceipt, openReceipt } from './temporaryReceipts';
import { TRQ_OBJTYPE, getRequest, openRequest } from './receiptRequests';
import { OWTR_OBJTYPE, getTransfer, openTransfer } from './inventoryTransfers';
import { notifyApprovalDecision, syncWaitingNotifications } from './notifications';
import { IN_LATEST_ROUND, STAGE_CTES, myCurrentRows } from './approvalCheck';

// The approval step (FTS11WDD1: one row per approver, per stage, per template, per document).
//   - Stages go in order (StageNo): a stage is done once it has as many APPROVED as its MaxReqr; only the first stage
//     not done yet ("current stage") can act. Each template that triggered approval runs its own stages.
//   - One REJECTED at any stage -> the document is REJECTED (a DRAFT that can be changed and confirmed again).
//   - Every stage of every template done -> the document gets its No. and becomes OPEN + APPROVED.
//   - Approvers left over in a stage that is already done (or once rejected) stay PENDING but can no longer act.
//   - Only the latest Round counts (a rejected document can be sent again); earlier rounds are history.

/** A document type that goes through approval, and what the approval needs from it */
interface ApprovalDocument {
  objType: string;
  /** Header table (has DocStatus, ApprStatus) */
  header: string;
  label: string;
  /** Has UpdatedBy / UpdatedDate (stamped on a Reject) */
  audited: boolean;
  /** Columns of the Approvals list, from the header `h` (the same names for every document) */
  listColumns: string;
  /** Fully approved: give it its No., OPEN + APPROVED */
  open: (docEntry: number, userName: string, transaction: sql.Transaction) => Promise<void>;
  /** The document as its screen shows it (the answer to Approve / Reject) */
  detail: (docEntry: number) => Promise<unknown>;
}

/** Every document that has approvals: the sales documents, Lead and Temporary Receipt */
const APPROVAL_DOCUMENTS: Record<string, ApprovalDocument> = {
  ...Object.fromEntries(
    Object.values(DOC_TYPES).map((d): [string, ApprovalDocument] => [
      d.objType,
      {
        objType: d.objType,
        header: d.header,
        label: d.label,
        audited: true,
        listColumns: `h.DocNum, h.CardCode, h.CardName, h.DocDate, h.DocTotal,
                      h.ConfirmedBy AS SentBy, h.ConfirmedDate AS SentDate`,
        open: (docEntry, userName, transaction) => openDocument(d, docEntry, userName, APPR_STATUS.approved, transaction),
        detail: (docEntry) => getDocumentDetail(d, docEntry),
      },
    ])
  ),
  // A lead has no customer, date or amount yet: its name shows as the Name
  [LEAD_OBJTYPE]: {
    objType: LEAD_OBJTYPE,
    header: 'FTS11LEAD',
    label: 'Lead',
    audited: false,
    listColumns: `h.LeadCode AS DocNum, NULL AS CardCode, h.LeadName AS CardName, NULL AS DocDate, NULL AS DocTotal,
                  h.ConfirmedBy AS SentBy, h.ConfirmedDate AS SentDate`,
    open: (docEntry, userName, transaction) => openLead(docEntry, userName, APPR_STATUS.approved, transaction),
    detail: getLead,
  },
  // The SAP BP Code to be created and the company's name; no amount
  [OCRD_OBJTYPE]: {
    objType: OCRD_OBJTYPE,
    header: 'FTS11OCRD',
    label: 'Convert to customer',
    audited: true,
    listColumns: `h.DocNum, h.CardCode, h.LeadName AS CardName, h.DocDate, NULL AS DocTotal,
                  h.ConfirmedBy AS SentBy, h.ConfirmedDate AS SentDate`,
    open: (docEntry, userName, transaction) => openConversion(docEntry, userName, APPR_STATUS.approved, transaction),
    detail: getConversion,
  },
  // No customer is needed and there is no amount: the business partner (if any) shows, Total stays empty
  [OWTR_OBJTYPE]: {
    objType: OWTR_OBJTYPE,
    header: 'FTS11OWTR',
    label: 'Inventory transfer',
    audited: true,
    listColumns: `h.DocNum, h.CardCode, h.CardName, h.DocDate, NULL AS DocTotal,
                  h.ConfirmedBy AS SentBy, h.ConfirmedDate AS SentDate`,
    open: (docEntry, userName, transaction) => openTransfer(docEntry, userName, APPR_STATUS.approved, transaction),
    detail: getTransfer,
  },
  [TMPR_OBJTYPE]: {
    objType: TMPR_OBJTYPE,
    header: 'FTS11TMPR',
    label: 'Temporary receipt',
    audited: false,
    listColumns: `h.DocNum, h.CardCode, h.CardName, NULL AS DocDate, h.DocTotal,
                  h.ConfirmedBy AS SentBy, h.ConfirmedDate AS SentDate`,
    open: (docEntry, userName, transaction) => openReceipt(docEntry, userName, APPR_STATUS.approved, transaction),
    detail: getReceipt,
  },
  // The customer may only be a typed name (no customer code)
  [TRQ_OBJTYPE]: {
    objType: TRQ_OBJTYPE,
    header: 'FTS11OTRQ',
    label: 'Temporary receipt request',
    audited: true,
    listColumns: `h.DocNum, h.CardCode, h.CardName, h.DocDate, h.DocTotal,
                  h.ConfirmedBy AS SentBy, h.ConfirmedDate AS SentDate`,
    open: (docEntry, userName, transaction) => openRequest(docEntry, userName, APPR_STATUS.approved, transaction),
    detail: getRequest,
  },
};

/** A document type that has approvals; unknown -> 400 */
export function approvalDocumentOf(objType: string): ApprovalDocument {
  const doc = APPROVAL_DOCUMENTS[objType];
  if (!doc) throw new ValidationError('This document type has no approvals');
  return doc;
}

/** Documents waiting for this user's decision: their row is PENDING in a current stage, the document still PENDING */
export async function getMyApprovals(userId: number) {
  const perType = Object.values(APPROVAL_DOCUMENTS).map(
    (doc) => `
    SELECT w.ObjType, v.Name AS ObjTypeName, h.DocEntry, ${doc.listColumns},
           t.WtmCode, t.WtmName, s.WstName, w.StageNo
    FROM FTS11WDD1 w
    JOIN CurrentStage c ON c.ObjType = w.ObjType AND c.DocEntry = w.DocEntry AND c.WtmDocEntry = w.WtmDocEntry
                       AND c.StageNo = w.StageNo
    JOIN ${doc.header} h ON h.DocEntry = w.DocEntry
    JOIN FTS11OWTM t ON t.DocEntry = w.WtmDocEntry
    JOIN FTS11OWST s ON s.DocEntry = w.WstDocEntry
    LEFT JOIN FTS_vw_ObjType v ON v.Code = w.ObjType
    WHERE w.ObjType = '${doc.objType}' AND w.UserID = @userId AND w.ApprStatus = '${APPR_STATUS.pending}'
      AND h.ApprStatus = '${APPR_STATUS.pending}' AND ${IN_LATEST_ROUND('w')}`
  );
  return db.query(
    `WITH ${STAGE_CTES}
     ${perType.join('\n UNION ALL \n')}
     ORDER BY SentDate, ObjType, DocEntry`,
    [{ name: 'userId', value: userId }]
  );
}

/**
 * A document's approval rows for its Approval tab (template, stage in order, approver, decision, remarks, date),
 * and whether this user can approve / reject it now.
 */
export async function getDocumentApprovals(objType: string, docEntry: number, userId: number) {
  const doc = approvalDocumentOf(objType);
  const header = await db.query<{ ApprStatus: string }>(`SELECT ApprStatus FROM ${doc.header} WHERE DocEntry = @docEntry`, [
    { name: 'docEntry', value: docEntry },
  ]);
  if (header.length === 0) throw new NotFoundError(doc.label);

  // A PENDING row says whose turn it is: the current stage is waiting for its approvers, a later stage comes after
  // it, and one left over in a stage already done (or after a Reject) is no longer needed
  const pending = header[0].ApprStatus === APPR_STATUS.pending;
  const rows = await db.query(
    `WITH ${STAGE_CTES}
     SELECT w.AbsEntry, w.Round, t.WtmCode, t.WtmName, w.StageNo, s.WstName, w.MaxReqr,
            u.UserName, u.DisplayName, w.ApprStatus, w.Remarks, w.ActionDate,
            CASE WHEN w.ApprStatus <> '${APPR_STATUS.pending}' THEN CONCAT(UPPER(LEFT(ap.Name, 1)), LOWER(SUBSTRING(ap.Name, 2, 50)))
                 WHEN @pending = 1 AND ${IN_LATEST_ROUND('w')} AND w.StageNo = c.StageNo THEN 'Pending - waiting for this approver'
                 WHEN @pending = 1 AND ${IN_LATEST_ROUND('w')} AND w.StageNo > c.StageNo THEN CONCAT('Not yet - after Stage ', c.StageNo)
                 ELSE 'Not needed' END AS ApprStatusName
     FROM FTS11WDD1 w
     JOIN FTS11OWTM t ON t.DocEntry = w.WtmDocEntry
     JOIN FTS11OWST s ON s.DocEntry = w.WstDocEntry
     JOIN SystemUsers u ON u.DocEntry = w.UserID
     LEFT JOIN FTS_vw_ApprStatus ap ON ap.Code = w.ApprStatus
     LEFT JOIN CurrentStage c ON c.ObjType = w.ObjType AND c.DocEntry = w.DocEntry AND c.WtmDocEntry = w.WtmDocEntry
     WHERE w.ObjType = @objType AND w.DocEntry = @docEntry
     ORDER BY w.Round DESC, t.WtmCode, w.StageNo, u.UserName`,
    [
      { name: 'objType', value: objType },
      { name: 'docEntry', value: docEntry },
      { name: 'pending', value: pending ? 1 : 0 },
    ]
  );
  const canDecide = pending && (await myCurrentRows(objType, docEntry, userId)).length > 0;
  // Changes approvers made while approving (Temporary Receipt), newest first
  const changes = await db.query(
    `SELECT c.AbsEntry, c.ChangeDate, c.Remarks, u.UserName, u.DisplayName
     FROM FTS11WDD2 c
     JOIN SystemUsers u ON u.DocEntry = c.UserID
     WHERE c.ObjType = @objType AND c.DocEntry = @docEntry
     ORDER BY c.ChangeDate DESC, c.AbsEntry DESC`,
    [
      { name: 'objType', value: objType },
      { name: 'docEntry', value: docEntry },
    ]
  );
  return { rows, canDecide, changes };
}

/**
 * Approve or Reject a document waiting for approval, as this user (in one transaction).
 * Returns what happened to the document: still PENDING (more approvals needed), APPROVED (now OPEN with its No.)
 * or REJECTED.
 */
export async function decideApproval(
  objType: string,
  docEntry: number,
  decision: 'APPROVED' | 'REJECTED',
  remarks: string | null,
  user: { userId: number; userName: string },
  transaction: sql.Transaction
): Promise<string> {
  const doc = approvalDocumentOf(objType);
  const header = await db.query<{ DocStatus: string; ApprStatus: string }>(
    `SELECT DocStatus, ApprStatus FROM ${doc.header} WITH (UPDLOCK, HOLDLOCK) WHERE DocEntry = @docEntry`,
    [{ name: 'docEntry', value: docEntry }],
    transaction
  );
  if (header.length === 0) throw new NotFoundError(doc.label);
  if (header[0].ApprStatus !== APPR_STATUS.pending || header[0].DocStatus !== DOC_STATUS.draft) {
    throw new ValidationError(`This ${doc.label.toLowerCase()} is no longer waiting for approval`);
  }

  const mine = await myCurrentRows(objType, docEntry, user.userId, transaction);
  if (mine.length === 0) {
    // Why not: their stage comes later, or it already has enough approvals from the others
    const waiting = await db.query<{ Later: number }>(
      `WITH ${STAGE_CTES}
       SELECT CASE WHEN c.StageNo IS NOT NULL AND w.StageNo > c.StageNo THEN 1 ELSE 0 END AS Later
       FROM FTS11WDD1 w
       LEFT JOIN CurrentStage c ON c.ObjType = w.ObjType AND c.DocEntry = w.DocEntry AND c.WtmDocEntry = w.WtmDocEntry
       WHERE w.ObjType = @objType AND w.DocEntry = @docEntry AND w.UserID = @userId AND w.ApprStatus = '${APPR_STATUS.pending}'
         AND ${IN_LATEST_ROUND('w')}`,
      [
        { name: 'objType', value: objType },
        { name: 'docEntry', value: docEntry },
        { name: 'userId', value: user.userId },
      ],
      transaction
    );
    if (waiting.length === 0) throw new ValidationError(`You are not waiting to approve this ${doc.label.toLowerCase()}`);
    throw new ValidationError(
      waiting.some((w) => w.Later === 1)
        ? 'An earlier approval stage has to approve first'
        : 'Your approval stage already has the approvals it needs'
    );
  }

  // This approver's decision, on their row(s) in the current stage(s)
  await db.query(
    `UPDATE FTS11WDD1 SET ApprStatus = @decision, Remarks = @remarks, ActionDate = GETDATE()
     WHERE AbsEntry IN (${mine.map((_, i) => `@row${i}`).join(', ')})`,
    [
      { name: 'decision', value: decision },
      { name: 'remarks', type: sql.NVarChar(254), value: remarks },
      ...mine.map((r, i) => ({ name: `row${i}`, value: r.AbsEntry })),
    ],
    transaction
  );

  if (decision === APPR_STATUS.rejected) {
    await db.query(
      `UPDATE ${doc.header}
       SET ApprStatus = @rejected${doc.audited ? ', UpdatedBy = @userName, UpdatedDate = GETDATE()' : ''}
       WHERE DocEntry = @docEntry`,
      [
        { name: 'docEntry', value: docEntry },
        { name: 'rejected', value: APPR_STATUS.rejected },
        { name: 'userName', value: user.userName },
      ],
      transaction
    );
    // The sender is told (with the reason); nobody is waiting to approve it any more
    await notifyApprovalDecision(objType, docEntry, 'REJECTED', user, { remarks }, transaction);
    await syncWaitingNotifications(objType, docEntry, transaction);
    return APPR_STATUS.rejected;
  }

  // Approved: is any stage of any template still short of approvals?
  const open = await db.query(
    `WITH ${STAGE_CTES}
     SELECT 1 AS X FROM CurrentStage WHERE ObjType = @objType AND DocEntry = @docEntry`,
    [
      { name: 'objType', value: objType },
      { name: 'docEntry', value: docEntry },
    ],
    transaction
  );
  if (open.length > 0) {
    // The stage this approver acted in now has all its approvals: the sender hears "Stage n of m"
    const done = await db.query<{ StageNo: number; StageCount: number }>(
      `WITH ${STAGE_CTES}
       SELECT s.StageNo,
              (SELECT COUNT(DISTINCT x.StageNo) FROM FTS11WDD1 x
               WHERE x.ObjType = s.ObjType AND x.DocEntry = s.DocEntry AND x.WtmDocEntry = s.WtmDocEntry
                 AND ${IN_LATEST_ROUND('x')}) AS StageCount
       FROM StageState s
       WHERE s.ObjType = @objType AND s.DocEntry = @docEntry AND s.Approved >= s.MaxReqr
         AND EXISTS (SELECT 1 FROM FTS11WDD1 m WHERE m.AbsEntry IN (${mine.map((_, i) => `@row${i}`).join(', ')})
                     AND m.WtmDocEntry = s.WtmDocEntry AND m.StageNo = s.StageNo)`,
      [
        { name: 'objType', value: objType },
        { name: 'docEntry', value: docEntry },
        ...mine.map((r, i) => ({ name: `row${i}`, value: r.AbsEntry })),
      ],
      transaction
    );
    if (done.length > 0) {
      await notifyApprovalDecision(objType, docEntry, 'STAGE', user, { stageNo: done[0].StageNo, stageCount: done[0].StageCount }, transaction);
    }
    // The next stage's approvers are told; those who can no longer act have theirs marked read
    await syncWaitingNotifications(objType, docEntry, transaction);
    return APPR_STATUS.pending;
  }

  // Fully approved: the document gets its No. and becomes OPEN + APPROVED (ConfirmedBy stays who sent it)
  await doc.open(docEntry, user.userName, transaction);
  await notifyApprovalDecision(objType, docEntry, 'APPROVED', user, {}, transaction);
  await syncWaitingNotifications(objType, docEntry, transaction);
  return APPR_STATUS.approved;
}

import { randomUUID } from 'crypto';
import { mkdir, readFile, unlink, writeFile } from 'fs/promises';
import path from 'path';
import { db } from './db';
import { NotFoundError, ValidationError } from './errors';
import { ATTACH_FOLDER_NOT_SET, splitFileName, uploadProblem } from './attachmentRules';
import { getAttachmentSettings } from './generalSettings';
import { isApproverNow, wentThroughApproval } from './approvalCheck';
import { isSynced } from './postStatus';

/**
 * Documents that can have attachments: document type (FTS_vw_ObjType.Code) -> its header table, and whether it has
 * approvals (ApprStatus; waiting for approval or approved, its attachments are locked).
 */
const DOCUMENT_TABLES: Record<string, { table: string; hasApproval: boolean; hasPosting?: boolean }> = {
  FTS11OQUT: { table: 'FTS11OQUT', hasApproval: true, hasPosting: true },
  FTS11ORDR: { table: 'FTS11ORDR', hasApproval: true, hasPosting: true },
  FTS11ORIN: { table: 'FTS11ORIN', hasApproval: true, hasPosting: true },
  FTS11LEAD: { table: 'FTS11LEAD', hasApproval: true, hasPosting: true },
  FTS11OCRD: { table: 'FTS11OCRD', hasApproval: true, hasPosting: true },
  FTS11TMPR: { table: 'FTS11TMPR', hasApproval: true, hasPosting: true },
  FTS11OWTR: { table: 'FTS11OWTR', hasApproval: true, hasPosting: true },
  // Temporary Receipt Request: approvals, but never posted to SAP
  FTS11OTRQ: { table: 'FTS11OTRQ', hasApproval: true },
};

/** Folder the files are saved in: Attachment Folder in General Settings */
async function attachmentRoot(): Promise<string> {
  const { folder } = await getAttachmentSettings();
  if (!folder) throw new ValidationError(ATTACH_FOLDER_NOT_SET);
  return folder;
}

/** Folder of one document: <root>\<ObjType>\<DocEntry> */
const documentFolder = async (objType: string, docEntry: number) =>
  path.join(await attachmentRoot(), objType, String(docEntry));

/** The document type must be one that takes attachments, and the document must exist */
export async function assertDocumentExists(objType: string, docEntry: number): Promise<void> {
  await documentStatuses(objType, docEntry);
}

/**
 * Its ApprStatus and PostStatus (null for a type without approvals / posting); the type must take attachments and
 * the document must exist
 */
async function documentStatuses(objType: string, docEntry: number) {
  const doc = DOCUMENT_TABLES[objType];
  if (!doc) throw new ValidationError('This document type has no attachments');
  if (!Number.isInteger(docEntry) || docEntry <= 0) throw new ValidationError('Document is not valid');
  const found = await db.query<{ ApprStatus: string | null; PostStatus: string | null }>(
    `SELECT ${doc.hasApproval ? 'ApprStatus' : 'NULL AS ApprStatus'}, ${doc.hasPosting ? 'PostStatus' : 'NULL AS PostStatus'}
     FROM ${doc.table} WHERE DocEntry = @docEntry`,
    [{ name: 'docEntry', value: docEntry }]
  );
  if (found.length === 0) throw new NotFoundError('Document');
  return found[0];
}

/** Changing / removing one attachment: its document must not be waiting for approval (see assertAttachmentsChangeable) */
export async function assertAttachmentChangeable(absEntry: number, userId: number): Promise<void> {
  const rows = await db.query<{ ObjType: string; DocEntry: number }>(
    `SELECT ObjType, DocEntry FROM FTS11ATC1 WHERE AbsEntry = @absEntry`,
    [{ name: 'absEntry', value: absEntry }]
  );
  if (rows.length === 0) throw new NotFoundError('Attachment');
  await assertAttachmentsChangeable(rows[0].ObjType, rows[0].DocEntry, userId);
}

/**
 * Adding / changing / removing files: the document must exist, not be waiting for approval or approved (a rejected
 * one can be changed), nor be synced to SAP.
 * Except: a Temporary Receipt waiting for this user's approval (the approver may change it while approving), and a
 * Convert to Customer that was rejected (it can be changed and sent for approval again).
 */
export async function assertAttachmentsChangeable(objType: string, docEntry: number, userId: number): Promise<void> {
  const { ApprStatus, PostStatus } = await documentStatuses(objType, docEntry);
  if (!DOCUMENT_TABLES[objType].hasApproval) return;
  const approverNow = objType === 'FTS11TMPR' && ApprStatus === 'PENDING' && (await isApproverNow(objType, docEntry, userId));
  const locked =
    objType === 'FTS11OCRD'
      ? ApprStatus === 'PENDING' || ApprStatus === 'APPROVED'
      : ApprStatus === 'PENDING' || (await wentThroughApproval(objType, docEntry));
  if (locked && !approverNow) {
    throw new ValidationError("This document is waiting for approval or approved; its attachments can't be changed");
  }
  if (isSynced(PostStatus)) {
    throw new ValidationError("This document has been posted to SAP; its attachments can't be changed");
  }
}

/** Split "Customer PO.pdf" into name and extension; refuse empty, too large or program files */
export async function checkUpload(fileName: string, size: number): Promise<{ name: string; ext: string | null }> {
  const { maxMB } = await getAttachmentSettings();
  const problem = uploadProblem(fileName, size, maxMB);
  if (problem) throw new ValidationError(problem);
  return splitFileName(fileName);
}

const ATTACHMENT_SELECT = `
  SELECT AbsEntry, ObjType, DocEntry, FileName, FileExt, FileSize, [FreeText], CreatedBy, CreatedDate
  FROM FTS11ATC1`;

/** Attachments of a document, oldest first */
export async function listAttachments(objType: string, docEntry: number) {
  return db.query(`${ATTACHMENT_SELECT} WHERE ObjType = @objType AND DocEntry = @docEntry ORDER BY AbsEntry`, [
    { name: 'objType', value: objType },
    { name: 'docEntry', value: docEntry },
  ]);
}

/** Save the file in the document's folder under a unique name, then record it */
export async function addAttachment(
  objType: string,
  docEntry: number,
  file: { name: string; size: number; bytes: Buffer },
  freeText: string | null,
  userName: string
) {
  const { name, ext } = await checkUpload(file.name, file.size);
  if (freeText && freeText.length > 254) throw new ValidationError('Remarks must be 254 characters or fewer');

  const storedName = `${randomUUID()}${ext ? `.${ext}` : ''}`;
  const folder = await documentFolder(objType, docEntry);
  await mkdir(folder, { recursive: true });
  await writeFile(path.join(folder, storedName), file.bytes);

  try {
    const rows = await db.query<{ AbsEntry: number }>(
      `INSERT INTO FTS11ATC1 (ObjType, DocEntry, FileName, FileExt, FileSize, StoredName, [FreeText],
                              CreatedBy, CreatedDate, UpdatedBy, UpdatedDate)
       OUTPUT INSERTED.AbsEntry
       VALUES (@objType, @docEntry, @fileName, @fileExt, @fileSize, @storedName, @freeText,
               @userName, GETDATE(), @userName, GETDATE())`,
      [
        { name: 'objType', value: objType },
        { name: 'docEntry', value: docEntry },
        { name: 'fileName', value: name },
        { name: 'fileExt', value: ext },
        { name: 'fileSize', value: file.size },
        { name: 'storedName', value: storedName },
        { name: 'freeText', value: freeText || null },
        { name: 'userName', value: userName },
      ]
    );
    return getAttachment(rows[0].AbsEntry);
  } catch (error) {
    // Not recorded: don't leave the file behind
    await unlink(path.join(folder, storedName)).catch(() => undefined);
    throw error;
  }
}

async function getStored(absEntry: number) {
  const rows = await db.query<{ ObjType: string; DocEntry: number; FileName: string; FileExt: string | null; StoredName: string }>(
    `SELECT ObjType, DocEntry, FileName, FileExt, StoredName FROM FTS11ATC1 WHERE AbsEntry = @absEntry`,
    [{ name: 'absEntry', value: absEntry }]
  );
  if (rows.length === 0) throw new NotFoundError('Attachment');
  return rows[0];
}

export async function getAttachment(absEntry: number) {
  const rows = await db.query(`${ATTACHMENT_SELECT} WHERE AbsEntry = @absEntry`, [{ name: 'absEntry', value: absEntry }]);
  if (rows.length === 0) throw new NotFoundError('Attachment');
  return rows[0];
}

/** The file's bytes and its original name, for download */
export async function readAttachmentFile(absEntry: number): Promise<{ fileName: string; bytes: Buffer }> {
  const stored = await getStored(absEntry);
  try {
    const bytes = await readFile(path.join(await documentFolder(stored.ObjType, stored.DocEntry), stored.StoredName));
    return { fileName: stored.FileExt ? `${stored.FileName}.${stored.FileExt}` : stored.FileName, bytes };
  } catch {
    throw new NotFoundError('Attachment file');
  }
}

/** Change an attachment's Remarks (FreeText) */
export async function updateAttachmentText(absEntry: number, freeText: string | null, userName: string) {
  if (freeText && freeText.length > 254) throw new ValidationError('Remarks must be 254 characters or fewer');
  await getStored(absEntry);
  await db.query(
    `UPDATE FTS11ATC1 SET [FreeText] = @freeText, UpdatedBy = @userName, UpdatedDate = GETDATE() WHERE AbsEntry = @absEntry`,
    [
      { name: 'absEntry', value: absEntry },
      { name: 'freeText', value: freeText || null },
      { name: 'userName', value: userName },
    ]
  );
  return getAttachment(absEntry);
}

/** Remove the attachment and its file from the folder */
export async function deleteAttachment(absEntry: number): Promise<void> {
  const stored = await getStored(absEntry);
  await db.query(`DELETE FROM FTS11ATC1 WHERE AbsEntry = @absEntry`, [{ name: 'absEntry', value: absEntry }]);
  await unlink(path.join(await documentFolder(stored.ObjType, stored.DocEntry), stored.StoredName)).catch(() => undefined);
}

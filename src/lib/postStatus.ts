// Posting to SAP B1 (PostStatus, FTS_vw_PostStatus): shared by the server and the screens.

/**
 * Posting statuses of a document synced to SAP B1, or being synced: it can't be edited any more (no edit, no line
 * changes, no attachments). FAILED stays editable so the error can be corrected.
 */
export const SYNCED_POST_STATUSES: readonly string[] = ['SUCCESS', 'PENDING'];

/** The document is synced to SAP B1 (or being synced) */
export const isSynced = (postStatus: string | null | undefined): boolean =>
  !!postStatus && SYNCED_POST_STATUSES.includes(postStatus);

/** The header fields that decide whether a portal document can still be changed (in every list and detail row) */
export interface DocumentLockFields {
  docStatus?: string | null;
  apprStatus?: string | null;
  apprLocked?: boolean | null;
  postStatus?: string | null;
}

/**
 * The document can still be edited: DRAFT or OPEN (not CLOSED / CANCELED), not waiting for approval nor been
 * through it, and not synced to SAP (or being synced). Used by the lists' Edit button and ?edit=1; a screen may
 * add its own rule (e.g. a receipt request already copied into a receipt).
 */
export const isDocumentEditable = (doc: DocumentLockFields): boolean =>
  ['DRAFT', 'OPEN'].includes(doc.docStatus ?? 'DRAFT') && doc.apprStatus !== 'PENDING' && !doc.apprLocked && !isSynced(doc.postStatus);

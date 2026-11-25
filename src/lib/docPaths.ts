/**
 * Where each document type's detail view is: the bell, the Dashboard's My Work tiles and the approval e-mails' links.
 * Plain module (no React) so the server can use it too.
 */
export const DOC_PATHS: Record<string, string> = {
  FTS11OQUT: '/sales-quotations',
  FTS11ORDR: '/sales-orders',
  FTS11ORIN: '/credit-memos',
  FTS11LEAD: '/leads',
  FTS11OCRD: '/convert-to-customer',
  FTS11TMPR: '/banking/temporary-receipts',
  FTS11OTRQ: '/banking/receipt-requests',
  FTS11OWTR: '/inventory/transfers',
  FTS11SCIN: '/sales-check-ins',
};

/**
 * The page of a document a notification is about. "Waiting for your approval" opens it as from the Approvals list
 * (?from=approvals), so an approver without access to that screen can still see it and decide.
 */
export function documentPath(objType: string | null, docEntry: number | null, waiting: boolean): string | null {
  const base = objType ? DOC_PATHS[objType] : undefined;
  if (!base || !docEntry) return null;
  return `${base}/${docEntry}${waiting ? '?from=approvals' : ''}`;
}

import { db } from './db';
import { getApprovalEmailSettings, getSavedSmtpConfig } from './generalSettings';
import { sendMail } from './mail';
import { DOC_PATHS, documentPath } from './docPaths';

// E-mail approval notifications (General Settings > SMTP > E-mail approval notifications): the bell's approval
// notifications are also e-mailed, to the user's SystemUsers.Email (none = bell only):
//   APPR_WAITING   -> the approvers whose turn it is
//   APPR_DONE / APPR_REJECTED / APPR_CHANGED -> who sent the document for approval
// ("Stage n of m" and Post to SAP failures stay bell-only.)
// Sent in the background after the event's transaction: Confirm / Approve never wait for, or fail because of, the
// mail server. A failure is only written to the portal's log.

/** The notification types that are also e-mailed */
export const EMAILED_TYPES = new Set(['APPR_WAITING', 'APPR_DONE', 'APPR_REJECTED', 'APPR_CHANGED']);

const SUBJECT_PREFIX: Record<string, string> = {
  APPR_WAITING: 'Approval needed',
  APPR_DONE: 'Approved',
  APPR_REJECTED: 'Rejected',
  APPR_CHANGED: 'Changed while approving',
};

interface EmailRow {
  AbsEntry: number;
  NtfType: string;
  Title: string;
  Message: string;
  ObjType: string;
  DocEntry: number;
  CreatedDate: Date;
  Email: string | null;
  DisplayName: string | null;
}

/** E-mail these notifications (FTS11ONTF.AbsEntry) once the transaction that wrote them is committed */
export function emailNotifications(ids: number[]): void {
  if (ids.length === 0) return;
  // The company context (AsyncLocalStorage) carries over into the timer
  setTimeout(() => {
    sendNotificationEmails(ids).catch((error) => console.error('[approval e-mail]', error instanceof Error ? error.message : error));
  }, 1000);
}

/** Waits until the rows are committed: another connection doesn't see them before (and never if rolled back) */
async function readCommitted(ids: number[]): Promise<EmailRow[]> {
  const waits = [0, 2000, 5000, 10000, 20000];
  let rows: EmailRow[] = [];
  for (const wait of waits) {
    if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
    try {
      rows = await db.query<EmailRow>(
        `SELECT n.AbsEntry, n.NtfType, n.Title, n.Message, n.ObjType, n.DocEntry, n.CreatedDate, u.Email, u.DisplayName
         FROM FTS11ONTF n
         JOIN SystemUsers u ON u.DocEntry = n.UserID
         WHERE n.AbsEntry IN (${ids.map((_, i) => `@n${i}`).join(', ')})`,
        ids.map((id, i) => ({ name: `n${i}`, value: id }))
      );
    } catch {
      continue; // timed out waiting for the transaction: try again
    }
    if (rows.length === ids.length) return rows;
  }
  return rows; // the rest were rolled back
}

/** Who sent the document for approval, and its approval template(s) in the latest round */
async function documentDetails(objType: string, docEntry: number): Promise<{ sender: string | null; templates: string }> {
  if (!DOC_PATHS[objType]) return { sender: null, templates: '' };
  const params = [
    { name: 'objType', value: objType },
    { name: 'docEntry', value: docEntry },
  ];
  const sender = await db.query<{ Sender: string | null }>(
    `SELECT ISNULL(u.DisplayName, h.ConfirmedBy) AS Sender
     FROM ${objType} h LEFT JOIN SystemUsers u ON u.UserName = h.ConfirmedBy
     WHERE h.DocEntry = @docEntry`,
    params
  );
  const templates = await db.query<{ WtmName: string }>(
    `SELECT DISTINCT t.WtmName
     FROM FTS11WDD1 w JOIN FTS11OWTM t ON t.DocEntry = w.WtmDocEntry
     WHERE w.ObjType = @objType AND w.DocEntry = @docEntry
       AND w.Round = (SELECT MAX(r.Round) FROM FTS11WDD1 r WHERE r.ObjType = @objType AND r.DocEntry = @docEntry)`,
    params
  );
  return { sender: sender[0]?.Sender ?? null, templates: templates.map((t) => t.WtmName).join(', ') };
}

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const pad = (n: number) => String(n).padStart(2, '0');
const formatDate = (d: Date) =>
  `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** The e-mail for one notification */
function buildEmail(row: EmailRow, details: { sender: string | null; templates: string }, portalUrl: string) {
  const [about, reason] = row.Message.split('. Reason: ');
  const subject = `${SUBJECT_PREFIX[row.NtfType] ?? row.Title}: ${about}`.slice(0, 200);
  const path = documentPath(row.ObjType, row.DocEntry, row.NtfType === 'APPR_WAITING');
  const link = path ? `${portalUrl}${path}` : portalUrl;
  const facts: [string, string][] = [
    ['Document', about],
    ...(reason ? [['Reason', reason] as [string, string]] : []),
    ...(details.sender ? [['Sent for approval by', details.sender] as [string, string]] : []),
    ...(details.templates ? [['Approval', details.templates] as [string, string]] : []),
    ['Date', formatDate(new Date(row.CreatedDate))],
  ];
  const greeting = `Hello ${row.DisplayName || ''},`.replace(' ,', ',');
  const action = row.NtfType === 'APPR_WAITING' ? 'Open it to approve or reject' : 'Open it in the portal';

  const text = [
    greeting,
    '',
    row.Title,
    '',
    ...facts.map(([label, value]) => `${label}: ${value}`),
    '',
    `${action}: ${link}`,
    '',
    '-- AJI Sales Portal (automatic e-mail, please do not reply)',
  ].join('\n');

  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#32363a">
<p>${escapeHtml(greeting)}</p>
<p style="font-size:16px;font-weight:bold;margin:16px 0 8px">${escapeHtml(row.Title)}</p>
<table cellpadding="4" cellspacing="0" style="border-collapse:collapse;font-size:14px">
${facts.map(([label, value]) => `<tr><td style="color:#6a6d70;padding-right:16px;vertical-align:top">${escapeHtml(label)}</td><td>${escapeHtml(value)}</td></tr>`).join('\n')}
</table>
<p style="margin:20px 0"><a href="${escapeHtml(link)}" style="background:#0a6ed1;color:#ffffff;padding:8px 16px;border-radius:4px;text-decoration:none">${escapeHtml(action)}</a></p>
<p style="color:#6a6d70;font-size:12px">AJI Sales Portal - automatic e-mail, please do not reply.</p>
</div>`;
  return { subject, text, html };
}

async function sendNotificationEmails(ids: number[]): Promise<void> {
  const settings = await getApprovalEmailSettings();
  if (!settings) return;
  const rows = (await readCommitted(ids)).filter((r) => r.Email && r.Email.trim());
  if (rows.length === 0) return;
  let smtp;
  try {
    smtp = await getSavedSmtpConfig();
  } catch (error) {
    console.error('[approval e-mail] not sent:', error instanceof Error ? error.message : error);
    return;
  }
  const detailsByDoc = new Map<string, { sender: string | null; templates: string }>();
  for (const row of rows) {
    const key = `${row.ObjType}|${row.DocEntry}`;
    if (!detailsByDoc.has(key)) detailsByDoc.set(key, await documentDetails(row.ObjType, row.DocEntry));
    const mail = buildEmail(row, detailsByDoc.get(key)!, settings.portalUrl);
    const result = await sendMail(smtp, { to: (row.Email as string).trim(), ...mail });
    if (!result.success) console.error(`[approval e-mail] to ${row.Email} failed: ${result.message}`);
  }
}

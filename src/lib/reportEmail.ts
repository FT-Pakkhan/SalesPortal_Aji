import { db } from './db';
import { NotFoundError, ValidationError } from './errors';
import { getSapDbLogon, getSavedSmtpConfig } from './generalSettings';
import { sendMail } from './mail';
import { renderReportPdf } from './crystal';
import type { ReportConnection, ReportParamValue } from './crystal';
import { assertReportFileExists, buildRunValues, getRunnableReport, parseAddressList, runReadOnlyQuery } from './reports';

// E-mailing a report (single sending): after Run the user opens the E-mail form, filled in from the report's E-mail
// tab (default To / CC, To query, subject / message / file name templates); Send runs the report again with the same
// parameter values, mails the PDF through General Settings > SMTP and writes the E-mail Log (FTS11OEML).
//
// Placeholders in the templates: {ReportName} {Today} {UserName} {DisplayName} and any parameter as its name in the
// report without SAP's "@query" part, e.g. {CardCode}, {ItemGroup} (case and spaces don't matter). The To query uses
// the same names as @parameters, e.g. SELECT E_Mail FROM SBODemoGB..OCRD WHERE CardCode = @CardCode (just FROM OCRD when the\n// report uses the SAP DB connection: its queries then run in the SAP company database).

type Report = Awaited<ReturnType<typeof getRunnableReport>>;

/** A parameter's name as used in templates and the To query: the report's name before "@", letters and digits only */
const keyOf = (paramName: string) => paramName.split('@')[0].replace(/[^A-Za-z0-9_]/g, '');
const norm = (key: string) => key.replace(/[^A-Za-z0-9]/g, '').toLowerCase();

const pad = (n: number) => String(n).padStart(2, '0');
const dateText = (d: Date) => `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;

/** A value as it reads in an e-mail: dates dd.MM.yyyy, ticks Yes / No */
function show(value: unknown): string {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  const s = String(value);
  const m = /^(\d{4})-(\d{2})-(\d{2})(T(\d{2}):(\d{2}))?$/.exec(s);
  if (m) return `${m[3]}.${m[2]}.${m[1]}${m[4] ? ` ${m[5]}:${m[6]}` : ''}`;
  return s;
}

/** Each parameter's value as text (a range "from - to", several values "a, b") and as one SQL value (the first / from) */
function parameterValues(values: ReportParamValue[]) {
  return values.map((v) => {
    const first = v.values[0];
    const isRange = first !== null && typeof first === 'object';
    const textValue = isRange
      ? (() => {
          const r = first as { from: unknown; to: unknown };
          return [show(r.from), show(r.to)].filter(Boolean).join(' - ');
        })()
      : v.values.map(show).filter(Boolean).join(', ');
    const sqlValue = isRange ? (first as { from: unknown }).from ?? null : first ?? null;
    return { key: keyOf(v.name), text: textValue, sqlValue };
  });
}

/** Fill {Placeholders}; an unknown one is left as it is, so a mistake in the template shows */
function fill(template: string | null, data: Record<string, string>): string {
  if (!template) return '';
  return template.replace(/\{([^{}]+)\}/g, (whole, key: string) => data[norm(key)] ?? whole);
}

export async function userOf(userId: number) {
  const rows = await db.query<{ UserName: string; DisplayName: string | null; Email: string | null }>(
    `SELECT UserName, DisplayName, Email FROM SystemUsers WHERE DocEntry = @userId`,
    [{ name: 'userId', value: userId }]
  );
  if (rows.length === 0) throw new NotFoundError('User');
  return rows[0];
}

/**
 * The To query: run with the parameters as @names (read-only; in the SAP company database when the report uses the SAP
 * DB connection); every row's 1st column that is an e-mail address is a recipient. A failing query is reported.
 * Two parameters with the same name before "@" give their first value.
 */
async function addressesFromQuery(query: string, params: ReturnType<typeof parameterValues>, inSapDb: boolean): Promise<string[]> {
  const rows = await runReadOnlyQuery(
    query,
    "The report's E-mail To Query",
    inSapDb,
    params.filter((p) => p.key).map((p) => ({ name: p.key, value: p.sqlValue }))
  );
  return rows
    .flatMap((r) => String(Object.values(r)[0] ?? '').split(/[;,]/))
    .map((a) => a.trim())
    .filter((a) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a));
}

/** The report, which must allow e-mail, and the run values checked against its parameters */
async function prepare(reportEntry: number, userId: number, body: Record<string, unknown>) {
  const report = await getRunnableReport(reportEntry, userId);
  if (!report.EmailAllowed) throw new ValidationError('This report is not set to be e-mailed (Report Settings > E-mail)');
  const values = buildRunValues(report.Params, (body.values ?? {}) as Record<string, unknown>);
  return { report, values };
}

function placeholderData(report: Report, values: ReportParamValue[], user: { UserName: string; DisplayName: string | null }) {
  const data: Record<string, string> = {
    reportname: report.ReportName,
    today: dateText(new Date()),
    username: user.UserName,
    displayname: user.DisplayName ?? user.UserName,
  };
  for (const p of parameterValues(values)) if (p.key) data[norm(p.key)] = p.text;
  return data;
}

/** A file name Windows and mail programs accept */
export const safeFileName = (name: string) => name.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 150) || 'Report';

/**
 * The E-mail form, filled in: To = the default To plus the To query's addresses, CC = the default CC, subject / message /
 * file name from the templates. The user can change all of it before sending.
 */
export async function getEmailDraft(reportEntry: number, userId: number, body: Record<string, unknown>) {
  const { report, values } = await prepare(reportEntry, userId, body);
  const user = await userOf(userId);
  const data = placeholderData(report, values, user);
  const queried = report.EmailToQuery ? await addressesFromQuery(report.EmailToQuery, parameterValues(values), report.UseSapConn) : [];
  const to = parseAddressList([report.EmailTo, ...queried].filter(Boolean).join(';'), 'To');
  return {
    To: to ?? '',
    Cc: report.EmailCc ?? '',
    Subject: fill(report.EmailSubject, data) || report.ReportName,
    Body: fill(report.EmailBody, data),
    FileName: safeFileName(fill(report.EmailFileName, data) || report.ReportName),
    // Whether "Send me a copy" can be ticked: the user has an e-mail address
    MyEmail: user.Email ?? null,
  };
}

/** "CardCode=C20000; FromDate=01.10.2026" for the log */
const paramText = (values: ReportParamValue[]) =>
  parameterValues(values)
    .filter((p) => p.text)
    .map((p) => `${p.key}=${p.text}`)
    .join('; ') || null;

/**
 * Send: run the report with the values, mail the PDF, and log it (SENT or FAILED with the mail server's error).
 * Returns { sent, message }; a mail server refusal is an answer, not an error (it is in the log too).
 */
export async function sendReportEmail(reportEntry: number, userId: number, body: Record<string, unknown>) {
  const { report, values } = await prepare(reportEntry, userId, body);
  const user = await userOf(userId);

  const to = parseAddressList(body.to, 'To');
  if (!to) throw new ValidationError('Enter at least one e-mail address in To');
  let cc = parseAddressList(body.cc, 'CC');
  if (body.copyMe === true) {
    if (!user.Email) throw new ValidationError('Your user has no e-mail address for a copy (Users > E-mail)');
    cc = parseAddressList([cc, user.Email].filter(Boolean).join(';'), 'CC');
  }
  const subject = String(body.subject ?? '').trim();
  if (!subject) throw new ValidationError('Subject is required');
  if (subject.length > 254) throw new ValidationError('Subject must be 254 characters or fewer');
  const text = String(body.body ?? '');
  const fileName = `${safeFileName(String(body.fileName ?? '') || report.ReportName)}.pdf`;

  // Everything needed to send is checked before the report is run
  const smtp = await getSavedSmtpConfig();
  await assertReportFileExists(report.ReportPath);
  const connection: ReportConnection = report.UseSapConn ? { kind: 'SAP', logon: await getSapDbLogon() } : { kind: 'PORTAL' };
  const pdf = await renderReportPdf(report.ReportPath, values, connection);

  const result = await sendMail(smtp, {
    to,
    cc,
    subject,
    text,
    attachments: [{ filename: fileName, content: pdf, contentType: 'application/pdf' }],
  });

  await db.query(
    `INSERT INTO FTS11OEML (ReportEntry, ParamValues, MailTo, MailCc, Subject, FileName, Status, ErrorDesc, SentBy)
     VALUES (@reportEntry, @paramValues, @mailTo, @mailCc, @subject, @fileName, @status, @errorDesc, @sentBy)`,
    [
      { name: 'reportEntry', value: reportEntry },
      { name: 'paramValues', value: paramText(values) },
      { name: 'mailTo', value: to },
      { name: 'mailCc', value: cc },
      { name: 'subject', value: subject },
      { name: 'fileName', value: fileName },
      { name: 'status', value: result.success ? 'SENT' : 'FAILED' },
      { name: 'errorDesc', value: result.success ? null : result.message },
      { name: 'sentBy', value: user.UserName },
    ]
  );

  return {
    sent: result.success,
    message: result.success ? `E-mailed to ${to}${cc ? ` (CC ${cc})` : ''}` : `The mail server refused it: ${result.message}`,
  };
}

/** The E-mail Log, newest first: reports, and layouts e-mailed from a document (ReportName = the layout's name) */
export async function getEmailLog(limit: number) {
  return db.query(
    `SELECT TOP (@limit) e.AbsEntry, e.ReportEntry, e.LayoutEntry, COALESCE(r.ReportName, l.LayoutName) AS ReportName,
            CASE WHEN e.LayoutEntry IS NULL THEN 'Report' ELSE 'Layout' END AS Source, e.DocRef,
            e.ParamValues, e.MailTo, e.MailCc, e.Subject, e.FileName, e.Status, e.ErrorDesc, e.SentBy, e.SentDate
     FROM FTS11OEML e
     LEFT JOIN FTS11SRPT r ON r.DocEntry = e.ReportEntry
     LEFT JOIN FTS11SLYT l ON l.DocEntry = e.LayoutEntry
     ORDER BY e.SentDate DESC, e.AbsEntry DESC`,
    [{ name: 'limit', value: limit }]
  );
}

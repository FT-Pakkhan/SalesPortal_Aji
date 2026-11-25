import { access } from 'fs/promises';
import { constants } from 'fs';
import path from 'path';
import sql from 'mssql';
import { db } from './db';
import { NotFoundError, ValidationError } from './errors';
import { getSapCompanyDbName } from './generalSettings';
import type { ReportParamType, ReportParamValue, ReportValue } from './crystal';

// Reports: Crystal Reports (.rpt) set up in Report Settings (FTS11SRPT), with the parameters the user fills in before
// running one (FTS11RPT1) and the roles that may run it (FTS11RPT2). Users in an administrator role may run every
// report. Choose-from-list queries run in the portal database (SAP tables as SBODemoGB..OITM).

export const PARAM_TYPES: ReportParamType[] = ['STRING', 'INTEGER', 'DECIMAL', 'DATE', 'DATETIME', 'BOOLEAN'];
export const INPUT_TYPES = ['KEYIN', 'LIST'] as const;
export type InputType = (typeof INPUT_TYPES)[number];

/** Rows a choose-from-list query may return (a longer list can't be used to choose anyway) */
const MAX_LIST_ROWS = 5000;

export const REPORT_SELECT = `
  SELECT r.DocEntry, r.ReportCode, r.ReportName, r.ReportPath, r.Category, r.Remarks, r.IsActive, r.UseSapConn,
         r.EmailAllowed, r.EmailTo, r.EmailCc, r.EmailToQuery, r.EmailSubject, r.EmailBody, r.EmailFileName,
         (SELECT COUNT(*) FROM FTS11RPT1 p WHERE p.DocEntry = r.DocEntry) AS ParamCount,
         STUFF((SELECT ', ' + o.RoleName FROM FTS11RPT2 x JOIN FTS11OROL o ON o.DocEntry = x.RoleEntry
                WHERE x.DocEntry = r.DocEntry ORDER BY o.RoleName FOR XML PATH(''), TYPE).value('.', 'NVARCHAR(MAX)'), 1, 2, '') AS RoleNames
  FROM FTS11SRPT r`;

export interface ReportParamFields {
  paramName: string;
  caption: string;
  paramType: ReportParamType;
  inputType: InputType;
  query: string | null;
  allowMulti: boolean;
  isRange: boolean;
  mandatory: boolean;
  defaultValue: string | null;
}

export interface ReportFields {
  reportCode: string;
  reportName: string;
  reportPath: string;
  category: string | null;
  remarks: string | null;
  isActive: boolean;
  /** Log on with the SAP DI API setting (SAP company database) instead of the portal's database setting */
  useSapConn: boolean;
  params: ReportParamFields[];
  roleIds: number[];
  /** The E-mail tab: whether it may be e-mailed after Run, default recipients and the e-mail's templates */
  email: ReportEmailFields;
}

export interface ReportEmailFields {
  emailAllowed: boolean;
  emailTo: string | null;
  emailCc: string | null;
  emailToQuery: string | null;
  emailSubject: string | null;
  emailBody: string | null;
  emailFileName: string | null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Addresses separated by ";" or ",": each must be an e-mail address; returned as a clean "a; b" list (or null) */
export function parseAddressList(value: unknown, label: string, max = 1000): string | null {
  const parts = String(value ?? '')
    .split(/[;,]/)
    .map((a) => a.trim())
    .filter(Boolean);
  const bad = parts.find((a) => !EMAIL_RE.test(a));
  if (bad) throw new ValidationError(`${label}: "${bad}" is not a valid e-mail address`);
  const list = [...new Set(parts.map((a) => a.toLowerCase()))].map((lower) => parts.find((a) => a.toLowerCase() === lower) as string).join('; ');
  if (list.length > max) throw new ValidationError(`${label} is too long`);
  return list || null;
}

/** Validate the E-mail tab */
function parseEmailFields(body: Record<string, unknown>): ReportEmailFields {
  const emailToQuery = text(body.emailToQuery);
  if (emailToQuery) assertSelectQuery(emailToQuery, 'E-mail To Query');
  const emailSubject = text(body.emailSubject);
  if (emailSubject.length > 254) throw new ValidationError('E-mail Subject must be 254 characters or fewer');
  const emailFileName = text(body.emailFileName);
  if (emailFileName.length > 100) throw new ValidationError('Attachment Name must be 100 characters or fewer');
  return {
    emailAllowed: body.emailAllowed === true,
    emailTo: parseAddressList(body.emailTo, 'Default To', 254),
    emailCc: parseAddressList(body.emailCc, 'Default CC', 254),
    emailToQuery: emailToQuery || null,
    emailSubject: emailSubject || null,
    emailBody: String(body.emailBody ?? '').trim() || null,
    emailFileName: emailFileName || null,
  };
}

const text = (value: unknown) => String(value ?? '').trim();

/** A choose-from-list query must be a single SELECT (or WITH ... SELECT): it only reads */
export function assertSelectQuery(query: string, label: string): void {
  if (!/^\s*(select|with)\b/i.test(query)) throw new ValidationError(`${label}: the query must start with SELECT (or WITH)`);
  // It runs in a transaction that is rolled back; it may not end that transaction itself
  if (/\b(commit|rollback|begin\s+tran|begin\s+transaction|save\s+tran)\b/i.test(query)) {
    throw new ValidationError(`${label}: the query may not use COMMIT, ROLLBACK or BEGIN TRAN`);
  }
}

/** The report path must be a full path to a .rpt file */
export function assertReportPath(reportPath: string): void {
  if (!reportPath) throw new ValidationError('Report Path is required');
  if (reportPath.length > 254) throw new ValidationError('Report Path must be 254 characters or fewer');
  if (!path.isAbsolute(reportPath)) {
    throw new ValidationError('Report Path must be a full path on the server, e.g. D:\\SalesPortal_Reports\\SalesAnalysis.rpt');
  }
  if (path.extname(reportPath).toLowerCase() !== '.rpt') throw new ValidationError('Report Path must be a Crystal Reports file (.rpt)');
}

/** The .rpt file must exist and be readable by the portal (checked on save, and again when running) */
export async function assertReportFileExists(reportPath: string): Promise<void> {
  try {
    await access(reportPath, constants.R_OK);
  } catch {
    throw new ValidationError(`The portal can't find or read the report file ${reportPath}`);
  }
}

/** Validate a create / update request body */
export function parseReportFields(body: Record<string, unknown>): ReportFields {
  const reportCode = text(body.reportCode);
  if (!reportCode) throw new ValidationError('Report Code is required');
  if (reportCode.length > 50) throw new ValidationError('Report Code must be 50 characters or fewer');
  const reportName = text(body.reportName);
  if (!reportName) throw new ValidationError('Report Name is required');
  if (reportName.length > 100) throw new ValidationError('Report Name must be 100 characters or fewer');
  const reportPath = text(body.reportPath);
  assertReportPath(reportPath);
  const category = text(body.category);
  if (category.length > 50) throw new ValidationError('Category must be 50 characters or fewer');
  const remarks = text(body.remarks);
  if (remarks.length > 254) throw new ValidationError('Remarks must be 254 characters or fewer');

  const rawParams = Array.isArray(body.params) ? (body.params as Record<string, unknown>[]) : [];
  const params = rawParams.map((p, i): ReportParamFields => {
    const row = `Parameter line ${i + 1}`;
    const paramName = text(p.paramName);
    if (!paramName) throw new ValidationError(`${row}: Parameter Name is required`);
    if (paramName.length > 100) throw new ValidationError(`${row}: Parameter Name must be 100 characters or fewer`);
    const caption = text(p.caption) || paramName.split('@')[0];
    if (caption.length > 100) throw new ValidationError(`${row}: Caption must be 100 characters or fewer`);
    const paramType = text(p.paramType) as ReportParamType;
    if (!PARAM_TYPES.includes(paramType)) throw new ValidationError(`${row}: Type is not valid`);
    const inputType = text(p.inputType) as InputType;
    if (!INPUT_TYPES.includes(inputType)) throw new ValidationError(`${row}: Input is not valid`);
    const query = text(p.query);
    if (inputType === 'LIST') {
      if (!query) throw new ValidationError(`${row} (${caption}): a Choose from List parameter needs a Query`);
      assertSelectQuery(query, `${row} (${caption})`);
    }
    const isRange = p.isRange === true;
    const allowMulti = p.allowMulti === true;
    if (paramType === 'BOOLEAN' && (isRange || allowMulti || inputType === 'LIST')) {
      throw new ValidationError(`${row} (${caption}): a Boolean parameter is a single tick box (no list, range or multiple values)`);
    }
    if (isRange && allowMulti) throw new ValidationError(`${row} (${caption}): choose either Range or Multiple Values, not both`);
    const defaultValue = text(p.defaultValue);
    if (defaultValue.length > 254) throw new ValidationError(`${row}: Default Value must be 254 characters or fewer`);
    return {
      paramName,
      caption,
      paramType,
      inputType,
      // A key-in parameter keeps no query
      query: inputType === 'LIST' ? query : null,
      allowMulti,
      isRange,
      mandatory: p.mandatory === true,
      defaultValue: defaultValue || null,
    };
  });
  const names = params.map((p) => p.paramName.toLowerCase());
  const twice = params.find((p, i) => names.indexOf(p.paramName.toLowerCase()) !== i);
  if (twice) throw new ValidationError(`Parameter ${twice.paramName} is listed twice`);

  const rawRoles = Array.isArray(body.roleIds) ? body.roleIds : [];
  const roleIds = [...new Set(rawRoles.map((id) => Number(id)))];
  if (roleIds.some((id) => !Number.isInteger(id) || id <= 0)) throw new ValidationError('Role list is not valid');

  return {
    reportCode,
    reportName,
    reportPath,
    category: category || null,
    remarks: remarks || null,
    isActive: body.isActive !== false,
    useSapConn: body.useSapConn === true,
    params,
    roleIds,
    email: parseEmailFields(body),
  };
}

/** Report Code must be unique; checked here for a friendly message (the table also enforces it) */
export async function assertReportCodeAvailable(reportCode: string, excludeDocEntry?: number): Promise<void> {
  const found = await db.query(`SELECT DocEntry FROM FTS11SRPT WHERE ReportCode = @reportCode AND DocEntry <> @exclude`, [
    { name: 'reportCode', value: reportCode },
    { name: 'exclude', value: excludeDocEntry ?? 0 },
  ]);
  if (found.length > 0) throw new ValidationError('Report Code already exists');
}

/** Every role must exist */
export async function assertRolesExist(roleIds: number[]): Promise<void> {
  if (roleIds.length === 0) return;
  const found = await db.query(
    `SELECT DocEntry FROM FTS11OROL WHERE DocEntry IN (${roleIds.map((_, i) => `@r${i}`).join(', ')})`,
    roleIds.map((id, i) => ({ name: `r${i}`, value: id }))
  );
  if (found.length !== roleIds.length) throw new ValidationError('One or more roles no longer exist');
}

/**
 * Save a report's E-mail tab and replace its parameters and roles (inside the save's transaction);
 * LineNum = the order given
 */
export async function saveReportLines(docEntry: number, fields: ReportFields, transaction: sql.Transaction): Promise<void> {
  const key = [{ name: 'docEntry', value: docEntry }];
  // The E-mail tab
  const e = fields.email;
  await db.query(
    `UPDATE FTS11SRPT
     SET EmailAllowed = @emailAllowed, EmailTo = @emailTo, EmailCc = @emailCc, EmailToQuery = @emailToQuery,
         EmailSubject = @emailSubject, EmailBody = @emailBody, EmailFileName = @emailFileName
     WHERE DocEntry = @docEntry`,
    [
      ...key,
      { name: 'emailAllowed', value: e.emailAllowed ? 1 : 0 },
      { name: 'emailTo', value: e.emailTo },
      { name: 'emailCc', value: e.emailCc },
      { name: 'emailToQuery', value: e.emailToQuery },
      { name: 'emailSubject', value: e.emailSubject },
      { name: 'emailBody', value: e.emailBody },
      { name: 'emailFileName', value: e.emailFileName },
    ],
    transaction
  );
  await db.query(`DELETE FROM FTS11RPT1 WHERE DocEntry = @docEntry`, key, transaction);
  await db.query(`DELETE FROM FTS11RPT2 WHERE DocEntry = @docEntry`, key, transaction);
  for (const [i, p] of fields.params.entries()) {
    await db.query(
      `INSERT INTO FTS11RPT1 (DocEntry, LineNum, ParamName, Caption, ParamType, InputType, Query, AllowMulti, IsRange, Mandatory, DefaultValue)
       VALUES (@docEntry, @lineNum, @paramName, @caption, @paramType, @inputType, @query, @allowMulti, @isRange, @mandatory, @defaultValue)`,
      [
        ...key,
        { name: 'lineNum', value: i },
        { name: 'paramName', value: p.paramName },
        { name: 'caption', value: p.caption },
        { name: 'paramType', value: p.paramType },
        { name: 'inputType', value: p.inputType },
        { name: 'query', value: p.query },
        { name: 'allowMulti', value: p.allowMulti ? 1 : 0 },
        { name: 'isRange', value: p.isRange ? 1 : 0 },
        { name: 'mandatory', value: p.mandatory ? 1 : 0 },
        { name: 'defaultValue', value: p.defaultValue },
      ],
      transaction
    );
  }
  for (const roleId of fields.roleIds) {
    await db.query(`INSERT INTO FTS11RPT2 (DocEntry, RoleEntry) VALUES (@docEntry, @roleId)`, [...key, { name: 'roleId', value: roleId }], transaction);
  }
}

/** A report's parameters, in their order */
export async function getReportParams(docEntry: number) {
  return db.query<{
    LineNum: number;
    ParamName: string;
    Caption: string;
    ParamType: ReportParamType;
    InputType: InputType;
    Query: string | null;
    AllowMulti: boolean;
    IsRange: boolean;
    Mandatory: boolean;
    DefaultValue: string | null;
  }>(
    `SELECT LineNum, ParamName, Caption, ParamType, InputType, Query, AllowMulti, IsRange, Mandatory, DefaultValue
     FROM FTS11RPT1 WHERE DocEntry = @docEntry ORDER BY LineNum`,
    [{ name: 'docEntry', value: docEntry }]
  );
}

/** A report with its parameters and roles (Report Settings) */
export async function getReportDetail(docEntry: number) {
  const rows = await db.query(`${REPORT_SELECT} WHERE r.DocEntry = @docEntry`, [{ name: 'docEntry', value: docEntry }]);
  if (rows.length === 0) throw new NotFoundError('Report');
  const roles = await db.query(
    `SELECT o.DocEntry AS RoleEntry, o.RoleName, o.IsAdmin
     FROM FTS11RPT2 x JOIN FTS11OROL o ON o.DocEntry = x.RoleEntry
     WHERE x.DocEntry = @docEntry ORDER BY o.RoleName`,
    [{ name: 'docEntry', value: docEntry }]
  );
  return { ...rows[0], Params: await getReportParams(docEntry), Roles: roles };
}

/** SQL: the user may run report `alias` - one of its roles is theirs, or they are in an administrator role */
const MAY_RUN = (alias: string) => `
  (EXISTS (SELECT 1 FROM FTS11ROL1 a JOIN FTS11OROL o ON o.DocEntry = a.DocEntry WHERE a.UserID = @userId AND o.IsAdmin = 1)
   OR EXISTS (SELECT 1 FROM FTS11RPT2 x JOIN FTS11ROL1 a ON a.DocEntry = x.RoleEntry WHERE x.DocEntry = ${alias}.DocEntry AND a.UserID = @userId))`;

/** The active reports this user may run (the Reports module), by category and name */
export async function getMyReports(userId: number) {
  return db.query(
    `SELECT r.DocEntry, r.ReportCode, r.ReportName, r.Category, r.Remarks
     FROM FTS11SRPT r
     WHERE r.IsActive = 1 AND ${MAY_RUN('r')}
     ORDER BY ISNULL(r.Category, ''), r.ReportName`,
    [{ name: 'userId', value: userId }]
  );
}

/** A report the user may run (active and one of their roles), with its parameters; otherwise not found */
export async function getRunnableReport(docEntry: number, userId: number) {
  const rows = await db.query<{
    DocEntry: number;
    ReportCode: string;
    ReportName: string;
    ReportPath: string;
    Category: string | null;
    Remarks: string | null;
    UseSapConn: boolean;
    EmailAllowed: boolean;
    EmailTo: string | null;
    EmailCc: string | null;
    EmailToQuery: string | null;
    EmailSubject: string | null;
    EmailBody: string | null;
    EmailFileName: string | null;
  }>(
    `SELECT r.DocEntry, r.ReportCode, r.ReportName, r.ReportPath, r.Category, r.Remarks, r.UseSapConn,
            r.EmailAllowed, r.EmailTo, r.EmailCc, r.EmailToQuery, r.EmailSubject, r.EmailBody, r.EmailFileName
     FROM FTS11SRPT r
     WHERE r.DocEntry = @docEntry AND r.IsActive = 1 AND ${MAY_RUN('r')}`,
    [
      { name: 'docEntry', value: docEntry },
      { name: 'userId', value: userId },
    ]
  );
  if (rows.length === 0) throw new NotFoundError('Report');
  return { ...rows[0], Params: await getReportParams(docEntry) };
}

/**
 * Run a report's query (choose-from-list, E-mail To Query) read-only: inside a transaction that is always rolled back,
 * so even a query that slipped past the SELECT check can't change anything.
 *   inSapDb = false: in the portal database (SAP tables written as SBODemoGB..OITM);
 *   inSapDb = true (the report uses the SAP DB connection): in the SAP company database, so SAP tables need no prefix
 *     (portal tables then do). Run with [SAP].sys.sp_executesql, which doesn't change the pooled connection's database.
 * `params`: @names the query may use; passed as text (SQL Server converts them for comparisons with numbers / dates).
 * Speed is the same either way: both databases are on the same SQL Server.
 */
export async function runReadOnlyQuery(
  query: string,
  label: string,
  inSapDb: boolean,
  params: { name: string; value: unknown }[] = []
): Promise<Record<string, unknown>[]> {
  assertSelectQuery(query, label);
  const sapDb = inSapDb ? await getSapCompanyDbName() : null;
  const transaction = await db.beginTransaction();
  try {
    const request = new sql.Request(transaction);
    let text = query;
    const unique = params.filter((p, i) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(p.name) && params.findIndex((x) => x.name.toLowerCase() === p.name.toLowerCase()) === i);
    if (sapDb) {
      request.input('__stmt', sql.NVarChar(sql.MAX), query);
      request.input('__params', sql.NVarChar(4000), unique.map((p) => `@${p.name} NVARCHAR(4000)`).join(', '));
      for (const p of unique) request.input(p.name, sql.NVarChar(4000), p.value === null || p.value === undefined ? null : String(p.value));
      text = `EXEC [${sapDb}].sys.sp_executesql @__stmt, @__params${unique.map((p) => `, @${p.name} = @${p.name}`).join('')}`;
    } else {
      for (const p of unique) request.input(p.name, p.value as never);
    }
    try {
      return (await request.query(text)).recordset as Record<string, unknown>[];
    } catch (error) {
      throw new ValidationError(`${label} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  } finally {
    // A failed query may have ended the transaction already
    await db.rollbackTransaction(transaction).catch(() => undefined);
  }
}

/**
 * Run a choose-from-list query: 1st column = value, 2nd column = description (if any), in the portal database or (the
 * report uses the SAP DB connection) the SAP company database. Returns the rows as they came too (Test Query shows them).
 */
export async function runListQuery(
  query: string,
  inSapDb = false
): Promise<{ columns: string[]; rows: Record<string, unknown>[]; choices: { value: unknown; description: unknown }[] }> {
  const rows = await runReadOnlyQuery(query, 'The query', inSapDb);
  if (rows.length > MAX_LIST_ROWS) throw new ValidationError(`The query returns ${rows.length} rows; a list can have at most ${MAX_LIST_ROWS}. Narrow it down.`);
  const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
  const choices = rows.map((r) => {
    const values = Object.values(r);
    return { value: values[0], description: values.length > 1 ? values[1] : null };
  });
  return { columns, rows, choices };
}

// ---------------------------------------------------------------------------
// Running a report: the values the user filled in, checked against the settings

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

/** One value checked and converted for its type; empty -> null */
function convertValue(raw: unknown, type: ReportParamType, caption: string): string | number | boolean | null {
  if (raw === null || raw === undefined || raw === '') return null;
  switch (type) {
    case 'STRING':
      return String(raw);
    case 'INTEGER': {
      const n = Number(raw);
      if (!Number.isInteger(n)) throw new ValidationError(`${caption}: enter a whole number`);
      return n;
    }
    case 'DECIMAL': {
      const n = Number(raw);
      if (!Number.isFinite(n)) throw new ValidationError(`${caption}: enter a number`);
      return n;
    }
    case 'DATE':
      if (!DATE_RE.test(String(raw))) throw new ValidationError(`${caption}: enter a date`);
      return String(raw);
    case 'DATETIME':
      if (!DATETIME_RE.test(String(raw))) throw new ValidationError(`${caption}: enter a date and time`);
      return String(raw);
    case 'BOOLEAN':
      return raw === true || raw === 'true' || raw === 1 || raw === '1';
  }
}

/**
 * The values sent for a run ({ [paramName]: value | value[] | { from, to } }), checked against the report's
 * parameters: mandatory ones filled, types right, several values only where allowed.
 */
export function buildRunValues(
  params: Awaited<ReturnType<typeof getReportParams>>,
  body: Record<string, unknown>
): ReportParamValue[] {
  return params.map((p) => {
    const raw = body[p.ParamName];
    let values: ReportValue[];
    if (p.IsRange) {
      const r = (raw ?? {}) as { from?: unknown; to?: unknown };
      const from = convertValue(r.from, p.ParamType, `${p.Caption} (From)`) as string | number | null;
      const to = convertValue(r.to, p.ParamType, `${p.Caption} (To)`) as string | number | null;
      if (p.Mandatory && from === null && to === null) throw new ValidationError(`${p.Caption} is required`);
      values = from === null && to === null ? [] : [{ from, to }];
    } else {
      const list = (Array.isArray(raw) ? raw : [raw])
        .map((v) => convertValue(v, p.ParamType, p.Caption))
        .filter((v): v is string | number | boolean => v !== null);
      if (!p.AllowMulti && list.length > 1) throw new ValidationError(`${p.Caption} takes one value`);
      if (p.Mandatory && list.length === 0) throw new ValidationError(`${p.Caption} is required`);
      values = list;
    }
    return { name: p.ParamName, values };
  });
}

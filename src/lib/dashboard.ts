import type sql from 'mssql';
import { db } from './db';
import { NotFoundError, ValidationError } from './errors';
import { getMyApprovals } from './approvals';
import { getUserAccess } from './roles';
import { accessTo } from './screens';
import { assertSelectQuery, runReadOnlyQuery } from './reports';

// The Dashboard (every user):
//   My Work - fixed tiles over the portal's own documents: what needs the user's attention (no setup).
//   Widgets - set up in Dashboard Settings (FTS11ODSH / FTS11DSH1): each the result of a read-only query, shown as a
//             KPI, chart or table. One layout for everyone (Sequence order); a user sees the widgets of their roles.

// ---------------------------------------------------------------------------
// My Work

/** A portal document type as the tiles list it: its table, screen (role access), and the columns to show */
interface WorkDoc {
  objType: string;
  typeName: string;
  header: string;
  screen: string;
  docNum: string;
  name: string;
  date: string;
  total: string;
  /** Posted to SAP from the portal (has PostStatus) */
  posts: boolean;
}

const WORK_DOCS: WorkDoc[] = [
  { objType: 'FTS11LEAD', typeName: 'Lead', header: 'FTS11LEAD', screen: 'LEAD', docNum: 'h.LeadCode', name: 'h.LeadName', date: 'h.DocDate', total: 'NULL', posts: false },
  { objType: 'FTS11OCRD', typeName: 'Convert to Customer', header: 'FTS11OCRD', screen: 'CNVC', docNum: 'h.DocNum', name: 'h.LeadName', date: 'h.DocDate', total: 'NULL', posts: true },
  { objType: 'FTS11OQUT', typeName: 'Sales Quotation', header: 'FTS11OQUT', screen: 'OQUT', docNum: 'h.DocNum', name: 'h.CardName', date: 'h.DocDate', total: 'h.DocTotal', posts: false },
  { objType: 'FTS11ORDR', typeName: 'Sales Order', header: 'FTS11ORDR', screen: 'ORDR', docNum: 'h.DocNum', name: 'h.CardName', date: 'h.DocDate', total: 'h.DocTotal', posts: true },
  { objType: 'FTS11ORIN', typeName: 'Credit Memo', header: 'FTS11ORIN', screen: 'ORIN', docNum: 'h.DocNum', name: 'h.CardName', date: 'h.DocDate', total: 'h.DocTotal', posts: true },
  { objType: 'FTS11OTRQ', typeName: 'Temporary Receipt Request', header: 'FTS11OTRQ', screen: 'TRRQ', docNum: 'h.DocNum', name: 'h.CardName', date: 'h.DocDate', total: 'h.DocTotal', posts: false },
  { objType: 'FTS11TMPR', typeName: 'Temporary Receipt', header: 'FTS11TMPR', screen: 'TMPR', docNum: 'h.DocNum', name: 'h.CardName', date: 'h.DocDate', total: 'h.DocTotal', posts: true },
  { objType: 'FTS11OWTR', typeName: 'Inventory Transfer', header: 'FTS11OWTR', screen: 'OWTR', docNum: 'h.DocNum', name: 'h.CardName', date: 'h.DocDate', total: 'NULL', posts: true },
];

/** At most this many documents are listed behind a tile (the count is always the full number) */
const TILE_ITEMS = 100;

/**
 * The documents of every type the user can see (`docs`) that match `where` (on header `h`), newest first, with the
 * full count. Columns: ObjType, TypeName, DocEntry, DocNum, Name, DocDate, Total, Note.
 */
async function workItems(docs: WorkDoc[], where: (d: WorkDoc) => string, note: (d: WorkDoc) => string, params: { name: string; value: unknown }[]) {
  if (docs.length === 0) return { count: 0, items: [] as Record<string, unknown>[] };
  const union = docs
    .map(
      (d) => `SELECT '${d.objType}' AS ObjType, '${d.typeName}' AS TypeName, h.DocEntry, ${d.docNum} AS DocNum, ${d.name} AS Name,
                     ${d.date} AS DocDate, ${d.total} AS Total, ${note(d)} AS Note
              FROM ${d.header} h WHERE ${where(d)}`
    )
    .join('\n UNION ALL \n');
  const rows = await db.query<Record<string, unknown>>(
    `SELECT COUNT(*) OVER () AS TotalCount, x.* FROM (${union}) x ORDER BY x.DocDate DESC, x.DocEntry DESC
     OFFSET 0 ROWS FETCH NEXT ${TILE_ITEMS} ROWS ONLY`,
    params
  );
  return { count: rows.length > 0 ? Number(rows[0].TotalCount) : 0, items: rows.map(({ TotalCount: _c, ...r }) => r) };
}

/**
 * The My Work tiles for a user: each with its count and the documents behind it. Only tiles for screens the user can
 * see; "Waiting for my approval" needs the Approvals screen; "Checked in now" the Sales Check In screen.
 */
export async function getMyWork(userId: number, userName: string) {
  const access = await getUserAccess(userId);
  const visible = WORK_DOCS.filter((d) => accessTo(access, d.screen) !== 'NONE');
  const posting = visible.filter((d) => d.posts);
  const user = [{ name: 'userName', value: userName }];
  const tiles: { key: string; title: string; hint: string; count: number; items: Record<string, unknown>[] }[] = [];

  if (accessTo(access, 'APPROVALS') !== 'NONE') {
    const waiting = (await getMyApprovals(userId)) as Record<string, unknown>[];
    tiles.push({
      key: 'APPROVALS',
      title: 'Waiting for My Approval',
      hint: 'Documents waiting for your decision now',
      count: waiting.length,
      items: waiting.slice(0, TILE_ITEMS).map((w) => ({
        ObjType: w.ObjType,
        TypeName: w.ObjTypeName,
        DocEntry: w.DocEntry,
        DocNum: w.DocNum,
        Name: w.CardName,
        DocDate: w.DocDate,
        Total: w.DocTotal,
        Note: `${w.StageNo}. ${w.WstName} - sent by ${w.SentBy ?? ''}`,
      })),
    });
  }

  tiles.push({
    key: 'MY_DRAFTS',
    title: 'My Drafts',
    hint: 'Your documents saved but not confirmed yet',
    ...(await workItems(visible, () => `h.DocStatus = 'DRAFT' AND h.ApprStatus = 'NO-APPROVAL' AND h.CreatedBy = @userName`, () => `'Draft'`, user)),
  });
  tiles.push({
    key: 'SENT_PENDING',
    title: 'Sent for Approval',
    hint: 'Your documents still waiting for approval',
    ...(await workItems(visible, () => `h.ApprStatus = 'PENDING' AND h.ConfirmedBy = @userName`, () => `'Waiting for approval'`, user)),
  });
  tiles.push({
    key: 'POST_FAILED',
    title: 'Post to SAP Failed',
    hint: 'SAP refused these documents: see Error Description, correct and post again',
    ...(await workItems(posting, () => `h.PostStatus = 'FAILED'`, () => `LEFT(h.ErrorDesc, 200)`, [])),
  });
  tiles.push({
    key: 'NOT_POSTED',
    title: 'Open, Not Posted',
    hint: 'Confirmed (and approved) documents not posted to SAP yet',
    ...(await workItems(
      posting,
      () => `h.DocStatus = 'OPEN' AND h.PostStatus = 'NO-POSTING' AND h.ApprStatus IN ('NO-APPROVAL', 'APPROVED')`,
      () => `'Ready to post'`,
      []
    )),
  });

  if (accessTo(access, 'SCIN') !== 'NONE') {
    const visits = await db.query<Record<string, unknown>>(
      `SELECT 'FTS11SCIN' AS ObjType, 'Sales Check In' AS TypeName, v.DocEntry, v.DocNum, v.CardName AS Name,
              v.CheckInTime AS DocDate, NULL AS Total, LEFT(v.Purpose, 200) AS Note
       FROM FTS11SCIN v WHERE v.UserID = @userId AND v.DocStatus = 'OPEN' ORDER BY v.CheckInTime DESC`,
      [{ name: 'userId', value: userId }]
    );
    tiles.push({ key: 'CHECKED_IN', title: 'Checked In Now', hint: 'Your visit in progress: check out when you leave', count: visits.length, items: visits });
  }
  return tiles;
}

// ---------------------------------------------------------------------------
// Widgets

export const WIDGET_TYPES = ['KPI', 'BAR', 'LINE', 'PIE', 'TABLE'] as const;
export const VALUE_FORMATS = ['NUMBER', 'AMOUNT', 'PERCENT'] as const;
export const WIDTHS = [1, 2, 4] as const;
/** Rows kept from a widget's query: a table shows 50, a chart 100 points */
const MAX_ROWS = { TABLE: 50, CHART: 100 };

/** SQL: the user may see widget `alias` - one of its roles is theirs, or they are in an administrator role */
const MAY_SEE = (alias: string) => `
  (EXISTS (SELECT 1 FROM FTS11ROL1 a JOIN FTS11OROL o ON o.DocEntry = a.DocEntry WHERE a.UserID = @userId AND o.IsAdmin = 1)
   OR EXISTS (SELECT 1 FROM FTS11DSH1 x JOIN FTS11ROL1 a ON a.DocEntry = x.RoleEntry WHERE x.DocEntry = ${alias}.DocEntry AND a.UserID = @userId))`;

/** The active widgets this user sees, in their order (definitions only; each is run separately) */
export async function getMyWidgets(userId: number) {
  return db.query(
    `SELECT d.DocEntry, d.WidgetCode, d.Title, d.WidgetType, d.Width, d.ValueFormat, d.LinkPath, d.Remarks
     FROM FTS11ODSH d
     WHERE d.IsActive = 1 AND ${MAY_SEE('d')}
     ORDER BY d.Sequence, d.DocEntry`,
    [{ name: 'userId', value: userId }]
  );
}

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** The @variables a widget's query may use, for this user */
async function widgetVariables(userId: number, userName: string) {
  const rows = await db.query<{ SlpCode: number | null }>(`SELECT SlpCode FROM SystemUsers WHERE DocEntry = @userId`, [{ name: 'userId', value: userId }]);
  const today = new Date();
  return [
    { name: 'UserID', value: userId },
    { name: 'UserName', value: userName },
    // No Sales Employee (e.g. a manager): NULL - queries written as (@SlpCode IS NULL OR SlpCode = @SlpCode) show all
    { name: 'SlpCode', value: rows[0]?.SlpCode ?? null },
    { name: 'Today', value: ymd(today) },
    { name: 'MonthStart', value: ymd(new Date(today.getFullYear(), today.getMonth(), 1)) },
    { name: 'YearStart', value: ymd(new Date(today.getFullYear(), 0, 1)) },
  ];
}

/**
 * Run a widget query for a user and keep what its type shows: columns (as written in the query) and rows as arrays,
 * so the API's camel-casing can't rename them.
 */
export async function runWidgetQuery(query: string, widgetType: string, useSapConn: boolean, userId: number, userName: string) {
  const rows = await runReadOnlyQuery(query, 'The widget query', useSapConn, await widgetVariables(userId, userName));
  const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
  const max = widgetType === 'TABLE' ? MAX_ROWS.TABLE : widgetType === 'KPI' ? 1 : MAX_ROWS.CHART;
  return {
    columnList: columns.map((name) => ({ name })),
    rowList: rows.slice(0, max).map((r) => ({ cells: Object.values(r) })),
    truncated: rows.length > max,
  };
}

/** One widget's data, if the user may see it (active and one of their roles) */
export async function getWidgetData(docEntry: number, userId: number, userName: string) {
  const rows = await db.query<{ Query: string; WidgetType: string; UseSapConn: boolean }>(
    `SELECT d.Query, d.WidgetType, d.UseSapConn FROM FTS11ODSH d WHERE d.DocEntry = @docEntry AND d.IsActive = 1 AND ${MAY_SEE('d')}`,
    [
      { name: 'docEntry', value: docEntry },
      { name: 'userId', value: userId },
    ]
  );
  if (rows.length === 0) throw new NotFoundError('Widget');
  return runWidgetQuery(rows[0].Query, rows[0].WidgetType, rows[0].UseSapConn, userId, userName);
}

// ---------------------------------------------------------------------------
// Dashboard Settings

/** Every widget with its roles (the Dashboard Settings list) */
export const WIDGET_SELECT = `
  SELECT d.DocEntry, d.WidgetCode, d.Title, d.WidgetType, d.Query, d.UseSapConn, d.Width, d.Sequence, d.ValueFormat,
         d.LinkPath, d.Remarks, d.IsActive, d.CreatedBy, d.CreatedDate, d.UpdatedBy, d.UpdatedDate,
         (SELECT STRING_AGG(o.RoleName, ', ') FROM FTS11DSH1 x JOIN FTS11OROL o ON o.DocEntry = x.RoleEntry WHERE x.DocEntry = d.DocEntry) AS RoleNames
  FROM FTS11ODSH d`;

export interface WidgetFields {
  widgetCode: string;
  title: string;
  widgetType: string;
  query: string;
  useSapConn: boolean;
  width: number;
  sequence: number;
  valueFormat: string;
  linkPath: string | null;
  remarks: string | null;
  isActive: boolean;
  roleIds: number[];
}

const text = (value: unknown) => String(value ?? '').trim();

/** Validate a create / update request body */
export function parseWidgetFields(body: Record<string, unknown>): WidgetFields {
  const widgetCode = text(body.widgetCode);
  if (!widgetCode) throw new ValidationError('Widget Code is required');
  if (widgetCode.length > 50) throw new ValidationError('Widget Code must be 50 characters or fewer');
  const title = text(body.title);
  if (!title) throw new ValidationError('Title is required');
  if (title.length > 100) throw new ValidationError('Title must be 100 characters or fewer');
  const widgetType = text(body.widgetType);
  if (!(WIDGET_TYPES as readonly string[]).includes(widgetType)) throw new ValidationError('Choose the Widget Type');
  const query = String(body.query ?? '').trim();
  if (!query) throw new ValidationError('Query is required');
  assertSelectQuery(query, 'Query');
  const width = Number(body.width);
  if (!(WIDTHS as readonly number[]).includes(width)) throw new ValidationError('Width must be a quarter, half or the whole row');
  const sequence = Number(body.sequence ?? 0);
  if (!Number.isInteger(sequence) || sequence < 0 || sequence > 9999) throw new ValidationError('Sequence must be a whole number from 0 to 9999');
  const valueFormat = text(body.valueFormat) || 'NUMBER';
  if (!(VALUE_FORMATS as readonly string[]).includes(valueFormat)) throw new ValidationError('Choose the Value Format');
  const linkPath = text(body.linkPath) || null;
  if (linkPath && (!linkPath.startsWith('/') || linkPath.length > 254)) throw new ValidationError('Link must be a portal page, e.g. /sales-orders');
  const remarks = text(body.remarks) || null;
  if (remarks && remarks.length > 254) throw new ValidationError('Remarks must be 254 characters or fewer');
  const roleIds = Array.isArray(body.roleIds) ? [...new Set(body.roleIds.map(Number).filter((n) => Number.isInteger(n) && n > 0))] : [];
  return { widgetCode, title, widgetType, query, useSapConn: body.useSapConn === true, width, sequence, valueFormat, linkPath, remarks, isActive: body.isActive !== false, roleIds };
}

/** Widget Code must be unique; checked here for a friendly message (the table also enforces it) */
export async function assertWidgetCodeAvailable(widgetCode: string, excludeDocEntry?: number): Promise<void> {
  const found = await db.query(`SELECT DocEntry FROM FTS11ODSH WHERE WidgetCode = @widgetCode AND DocEntry <> @exclude`, [
    { name: 'widgetCode', value: widgetCode },
    { name: 'exclude', value: excludeDocEntry ?? 0 },
  ]);
  if (found.length > 0) throw new ValidationError('Widget Code already exists');
}

/** The widget's columns as saved (create / update) */
export const widgetParams = (f: WidgetFields, userName: string) => [
  { name: 'widgetCode', value: f.widgetCode },
  { name: 'title', value: f.title },
  { name: 'widgetType', value: f.widgetType },
  { name: 'query', value: f.query },
  { name: 'useSapConn', value: f.useSapConn ? 1 : 0 },
  { name: 'width', value: f.width },
  { name: 'sequence', value: f.sequence },
  { name: 'valueFormat', value: f.valueFormat },
  { name: 'linkPath', value: f.linkPath },
  { name: 'remarks', value: f.remarks },
  { name: 'isActive', value: f.isActive ? 1 : 0 },
  { name: 'userName', value: userName },
];

/** Replace the widget's roles (inside the save's transaction) */
export async function saveWidgetRoles(docEntry: number, roleIds: number[], transaction: sql.Transaction): Promise<void> {
  await db.query(`DELETE FROM FTS11DSH1 WHERE DocEntry = @docEntry`, [{ name: 'docEntry', value: docEntry }], transaction);
  for (const roleId of roleIds) {
    await db.query(
      `INSERT INTO FTS11DSH1 (DocEntry, RoleEntry) VALUES (@docEntry, @roleId)`,
      [
        { name: 'docEntry', value: docEntry },
        { name: 'roleId', value: roleId },
      ],
      transaction
    );
  }
}

/** A widget with its roles (Dashboard Settings) */
export async function getWidgetDetail(docEntry: number) {
  const rows = await db.query(`${WIDGET_SELECT} WHERE d.DocEntry = @docEntry`, [{ name: 'docEntry', value: docEntry }]);
  if (rows.length === 0) throw new NotFoundError('Widget');
  const roles = await db.query(
    `SELECT o.DocEntry AS RoleEntry, o.RoleName, o.IsAdmin
     FROM FTS11DSH1 x JOIN FTS11OROL o ON o.DocEntry = x.RoleEntry
     WHERE x.DocEntry = @docEntry ORDER BY o.RoleName`,
    [{ name: 'docEntry', value: docEntry }]
  );
  return { ...rows[0], Roles: roles };
}

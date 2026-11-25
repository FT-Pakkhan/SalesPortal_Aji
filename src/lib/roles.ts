import type sql from 'mssql';
import { db } from './db';
import { NotFoundError, ValidationError } from './errors';
import { SCREEN_CODES, bestAccess } from './screens';
import type { MyAccess, ScreenAccess } from './screens';

// Roles (FTS11OROL), their users (FTS11ROL1) and screens (FTS11ROL2).
// A user may have several roles: per screen the best access wins; any administrator role = administrator.
// A user with no role has no access (Dashboard, My Profile and Approvals are always there).

export const ROLE_SELECT = `
  SELECT r.DocEntry, r.RoleName, r.IsAdmin,
         (SELECT COUNT(*) FROM FTS11ROL1 a WHERE a.DocEntry = r.DocEntry) AS UserCount
  FROM FTS11OROL r`;

export interface RoleFields {
  roleName: string;
  isAdmin: boolean;
  userIds: number[];
  screens: { screenCode: string; access: ScreenAccess }[];
  /**
   * Reports this role may run (FTS11RPT2, the same rows as the report's Roles tab in Report Settings);
   * undefined = not sent, leave them as they are
   */
  reportIds?: number[];
}

const ACCESS: ScreenAccess[] = ['FULL', 'READ', 'NONE'];

/** Validate a create / update request body */
export function parseRoleFields(body: Record<string, unknown>): RoleFields {
  const roleName = String(body.roleName ?? '').trim();
  if (!roleName) throw new ValidationError('Role Name is required');
  if (roleName.length > 100) throw new ValidationError('Role Name must be 100 characters or fewer');

  const rawIds = Array.isArray(body.userIds) ? body.userIds : [];
  const userIds = [...new Set(rawIds.map((id) => Number(id)))];
  if (userIds.some((id) => !Number.isInteger(id) || id <= 0)) throw new ValidationError('User list is not valid');

  const rawScreens = Array.isArray(body.screens) ? (body.screens as Record<string, unknown>[]) : [];
  const screens = rawScreens.map((s) => {
    const screenCode = String(s.screenCode ?? '');
    const access = String(s.access ?? '') as ScreenAccess;
    if (!SCREEN_CODES.has(screenCode)) throw new ValidationError(`Screen ${screenCode} is not a portal screen`);
    if (!ACCESS.includes(access)) throw new ValidationError(`Access for ${screenCode} is not valid`);
    return { screenCode, access };
  });
  if (new Set(screens.map((s) => s.screenCode)).size !== screens.length) throw new ValidationError('A screen is listed twice');

  let reportIds: number[] | undefined;
  if (Array.isArray(body.reportIds)) {
    reportIds = [...new Set(body.reportIds.map((id) => Number(id)))];
    if (reportIds.some((id) => !Number.isInteger(id) || id <= 0)) throw new ValidationError('Report list is not valid');
  }

  return { roleName, isAdmin: body.isAdmin === true, userIds, screens, reportIds };
}

/** Every report must exist */
export async function assertReportsExist(reportIds: number[] | undefined): Promise<void> {
  if (!reportIds || reportIds.length === 0) return;
  const found = await db.query(
    `SELECT DocEntry FROM FTS11SRPT WHERE DocEntry IN (${reportIds.map((_, i) => `@r${i}`).join(', ')})`,
    reportIds.map((id, i) => ({ name: `r${i}`, value: id }))
  );
  if (found.length !== reportIds.length) throw new ValidationError('One or more reports no longer exist');
}

/** Role Name must be unique; checked here for a friendly message (the table also enforces it) */
export async function assertRoleNameAvailable(roleName: string, excludeDocEntry?: number): Promise<void> {
  const existing = await db.query(`SELECT DocEntry FROM FTS11OROL WHERE RoleName = @roleName AND DocEntry <> @exclude`, [
    { name: 'roleName', value: roleName },
    { name: 'exclude', value: excludeDocEntry ?? 0 },
  ]);
  if (existing.length > 0) throw new ValidationError('Role Name already exists');
}

/** Every user must exist */
export async function assertUsersExist(userIds: number[]): Promise<void> {
  if (userIds.length === 0) return;
  const found = await db.query(
    `SELECT DocEntry FROM SystemUsers WHERE DocEntry IN (${userIds.map((_, i) => `@u${i}`).join(', ')})`,
    userIds.map((id, i) => ({ name: `u${i}`, value: id }))
  );
  if (found.length !== userIds.length) throw new ValidationError('One or more users no longer exist');
}

/** Replace a role's users and screens (inside the save's transaction). NONE rows aren't stored (no row = NONE). */
export async function saveRoleLines(docEntry: number, fields: RoleFields, transaction: sql.Transaction): Promise<void> {
  const key = [{ name: 'docEntry', value: docEntry }];
  await db.query(`DELETE FROM FTS11ROL1 WHERE DocEntry = @docEntry`, key, transaction);
  await db.query(`DELETE FROM FTS11ROL2 WHERE DocEntry = @docEntry`, key, transaction);
  for (const userId of fields.userIds) {
    await db.query(`INSERT INTO FTS11ROL1 (DocEntry, UserID) VALUES (@docEntry, @userId)`, [...key, { name: 'userId', value: userId }], transaction);
  }
  for (const s of fields.screens.filter((x) => x.access !== 'NONE')) {
    await db.query(
      `INSERT INTO FTS11ROL2 (DocEntry, ScreenCode, Access) VALUES (@docEntry, @screenCode, @access)`,
      [...key, { name: 'screenCode', value: s.screenCode }, { name: 'access', value: s.access }],
      transaction
    );
  }
  if (fields.reportIds) {
    await db.query(`DELETE FROM FTS11RPT2 WHERE RoleEntry = @docEntry`, key, transaction);
    for (const reportId of fields.reportIds) {
      await db.query(`INSERT INTO FTS11RPT2 (DocEntry, RoleEntry) VALUES (@reportId, @docEntry)`, [...key, { name: 'reportId', value: reportId }], transaction);
    }
  }
}

/**
 * At least one active user must stay an administrator, or nobody could open Role again. Checked inside the save's
 * transaction, after the change.
 */
export async function assertAdministratorRemains(transaction: sql.Transaction): Promise<void> {
  const rows = await db.query<{ Admins: number }>(
    `SELECT COUNT(DISTINCT u.DocEntry) AS Admins
     FROM FTS11OROL r
     JOIN FTS11ROL1 a ON a.DocEntry = r.DocEntry
     JOIN SystemUsers u ON u.DocEntry = a.UserID
     WHERE r.IsAdmin = 1 AND u.IsActive = 1`,
    [],
    transaction
  );
  if ((rows[0]?.Admins ?? 0) === 0) {
    throw new ValidationError('At least one active user must stay in an administrator role, or nobody could manage roles');
  }
}

/** A role with its users and screens (every portal screen; a screen without a row is NONE) */
export async function getRoleDetail(docEntry: number) {
  const roles = await db.query(`${ROLE_SELECT} WHERE r.DocEntry = @docEntry`, [{ name: 'docEntry', value: docEntry }]);
  if (roles.length === 0) throw new NotFoundError('Role');
  const users = await db.query(
    `SELECT u.DocEntry AS UserId, u.UserName, u.DisplayName, CAST(ISNULL(u.IsActive, 0) AS BIT) AS IsActive
     FROM FTS11ROL1 a JOIN SystemUsers u ON u.DocEntry = a.UserID
     WHERE a.DocEntry = @docEntry ORDER BY u.UserName`,
    [{ name: 'docEntry', value: docEntry }]
  );
  const screens = await db.query<{ ScreenCode: string; Access: ScreenAccess }>(
    `SELECT ScreenCode, Access FROM FTS11ROL2 WHERE DocEntry = @docEntry`,
    [{ name: 'docEntry', value: docEntry }]
  );
  // Every report, and whether this role may run it (Screens Permission lists them under "Reports")
  const reports = await db.query(
    `SELECT r.DocEntry AS ReportEntry, r.ReportName, r.Category, r.IsActive,
            CAST(CASE WHEN EXISTS (SELECT 1 FROM FTS11RPT2 x WHERE x.DocEntry = r.DocEntry AND x.RoleEntry = @docEntry) THEN 1 ELSE 0 END AS BIT) AS Allowed
     FROM FTS11SRPT r
     ORDER BY ISNULL(r.Category, ''), r.ReportName`,
    [{ name: 'docEntry', value: docEntry }]
  );
  return { ...roles[0], Users: users, Screens: screens, Reports: reports };
}

/** What a user may do: the best access over all their roles; administrator if any role is */
export async function getUserAccess(userId: number): Promise<MyAccess> {
  const rows = await db.query<{ IsAdmin: boolean; ScreenCode: string | null; Access: ScreenAccess | null }>(
    `SELECT r.IsAdmin, s.ScreenCode, s.Access
     FROM FTS11ROL1 a
     JOIN FTS11OROL r ON r.DocEntry = a.DocEntry
     LEFT JOIN FTS11ROL2 s ON s.DocEntry = r.DocEntry
     WHERE a.UserID = @userId`,
    [{ name: 'userId', value: userId }]
  );
  const screens: Record<string, ScreenAccess> = {};
  for (const row of rows) {
    if (row.ScreenCode && row.Access) screens[row.ScreenCode] = bestAccess(screens[row.ScreenCode] ?? 'NONE', row.Access);
  }
  return { isAdmin: rows.some((r) => r.IsAdmin), screens };
}

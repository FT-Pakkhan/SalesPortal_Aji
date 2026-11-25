import { db } from './db';
import { ValidationError } from './errors';
import { sapTable } from './sapDb';

/**
 * Columns returned for a user — never includes PasswordHash. The Sales Employee name comes from SAP B1 (OSLP),
 * looked up in a subquery so callers' WHERE / ORDER BY on SystemUsers columns stay unambiguous.
 * A function because the SAP database name comes from .env.local.
 */
export const userSelect = () => `
  SELECT DocEntry AS Id, UserName, DisplayName, Email, SlpCode,
         (SELECT sp.SlpName FROM ${sapTable('OSLP')} sp WHERE sp.SlpCode = SystemUsers.SlpCode) AS SlpName,
         Branch,
         -- COLLATE: the SAP company database and the portal's compare text differently
         (SELECT oc.OcrName FROM ${sapTable('OOCR')} oc WHERE oc.DimCode = 1 AND oc.OcrCode = SystemUsers.Branch COLLATE DATABASE_DEFAULT) AS BranchName,
         CAST(ISNULL(IsActive, 0) AS BIT) AS IsActive,
         CAST(CASE WHEN ISNULL(PasswordHash, '') = '' THEN 0 ELSE 1 END AS BIT) AS HasPassword,
         ChgPwdOnLogon
  FROM SystemUsers`;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface UserFields {
  userName?: string;
  displayName?: string | null;
  email?: string | null;
  /** SAP B1 Sales Employee (OSLP.SlpCode); null = none */
  slpCode?: number | null;
  /** Branch: SAP cost centre of Dimension 1 (OOCR.OcrCode); null = none */
  branch?: string | null;
  isActive?: boolean;
  /** Must choose a new password after signing in */
  chgPwdOnLogon?: boolean;
}

/** Validate the user fields present in a request body; fields not sent stay undefined */
export function parseUserFields(body: Record<string, unknown>): UserFields {
  const fields: UserFields = {};

  if (body.userName !== undefined) {
    const userName = String(body.userName).trim();
    if (!userName) throw new ValidationError('User name is required');
    if (userName.length > 50) throw new ValidationError('User name must be 50 characters or fewer');
    fields.userName = userName;
  }
  if (body.displayName !== undefined) {
    const displayName = String(body.displayName ?? '').trim();
    if (displayName.length > 100) throw new ValidationError('Display name must be 100 characters or fewer');
    fields.displayName = displayName || null;
  }
  if (body.email !== undefined) {
    const email = String(body.email ?? '').trim();
    if (email.length > 200) throw new ValidationError('Email must be 200 characters or fewer');
    if (email && !EMAIL_PATTERN.test(email)) throw new ValidationError('Email is not valid');
    fields.email = email || null;
  }
  if (body.slpCode !== undefined) {
    const slpCode = body.slpCode === null || body.slpCode === '' ? null : Number(body.slpCode);
    if (slpCode !== null && !Number.isInteger(slpCode)) throw new ValidationError('Sales Employee is not valid');
    fields.slpCode = slpCode;
  }
  if (body.branch !== undefined) {
    const branch = String(body.branch ?? '').trim();
    if (branch.length > 8) throw new ValidationError('Branch is not valid');
    fields.branch = branch || null;
  }
  if (body.isActive !== undefined) {
    fields.isActive = Boolean(body.isActive);
  }
  if (body.chgPwdOnLogon !== undefined) {
    fields.chgPwdOnLogon = Boolean(body.chgPwdOnLogon);
  }

  return fields;
}

/** The Sales Employee must exist in SAP B1 (OSLP) — another database, so no foreign key */
export async function assertSalesEmployeeExists(slpCode: number | null | undefined): Promise<void> {
  if (slpCode === null || slpCode === undefined) return;
  const found = await db.query(`SELECT SlpCode FROM ${sapTable('OSLP')} WHERE SlpCode = @slpCode`, [
    { name: 'slpCode', value: slpCode },
  ]);
  if (found.length === 0) throw new ValidationError('Sales Employee does not exist in SAP');
}

/** A Branch must be an active SAP cost centre of Dimension 1 (OOCR) — another database, so no foreign key */
export async function assertBranchExists(branch: string | null | undefined): Promise<void> {
  if (branch === null || branch === undefined) return;
  const found = await db.query(
    `SELECT OcrCode FROM ${sapTable('OOCR')} WHERE DimCode = 1 AND ISNULL(Active, 'Y') = 'Y' AND OcrCode = @branch`,
    [{ name: 'branch', value: branch }]
  );
  if (found.length === 0) throw new ValidationError('Branch is not an active SAP cost centre of Dimension 1');
}

/** SystemUsers has no unique constraint on UserName, so uniqueness is enforced here */
export async function assertUserNameAvailable(userName: string, excludeId?: number): Promise<void> {
  const existing = await db.query<{ Id: number }>(
    `SELECT DocEntry AS Id FROM SystemUsers WHERE UserName = @userName AND DocEntry <> @excludeId`,
    [
      { name: 'userName', value: userName },
      { name: 'excludeId', value: excludeId ?? 0 },
    ]
  );
  if (existing.length > 0) throw new ValidationError('User name already exists');
}

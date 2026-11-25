import { NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';
import { db, findCompany } from '@/lib/db';
import { generateToken } from '@/lib/auth';
import { isMultiCompany, runInCompany } from '@/lib/companyContext';
import { successResponse, errorResponse } from '@/lib/apiResponse';
import { ValidationError } from '@/lib/errors';

interface SystemUserRow {
  Id: number;
  UserName: string;
  DisplayName: string | null;
  PasswordHash: string | null;
  Email: string | null;
  IsActive: boolean | null;
  ChgPwdOnLogon: boolean;
}

// POST /api/auth - Login (several companies: in the company chosen, its database in `company`)
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const userName = typeof body.userName === 'string' ? body.userName.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';

    if (!userName) {
      throw new ValidationError('User name is required');
    }

    if (!isMultiCompany()) return successResponse(await logIn(userName, password));

    const database = typeof body.company === 'string' ? body.company : '';
    if (!database) throw new ValidationError('Please choose the company');
    const company = await findCompany(database);
    if (!company) throw new ValidationError('That company is not in the company list');
    // The user is looked up in that company's own users
    const result = await runInCompany({ database: company.database, sapDatabase: null }, () =>
      logIn(userName, password, company)
    );
    return successResponse(result);
  } catch (error) {
    return errorResponse(error);
  }
}

async function logIn(userName: string, password: string, company?: { database: string; name: string }) {
  const users = await db.query<SystemUserRow>(
    `SELECT DocEntry AS Id, UserName, DisplayName, PasswordHash, Email, IsActive, ChgPwdOnLogon
     FROM SystemUsers
     WHERE UserName = @userName`,
    [{ name: 'userName', value: userName }]
  );

  if (users.length === 0) {
    throw new ValidationError('Invalid user name or password');
  }

  const user = users[0];

  if (!user.IsActive) {
    throw new ValidationError('Account is inactive. Please contact administrator.');
  }

  // A user with no password set (NULL/empty PasswordHash) logs in with a blank password
  const isPasswordValid = user.PasswordHash
    ? await bcrypt.compare(password, user.PasswordHash)
    : password === '';
  if (!isPasswordValid) {
    throw new ValidationError('Invalid user name or password');
  }

  // Update last login
  await db.query(
    `UPDATE SystemUsers SET LastLoginDate = GETDATE() WHERE DocEntry = @id`,
    [{ name: 'id', value: user.Id }]
  );

  // Several companies: the company's SAP database (General Settings) goes into the token, so SAP data is read
  // from the right company on every request
  let sapDb: string | null = null;
  if (company) {
    const settings = await db.query<{ SapCompanyDB: string | null }>(`SELECT SapCompanyDB FROM FTS11OADM WHERE DocEntry = 1`);
    sapDb = settings[0]?.SapCompanyDB || null;
  }

  const token = generateToken({
    userId: user.Id,
    userName: user.UserName,
    displayName: user.DisplayName,
    ...(company ? { company: company.database, sapDb } : {}),
  });

  return {
    token,
    user: {
      id: user.Id,
      userName: user.UserName,
      displayName: user.DisplayName,
      email: user.Email,
      // The portal sends the user to Change Password first
      chgPwdOnLogon: !!user.ChgPwdOnLogon,
      // Shown in the shell bar
      company: company ? { database: company.database, name: company.name } : null,
    },
  };
}

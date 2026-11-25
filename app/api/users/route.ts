import { NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';
import sql from 'mssql';
import { db } from '@/lib/db';
import { authenticateRequest } from '@/lib/auth';
import { successResponse, errorResponse } from '@/lib/apiResponse';
import { ValidationError } from '@/lib/errors';
import { userSelect, parseUserFields, assertUserNameAvailable, assertSalesEmployeeExists, assertBranchExists } from '@/lib/systemUsers';

// GET /api/users - List users (any logged-in user; no roles yet)
export async function GET(request: NextRequest) {
  try {
    authenticateRequest(request);

    const search = request.nextUrl.searchParams.get('search');

    const whereClause: string[] = ['1=1'];
    const params: { name: string; value: unknown }[] = [];

    if (search) {
      whereClause.push('(UserName LIKE @search OR DisplayName LIKE @search OR Email LIKE @search)');
      params.push({ name: 'search', value: `%${search}%` });
    }

    const data = await db.query(
      `${userSelect()}
       WHERE ${whereClause.join(' AND ')}
       ORDER BY UserName`,
      params
    );

    return successResponse(data);
  } catch (error) {
    return errorResponse(error);
  }
}

// POST /api/users - Create new user (any logged-in user; no roles yet)
export async function POST(request: NextRequest) {
  try {
    const user = authenticateRequest(request);
    const body = await request.json();

    const fields = parseUserFields(body);
    if (!fields.userName) throw new ValidationError('User name is required');
    if (typeof body.password !== 'string' || body.password.length < 6) {
      throw new ValidationError('Password must be at least 6 characters');
    }

    await assertUserNameAvailable(fields.userName);
    await assertSalesEmployeeExists(fields.slpCode);
    await assertBranchExists(fields.branch);

    const passwordHash = await bcrypt.hash(body.password, 10);

    const result = await db.query<{ Id: number }>(
      `INSERT INTO SystemUsers
       (UserName, DisplayName, PasswordHash, Email, SlpCode, Branch, IsActive, ChgPwdOnLogon, CreatedBy, CreatedDate, UpdatedBy, UpdatedDate)
       OUTPUT INSERTED.DocEntry AS Id
       VALUES
       (@userName, @displayName, @hash, @email, @slpCode, @branch, @isActive, @chgPwdOnLogon, @createdBy, GETDATE(), @createdBy, GETDATE())`,
      [
        { name: 'userName', value: fields.userName },
        { name: 'displayName', value: fields.displayName ?? null },
        { name: 'hash', value: passwordHash },
        { name: 'email', value: fields.email ?? null },
        { name: 'slpCode', type: sql.Int, value: fields.slpCode ?? null },
        { name: 'branch', type: sql.NVarChar(8), value: fields.branch ?? null },
        { name: 'isActive', value: fields.isActive === false ? 0 : 1 },
        { name: 'chgPwdOnLogon', value: fields.chgPwdOnLogon ? 1 : 0 },
        { name: 'createdBy', value: user.userName },
      ]
    );

    const created = await db.query(
      `${userSelect()} WHERE DocEntry = @id`,
      [{ name: 'id', value: result[0].Id }]
    );

    return successResponse(created[0], 'User created', 201);
  } catch (error) {
    return errorResponse(error);
  }
}

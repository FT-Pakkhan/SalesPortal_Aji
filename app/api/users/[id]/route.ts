import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { authenticateRequest } from '@/lib/auth';
import { successResponse, errorResponse } from '@/lib/apiResponse';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { userSelect, parseUserFields, assertUserNameAvailable, assertSalesEmployeeExists, assertBranchExists } from '@/lib/systemUsers';

interface RouteContext {
  params: Promise<{ id: string }>;
}

// GET /api/users/[id] (any logged-in user; no roles yet)
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    authenticateRequest(request);
    const { id } = await context.params;
    const userId = parseInt(id);

    const rows = await db.query(
      `${userSelect()} WHERE DocEntry = @id`,
      [{ name: 'id', value: userId }]
    );

    if (rows.length === 0) throw new NotFoundError('User');

    return successResponse(rows[0]);
  } catch (error) {
    return errorResponse(error);
  }
}

// PUT /api/users/[id] (any logged-in user; no roles yet)
export async function PUT(request: NextRequest, context: RouteContext) {
  try {
    const user = authenticateRequest(request);
    const { id } = await context.params;
    const userId = parseInt(id);
    const body = await request.json();

    // Check user exists
    const existing = await db.query<{ Id: number }>(
      `SELECT DocEntry AS Id FROM SystemUsers WHERE DocEntry = @id`,
      [{ name: 'id', value: userId }]
    );
    if (existing.length === 0) throw new NotFoundError('User');

    const fields = parseUserFields(body);

    const updateFields: string[] = ['UpdatedBy = @updatedBy', 'UpdatedDate = GETDATE()'];
    const params: { name: string; value: unknown }[] = [
      { name: 'id', value: userId },
      { name: 'updatedBy', value: user.userName },
    ];

    if (fields.userName !== undefined) {
      await assertUserNameAvailable(fields.userName, userId);
      updateFields.push('UserName = @userName');
      params.push({ name: 'userName', value: fields.userName });
    }
    if (fields.displayName !== undefined) {
      updateFields.push('DisplayName = @displayName');
      params.push({ name: 'displayName', value: fields.displayName });
    }
    if (fields.email !== undefined) {
      updateFields.push('Email = @email');
      params.push({ name: 'email', value: fields.email });
    }
    if (fields.slpCode !== undefined) {
      await assertSalesEmployeeExists(fields.slpCode);
      updateFields.push('SlpCode = @slpCode');
      params.push({ name: 'slpCode', value: fields.slpCode });
    }
    if (fields.branch !== undefined) {
      await assertBranchExists(fields.branch);
      updateFields.push('Branch = @branch');
      params.push({ name: 'branch', value: fields.branch });
    }
    if (fields.isActive !== undefined) {
      // Prevent locking yourself out
      if (!fields.isActive && user.userId === userId) {
        throw new ValidationError('You cannot deactivate your own account');
      }
      updateFields.push('IsActive = @isActive');
      params.push({ name: 'isActive', value: fields.isActive ? 1 : 0 });
    }

    if (fields.chgPwdOnLogon !== undefined) {
      updateFields.push('ChgPwdOnLogon = @chgPwdOnLogon');
      params.push({ name: 'chgPwdOnLogon', value: fields.chgPwdOnLogon ? 1 : 0 });
    }

    await db.query(
      `UPDATE SystemUsers SET ${updateFields.join(', ')} WHERE DocEntry = @id`,
      params
    );

    const updated = await db.query(
      `${userSelect()} WHERE DocEntry = @id`,
      [{ name: 'id', value: userId }]
    );

    return successResponse(updated[0], 'User updated');
  } catch (error) {
    return errorResponse(error);
  }
}

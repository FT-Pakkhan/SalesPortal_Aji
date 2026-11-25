import { NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';
import { db } from '@/lib/db';
import { authenticateRequest } from '@/lib/auth';
import { successResponse, errorResponse } from '@/lib/apiResponse';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { userSelect } from '@/lib/systemUsers';

interface RouteContext {
  params: Promise<{ id: string }>;
}

// POST /api/users/[id]/reset-password - A forgotten password: set a new one for the user (Users screen)
//   body { newPassword: '' (no password) or at least 6 characters, chgPwdOnLogon: true / false }
//   No current password is needed: this is the administrator's reset, not the user's own change.
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const user = authenticateRequest(request);
    const { id } = await context.params;
    const userId = parseInt(id);
    const body = (await request.json()) as { newPassword?: unknown; chgPwdOnLogon?: unknown };

    const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';
    if (newPassword && newPassword.length < 6) throw new ValidationError('New password must be at least 6 characters');
    const chgPwdOnLogon = body.chgPwdOnLogon !== false;

    const existing = await db.query(`SELECT DocEntry FROM SystemUsers WHERE DocEntry = @id`, [{ name: 'id', value: userId }]);
    if (existing.length === 0) throw new NotFoundError('User');

    // Blank = no password (signs in with the user name only)
    const hash = newPassword ? await bcrypt.hash(newPassword, 10) : null;
    await db.query(
      `UPDATE SystemUsers
       SET PasswordHash = @hash, ChgPwdOnLogon = @chgPwdOnLogon, UpdatedBy = @updatedBy, UpdatedDate = GETDATE()
       WHERE DocEntry = @id`,
      [
        { name: 'id', value: userId },
        { name: 'hash', value: hash },
        { name: 'chgPwdOnLogon', value: chgPwdOnLogon ? 1 : 0 },
        { name: 'updatedBy', value: user.userName },
      ]
    );

    const updated = await db.query(`${userSelect()} WHERE DocEntry = @id`, [{ name: 'id', value: userId }]);
    return successResponse(updated[0], 'Password reset');
  } catch (error) {
    return errorResponse(error);
  }
}

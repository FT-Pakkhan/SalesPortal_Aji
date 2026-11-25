import { NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';
import { db } from '@/lib/db';
import { authenticateRequest } from '@/lib/auth';
import { successResponse, errorResponse } from '@/lib/apiResponse';
import { ValidationError, NotFoundError } from '@/lib/errors';

interface RouteContext {
  params: Promise<{ id: string }>;
}

// POST /api/users/[id]/change-password - User changes own password
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const user = authenticateRequest(request);
    const { id } = await context.params;
    const userId = parseInt(id);

    // Only the user themselves can change their password
    if (user.userId !== userId) {
      throw new ValidationError('You can only change your own password');
    }

    const body = await request.json();

    if (typeof body.newPassword !== 'string' || body.newPassword.length < 6) {
      throw new ValidationError('New password must be at least 6 characters');
    }

    const rows = await db.query<{ PasswordHash: string | null; ChgPwdOnLogon: boolean }>(
      `SELECT PasswordHash, ChgPwdOnLogon FROM SystemUsers WHERE DocEntry = @id`,
      [{ name: 'id', value: userId }]
    );
    if (rows.length === 0) throw new NotFoundError('User');

    // A user with no password set has no current password to verify; nor one who must change it now (they have just
    // signed in with it)
    const storedHash = rows[0].PasswordHash;
    if (storedHash && !rows[0].ChgPwdOnLogon) {
      if (!body.currentPassword) throw new ValidationError('Current password is required');
      const valid = await bcrypt.compare(String(body.currentPassword), storedHash);
      if (!valid) throw new ValidationError('Current password is incorrect');
    }

    const hash = await bcrypt.hash(body.newPassword, 10);

    await db.query(
      `UPDATE SystemUsers SET PasswordHash = @hash, ChgPwdOnLogon = 0, UpdatedBy = @updatedBy, UpdatedDate = GETDATE()
       WHERE DocEntry = @id`,
      [
        { name: 'id', value: userId },
        { name: 'hash', value: hash },
        { name: 'updatedBy', value: user.userName },
      ]
    );

    return successResponse(null, 'Password changed successfully');
  } catch (error) {
    return errorResponse(error);
  }
}

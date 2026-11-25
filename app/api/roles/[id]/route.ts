import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { authenticateRequest } from '@/lib/auth';
import { successResponse, errorResponse } from '@/lib/apiResponse';
import { NotFoundError } from '@/lib/errors';
import {
  parseRoleFields,
  assertRoleNameAvailable,
  assertUsersExist,
  assertReportsExist,
  saveRoleLines,
  assertAdministratorRemains,
  getRoleDetail,
} from '@/lib/roles';

interface RouteContext {
  params: Promise<{ id: string }>;
}

// GET /api/roles/[id] - A role with its users and screens
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    authenticateRequest(request);
    const { id } = await context.params;
    return successResponse(await getRoleDetail(parseInt(id)));
  } catch (error) {
    return errorResponse(error);
  }
}

// PUT /api/roles/[id] - Update a role and replace its users and screens; at least one active administrator must remain
export async function PUT(request: NextRequest, context: RouteContext) {
  try {
    const user = authenticateRequest(request);
    const { id } = await context.params;
    const docEntry = parseInt(id);
    const fields = parseRoleFields(await request.json());

    const existing = await db.query(`SELECT DocEntry FROM FTS11OROL WHERE DocEntry = @docEntry`, [{ name: 'docEntry', value: docEntry }]);
    if (existing.length === 0) throw new NotFoundError('Role');
    await assertRoleNameAvailable(fields.roleName, docEntry);
    await assertUsersExist(fields.userIds);
    await assertReportsExist(fields.reportIds);

    const transaction = await db.beginTransaction();
    try {
      await db.query(
        `UPDATE FTS11OROL SET RoleName = @roleName, IsAdmin = @isAdmin, UpdatedBy = @userName, UpdatedDate = GETDATE()
         WHERE DocEntry = @docEntry`,
        [
          { name: 'docEntry', value: docEntry },
          { name: 'roleName', value: fields.roleName },
          { name: 'isAdmin', value: fields.isAdmin ? 1 : 0 },
          { name: 'userName', value: user.userName },
        ],
        transaction
      );
      await saveRoleLines(docEntry, fields, transaction);
      await assertAdministratorRemains(transaction);
      await db.commitTransaction(transaction);
    } catch (error) {
      await db.rollbackTransaction(transaction);
      throw error;
    }
    return successResponse(await getRoleDetail(docEntry), 'Role updated');
  } catch (error) {
    return errorResponse(error);
  }
}

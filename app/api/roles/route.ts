import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { authenticateRequest } from '@/lib/auth';
import { successResponse, errorResponse } from '@/lib/apiResponse';
import {
  ROLE_SELECT,
  parseRoleFields,
  assertRoleNameAvailable,
  assertUsersExist,
  assertReportsExist,
  saveRoleLines,
  getRoleDetail,
} from '@/lib/roles';

// GET /api/roles - All roles
export async function GET(request: NextRequest) {
  try {
    authenticateRequest(request);
    return successResponse(await db.query(`${ROLE_SELECT} ORDER BY r.RoleName`));
  } catch (error) {
    return errorResponse(error);
  }
}

// POST /api/roles - A new role with its users and screens: { roleName, isAdmin, userIds, screens: [{ screenCode, access }] }
export async function POST(request: NextRequest) {
  try {
    const user = authenticateRequest(request);
    const fields = parseRoleFields(await request.json());
    await assertRoleNameAvailable(fields.roleName);
    await assertUsersExist(fields.userIds);
    await assertReportsExist(fields.reportIds);

    const transaction = await db.beginTransaction();
    let docEntry: number;
    try {
      const result = await db.query<{ DocEntry: number }>(
        `INSERT INTO FTS11OROL (RoleName, IsAdmin, CreatedBy, CreatedDate, UpdatedBy, UpdatedDate)
         OUTPUT INSERTED.DocEntry
         VALUES (@roleName, @isAdmin, @userName, GETDATE(), @userName, GETDATE())`,
        [
          { name: 'roleName', value: fields.roleName },
          { name: 'isAdmin', value: fields.isAdmin ? 1 : 0 },
          { name: 'userName', value: user.userName },
        ],
        transaction
      );
      docEntry = result[0].DocEntry;
      await saveRoleLines(docEntry, fields, transaction);
      await db.commitTransaction(transaction);
    } catch (error) {
      await db.rollbackTransaction(transaction);
      throw error;
    }
    return successResponse(await getRoleDetail(docEntry), 'Role created', 201);
  } catch (error) {
    return errorResponse(error);
  }
}

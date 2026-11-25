import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { authenticateRequest } from '@/lib/auth';
import { successResponse, errorResponse } from '@/lib/apiResponse';
import { sapDatabase, sapTable } from '@/lib/sapDb';

// GET /api/sap/warehouses - Active warehouses from SAP B1 (OWHS), with the company's own fields Branch (U_Branch, a
// Dimension 1 cost centre code) and Default (U_Default = 'Y'): a sales document line gets its Branch's default
// warehouse. A company without those fields gets null / false.
export async function GET(request: NextRequest) {
  try {
    authenticateRequest(request);
    const [check] = await db.query<{ HasBranch: number | null; HasDefault: number | null }>(
      `SELECT COL_LENGTH(@owhs, 'U_Branch') AS HasBranch, COL_LENGTH(@owhs, 'U_Default') AS HasDefault`,
      [{ name: 'owhs', value: `[${sapDatabase()}].dbo.OWHS` }]
    );
    const branch = check?.HasBranch != null ? 'U_Branch' : 'CAST(NULL AS NVARCHAR(10))';
    const isDefault = check?.HasBranch != null && check?.HasDefault != null ? "CAST(CASE WHEN U_Default = 'Y' THEN 1 ELSE 0 END AS BIT)" : 'CAST(0 AS BIT)';
    const data = await db.query(
      `SELECT WhsCode, WhsName, ${branch} AS Branch, ${isDefault} AS IsDefault
       FROM ${sapTable('OWHS')}
       WHERE ISNULL(Inactive, 'N') <> 'Y'
       ORDER BY WhsCode`
    );
    return successResponse(data);
  } catch (error) {
    return errorResponse(error);
  }
}

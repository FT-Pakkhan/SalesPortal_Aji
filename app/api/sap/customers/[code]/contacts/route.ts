import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { authenticateRequest } from '@/lib/auth';
import { successResponse, errorResponse } from '@/lib/apiResponse';
import { sapTable } from '@/lib/sapDb';

interface RouteContext {
  params: Promise<{ code: string }>;
}

// GET /api/sap/customers/[code]/contacts - Contact persons of a SAP B1 customer (OCPR)
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    authenticateRequest(request);
    const { code } = await context.params;
    const data = await db.query(
      `SELECT CntctCode, Name
       FROM ${sapTable('OCPR')}
       WHERE CardCode = @cardCode AND ISNULL(Active, 'Y') = 'Y'
       ORDER BY Name`,
      [{ name: 'cardCode', value: decodeURIComponent(code) }]
    );
    return successResponse(data);
  } catch (error) {
    return errorResponse(error);
  }
}

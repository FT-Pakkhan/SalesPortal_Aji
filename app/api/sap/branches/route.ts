import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { authenticateRequest } from '@/lib/auth';
import { successResponse, errorResponse } from '@/lib/apiResponse';
import { sapTable } from '@/lib/sapDb';

// GET /api/sap/branches - Branches: active SAP B1 cost centres of Dimension 1 (OOCR, DimCode 1)
export async function GET(request: NextRequest) {
  try {
    authenticateRequest(request);
    const data = await db.query(
      `SELECT OcrCode, OcrName
       FROM ${sapTable('OOCR')}
       WHERE DimCode = 1 AND ISNULL(Active, 'Y') = 'Y'
       ORDER BY OcrCode`
    );
    return successResponse(data);
  } catch (error) {
    return errorResponse(error);
  }
}

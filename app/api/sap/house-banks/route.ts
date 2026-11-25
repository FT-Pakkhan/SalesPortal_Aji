import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { authenticateRequest } from '@/lib/auth';
import { successResponse, errorResponse } from '@/lib/apiResponse';
import { sapTable } from '@/lib/sapDb';

// GET /api/sap/house-banks - The company's own bank accounts in SAP B1 (house bank accounts, DSC1), e.g. for the bank a
// customer's bank transfer went to
export async function GET(request: NextRequest) {
  try {
    authenticateRequest(request);
    const data = await db.query(
      `SELECT b.AbsEntry, b.BankCode, b.Account, b.GLAccount, d.BankName
       FROM ${sapTable('DSC1')} b
       LEFT JOIN ${sapTable('ODSC')} d ON d.BankCode = b.BankCode
       ORDER BY b.BankCode, b.Account`
    );
    return successResponse(data);
  } catch (error) {
    return errorResponse(error);
  }
}

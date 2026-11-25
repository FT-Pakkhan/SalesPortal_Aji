import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { authenticateRequest } from '@/lib/auth';
import { successResponse, errorResponse } from '@/lib/apiResponse';
import { sapTable } from '@/lib/sapDb';

// GET /api/sap/payment-accounts - Choices for General Settings > Incoming Payment: SAP's active postable G/L accounts
// (OACT, for cash / cheques) and its credit cards (OCRC)
export async function GET(request: NextRequest) {
  try {
    authenticateRequest(request);
    const [accounts, creditCards] = await Promise.all([
      db.query(
        `SELECT AcctCode, AcctName FROM ${sapTable('OACT')}
         WHERE Postable = 'Y' AND ISNULL(FrozenFor, 'N') <> 'Y'
         ORDER BY AcctCode`
      ),
      db.query(`SELECT CreditCard, CardName FROM ${sapTable('OCRC')} ORDER BY CardName`),
    ]);
    return successResponse({ accounts, creditCards });
  } catch (error) {
    return errorResponse(error);
  }
}

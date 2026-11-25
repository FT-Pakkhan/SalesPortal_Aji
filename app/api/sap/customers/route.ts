import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { authenticateRequest } from '@/lib/auth';
import { successResponse, errorResponse } from '@/lib/apiResponse';
import { sapColumnOr, sapTable } from '@/lib/sapDb';

// GET /api/sap/customers - Active SAP B1 customers (OCRD, CardType 'C') for the customer lookup.
// GroupNum: payment terms (OCTG), the default of a sales document's Payment Terms.
// CustType: the Customer Type UDF (U_CustType, e.g. LOCAL / EXPORT), the default of its Sales Type; empty when the
// company database has no such field. Currency: the customer's currency (OCRD.Currency; '##' = all currencies).
export async function GET(request: NextRequest) {
  try {
    authenticateRequest(request);
    const custType = await sapColumnOr('OCRD', 'U_CustType', 'c');
    const data = await db.query(
      `SELECT c.CardCode, c.CardName, c.CntctPrsn, c.SlpCode, c.GroupNum, ${custType} AS CustType, c.Currency
       FROM ${sapTable('OCRD')} c
       WHERE c.CardType = 'C' AND ISNULL(c.frozenFor, 'N') <> 'Y'
       ORDER BY c.CardCode`
    );
    return successResponse(data);
  } catch (error) {
    return errorResponse(error);
  }
}

import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { authenticateRequest } from '@/lib/auth';
import { successResponse, errorResponse } from '@/lib/apiResponse';
import {
  requestSelect,
  parseRequestFields,
  assertRequestReferences,
  requestParams,
  saveRequestMeans,
  getRequest,
  TRQ_NUMBER,
  applyRequestCurrency,
} from '@/lib/receiptRequests';
import { saveDraftNumber } from '@/lib/documentNumbering';

// GET /api/receipt-requests - All temporary receipt requests, newest first
export async function GET(request: NextRequest) {
  try {
    authenticateRequest(request);
    return successResponse(await db.query(`${requestSelect()} ORDER BY q.DocEntry DESC`));
  } catch (error) {
    return errorResponse(error);
  }
}

// POST /api/receipt-requests - Save a new request as DRAFT (its No. is given on Confirm), with its payment means
export async function POST(request: NextRequest) {
  try {
    const user = authenticateRequest(request);
    const body = await request.json();
    const fields = parseRequestFields(body);
    await assertRequestReferences(fields, true);
    // Its currency and SAP's rate for its Date (refused when SAP has none)
    await applyRequestCurrency(fields);

    const transaction = await db.beginTransaction();
    let docEntry: number;
    try {
      // DocStatus / ApprStatus come from the column defaults (DRAFT, NO-APPROVAL)
      const result = await db.query<{ DocEntry: number }>(
        `INSERT INTO FTS11OTRQ (Series, DocDate, KnownCust, CardCode, CardName, SlpCode, Comments, PayTyp, DocTotal,
                                DocCur, DocRate, DocTotalFC, CreatedBy, CreatedDate, UpdatedBy, UpdatedDate)
         OUTPUT INSERTED.DocEntry
         VALUES (@series, @docDate, @knownCust, @cardCode, @cardName, @slpCode, @comments, @payTyp, @docTotal,
                 @docCur, @docRate, @docTotalFC, @userName, GETDATE(), @userName, GETDATE())`,
        [...requestParams(fields), { name: 'userName', value: user.userName }],
        transaction
      );
      docEntry = result[0].DocEntry;
      await saveRequestMeans(docEntry, fields.means, transaction);
      // Manual series: the No. typed in the No. field (checked on Confirm)
      await saveDraftNumber(TRQ_NUMBER, docEntry, fields.series, body.docNum, transaction);
      await db.commitTransaction(transaction);
    } catch (error) {
      await db.rollbackTransaction(transaction);
      throw error;
    }
    return successResponse(await getRequest(docEntry), 'Temporary receipt request saved as draft', 201);
  } catch (error) {
    return errorResponse(error);
  }
}

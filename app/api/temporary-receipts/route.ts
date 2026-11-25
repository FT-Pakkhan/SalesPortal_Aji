import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { authenticateRequest } from '@/lib/auth';
import { successResponse, errorResponse } from '@/lib/apiResponse';
import {
  tmprSelect,
  parseReceiptFields,
  parseReceiptLines,
  assertReceiptReferences,
  receiptParams,
  saveReceiptMeans,
  saveReceiptLines,
  getReceipt,
  applyReceiptCurrency,
  TMPR_NUMBER,
} from '@/lib/temporaryReceipts';
import { saveDraftNumber } from '@/lib/documentNumbering';
import { assertReceiptFitsRequest } from '@/lib/receiptRequests';

// GET /api/temporary-receipts - All temporary receipts, newest first
export async function GET(request: NextRequest) {
  try {
    authenticateRequest(request);
    return successResponse(await db.query(`${tmprSelect()} ORDER BY t.DocEntry DESC`));
  } catch (error) {
    return errorResponse(error);
  }
}

// POST /api/temporary-receipts - Save a new receipt as DRAFT (its No. is given on Confirm), with its lines
export async function POST(request: NextRequest) {
  try {
    const user = authenticateRequest(request);
    const body = await request.json();
    const fields = parseReceiptFields(body);
    const lines = parseReceiptLines(body);
    await assertReceiptReferences(fields, true);
    // Its currency and SAP's rate for the Posting Date (refused when SAP has none)
    await applyReceiptCurrency(fields);

    const transaction = await db.beginTransaction();
    let docEntry: number;
    try {
      // DocStatus / ApprStatus / PostStatus come from the column defaults (DRAFT, NO-APPROVAL, NO-POSTING)
      // Copied from a Temporary Receipt Request (Copy To): it must fit what is left on the request
      if (fields.baseEntry !== null) await assertReceiptFitsRequest(fields.baseEntry, fields, undefined, transaction);
      const result = await db.query<{ DocEntry: number }>(
        `INSERT INTO FTS11TMPR (Series, DocDate, TaxDate, CardCode, CardName, PayTyp, DocTotal, DocCur, DocRate, DocTotalFC, Comments, BaseType, BaseEntry, CreatedBy, CreatedDate)
         OUTPUT INSERTED.DocEntry
         VALUES (@series, @docDate, @taxDate, @cardCode, @cardName, @payTyp, @docTotal, @docCur, @docRate, @docTotalFC, @comments, @baseType, @baseEntry, @createdBy, GETDATE())`,
        [
          ...receiptParams(fields),
          { name: 'createdBy', value: user.userName },
          { name: 'baseType', value: fields.baseEntry !== null ? 'FTS11OTRQ' : null },
          { name: 'baseEntry', value: fields.baseEntry },
        ],
        transaction
      );
      docEntry = result[0].DocEntry;
      await saveReceiptMeans(docEntry, fields.means, transaction);
      await saveReceiptLines(docEntry, fields.cardCode, fields.docTotal, lines, user.userName, transaction, {
        currency: fields.docCur as string,
        date: fields.docDate,
      });
      // Manual series: the No. typed in the No. field (checked on Confirm)
      await saveDraftNumber(TMPR_NUMBER, docEntry, fields.series, body.docNum, transaction);
      await db.commitTransaction(transaction);
    } catch (error) {
      await db.rollbackTransaction(transaction);
      throw error;
    }
    return successResponse(await getReceipt(docEntry), 'Temporary receipt saved as draft', 201);
  } catch (error) {
    return errorResponse(error);
  }
}

import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { authenticateRequest } from '@/lib/auth';
import { successResponse, errorResponse } from '@/lib/apiResponse';
import {
  transferSelect,
  parseTransferFields,
  assertTransferReferences,
  transferParams,
  saveTransferLines,
  getTransfer,
  OWTR_NUMBER,
} from '@/lib/inventoryTransfers';
import { saveDraftNumber } from '@/lib/documentNumbering';

// GET /api/inventory-transfers - All inventory transfers, newest first
export async function GET(request: NextRequest) {
  try {
    authenticateRequest(request);
    return successResponse(await db.query(`${transferSelect()} ORDER BY t.DocEntry DESC`));
  } catch (error) {
    return errorResponse(error);
  }
}

// POST /api/inventory-transfers - Save a new transfer as DRAFT (its No. is given on Confirm), with its lines
export async function POST(request: NextRequest) {
  try {
    const user = authenticateRequest(request);
    const body = await request.json();
    const fields = parseTransferFields(body);
    await assertTransferReferences(fields, true);

    const transaction = await db.beginTransaction();
    let docEntry: number;
    try {
      // DocStatus / ApprStatus / PostStatus come from the column defaults (DRAFT, NO-APPROVAL, NO-POSTING)
      const result = await db.query<{ DocEntry: number }>(
        `INSERT INTO FTS11OWTR (Series, CardCode, CardName, DocDate, TaxDate, Filler, ToWhsCode, SlpCode, Comments,
                                CreatedBy, CreatedDate, UpdatedBy, UpdatedDate)
         OUTPUT INSERTED.DocEntry
         VALUES (@series, @cardCode, @cardName, @docDate, @taxDate, @filler, @toWhsCode, @slpCode, @comments,
                 @userName, GETDATE(), @userName, GETDATE())`,
        [...transferParams(fields), { name: 'userName', value: user.userName }],
        transaction
      );
      docEntry = result[0].DocEntry;
      await saveTransferLines(docEntry, fields.lines, user.userName, transaction);
      // Manual series: the No. typed in the No. field (checked on Confirm)
      await saveDraftNumber(OWTR_NUMBER, docEntry, fields.series, body.docNum, transaction);
      await db.commitTransaction(transaction);
    } catch (error) {
      await db.rollbackTransaction(transaction);
      throw error;
    }
    return successResponse(await getTransfer(docEntry), 'Inventory transfer saved as draft', 201);
  } catch (error) {
    return errorResponse(error);
  }
}

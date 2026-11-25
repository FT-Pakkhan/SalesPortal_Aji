import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { authenticateRequest } from '@/lib/auth';
import { successResponse, errorResponse } from '@/lib/apiResponse';
import { ValidationError } from '@/lib/errors';
import {
  parseTransferFields,
  assertTransferReferences,
  assertTransferChangeable,
  transferParams,
  saveTransferLines,
  lockTransfer,
  getTransfer,
  OWTR_STATUS,
  OWTR_NUMBER,
} from '@/lib/inventoryTransfers';
import { saveDraftNumber } from '@/lib/documentNumbering';

interface RouteContext {
  params: Promise<{ id: string }>;
}

// GET /api/inventory-transfers/[id] - One transfer with its lines
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    authenticateRequest(request);
    const { id } = await context.params;
    return successResponse(await getTransfer(parseInt(id)));
  } catch (error) {
    return errorResponse(error);
  }
}

// PUT /api/inventory-transfers/[id] - Change a DRAFT or OPEN transfer and its lines (the Series is fixed once
// confirmed); not while in / after approval, nor once synced to SAP
export async function PUT(request: NextRequest, context: RouteContext) {
  try {
    const user = authenticateRequest(request);
    const { id } = await context.params;
    const docEntry = parseInt(id);
    const body = await request.json();
    const fields = parseTransferFields(body);

    const transaction = await db.beginTransaction();
    try {
      const current = await lockTransfer(docEntry, transaction);
      if (current.DocStatus !== OWTR_STATUS.draft && current.DocStatus !== OWTR_STATUS.open) {
        throw new ValidationError(`A ${current.DocStatus} inventory transfer can't be changed`);
      }
      await assertTransferChangeable(docEntry, current, transaction);
      const isOpen = current.DocStatus === OWTR_STATUS.open;
      if (isOpen && fields.series !== current.Series) throw new ValidationError("Series can't be changed after confirming");
      await assertTransferReferences(fields, !isOpen);

      await db.query(
        `UPDATE FTS11OWTR
         SET Series = @series, CardCode = @cardCode, CardName = @cardName, DocDate = @docDate, TaxDate = @taxDate,
             Filler = @filler, ToWhsCode = @toWhsCode, SlpCode = @slpCode, Comments = @comments,
             UpdatedBy = @userName, UpdatedDate = GETDATE()
         WHERE DocEntry = @docEntry`,
        [{ name: 'docEntry', value: docEntry }, ...transferParams(fields), { name: 'userName', value: user.userName }],
        transaction
      );
      await saveTransferLines(docEntry, fields.lines, user.userName, transaction);
      // A draft on a manual series: the No. typed in the No. field (checked on Confirm); nothing once confirmed
      await saveDraftNumber(OWTR_NUMBER, docEntry, fields.series, body.docNum, transaction);
      await db.commitTransaction(transaction);
    } catch (error) {
      await db.rollbackTransaction(transaction);
      throw error;
    }
    return successResponse(await getTransfer(docEntry), 'Inventory transfer updated');
  } catch (error) {
    return errorResponse(error);
  }
}

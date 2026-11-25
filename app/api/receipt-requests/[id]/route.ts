import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { authenticateRequest } from '@/lib/auth';
import { successResponse, errorResponse } from '@/lib/apiResponse';
import { ValidationError } from '@/lib/errors';
import {
  parseRequestFields,
  assertRequestReferences,
  assertRequestChangeable,
  requestParams,
  saveRequestMeans,
  lockRequest,
  getRequest,
  TRQ_STATUS,
  TRQ_NUMBER,
  applyRequestCurrency,
} from '@/lib/receiptRequests';
import { getCurrencySettings } from '@/lib/currency';
import { saveDraftNumber } from '@/lib/documentNumbering';

interface RouteContext {
  params: Promise<{ id: string }>;
}

// GET /api/receipt-requests/[id] - One request with its cheques and the receipts copied from it
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    authenticateRequest(request);
    const { id } = await context.params;
    return successResponse(await getRequest(parseInt(id)));
  } catch (error) {
    return errorResponse(error);
  }
}

// PUT /api/receipt-requests/[id] - Change a DRAFT or OPEN request (the Series is fixed once confirmed); not while in /
// after approval, nor once copied into a receipt
export async function PUT(request: NextRequest, context: RouteContext) {
  try {
    const user = authenticateRequest(request);
    const { id } = await context.params;
    const docEntry = parseInt(id);
    const body = await request.json();
    const fields = parseRequestFields(body);

    const transaction = await db.beginTransaction();
    try {
      const current = await lockRequest(docEntry, transaction);
      if (current.DocStatus !== TRQ_STATUS.draft && current.DocStatus !== TRQ_STATUS.open) {
        throw new ValidationError(`A ${current.DocStatus} temporary receipt request can't be changed`);
      }
      await assertRequestChangeable(docEntry, current.ApprStatus, transaction);
      const isOpen = current.DocStatus === TRQ_STATUS.open;
      if (isOpen && fields.series !== current.Series) throw new ValidationError("Series can't be changed after confirming");
      await assertRequestReferences(fields, !isOpen);
      // Its currency and rate: kept once confirmed; a draft's rate is SAP's for its Date. One made before currencies
      // (no DocCur) is in the local currency.
      await applyRequestCurrency(
        fields,
        isOpen ? { docCur: current.DocCur ?? (await getCurrencySettings()).local, docRate: Number(current.DocRate) || 1 } : undefined
      );

      await db.query(
        `UPDATE FTS11OTRQ
         SET Series = @series, DocDate = @docDate, KnownCust = @knownCust, CardCode = @cardCode, CardName = @cardName,
             SlpCode = @slpCode, Comments = @comments, PayTyp = @payTyp, DocTotal = @docTotal,
             DocCur = @docCur, DocRate = @docRate, DocTotalFC = @docTotalFC,
             UpdatedBy = @userName, UpdatedDate = GETDATE()
         WHERE DocEntry = @docEntry`,
        [{ name: 'docEntry', value: docEntry }, ...requestParams(fields), { name: 'userName', value: user.userName }],
        transaction
      );
      await saveRequestMeans(docEntry, fields.means, transaction);
      // A draft on a manual series: the No. typed in the No. field (checked on Confirm); nothing once confirmed
      await saveDraftNumber(TRQ_NUMBER, docEntry, fields.series, body.docNum, transaction);
      await db.commitTransaction(transaction);
    } catch (error) {
      await db.rollbackTransaction(transaction);
      throw error;
    }
    return successResponse(await getRequest(docEntry), 'Temporary receipt request updated');
  } catch (error) {
    return errorResponse(error);
  }
}

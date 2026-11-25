import { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/auth';
import { successResponse, errorResponse } from '@/lib/apiResponse';
import { ValidationError } from '@/lib/errors';
import { getRequestRemaining, TRQ_STATUS } from '@/lib/receiptRequests';

interface RouteContext {
  params: Promise<{ id: string }>;
}

// GET /api/receipt-requests/[id]/copy - Copy To Temporary Receipt: what is still left on an OPEN request (its customer
// if known, the cheques not used yet and the rest of each amount), to start the new receipt with
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    authenticateRequest(request);
    const { id } = await context.params;
    const { request: req, remainingTotal, means } = await getRequestRemaining(parseInt(id));
    if (req.DocStatus !== TRQ_STATUS.open) throw new ValidationError(`Only an OPEN request can be copied (this one is ${req.DocStatus})`);
    if (remainingTotal <= 0) throw new ValidationError('Nothing is left on this request to copy: its receipts already take its full Amount');
    return successResponse({
      BaseEntry: req.DocEntry,
      BaseDocNum: req.DocNum,
      KnownCust: req.KnownCust,
      CardCode: req.CardCode,
      CardName: req.CardName,
      Comments: req.Comments,
      // The receipt is in the request's currency
      DocCur: req.DocCur,
      RemainingTotal: remainingTotal,
      Means: means,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

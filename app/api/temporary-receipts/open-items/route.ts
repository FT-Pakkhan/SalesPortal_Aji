import { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/auth';
import { successResponse, errorResponse } from '@/lib/apiResponse';
import { ValidationError } from '@/lib/errors';
import { getOpenItems } from '@/lib/temporaryReceipts';

// GET /api/temporary-receipts/open-items?cardCode=C20000&docEntry=5 - The customer's open SAP items a receipt may pay
// (FTS_fn_UnreconciledDocs), less those held by another receipt. docEntry = the receipt being edited (omit for new).
// &currency=USD&date=2026-11-15: the receipt's currency and Posting Date - items in it or in the local currency, the
// balance due in the receipt's currency at SAP's rates that day.
export async function GET(request: NextRequest) {
  try {
    authenticateRequest(request);
    const params = request.nextUrl.searchParams;
    const cardCode = (params.get('cardCode') ?? '').trim();
    if (!cardCode) throw new ValidationError('Choose a Customer first');
    const docEntry = params.get('docEntry') ? parseInt(params.get('docEntry') as string) : null;
    const currency = (params.get('currency') ?? '').trim().toUpperCase();
    const date = (params.get('date') ?? '').trim();
    const receipt = currency && /^\d{4}-\d{2}-\d{2}$/.test(date) ? { currency, date } : undefined;
    return successResponse(await getOpenItems(cardCode, Number.isInteger(docEntry) ? docEntry : null, undefined, receipt));
  } catch (error) {
    return errorResponse(error);
  }
}

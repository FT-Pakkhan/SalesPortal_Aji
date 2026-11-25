import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { authenticateRequest } from '@/lib/auth';
import { successResponse, errorResponse } from '@/lib/apiResponse';
import { sapTable } from '@/lib/sapDb';
import { getCurrencySettings, getRates } from '@/lib/currency';

// GET /api/sap/currencies - SAP's currencies (OCRN), the company's local currency and how its rates read
// (direct: 1 foreign = rate local). ?date=2026-11-15: also SAP's rate of each currency on that date (null = none).
export async function GET(request: NextRequest) {
  try {
    authenticateRequest(request);
    const settings = await getCurrencySettings();
    const list = await db.query<{ CurrCode: string; CurrName: string }>(
      `SELECT CurrCode, CurrName FROM ${sapTable('OCRN')} ORDER BY CurrCode`
    );
    const date = request.nextUrl.searchParams.get('date');
    const rates = date && /^\d{4}-?\d{2}-?\d{2}$/.test(date) ? await getRates(list.map((c) => c.CurrCode.trim()), date, settings) : null;
    return successResponse({
      local: settings.local,
      direct: settings.direct,
      currencies: list.map((c) => ({
        code: c.CurrCode.trim(),
        name: c.CurrName,
        rate: rates ? (rates.get(c.CurrCode.trim()) ?? null) : undefined,
      })),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

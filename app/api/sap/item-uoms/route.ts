import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { authenticateRequest } from '@/lib/auth';
import { successResponse, errorResponse } from '@/lib/apiResponse';
import { sapTable } from '@/lib/sapDb';
import { priceListSql, uomPriceCurrencySql, uomPriceSql } from '@/lib/sapUom';
import { pricesInCurrency } from '@/lib/currency';

// GET /api/sap/item-uoms?items=A00001,B10000&cardCode=C20000 - the units of each item's UoM Group (UGP1), for the
// line's UoM Code list. Factor: base units in one of this unit. Price: the customer's price-list price in this unit,
// as SAP B1 gives it (a price set for the unit, else the list price x its quantity); null without a price.
// Items with a Manual UoM group have no rows (their UoM is typed). &currency=USD&date=...: prices in that currency, as
// /api/sap/items.
export async function GET(request: NextRequest) {
  try {
    authenticateRequest(request);
    const items = [...new Set((request.nextUrl.searchParams.get('items') || '').split(',').map((c) => c.trim()).filter(Boolean))].slice(0, 200);
    if (items.length === 0) return successResponse([]);
    const cardCode = request.nextUrl.searchParams.get('cardCode') || '';
    const data = await db.query(
      `SELECT i.ItemCode, o.UomEntry, o.UomCode, o.UomName, g.BaseQty / NULLIF(g.AltQty, 0) AS Factor,
              ${uomPriceSql('i', 'p', 'c', 'o.UomEntry')} AS Price, ${uomPriceCurrencySql('i', 'p', 'c', 'o.UomEntry')} AS PriceCur
       FROM ${sapTable('OITM')} i
       JOIN ${sapTable('UGP1')} g ON g.UgpEntry = i.UgpEntry
       JOIN ${sapTable('OUOM')} o ON o.UomEntry = g.UomEntry
       LEFT JOIN ${sapTable('OCRD')} c ON c.CardCode = @cardCode
       LEFT JOIN ${sapTable('ITM1')} p ON p.ItemCode = i.ItemCode AND p.PriceList = ${priceListSql('c')}
       WHERE i.UgpEntry <> -1 AND i.ItemCode IN (${items.map((_, n) => `@item${n}`).join(', ')})
       ORDER BY i.ItemCode, g.BaseQty / NULLIF(g.AltQty, 0), o.UomCode`,
      [{ name: 'cardCode', value: cardCode }, ...items.map((code, n) => ({ name: `item${n}`, value: code }))]
    );
    return successResponse(
      await pricesInCurrency(data as { Price: number | null; PriceCur: string | null }[], request.nextUrl.searchParams.get('currency'), request.nextUrl.searchParams.get('date'))
    );
  } catch (error) {
    return errorResponse(error);
  }
}

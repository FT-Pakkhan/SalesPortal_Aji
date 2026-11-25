import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { authenticateRequest } from '@/lib/auth';
import { successResponse, errorResponse } from '@/lib/apiResponse';
import { sapColumnOr, sapTable } from '@/lib/sapDb';
import { priceListSql, uomPriceCurrencySql, uomPriceSql } from '@/lib/sapUom';
import { pricesInCurrency } from '@/lib/currency';

// GET /api/sap/items?cardCode=C20000 - Sales items from SAP B1 (OITM) for the item lookup.
// SalUnitMsr: the sales unit (for a UoM-group item the code of its default sales UoM, as in the UoM Code list).
// Price is the item's price for the sales unit in the customer's price list (OCRD.ListNum, ITM1), as SAP B1 does;
// for a lead or no customer yet, in the Default Price List of General Settings. DfltWH: the item's default warehouse, or else the company's default warehouse (OADM.DfltWhs).
// Moq / MoqUom: the item's Sales MOQ and its unit (OITM.U_Sales_MOQ, U_Sales_MOQ_UOM), shown on the quotation / order lines.
// ?rebate=Y: rebate items only (U_Rebate = 'Y'), for the Credit Memo; none when the company database has no such field.
// ?currency=USD&date=2026-11-15: prices in the document's currency at SAP's rates on that date (none when a rate is
// missing); without them, as the price list has them.
export async function GET(request: NextRequest) {
  try {
    authenticateRequest(request);
    const cardCode = request.nextUrl.searchParams.get('cardCode') || '';
    const rebateOnly = request.nextUrl.searchParams.get('rebate') === 'Y';
    const rebateFilter = rebateOnly ? `AND ${await sapColumnOr('OITM', 'U_Rebate', 'i')} = 'Y'` : '';
    const moq = await sapColumnOr('OITM', 'U_Sales_MOQ', 'i');
    const moqUom = await sapColumnOr('OITM', 'U_Sales_MOQ_UOM', 'i');
    const data = await db.query(
      `SELECT i.ItemCode, i.ItemName, ${moq} AS Moq, ${moqUom} AS MoqUom,
              CASE WHEN i.UgpEntry <> -1 AND su.UomCode IS NOT NULL THEN su.UomCode ELSE i.SalUnitMsr END AS SalUnitMsr,
              COALESCE(NULLIF(i.DfltWH, ''), (SELECT TOP 1 NULLIF(a.DfltWhs, '') FROM ${sapTable('OADM')} a)) AS DfltWH,
              i.VatGourpSa AS VatGroup, ${uomPriceSql('i', 'p', 'c', 'su.UomEntry')} AS Price,
              ${uomPriceCurrencySql('i', 'p', 'c', 'su.UomEntry')} AS PriceCur
       FROM ${sapTable('OITM')} i
       LEFT JOIN ${sapTable('OUOM')} su ON su.UomEntry = i.SUoMEntry AND i.UgpEntry <> -1
       LEFT JOIN ${sapTable('OCRD')} c ON c.CardCode = @cardCode
       LEFT JOIN ${sapTable('ITM1')} p ON p.ItemCode = i.ItemCode AND p.PriceList = ${priceListSql('c')}
       WHERE i.SellItem = 'Y' AND ISNULL(i.frozenFor, 'N') <> 'Y' ${rebateFilter}
       ORDER BY i.ItemCode`,
      [{ name: 'cardCode', value: cardCode }]
    );
    return successResponse(
      await pricesInCurrency(data as { Price: number | null; PriceCur: string | null }[], request.nextUrl.searchParams.get('currency'), request.nextUrl.searchParams.get('date'))
    );
  } catch (error) {
    return errorResponse(error);
  }
}

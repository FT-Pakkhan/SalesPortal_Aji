import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { authenticateRequest } from '@/lib/auth';
import { successResponse, errorResponse } from '@/lib/apiResponse';
import { sapTable } from '@/lib/sapDb';

// GET /api/sap/stock-items - Inventory items from SAP B1 (OITM) for the Inventory Transfer item lookup: the inventory
// unit, the default warehouse (the item's own, or else the company's, SAP General Settings OADM.DfltWhs) with the
// stock there (OITW), and the stock in total.
export async function GET(request: NextRequest) {
  try {
    authenticateRequest(request);
    const data = await db.query(
      `SELECT i.ItemCode, i.ItemName, i.InvntryUom, d.DfltWH, w.OnHand AS WhsOnHand, i.OnHand AS TotalOnHand
       FROM ${sapTable('OITM')} i
       CROSS APPLY (SELECT COALESCE(NULLIF(i.DfltWH, ''), (SELECT TOP 1 NULLIF(a.DfltWhs, '') FROM ${sapTable('OADM')} a)) AS DfltWH) d
       LEFT JOIN ${sapTable('OITW')} w ON w.ItemCode = i.ItemCode AND w.WhsCode = d.DfltWH
       WHERE i.InvntItem = 'Y' AND ISNULL(i.frozenFor, 'N') <> 'Y'
       ORDER BY i.ItemCode`
    );
    return successResponse(data);
  } catch (error) {
    return errorResponse(error);
  }
}

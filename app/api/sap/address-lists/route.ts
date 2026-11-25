import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { authenticateRequest } from '@/lib/auth';
import { successResponse, errorResponse } from '@/lib/apiResponse';
import { sapDatabase, sapTable } from '@/lib/sapDb';

// GET /api/sap/address-lists - The choices for a business partner's addresses and credit term, from SAP B1:
//   countries (OCRY), states of every country (OCST), payment terms (OCTG), customer groups (OCRG, not locked) and
//   delivery zones (UDT @DELIVERYZONE; none if the company database doesn't have the table)
export async function GET(request: NextRequest) {
  try {
    authenticateRequest(request);
    const zoneTable = `[${sapDatabase()}].dbo.[@DELIVERYZONE]`;
    const [countries, states, paymentTerms, customerGroups, deliveryZones] = await Promise.all([
      db.query(`SELECT Code, Name FROM ${sapTable('OCRY')} ORDER BY Name`),
      db.query(`SELECT Country, Code, Name FROM ${sapTable('OCST')} ORDER BY Country, Name`),
      db.query(`SELECT GroupNum, PymntGroup FROM ${sapTable('OCTG')} ORDER BY PymntGroup`),
      db.query(`SELECT GroupCode, GroupName FROM ${sapTable('OCRG')} WHERE GroupType = 'C' AND Locked = 'N' ORDER BY GroupName`),
      db.query(
        `IF OBJECT_ID(@zoneTable, 'U') IS NOT NULL
           EXEC('SELECT Code, Name, U_DZ_State AS State, U_DZ_City AS City, U_DZ_Area AS Area FROM ${zoneTable} ORDER BY Code')
         ELSE
           SELECT CAST(NULL AS NVARCHAR(50)) AS Code, CAST(NULL AS NVARCHAR(100)) AS Name, CAST(NULL AS NVARCHAR(25)) AS State,
                  CAST(NULL AS NVARCHAR(50)) AS City, CAST(NULL AS NVARCHAR(50)) AS Area WHERE 1 = 0`,
        [{ name: 'zoneTable', value: zoneTable }]
      ),
    ]);
    return successResponse({ countries, states, paymentTerms, customerGroups, deliveryZones });
  } catch (error) {
    return errorResponse(error);
  }
}

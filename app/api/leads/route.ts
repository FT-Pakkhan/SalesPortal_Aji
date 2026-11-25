import { NextRequest } from 'next/server';
import sql from 'mssql';
import { db } from '@/lib/db';
import { authenticateRequest } from '@/lib/auth';
import { successResponse, errorResponse } from '@/lib/apiResponse';
import { leadSelect, parseLeadFields, assertLeadSeries, getLead, settleLeadCurrency, LEAD_NUMBER } from '@/lib/leads';
import { saveDraftNumber } from '@/lib/documentNumbering';

// GET /api/leads - All leads, newest first
export async function GET(request: NextRequest) {
  try {
    authenticateRequest(request);
    return successResponse(await db.query(`${leadSelect()} ORDER BY l.DocEntry DESC`));
  } catch (error) {
    return errorResponse(error);
  }
}

// POST /api/leads - Save a new lead as DRAFT (its Lead Code is given on Confirm): its name and series. Its Sales
// Employee is the user's own (Users > Sales Employee) and its date today; the application form is filled in on
// Convert to Customer.
export async function POST(request: NextRequest) {
  try {
    const user = authenticateRequest(request);
    const body = await request.json();
    const fields = parseLeadFields(body);
    await assertLeadSeries(fields.series);
    const currency = await settleLeadCurrency(fields.currency);

    const transaction = await db.beginTransaction();
    let docEntry: number;
    try {
      // DocStatus / ApprStatus / PostStatus come from the column defaults (DRAFT, NO-APPROVAL, NO-POSTING)
      const result = await db.query<{ DocEntry: number }>(
        `INSERT INTO FTS11LEAD (LeadName, SlpCode, Series, Currency, DocDate, CreatedBy, CreatedDate)
         OUTPUT INSERTED.DocEntry
         VALUES (@leadName, (SELECT u.SlpCode FROM SystemUsers u WHERE u.DocEntry = @userId), @series, @currency, CAST(GETDATE() AS DATE),
                 @createdBy, GETDATE())`,
        [
          { name: 'leadName', value: fields.leadName },
          { name: 'userId', value: user.userId },
          { name: 'createdBy', value: user.userName },
          { name: 'series', type: sql.Int, value: fields.series },
          { name: 'currency', type: sql.NVarChar(3), value: currency },
        ],
        transaction
      );
      docEntry = result[0].DocEntry;
      // Manual series: the Lead Code typed in its field (checked on Confirm)
      await saveDraftNumber(LEAD_NUMBER, docEntry, fields.series, body.leadCode, transaction);
      await db.commitTransaction(transaction);
    } catch (error) {
      await db.rollbackTransaction(transaction);
      throw error;
    }
    return successResponse(await getLead(docEntry), 'Lead saved as draft', 201);
  } catch (error) {
    return errorResponse(error);
  }
}

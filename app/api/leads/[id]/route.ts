import { NextRequest } from 'next/server';
import sql from 'mssql';
import { db } from '@/lib/db';
import { authenticateRequest } from '@/lib/auth';
import { successResponse, errorResponse } from '@/lib/apiResponse';
import { ValidationError } from '@/lib/errors';
import { parseLeadFields, assertLeadSeries, assertLeadNotInApproval, getLead, lockLead, settleLeadCurrency, LEAD_NUMBER, LEAD_STATUS } from '@/lib/leads';
import { saveDraftNumber } from '@/lib/documentNumbering';
import { assertNotSynced } from '@/lib/salesDocuments';

interface RouteContext {
  params: Promise<{ id: string }>;
}

// GET /api/leads/[id] - One lead
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    authenticateRequest(request);
    const { id } = await context.params;
    return successResponse(await getLead(parseInt(id)));
  } catch (error) {
    return errorResponse(error);
  }
}

// PUT /api/leads/[id] - Change a DRAFT or OPEN lead's name and currency (until its first quotation), and series while
// DRAFT (its Lead Code came from it).
// The rest of the lead (Sales Employee, an application form saved earlier) is kept as it is.
export async function PUT(request: NextRequest, context: RouteContext) {
  try {
    authenticateRequest(request);
    const { id } = await context.params;
    const docEntry = parseInt(id);
    const current = await lockLead(docEntry);
    if (current.DocStatus !== LEAD_STATUS.draft && current.DocStatus !== LEAD_STATUS.open) {
      throw new ValidationError(`A ${current.DocStatus} lead can't be changed`);
    }
    await assertLeadNotInApproval(docEntry, current.ApprStatus);
    assertNotSynced('lead', current.PostStatus);

    const body = await request.json();
    const fields = parseLeadFields(body);
    if (current.DocStatus === LEAD_STATUS.open && fields.series !== current.Series) {
      throw new ValidationError("Series can't be changed after confirming");
    }
    if (current.DocStatus === LEAD_STATUS.draft) await assertLeadSeries(fields.series);
    // Its currency: fixed once it has a quotation
    const currency = await settleLeadCurrency(fields.currency, docEntry);

    const transaction = await db.beginTransaction();
    try {
      await db.query(`UPDATE FTS11LEAD SET LeadName = @leadName, Series = @series, Currency = @currency WHERE DocEntry = @docEntry`, [
        { name: 'docEntry', value: docEntry },
        { name: 'leadName', value: fields.leadName },
        { name: 'series', type: sql.Int, value: fields.series },
        { name: 'currency', type: sql.NVarChar(3), value: currency },
      ], transaction);
      // A draft on a manual series: the Lead Code typed in its field (checked on Confirm); nothing once confirmed
      await saveDraftNumber(LEAD_NUMBER, docEntry, fields.series, body.leadCode, transaction);
      await db.commitTransaction(transaction);
    } catch (error) {
      await db.rollbackTransaction(transaction);
      throw error;
    }
    return successResponse(await getLead(docEntry), 'Lead updated');
  } catch (error) {
    return errorResponse(error);
  }
}

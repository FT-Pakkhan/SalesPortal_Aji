import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { authenticateRequest } from '@/lib/auth';
import { successResponse, errorResponse } from '@/lib/apiResponse';
import { ValidationError } from '@/lib/errors';
import { saveApplicationForm } from '@/lib/leads';
import {
  CONVERSION_TABLES,
  OCRD_STATUS,
  assertConversionChangeable,
  assertConversionReferences,
  conversionParams,
  getConversion,
  lockConversion,
  parseConversionFields,
  saveConversionAddresses,
} from '@/lib/customerConversions';

interface RouteContext {
  params: Promise<{ id: string }>;
}

// GET /api/customer-conversions/[id] - One Convert to Customer with its contacts
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    authenticateRequest(request);
    const { id } = await context.params;
    return successResponse(await getConversion(parseInt(id)));
  } catch (error) {
    return errorResponse(error);
  }
}

// PUT /api/customer-conversions/[id] - Change a DRAFT one (also a rejected one, to send it again), or an OPEN one whose
// posting FAILED (to correct it); the Series and the lead are fixed once confirmed. An Update Customer keeps its lead
// and SAP BP Code, and its own No.
export async function PUT(request: NextRequest, context: RouteContext) {
  try {
    const user = authenticateRequest(request);
    const { id } = await context.params;
    const docEntry = parseInt(id);
    const fields = parseConversionFields(await request.json());

    const transaction = await db.beginTransaction();
    try {
      const current = await lockConversion(docEntry, transaction);
      if (current.DocStatus !== OCRD_STATUS.draft && current.DocStatus !== OCRD_STATUS.open) {
        throw new ValidationError(`A ${current.DocStatus} convert to customer can't be changed`);
      }
      assertConversionChangeable(current);
      const isDraft = current.DocStatus === OCRD_STATUS.draft;
      if (current.BaseEntry !== null) {
        if (fields.cardCode !== current.CardCode) throw new ValidationError("The SAP BP Code of an Update Customer can't be changed");
        if (fields.leadEntry !== current.LeadEntry) throw new ValidationError("The lead of an Update Customer can't be changed");
      }
      if (!isDraft && fields.series !== current.Series) throw new ValidationError("Series can't be changed after confirming");
      if (!isDraft && fields.leadEntry !== current.LeadEntry) throw new ValidationError("The lead can't be changed after confirming");
      await assertConversionReferences(fields, isDraft, current.LeadEntry);

      await db.query(
        `UPDATE FTS11OCRD
         SET LeadEntry = @leadEntry, LeadName = @leadName, CardCode = @cardCode,
             DocNum = CASE WHEN BaseEntry IS NULL THEN @cardCode ELSE DocNum END, CreditLine = @creditLine, SlpCode = @slpCode, GroupCode = @groupCode,
             Series = @series, Comments = @comments, UpdatedBy = @userName, UpdatedDate = GETDATE()
         WHERE DocEntry = @docEntry`,
        [...conversionParams(fields), { name: 'docEntry', value: docEntry }, { name: 'userName', value: user.userName }],
        transaction
      );
      await saveApplicationForm(CONVERSION_TABLES, docEntry, fields, transaction);
      await saveConversionAddresses(docEntry, fields.addresses, transaction);
      await db.commitTransaction(transaction);
    } catch (error) {
      await db.rollbackTransaction(transaction);
      throw error;
    }
    return successResponse(await getConversion(docEntry), 'Convert to customer updated');
  } catch (error) {
    return errorResponse(error);
  }
}

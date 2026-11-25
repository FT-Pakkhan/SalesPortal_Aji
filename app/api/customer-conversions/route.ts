import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { authenticateRequest } from '@/lib/auth';
import { successResponse, errorResponse } from '@/lib/apiResponse';
import { saveApplicationForm } from '@/lib/leads';
import {
  CONVERSION_TABLES,
  assertConversionReferences,
  conversionParams,
  conversionSelect,
  getConversion,
  parseConversionFields,
  saveConversionAddresses,
} from '@/lib/customerConversions';

// GET /api/customer-conversions - All Convert to Customer documents, newest first
export async function GET(request: NextRequest) {
  try {
    authenticateRequest(request);
    return successResponse(await db.query(`${conversionSelect()} ORDER BY c.DocEntry DESC`));
  } catch (error) {
    return errorResponse(error);
  }
}

// POST /api/customer-conversions - Save a new Convert to Customer as DRAFT, with the application form and contacts.
// Its No. is its SAP BP Code (same value, kept in DocNum).
export async function POST(request: NextRequest) {
  try {
    const user = authenticateRequest(request);
    const fields = parseConversionFields(await request.json());
    await assertConversionReferences(fields, true);

    const transaction = await db.beginTransaction();
    let docEntry: number;
    try {
      // DocStatus / ApprStatus / PostStatus come from the column defaults (DRAFT, NO-APPROVAL, NO-POSTING)
      const result = await db.query<{ DocEntry: number }>(
        `INSERT INTO FTS11OCRD (LeadEntry, LeadName, CardCode, DocNum, CreditLine, SlpCode, GroupCode, Series, Comments, CreatedBy, CreatedDate, UpdatedBy, UpdatedDate)
         OUTPUT INSERTED.DocEntry
         VALUES (@leadEntry, @leadName, @cardCode, @cardCode, @creditLine, @slpCode, @groupCode, @series, @comments, @userName, GETDATE(), @userName, GETDATE())`,
        [...conversionParams(fields), { name: 'userName', value: user.userName }],
        transaction
      );
      docEntry = result[0].DocEntry;
      await saveApplicationForm(CONVERSION_TABLES, docEntry, fields, transaction);
      await saveConversionAddresses(docEntry, fields.addresses, transaction);
      await db.commitTransaction(transaction);
    } catch (error) {
      await db.rollbackTransaction(transaction);
      throw error;
    }
    return successResponse(await getConversion(docEntry), 'Convert to customer saved as draft', 201);
  } catch (error) {
    return errorResponse(error);
  }
}

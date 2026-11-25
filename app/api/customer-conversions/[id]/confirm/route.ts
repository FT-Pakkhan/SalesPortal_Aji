import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { authenticateRequest } from '@/lib/auth';
import { successResponse, errorResponse } from '@/lib/apiResponse';
import { OCRD_OBJTYPE, confirmConversion, getConversion } from '@/lib/customerConversions';
import { autoPostToSap, withPostResult } from '@/lib/sapPosting';

interface RouteContext {
  params: Promise<{ id: string }>;
}

// POST /api/customer-conversions/[id]/confirm - Confirm a DRAFT Convert to Customer: the form and BP code checked,
// then its No. and OPEN (posted to SAP straight away), or (approval needed) PENDING approval
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const user = authenticateRequest(request);
    const { id } = await context.params;
    const docEntry = parseInt(id);

    const transaction = await db.beginTransaction();
    let apprStatus: string;
    try {
      apprStatus = await confirmConversion(docEntry, user.userName, transaction);
      await db.commitTransaction(transaction);
    } catch (error) {
      await db.rollbackTransaction(transaction);
      throw error;
    }
    // Confirmed (no approval needed): posted to SAP straight away (FAILED with the reason if not)
    const post = apprStatus === 'PENDING' ? null : await autoPostToSap(OCRD_OBJTYPE, docEntry, user.userId);
    const conversion = await getConversion(docEntry);
    return successResponse(
      conversion,
      apprStatus === 'PENDING'
        ? 'Convert to customer sent for approval'
        : withPostResult(`Convert to customer confirmed: No. ${(conversion as { DocNum?: string }).DocNum}`, post)
    );
  } catch (error) {
    return errorResponse(error);
  }
}

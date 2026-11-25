import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { authenticateRequest } from '@/lib/auth';
import { successResponse, errorResponse } from '@/lib/apiResponse';
import { confirmLead, getLead } from '@/lib/leads';

interface RouteContext {
  params: Promise<{ id: string }>;
}

// POST /api/leads/[id]/confirm - Confirm a DRAFT lead: its Lead Code and OPEN, or (approval needed) PENDING approval
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const user = authenticateRequest(request);
    const { id } = await context.params;
    const docEntry = parseInt(id);
    // { docNum }: the No. keyed in, for a manual series (no body otherwise)
    const body = (await request.json().catch(() => ({}))) as { docNum?: unknown };

    const transaction = await db.beginTransaction();
    let apprStatus: string;
    try {
      apprStatus = await confirmLead(docEntry, user.userName, transaction, body.docNum);
      await db.commitTransaction(transaction);
    } catch (error) {
      await db.rollbackTransaction(transaction);
      throw error;
    }
    const lead = await getLead(docEntry);
    return successResponse(
      lead,
      apprStatus === 'PENDING' ? 'Lead sent for approval' : `Lead confirmed: ${(lead as { LeadCode?: string }).LeadCode}`
    );
  } catch (error) {
    return errorResponse(error);
  }
}

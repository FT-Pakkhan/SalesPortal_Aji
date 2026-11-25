import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { authenticateRequest } from '@/lib/auth';
import { successResponse, errorResponse } from '@/lib/apiResponse';
import { ValidationError } from '@/lib/errors';
import { approvalDocumentOf, decideApproval, getDocumentApprovals } from '@/lib/approvals';
import { autoPostToSap, senderUserId, withPostResult } from '@/lib/sapPosting';

interface RouteContext {
  params: Promise<{ objType: string; docEntry: string }>;
}

// GET /api/approvals/[objType]/[docEntry] - The document's approval rows (Approval tab) and whether I can decide now
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const user = authenticateRequest(request);
    const { objType, docEntry } = await context.params;
    return successResponse(await getDocumentApprovals(objType, parseInt(docEntry), user.userId));
  } catch (error) {
    return errorResponse(error);
  }
}

// POST /api/approvals/[objType]/[docEntry] - Approve or Reject: body { decision: 'APPROVED' | 'REJECTED', remarks }
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const user = authenticateRequest(request);
    const { objType, docEntry: id } = await context.params;
    const docEntry = parseInt(id);
    const doc = approvalDocumentOf(objType);
    const body = (await request.json()) as { decision?: string; remarks?: string };

    const decision = body.decision;
    if (decision !== 'APPROVED' && decision !== 'REJECTED') throw new ValidationError('Choose Approve or Reject');
    const remarks = String(body.remarks ?? '').trim() || null;
    if (remarks && remarks.length > 254) throw new ValidationError('Remarks must be 254 characters or fewer');

    const transaction = await db.beginTransaction();
    let result: string;
    try {
      result = await decideApproval(objType, docEntry, decision, remarks, user, transaction);
      await db.commitTransaction(transaction);
    } catch (error) {
      await db.rollbackTransaction(transaction);
      throw error;
    }

    // Fully approved (now OPEN): a Sales Order / Temporary Receipt / Inventory Transfer goes to SAP straight away;
    // a failure is told to whoever sent it for approval (they own the document)
    const post = result === 'APPROVED' ? await autoPostToSap(objType, docEntry, (await senderUserId(objType, docEntry)) ?? user.userId) : null;

    const messages: Record<string, string> = {
      APPROVED: withPostResult(`${doc.label} approved`, post),
      REJECTED: `${doc.label} rejected`,
      PENDING: 'Your approval is recorded; waiting for the other approvals',
    };
    return successResponse(await doc.detail(docEntry), messages[result]);
  } catch (error) {
    return errorResponse(error);
  }
}

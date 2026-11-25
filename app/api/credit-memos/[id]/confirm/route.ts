import { documentConfirmRoute } from '@/lib/salesDocumentRoutes';
import { CREDIT_MEMO } from '@/lib/salesDocuments';

// POST /api/credit-memos/[id]/confirm - Assign the No., set it OPEN and record who confirmed it
export const { POST } = documentConfirmRoute(CREDIT_MEMO);

import { documentStatusRoutes } from '@/lib/salesDocumentRoutes';
import { CREDIT_MEMO } from '@/lib/salesDocuments';

// POST /api/credit-memos/[id]/cancel - Cancel Doc: a DRAFT / OPEN credit memo becomes CANCELED (once posted, SAP adds its cancellation document)
export const { POST } = documentStatusRoutes(CREDIT_MEMO).cancel;

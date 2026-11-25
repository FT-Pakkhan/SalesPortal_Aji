import { documentCollectionRoutes } from '@/lib/salesDocumentRoutes';
import { CREDIT_MEMO } from '@/lib/salesDocuments';

// GET /api/credit-memos - List credit memos (newest first)
// POST /api/credit-memos - Save a new credit memo as DRAFT (no No. until it is confirmed)
export const { GET, POST } = documentCollectionRoutes(CREDIT_MEMO);

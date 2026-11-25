import { documentItemRoutes } from '@/lib/salesDocumentRoutes';
import { CREDIT_MEMO } from '@/lib/salesDocuments';

// GET /api/credit-memos/[id] - One credit memo: header and lines
// PUT /api/credit-memos/[id] - Update a DRAFT or OPEN credit memo and replace its lines
export const { GET, PUT } = documentItemRoutes(CREDIT_MEMO);

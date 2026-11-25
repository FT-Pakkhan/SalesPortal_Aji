import { documentStatusRoutes } from '@/lib/salesDocumentRoutes';
import { SALES_QUOTATION } from '@/lib/salesDocuments';

// POST /api/sales-quotations/[id]/cancel - Cancel Doc: a DRAFT / OPEN document nothing was copied from becomes CANCELED
export const { POST } = documentStatusRoutes(SALES_QUOTATION).cancel;

import { documentStatusRoutes } from '@/lib/salesDocumentRoutes';
import { SALES_QUOTATION } from '@/lib/salesDocuments';

// POST /api/sales-quotations/[id]/close - Close Doc: the OPEN document and its open lines become CLOSED
export const { POST } = documentStatusRoutes(SALES_QUOTATION).close;

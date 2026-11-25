import { documentStatusRoutes } from '@/lib/salesDocumentRoutes';
import { SALES_QUOTATION } from '@/lib/salesDocuments';

// POST /api/sales-quotations/[id]/close-lines - Close Line: body { lineNums } - those open lines become CLOSED
export const { POST } = documentStatusRoutes(SALES_QUOTATION).closeLines;

import { documentStatusRoutes } from '@/lib/salesDocumentRoutes';
import { SALES_ORDER } from '@/lib/salesDocuments';

// POST /api/sales-orders/[id]/close-lines - Close Line: body { lineNums } - those open lines become CLOSED
export const { POST } = documentStatusRoutes(SALES_ORDER).closeLines;

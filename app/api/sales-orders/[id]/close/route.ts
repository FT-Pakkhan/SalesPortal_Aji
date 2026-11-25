import { documentStatusRoutes } from '@/lib/salesDocumentRoutes';
import { SALES_ORDER } from '@/lib/salesDocuments';

// POST /api/sales-orders/[id]/close - Close Doc: the OPEN document and its open lines become CLOSED
export const { POST } = documentStatusRoutes(SALES_ORDER).close;

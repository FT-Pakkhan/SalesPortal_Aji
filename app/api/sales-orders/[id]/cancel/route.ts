import { documentStatusRoutes } from '@/lib/salesDocumentRoutes';
import { SALES_ORDER } from '@/lib/salesDocuments';

// POST /api/sales-orders/[id]/cancel - Cancel Doc: a DRAFT / OPEN document nothing was copied from becomes CANCELED
export const { POST } = documentStatusRoutes(SALES_ORDER).cancel;

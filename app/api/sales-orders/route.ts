import { documentCollectionRoutes } from '@/lib/salesDocumentRoutes';
import { SALES_ORDER } from '@/lib/salesDocuments';

// GET /api/sales-orders - List sales orders (newest first)
// POST /api/sales-orders - Save a new order as DRAFT (no No. until it is confirmed)
export const { GET, POST } = documentCollectionRoutes(SALES_ORDER);

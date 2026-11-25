import { documentCollectionRoutes } from '@/lib/salesDocumentRoutes';
import { SALES_QUOTATION } from '@/lib/salesDocuments';

// GET /api/sales-quotations - List sales quotations (newest first)
// POST /api/sales-quotations - Save a new quotation as DRAFT (no No. until it is confirmed)
export const { GET, POST } = documentCollectionRoutes(SALES_QUOTATION);

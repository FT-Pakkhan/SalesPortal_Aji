import { documentItemRoutes } from '@/lib/salesDocumentRoutes';
import { SALES_QUOTATION } from '@/lib/salesDocuments';

// GET /api/sales-quotations/[id] - One sales quotation: header and lines
// PUT /api/sales-quotations/[id] - Update a DRAFT or OPEN quotation and replace its lines
export const { GET, PUT } = documentItemRoutes(SALES_QUOTATION);

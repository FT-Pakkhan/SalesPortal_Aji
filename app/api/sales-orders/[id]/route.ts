import { documentItemRoutes } from '@/lib/salesDocumentRoutes';
import { SALES_ORDER } from '@/lib/salesDocuments';

// GET /api/sales-orders/[id] - One sales order: header and lines
// PUT /api/sales-orders/[id] - Update a DRAFT or OPEN order and replace its lines
export const { GET, PUT } = documentItemRoutes(SALES_ORDER);

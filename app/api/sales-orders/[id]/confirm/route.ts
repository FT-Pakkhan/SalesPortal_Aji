import { documentConfirmRoute } from '@/lib/salesDocumentRoutes';
import { SALES_ORDER } from '@/lib/salesDocuments';

// POST /api/sales-orders/[id]/confirm - Assign the No., set it OPEN and record who confirmed it
export const { POST } = documentConfirmRoute(SALES_ORDER);

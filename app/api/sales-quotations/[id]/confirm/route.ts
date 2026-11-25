import { documentConfirmRoute } from '@/lib/salesDocumentRoutes';
import { SALES_QUOTATION } from '@/lib/salesDocuments';

// POST /api/sales-quotations/[id]/confirm - Assign the No., set it OPEN and record who confirmed it
export const { POST } = documentConfirmRoute(SALES_QUOTATION);

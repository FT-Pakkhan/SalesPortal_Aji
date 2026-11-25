import { documentCopySourceRoute } from '@/lib/salesDocumentRoutes';
import { SALES_ORDER } from '@/lib/salesDocuments';

// GET /api/sales-orders/copy-from?cardCode=C20000 - Open lines of OPEN sales quotations of that customer (Copy From)
export const { GET } = documentCopySourceRoute(SALES_ORDER);

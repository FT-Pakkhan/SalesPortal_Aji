'use client';

import SalesDocumentDetail from '@/components/sales/SalesDocumentDetail';
import { SALES_ORDER_SCREEN } from '@/components/sales/salesScreens';

export default function CreateSalesOrderPage() {
  return <SalesDocumentDetail config={SALES_ORDER_SCREEN} />;
}

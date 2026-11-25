'use client';

import SalesDocumentList from '@/components/sales/SalesDocumentList';
import { SALES_ORDER_SCREEN } from '@/components/sales/salesScreens';

export default function SalesOrderListPage() {
  return <SalesDocumentList config={SALES_ORDER_SCREEN} />;
}

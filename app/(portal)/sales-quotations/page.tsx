'use client';

import SalesDocumentList from '@/components/sales/SalesDocumentList';
import { SALES_QUOTATION_SCREEN } from '@/components/sales/salesScreens';

export default function SalesQuotationListPage() {
  return <SalesDocumentList config={SALES_QUOTATION_SCREEN} />;
}

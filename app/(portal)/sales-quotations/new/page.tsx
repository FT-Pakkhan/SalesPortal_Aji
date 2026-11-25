'use client';

import SalesDocumentDetail from '@/components/sales/SalesDocumentDetail';
import { SALES_QUOTATION_SCREEN } from '@/components/sales/salesScreens';

export default function CreateSalesQuotationPage() {
  return <SalesDocumentDetail config={SALES_QUOTATION_SCREEN} />;
}

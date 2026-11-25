'use client';

import SalesDocumentDetail from '@/components/sales/SalesDocumentDetail';
import { CREDIT_MEMO_SCREEN } from '@/components/sales/salesScreens';

export default function CreateCreditMemoPage() {
  return <SalesDocumentDetail config={CREDIT_MEMO_SCREEN} />;
}

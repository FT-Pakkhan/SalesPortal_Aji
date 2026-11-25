'use client';

import SalesDocumentList from '@/components/sales/SalesDocumentList';
import { CREDIT_MEMO_SCREEN } from '@/components/sales/salesScreens';

export default function CreditMemoListPage() {
  return <SalesDocumentList config={CREDIT_MEMO_SCREEN} />;
}

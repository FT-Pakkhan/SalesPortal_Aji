'use client';

import React, { use } from 'react';
import SalesDocumentDetail from '@/components/sales/SalesDocumentDetail';
import { SALES_ORDER_SCREEN } from '@/components/sales/salesScreens';

export default function SalesOrderDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ edit?: string }>;
}) {
  const { id } = use(params);
  // ?edit=1 (the list view's Edit button) opens straight in edit mode
  const { edit } = use(searchParams);
  return <SalesDocumentDetail config={SALES_ORDER_SCREEN} docEntry={parseInt(id)} startInEdit={edit === '1'} />;
}

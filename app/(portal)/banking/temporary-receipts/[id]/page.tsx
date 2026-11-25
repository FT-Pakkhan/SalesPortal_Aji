'use client';

import React, { use } from 'react';
import TemporaryReceiptDetail from '@/components/banking/TemporaryReceiptDetail';

export default function TemporaryReceiptDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ edit?: string }>;
}) {
  const { id } = use(params);
  // ?edit=1 (the list view's Edit button) opens straight in edit mode
  const { edit } = use(searchParams);
  return <TemporaryReceiptDetail docEntry={parseInt(id)} startInEdit={edit === '1'} />;
}

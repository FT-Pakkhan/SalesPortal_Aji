'use client';

import React, { use } from 'react';
import LeadDetail from '@/components/sales/LeadDetail';

export default function LeadDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ edit?: string }>;
}) {
  const { id } = use(params);
  // ?edit=1 (the list view's Edit button) opens straight in edit mode
  const { edit } = use(searchParams);
  return <LeadDetail docEntry={parseInt(id)} startInEdit={edit === '1'} />;
}

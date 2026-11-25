'use client';

import React, { use } from 'react';
import ApprovalStageDetail from '@/components/system/ApprovalStageDetail';

export default function ApprovalStageDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ edit?: string }>;
}) {
  const { id } = use(params);
  // ?edit=1 (the list view's Edit button) opens straight in edit mode
  const { edit } = use(searchParams);
  return <ApprovalStageDetail docEntry={parseInt(id)} startInEdit={edit === '1'} />;
}

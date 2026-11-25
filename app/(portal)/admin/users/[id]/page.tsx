'use client';

import React, { use } from 'react';
import UserDetail from '@/components/admin/UserDetail';

export default function UserDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ edit?: string }>;
}) {
  const { id } = use(params);
  // ?edit=1 (the list view's Edit button) opens straight in edit mode
  const { edit } = use(searchParams);
  return <UserDetail userId={parseInt(id)} startInEdit={edit === '1'} />;
}

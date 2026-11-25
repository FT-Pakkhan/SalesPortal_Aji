'use client';

import React from 'react';
import type { ColDef } from 'ag-grid-community';
import { usersAPI } from '@/lib/apiClient';
import { LookupListView } from '@/components/ui/LookupListView';
import type { PortalUserDetail } from '@/types';

interface UserLookupProps {
  open: boolean;
  title: string;
  /** Users already chosen — left out of the list */
  excludeIds: number[];
  onSelect: (users: PortalUserDetail[]) => void;
  onCancel: () => void;
}

const columnDefs: ColDef<PortalUserDetail>[] = [
  { field: 'userName', headerName: 'User Name', width: 200, sort: 'asc' },
  { field: 'displayName', headerName: 'Display Name', flex: 1, minWidth: 200 },
];

const loadActiveUsers = async (): Promise<PortalUserDetail[]> => {
  const res = await usersAPI.getList();
  return res.success ? res.data.filter((u) => u.isActive) : [];
};

/** Lookup list view of active users */
export default function UserLookup({ open, title, excludeIds, onSelect, onCancel }: UserLookupProps) {
  return (
    <LookupListView<PortalUserDetail>
      open={open}
      title={title}
      searchPlaceholder="Search users..."
      columnDefs={columnDefs}
      loadRows={loadActiveUsers}
      getKey={(u) => u.id}
      excludeKeys={excludeIds}
      onSelect={onSelect}
      onCancel={onCancel}
    />
  );
}

'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Button } from 'antd';
import { PlusOutlined, SyncOutlined, EditOutlined } from '@ant-design/icons';
import type { ColDef } from 'ag-grid-community';
import { useRouter } from 'next/navigation';
import { usersAPI } from '@/lib/apiClient';
import { useCanChange } from '@/stores/accessStore';
import { ListView } from '@/components/ui/ListView';
import type { PortalUserDetail } from '@/types';

export default function UserListPage() {
  const router = useRouter();
  // Read Only screen (the user's roles): no New
  const canChange = useCanChange();
  const [data, setData] = useState<PortalUserDetail[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const response = await usersAPI.getList();
      if (response.success) {
        setData(response.data);
      }
    } catch {
      setData([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const columnDefs = useMemo<ColDef<PortalUserDetail>[]>(() => [
    {
      // Edit button beside each record — opens the detail view in edit mode
      colId: 'edit',
      headerName: '',
      // Narrow, so the checkbox and the pencil sit close together
      width: 30,
      suppressAutoSize: true,
      sortable: false,
      resizable: false,
      filter: false,
      cellStyle: { padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' },
      cellRenderer: (p: { data?: PortalUserDetail }) => (
        <Button
          type="text"
          size="small"
          icon={<EditOutlined />}
          title="Edit"
          onClick={() => p.data && router.push(`/admin/users/${p.data.id}?edit=1`)}
        />
      ),
    },
    { field: 'userName', headerName: 'User Name', width: 180, sort: 'asc' },
    { field: 'displayName', headerName: 'Display Name', width: 220 },
    { field: 'email', headerName: 'E-mail', flex: 1, minWidth: 220 },
    // The user's SAP B1 Sales Employee (OSLP)
    { field: 'slpName', headerName: 'Sales Employee' },
    { field: 'isActive', headerName: 'Active', width: 130, cellDataType: 'boolean' },
  ], [router]);

  // Button order: New, Edit, then the rest
  const toolbar = (
    <>
      {canChange && (
        <Button type="primary" icon={<PlusOutlined />} onClick={() => router.push('/admin/users/new')}>
          New
        </Button>
      )}
      <Button icon={<SyncOutlined />} onClick={loadData}>Refresh</Button>
    </>
  );

  return (
    <ListView<PortalUserDetail>
      title="Users"
      toolbar={toolbar}
      searchPlaceholder="Search users..."
      onOpenRecord={(user) => router.push(`/admin/users/${user.id}`)}
      gridProps={{
        rowData: data,
        columnDefs,
        loading,
      }}
    />
  );
}

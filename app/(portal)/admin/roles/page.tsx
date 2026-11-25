'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Button } from 'antd';
import { PlusOutlined, SyncOutlined, EditOutlined } from '@ant-design/icons';
import type { ColDef } from 'ag-grid-community';
import { useRouter } from 'next/navigation';
import { rolesAPI } from '@/lib/apiClient';
import { useCanChange } from '@/stores/accessStore';
import { ListView } from '@/components/ui/ListView';
import type { Role } from '@/types';

export default function RoleListPage() {
  const router = useRouter();
  // Read Only: no New, no Edit buttons
  const canChange = useCanChange();
  const [data, setData] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const response = await rolesAPI.getList();
      if (response.success) setData(response.data);
    } catch {
      setData([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const columnDefs = useMemo<ColDef<Role>[]>(
    () => [
      ...(canChange
        ? [
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
              cellRenderer: (p: { data?: Role }) => (
                <Button
                  type="text"
                  size="small"
                  icon={<EditOutlined />}
                  title="Edit"
                  onClick={() => p.data && router.push(`/admin/roles/${p.data.docEntry}?edit=1`)}
                />
              ),
            } as ColDef<Role>,
          ]
        : []),
      { field: 'roleName', headerName: 'Role Name', sort: 'asc' },
      { field: 'isAdmin', headerName: 'Is Administrator', cellDataType: 'boolean' },
      { field: 'userCount', headerName: 'Users', cellDataType: 'number' },
    ],
    [router, canChange]
  );

  // Button order: New, Edit, then the rest
  const toolbar = (
    <>
      {canChange && (
        <Button type="primary" icon={<PlusOutlined />} onClick={() => router.push('/admin/roles/new')}>
          New
        </Button>
      )}
      <Button icon={<SyncOutlined />} onClick={loadData}>
        Refresh
      </Button>
    </>
  );

  return (
    <ListView<Role>
      title="Role"
      toolbar={toolbar}
      searchPlaceholder="Search roles..."
      onOpenRecord={(role) => router.push(`/admin/roles/${role.docEntry}`)}
      gridProps={{ rowData: data, columnDefs, loading, getRowId: (p) => String(p.data.docEntry) }}
    />
  );
}

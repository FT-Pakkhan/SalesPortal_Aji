'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Button } from 'antd';
import { PlusOutlined, SyncOutlined, EditOutlined } from '@ant-design/icons';
import type { ColDef } from 'ag-grid-community';
import { useRouter } from 'next/navigation';
import { printLayoutsAPI } from '@/lib/apiClient';
import { useCanChange } from '@/stores/accessStore';
import { ListView } from '@/components/ui/ListView';
import type { PrintLayout } from '@/types';

export default function PrintLayoutListPage() {
  const router = useRouter();
  // Read Only screen (the user's roles): no New
  const canChange = useCanChange();
  const [data, setData] = useState<PrintLayout[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const response = await printLayoutsAPI.getList();
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

  const columnDefs = useMemo<ColDef<PrintLayout>[]>(() => [
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
      cellRenderer: (p: { data?: PrintLayout }) => (
        <Button
          type="text"
          size="small"
          icon={<EditOutlined />}
          title="Edit"
          onClick={() => p.data && router.push(`/system/print-layouts/${p.data.docEntry}?edit=1`)}
        />
      ),
    },
    { field: 'layoutName', headerName: 'Layout Name', sort: 'asc' },
    { field: 'objDocName', headerName: 'Document' },
    { field: 'layoutPath', headerName: 'Layout Path' },
    { field: 'isActive', headerName: 'Active', cellDataType: 'boolean' },
    { field: 'emailAllowed', headerName: 'Allow E-mail', cellDataType: 'boolean' },
  ], [router]);

  // Button order: New, Edit, then the rest
  const toolbar = (
    <>
      {canChange && (
        <Button type="primary" icon={<PlusOutlined />} onClick={() => router.push('/system/print-layouts/new')}>
          New
        </Button>
      )}
      <Button icon={<SyncOutlined />} onClick={loadData}>Refresh</Button>
    </>
  );

  return (
    <ListView<PrintLayout>
      title="Layouts"
      toolbar={toolbar}
      searchPlaceholder="Search layouts..."
      onOpenRecord={(layout) => router.push(`/system/print-layouts/${layout.docEntry}`)}
      gridProps={{
        rowData: data,
        columnDefs,
        loading,
        getRowId: (p) => String(p.data.docEntry),
      }}
    />
  );
}

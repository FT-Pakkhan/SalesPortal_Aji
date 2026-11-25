'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Button } from 'antd';
import { PlusOutlined, SyncOutlined, EditOutlined } from '@ant-design/icons';
import type { ColDef } from 'ag-grid-community';
import { useRouter } from 'next/navigation';
import { documentNumberingAPI } from '@/lib/apiClient';
import { useCanChange } from '@/stores/accessStore';
import { ListView } from '@/components/ui/ListView';
import type { NumberingSeries } from '@/types';

export default function DocumentNumberingListPage() {
  const router = useRouter();
  // Read Only screen (the user's roles): no New
  const canChange = useCanChange();
  const [data, setData] = useState<NumberingSeries[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const response = await documentNumberingAPI.getList();
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

  const columnDefs = useMemo<ColDef<NumberingSeries>[]>(() => [
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
      cellRenderer: (p: { data?: NumberingSeries }) => (
        <Button
          type="text"
          size="small"
          icon={<EditOutlined />}
          title="Edit"
          onClick={() => p.data && router.push(`/system/document-numbering/${p.data.docEntry}?edit=1`)}
        />
      ),
    },
    { field: 'objTypeName', headerName: 'Doc. Object Type', sort: 'asc' },
    { field: 'series', headerName: 'Series' },
    { field: 'seriesName', headerName: 'Series Name' },
    { field: 'prefix', headerName: 'Prefix' },
    { field: 'seq', headerName: 'Seq', cellDataType: 'number' },
    { field: 'length', headerName: 'Length', cellDataType: 'number' },
    { field: 'suffix', headerName: 'Suffix' },
    { field: 'month', headerName: 'Month', cellDataType: 'boolean' },
    { field: 'year', headerName: 'Year', cellDataType: 'boolean' },
    { field: 'isManual', headerName: 'Manual', cellDataType: 'boolean' },
    { field: 'isDefault', headerName: 'Default', cellDataType: 'boolean' },
    { field: 'active', headerName: 'Active', cellDataType: 'boolean' },
  ], [router]);

  // Button order: New, Edit, then the rest
  const toolbar = (
    <>
      {canChange && (
        <Button type="primary" icon={<PlusOutlined />} onClick={() => router.push('/system/document-numbering/new')}>
          New
        </Button>
      )}
      <Button icon={<SyncOutlined />} onClick={loadData}>Refresh</Button>
    </>
  );

  return (
    <ListView<NumberingSeries>
      title="Document Numbering"
      toolbar={toolbar}
      searchPlaceholder="Search document numbering..."
      onOpenRecord={(series) => router.push(`/system/document-numbering/${series.docEntry}`)}
      gridProps={{
        rowData: data,
        columnDefs,
        loading,
      }}
    />
  );
}

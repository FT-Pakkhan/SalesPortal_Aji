'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Button } from 'antd';
import { PlusOutlined, SyncOutlined, EditOutlined } from '@ant-design/icons';
import type { ColDef } from 'ag-grid-community';
import { useRouter } from 'next/navigation';
import { reportSettingsAPI } from '@/lib/apiClient';
import { useCanChange } from '@/stores/accessStore';
import { ListView } from '@/components/ui/ListView';
import type { ReportSetting } from '@/types';

const LIST_PATH = '/system/report-settings';

export default function ReportSettingListPage() {
  const router = useRouter();
  // Read Only screen (the user's roles): no New
  const canChange = useCanChange();
  const [data, setData] = useState<ReportSetting[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const response = await reportSettingsAPI.getList();
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

  const columnDefs = useMemo<ColDef<ReportSetting>[]>(() => [
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
      cellRenderer: (p: { data?: ReportSetting }) => (
        <Button
          type="text"
          size="small"
          icon={<EditOutlined />}
          title="Edit"
          onClick={() => p.data && router.push(`${LIST_PATH}/${p.data.docEntry}?edit=1`)}
        />
      ),
    },
    { field: 'reportCode', headerName: 'Report Code' },
    { field: 'reportName', headerName: 'Report Name', sort: 'asc' },
    { field: 'category', headerName: 'Category' },
    { field: 'paramCount', headerName: 'Parameters', cellDataType: 'number' },
    { field: 'roleNames', headerName: 'Roles' },
    { colId: 'connection', headerName: 'Connection', valueGetter: (p) => (p.data?.useSapConn ? 'SAP DB' : 'Portal') },
    { field: 'reportPath', headerName: 'Report Path' },
    { field: 'isActive', headerName: 'Active', cellDataType: 'boolean' },
  ], [router]);

  // Button order: New, Edit, then the rest
  const toolbar = (
    <>
      {canChange && (
        <Button type="primary" icon={<PlusOutlined />} onClick={() => router.push(`${LIST_PATH}/new`)}>
          New
        </Button>
      )}
      <Button icon={<SyncOutlined />} onClick={loadData}>Refresh</Button>
    </>
  );

  return (
    <ListView<ReportSetting>
      title="Report Settings"
      toolbar={toolbar}
      searchPlaceholder="Search reports..."
      onOpenRecord={(r) => router.push(`${LIST_PATH}/${r.docEntry}`)}
      gridProps={{
        rowData: data,
        columnDefs,
        loading,
        getRowId: (p) => String(p.data.docEntry),
      }}
    />
  );
}

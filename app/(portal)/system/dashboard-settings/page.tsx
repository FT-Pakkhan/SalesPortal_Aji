'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Button } from 'antd';
import { PlusOutlined, SyncOutlined, EditOutlined } from '@ant-design/icons';
import type { ColDef } from 'ag-grid-community';
import { useRouter } from 'next/navigation';
import { dashboardSettingsAPI } from '@/lib/apiClient';
import { useCanChange } from '@/stores/accessStore';
import { ListView } from '@/components/ui/ListView';
import { VALUE_FORMAT_OPTIONS, WIDGET_TYPE_OPTIONS, WIDTH_OPTIONS } from '@/components/system/DashboardSettingDetail';
import type { DashboardWidgetSetting } from '@/types';

const LIST_PATH = '/system/dashboard-settings';
const labelOf = (options: { value: unknown; label: string }[], value: unknown) => options.find((o) => o.value === value)?.label ?? String(value ?? '');

export default function DashboardSettingListPage() {
  const router = useRouter();
  // Read Only screen (the user's roles): no New
  const canChange = useCanChange();
  const [data, setData] = useState<DashboardWidgetSetting[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const response = await dashboardSettingsAPI.getList();
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

  const columnDefs = useMemo<ColDef<DashboardWidgetSetting>[]>(() => [
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
      cellRenderer: (p: { data?: DashboardWidgetSetting }) => (
        <Button type="text" size="small" icon={<EditOutlined />} title="Edit" onClick={() => p.data && router.push(`${LIST_PATH}/${p.data.docEntry}?edit=1`)} />
      ),
    },
    { field: 'sequence', headerName: 'Sequence', cellDataType: 'number', sort: 'asc' },
    { field: 'widgetCode', headerName: 'Widget Code' },
    { field: 'title', headerName: 'Title' },
    { colId: 'widgetType', headerName: 'Widget Type', valueGetter: (p) => labelOf(WIDGET_TYPE_OPTIONS, p.data?.widgetType) },
    { colId: 'width', headerName: 'Width', valueGetter: (p) => labelOf(WIDTH_OPTIONS, p.data?.width) },
    { colId: 'valueFormat', headerName: 'Value Format', valueGetter: (p) => labelOf(VALUE_FORMAT_OPTIONS, p.data?.valueFormat) },
    { field: 'roleNames', headerName: 'Roles' },
    { colId: 'connection', headerName: 'Connection', valueGetter: (p) => (p.data?.useSapConn ? 'SAP DB' : 'Portal') },
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
    <ListView<DashboardWidgetSetting>
      title="Dashboard Settings"
      toolbar={toolbar}
      searchPlaceholder="Search widgets..."
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

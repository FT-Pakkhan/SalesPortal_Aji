'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { Button, Input } from 'antd';
import { EditOutlined, EnvironmentOutlined, PlusOutlined, SyncOutlined, UnorderedListOutlined } from '@ant-design/icons';
import type { ColDef, ICellRendererParams, ValueFormatterParams } from 'ag-grid-community';
import dayjs from 'dayjs';
import { useRouter } from 'next/navigation';
import { salesCheckInsAPI } from '@/lib/apiClient';
import { useCanChange } from '@/stores/accessStore';
import { ListView } from '@/components/ui/ListView';
import listStyles from '@/components/ui/ListView.module.css';
import { StatusTag } from '@/components/ui/StatusTag';
import { formatDuration } from '@/components/sales/checkInFormat';
import type { SalesCheckIn } from '@/types';

// Leaflet only runs in the browser
const CheckInMap = dynamic(() => import('@/components/sales/CheckInMap'), { ssr: false });

const LIST_PATH = '/sales-check-ins';

const dateTimeColumn = (field: keyof SalesCheckIn, headerName: string): ColDef<SalesCheckIn> => ({
  colId: field,
  headerName,
  cellDataType: 'date',
  valueGetter: (p) => (p.data?.[field] ? new Date(p.data[field] as string) : null),
  valueFormatter: (p: ValueFormatterParams<SalesCheckIn, Date | null>) => (p.value ? dayjs(p.value).format('DD.MM.YY HH:mm') : ''),
  wrapText: false,
  minWidth: 120,
});

/** Sales Check In: my Sales Employee's visits (all, if I have none), as a list or on a map */
export default function SalesCheckInListPage() {
  const router = useRouter();
  // Read Only screen (the user's roles): no New
  const canChange = useCanChange();
  const [data, setData] = useState<SalesCheckIn[]>([]);
  const [loading, setLoading] = useState(true);
  // Map View: the same visits as pins; the search box narrows them
  const [mapView, setMapView] = useState(false);
  const [mapSearch, setMapSearch] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const response = await salesCheckInsAPI.getList();
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

  const columnDefs = useMemo<ColDef<SalesCheckIn>[]>(
    () => [
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
        cellRenderer: (p: { data?: SalesCheckIn }) => (
          <Button
            type="text"
            size="small"
            icon={<EditOutlined />}
            title="Edit"
            onClick={() => p.data && router.push(`${LIST_PATH}/${p.data.docEntry}?edit=1`)}
          />
        ),
      },
      { field: 'docNum', headerName: 'No.' },
      {
        field: 'docStatusName',
        headerName: 'Status',
        cellRenderer: (p: ICellRendererParams<SalesCheckIn>) => <StatusTag code={p.data?.docStatus} label={p.data?.docStatusName} />,
      },
      { field: 'cardCode', headerName: 'Customer' },
      { field: 'cardName', headerName: 'Name' },
      { field: 'purpose', headerName: 'Purpose of Visit' },
      dateTimeColumn('checkInTime', 'Check In'),
      dateTimeColumn('checkOutTime', 'Check Out'),
      { colId: 'duration', headerName: 'Duration', valueGetter: (p) => formatDuration(p.data?.duration) },
      // Long: one line, the full address shows on hover (and on the visit's Location tab)
      { field: 'checkInAddress', headerName: 'Check In Address', wrapText: false, autoHeight: false, tooltipField: 'checkInAddress', maxWidth: 320 },
      { field: 'comments', headerName: 'Remarks' },
      { colId: 'visitedBy', headerName: 'Visited By', valueGetter: (p) => p.data?.userDisplayName || p.data?.userName || '' },
      { field: 'slpName', headerName: 'Sales Employee' },
    ],
    [router]
  );

  const mapVisits = useMemo(() => {
    const text = mapSearch.trim().toLowerCase();
    if (!text) return data;
    return data.filter((v) =>
      [v.docNum, v.cardCode, v.cardName, v.purpose, v.checkInAddress, v.slpName, v.userName]
        .some((s) => (s ?? '').toLowerCase().includes(text))
    );
  }, [data, mapSearch]);

  // Button order: New first, then the rest
  const toolbar = (
    <>
      {canChange && (
        <Button type="primary" icon={<PlusOutlined />} onClick={() => router.push(`${LIST_PATH}/new`)}>
          New
        </Button>
      )}
      <Button icon={<SyncOutlined />} onClick={loadData}>
        Refresh
      </Button>
      <Button
        icon={mapView ? <UnorderedListOutlined /> : <EnvironmentOutlined />}
        onClick={() => setMapView((on) => !on)}
      >
        {mapView ? 'List View' : 'Map View'}
      </Button>
    </>
  );

  if (mapView) {
    return (
      <div className={listStyles.root}>
        <div className={listStyles.toolbar}>{toolbar}</div>
        <h1 className={listStyles.title}>Sales Check In</h1>
        <div className={listStyles.searchRow}>
          <Input.Search
            placeholder="Search visits..."
            value={mapSearch}
            onChange={(e) => setMapSearch(e.target.value)}
            style={{ width: 250 }}
            allowClear
          />
          <span style={{ marginLeft: 12, color: '#6a6d70' }}>
            {mapVisits.length} visit(s) · green = check-in, blue = check-out · double-click a pin to open the visit
          </span>
        </div>
        <CheckInMap visits={mapVisits} height="calc(100vh - 230px)" onOpenVisit={(v) => router.push(`${LIST_PATH}/${v.docEntry}`)} />
      </div>
    );
  }

  return (
    <ListView<SalesCheckIn>
      title="Sales Check In"
      toolbar={toolbar}
      searchPlaceholder="Search visits..."
      onOpenRecord={(visit) => router.push(`${LIST_PATH}/${visit.docEntry}`)}
      gridProps={{
        rowData: data,
        columnDefs,
        loading,
        getRowId: (p) => String(p.data.docEntry),
      }}
    />
  );
}

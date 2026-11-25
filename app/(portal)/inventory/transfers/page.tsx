'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Button } from 'antd';
import { PlusOutlined, SyncOutlined, EditOutlined } from '@ant-design/icons';
import type { ColDef, ICellRendererParams, ValueFormatterParams } from 'ag-grid-community';
import dayjs from 'dayjs';
import { useRouter } from 'next/navigation';
import { inventoryTransfersAPI } from '@/lib/apiClient';
import { useCanChange } from '@/stores/accessStore';
import { ListView } from '@/components/ui/ListView';
import { StatusTag } from '@/components/ui/StatusTag';
import type { InventoryTransfer } from '@/types';
import { isDocumentEditable } from '@/lib/postStatus';

const LIST_PATH = '/inventory/transfers';

export default function InventoryTransferListPage() {
  const router = useRouter();
  // Read Only screen (the user's roles): no New
  const canChange = useCanChange();
  const [data, setData] = useState<InventoryTransfer[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const response = await inventoryTransfersAPI.getList();
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

  const columnDefs = useMemo<ColDef<InventoryTransfer>[]>(
    () => [
      {
        // Edit button beside each record — opens the detail view in edit mode; disabled like the detail view's Edit
        colId: 'edit',
        headerName: '',
        // Narrow, so the checkbox and the pencil sit close together
        width: 30,
        suppressAutoSize: true,
        sortable: false,
        resizable: false,
        filter: false,
        cellStyle: { padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' },
        cellRenderer: (p: { data?: InventoryTransfer }) =>
          p.data ? (
            <Button
              type="text"
              disabled={!(canChange && isDocumentEditable(p.data))}
              size="small"
              icon={<EditOutlined />}
              title="Edit"
              onClick={() => p.data && router.push(`${LIST_PATH}/${p.data.docEntry}?edit=1`)}
            />
          ) : null,
      },
      { field: 'docNum', headerName: 'No.' },
      {
        field: 'docStatusName',
        headerName: 'Status',
        cellRenderer: (p: ICellRendererParams<InventoryTransfer>) => <StatusTag code={p.data?.docStatus} label={p.data?.docStatusName} />,
      },
      {
        colId: 'docDate',
        headerName: 'Posting Date',
        cellDataType: 'date',
        valueGetter: (p) => (p.data?.docDate ? new Date(p.data.docDate) : null),
        valueFormatter: (p: ValueFormatterParams<InventoryTransfer, Date | null>) => (p.value ? dayjs(p.value).format('DD.MM.YY') : ''),
        wrapText: false,
        minWidth: 110,
      },
      { field: 'filler', headerName: 'From Warehouse' },
      { field: 'toWhsCode', headerName: 'To Warehouse' },
      { field: 'cardCode', headerName: 'Business Partner' },
      { field: 'lineCount', headerName: 'Lines', cellDataType: 'number' },
      {
        field: 'totalQuantity',
        headerName: 'Total Quantity',
        cellDataType: 'number',
        valueFormatter: (p: ValueFormatterParams) => (p.value == null ? '' : Number(p.value).toLocaleString('en-US', { maximumFractionDigits: 6 })),
      },
      { field: 'comments', headerName: 'Remarks' },
      {
        field: 'apprStatusName',
        headerName: 'Approval Status',
        cellRenderer: (p: ICellRendererParams<InventoryTransfer>) => <StatusTag code={p.data?.apprStatus} label={p.data?.apprStatusName} />,
      },
      {
        field: 'postStatusName',
        headerName: 'Posting Status',
        cellRenderer: (p: ICellRendererParams<InventoryTransfer>) => <StatusTag code={p.data?.postStatus} label={p.data?.postStatusName} />,
      },
      { field: 'errorDesc', headerName: 'Error Description' },
      { field: 'slpName', headerName: 'Sales Employee' },
    ],
    [router, canChange]
  );

  // Button order: New, Edit, then the rest
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
    </>
  );

  return (
    <ListView<InventoryTransfer>
      title="Inventory Transfer"
      toolbar={toolbar}
      searchPlaceholder="Search inventory transfers..."
      onOpenRecord={(t) => router.push(`${LIST_PATH}/${t.docEntry}`)}
      gridProps={{ rowData: data, columnDefs, loading, getRowId: (p) => String(p.data.docEntry) }}
    />
  );
}

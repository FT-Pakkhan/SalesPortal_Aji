'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Button } from 'antd';
import { PlusOutlined, SyncOutlined, EditOutlined } from '@ant-design/icons';
import type { ColDef, ICellRendererParams, ValueFormatterParams } from 'ag-grid-community';
import { useRouter } from 'next/navigation';
import dayjs from 'dayjs';
import { receiptRequestsAPI } from '@/lib/apiClient';
import { useCanChange } from '@/stores/accessStore';
import { ListView } from '@/components/ui/ListView';
import { StatusTag } from '@/components/ui/StatusTag';
import type { ReceiptRequest } from '@/types';
import { isDocumentEditable } from '@/lib/postStatus';

const LIST_PATH = '/banking/receipt-requests';

const money = (v: unknown) => Number(v ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Status column as a coloured tag: the name from the status view, coloured by the code */
const statusColumn = (
  field: 'docStatusName' | 'apprStatusName',
  codeField: 'docStatus' | 'apprStatus',
  headerName: string
): ColDef<ReceiptRequest> => ({
  field,
  headerName,
  cellRenderer: (p: ICellRendererParams<ReceiptRequest>) => <StatusTag code={p.data?.[codeField]} label={p.data?.[field]} />,
});

export default function ReceiptRequestListPage() {
  const router = useRouter();
  // Read Only screen (the user's roles): no New
  const canChange = useCanChange();
  const [data, setData] = useState<ReceiptRequest[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const response = await receiptRequestsAPI.getList();
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

  const columnDefs = useMemo<ColDef<ReceiptRequest>[]>(() => [
    {
      // Edit button beside each record - opens the detail view in edit mode; disabled like the detail view's Edit
      colId: 'edit',
      headerName: '',
      // Narrow, so the checkbox and the pencil sit close together
      width: 30,
      suppressAutoSize: true,
      sortable: false,
      resizable: false,
      filter: false,
      cellStyle: { padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' },
      cellRenderer: (p: { data?: ReceiptRequest }) =>
        p.data ? (
          <Button
            type="text"
            disabled={!(canChange && isDocumentEditable(p.data) && (p.data.receiptCount ?? 0) === 0)}
            size="small"
            icon={<EditOutlined />}
            title="Edit"
            onClick={() => p.data && router.push(`${LIST_PATH}/${p.data.docEntry}?edit=1`)}
          />
        ) : null,
    },
    { field: 'docNum', headerName: 'No.' },
    statusColumn('docStatusName', 'docStatus', 'Status'),
    { field: 'docDate', headerName: 'Posting Date', valueFormatter: (p: ValueFormatterParams) => (p.value ? dayjs(p.value).format('DD.MM.YY') : '') },
    { field: 'cardCode', headerName: 'Customer' },
    { field: 'cardName', headerName: 'Name' },
    { field: 'payTypName', headerName: 'Payment Type' },
    // The Amount is in the document's own currency
    { field: 'docCur', headerName: 'Currency', width: 100 },
    { field: 'docTotal', headerName: 'Amount', cellDataType: 'number', valueFormatter: (p: ValueFormatterParams) => money(p.value) },
    { field: 'copiedTotal', headerName: 'Copied to Receipts', cellDataType: 'number', valueFormatter: (p: ValueFormatterParams) => money(p.value) },
    statusColumn('apprStatusName', 'apprStatus', 'Approval Status'),
    { field: 'slpName', headerName: 'Sales Employee' },
  ], [router, canChange]);

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
    <ListView<ReceiptRequest>
      title="Temporary Receipt Request"
      toolbar={toolbar}
      searchPlaceholder="Search temporary receipt requests..."
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

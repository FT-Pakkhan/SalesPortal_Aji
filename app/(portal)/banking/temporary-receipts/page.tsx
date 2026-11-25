'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Button } from 'antd';
import { PlusOutlined, SyncOutlined, EditOutlined } from '@ant-design/icons';
import type { ColDef, ICellRendererParams, ValueFormatterParams } from 'ag-grid-community';
import { useRouter } from 'next/navigation';
import dayjs from 'dayjs';
import { temporaryReceiptsAPI } from '@/lib/apiClient';
import { useCanChange } from '@/stores/accessStore';
import { ListView } from '@/components/ui/ListView';
import { StatusTag } from '@/components/ui/StatusTag';
import type { TemporaryReceipt } from '@/types';
import { isDocumentEditable } from '@/lib/postStatus';

const LIST_PATH = '/banking/temporary-receipts';

/** Status column as a coloured tag: the name from the status view, coloured by the code */
const statusColumn = (
  field: 'docStatusName' | 'apprStatusName' | 'postStatusName',
  codeField: 'docStatus' | 'apprStatus' | 'postStatus',
  headerName: string
): ColDef<TemporaryReceipt> => ({
  field,
  headerName,
  cellRenderer: (p: ICellRendererParams<TemporaryReceipt>) => <StatusTag code={p.data?.[codeField]} label={p.data?.[field]} />,
});

export default function TemporaryReceiptListPage() {
  const router = useRouter();
  // Read Only screen (the user's roles): no New
  const canChange = useCanChange();
  const [data, setData] = useState<TemporaryReceipt[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const response = await temporaryReceiptsAPI.getList();
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

  const columnDefs = useMemo<ColDef<TemporaryReceipt>[]>(() => [
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
      cellRenderer: (p: { data?: TemporaryReceipt }) =>
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
    statusColumn('docStatusName', 'docStatus', 'Status'),
    { field: 'docDate', headerName: 'Posting Date', valueFormatter: (p: ValueFormatterParams) => (p.value ? dayjs(p.value).format('DD.MM.YY') : '') },
    { field: 'cardCode', headerName: 'Customer' },
    { field: 'cardName', headerName: 'Name' },
    { field: 'payTypName', headerName: 'Payment Type' },
    // The Amount is in the document's own currency
    { field: 'docCur', headerName: 'Currency', width: 100 },
    {
      field: 'docTotal',
      headerName: 'Amount',
      cellDataType: 'number',
      valueFormatter: (p: ValueFormatterParams<TemporaryReceipt, number>) =>
        Number(p.value ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    },
    statusColumn('apprStatusName', 'apprStatus', 'Approval Status'),
    statusColumn('postStatusName', 'postStatus', 'Posting Status'),
    { field: 'errorDesc', headerName: 'Error Description' },
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
    <ListView<TemporaryReceipt>
      title="Temporary Receipt"
      toolbar={toolbar}
      searchPlaceholder="Search temporary receipts..."
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

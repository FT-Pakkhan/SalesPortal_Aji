'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Button } from 'antd';
import { PlusOutlined, SyncOutlined, EditOutlined } from '@ant-design/icons';
import type { ColDef, ICellRendererParams } from 'ag-grid-community';
import { useRouter } from 'next/navigation';
import dayjs from 'dayjs';
import { customerConversionsAPI } from '@/lib/apiClient';
import { useCanChange } from '@/stores/accessStore';
import { ListView } from '@/components/ui/ListView';
import { StatusTag } from '@/components/ui/StatusTag';
import type { CustomerConversion } from '@/types';
import { isDocumentEditable } from '@/lib/postStatus';

const LIST_PATH = '/convert-to-customer';

export default function CustomerConversionListPage() {
  const router = useRouter();
  // Read Only screen (the user's roles): no New
  const canChange = useCanChange();
  const [data, setData] = useState<CustomerConversion[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const response = await customerConversionsAPI.getList();
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

  const columnDefs = useMemo<ColDef<CustomerConversion>[]>(() => [
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
      cellRenderer: (p: { data?: CustomerConversion }) =>
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
      cellRenderer: (p: ICellRendererParams<CustomerConversion>) => <StatusTag code={p.data?.docStatus} label={p.data?.docStatusName} />,
    },
    { field: 'docDate', headerName: 'Date', valueFormatter: (p) => (p.value ? dayjs(p.value).format('DD.MM.YY') : '') },
    { field: 'leadCode', headerName: 'Lead Code' },
    { field: 'leadName', headerName: 'Company Name' },
    { field: 'cardCode', headerName: 'SAP BP Code' },
    {
      field: 'apprStatusName',
      headerName: 'Approval Status',
      cellRenderer: (p: ICellRendererParams<CustomerConversion>) => <StatusTag code={p.data?.apprStatus} label={p.data?.apprStatusName} />,
    },
    {
      field: 'postStatusName',
      headerName: 'Posting Status',
      cellRenderer: (p: ICellRendererParams<CustomerConversion>) => <StatusTag code={p.data?.postStatus} label={p.data?.postStatusName} />,
    },
    { field: 'errorDesc', headerName: 'Error Description' },
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
    <ListView<CustomerConversion>
      title="Convert to Customer"
      toolbar={toolbar}
      searchPlaceholder="Search convert to customer..."
      onOpenRecord={(c) => router.push(`${LIST_PATH}/${c.docEntry}`)}
      gridProps={{
        rowData: data,
        columnDefs,
        loading,
        getRowId: (p) => String(p.data.docEntry),
      }}
    />
  );
}

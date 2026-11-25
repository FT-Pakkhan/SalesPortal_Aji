'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Button } from 'antd';
import { PlusOutlined, SyncOutlined, EditOutlined } from '@ant-design/icons';
import type { ColDef, ICellRendererParams } from 'ag-grid-community';
import { useRouter } from 'next/navigation';
import { leadsAPI } from '@/lib/apiClient';
import { useCanChange } from '@/stores/accessStore';
import { ListView } from '@/components/ui/ListView';
import { StatusTag } from '@/components/ui/StatusTag';
import type { Lead } from '@/types';
import { isDocumentEditable } from '@/lib/postStatus';

export default function LeadListPage() {
  const router = useRouter();
  // Read Only screen (the user's roles): no New
  const canChange = useCanChange();
  const [data, setData] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const response = await leadsAPI.getList();
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

  const columnDefs = useMemo<ColDef<Lead>[]>(() => [
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
      cellRenderer: (p: { data?: Lead }) =>
        p.data ? (
          <Button
            type="text"
            disabled={!(canChange && isDocumentEditable(p.data))}
            size="small"
            icon={<EditOutlined />}
            title="Edit"
            onClick={() => p.data && router.push(`/leads/${p.data.docEntry}?edit=1`)}
          />
        ) : null,
    },
    { field: 'leadCode', headerName: 'Lead Code' },
    {
      field: 'docStatusName',
      headerName: 'Status',
      cellRenderer: (p: ICellRendererParams<Lead>) => <StatusTag code={p.data?.docStatus} label={p.data?.docStatusName} />,
    },
    { field: 'leadName', headerName: 'Lead Name' },
    // The SAP customer it became through Convert to Customer
    { field: 'cardCode', headerName: 'Customer' },
    {
      field: 'apprStatusName',
      headerName: 'Approval Status',
      cellRenderer: (p: ICellRendererParams<Lead>) => <StatusTag code={p.data?.apprStatus} label={p.data?.apprStatusName} />,
    },
  ], [router, canChange]);

  // Button order: New, Edit, then the rest
  const toolbar = (
    <>
      {canChange && (
        <Button type="primary" icon={<PlusOutlined />} onClick={() => router.push('/leads/new')}>
          New
        </Button>
      )}
      <Button icon={<SyncOutlined />} onClick={loadData}>Refresh</Button>
    </>
  );

  return (
    <ListView<Lead>
      title="Lead"
      toolbar={toolbar}
      searchPlaceholder="Search leads..."
      onOpenRecord={(lead) => router.push(`/leads/${lead.docEntry}`)}
      gridProps={{
        rowData: data,
        columnDefs,
        loading,
        getRowId: (p) => String(p.data.docEntry),
      }}
    />
  );
}

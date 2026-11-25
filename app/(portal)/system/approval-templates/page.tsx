'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Button } from 'antd';
import { PlusOutlined, SyncOutlined, EditOutlined } from '@ant-design/icons';
import type { ColDef } from 'ag-grid-community';
import { useRouter } from 'next/navigation';
import { approvalTemplatesAPI } from '@/lib/apiClient';
import { useCanChange } from '@/stores/accessStore';
import { ListView } from '@/components/ui/ListView';
import type { ApprovalTemplate } from '@/types';

export default function ApprovalTemplateListPage() {
  const router = useRouter();
  // Read Only screen (the user's roles): no New
  const canChange = useCanChange();
  const [data, setData] = useState<ApprovalTemplate[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const response = await approvalTemplatesAPI.getList();
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

  const columnDefs = useMemo<ColDef<ApprovalTemplate>[]>(() => [
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
      cellRenderer: (p: { data?: ApprovalTemplate }) => (
        <Button
          type="text"
          size="small"
          icon={<EditOutlined />}
          title="Edit"
          onClick={() => p.data && router.push(`/system/approval-templates/${p.data.docEntry}?edit=1`)}
        />
      ),
    },
    { field: 'wtmCode', headerName: 'Template Code', width: 260, sort: 'asc' },
    { field: 'wtmName', headerName: 'Description', flex: 1, minWidth: 260 },
    { field: 'objDocName', headerName: 'Document', width: 200 },
    { field: 'active', headerName: 'Active', width: 110, cellDataType: 'boolean' },
  ], [router]);

  // Button order: New, Edit, then the rest
  const toolbar = (
    <>
      {canChange && (
        <Button type="primary" icon={<PlusOutlined />} onClick={() => router.push('/system/approval-templates/new')}>
          New
        </Button>
      )}
      <Button icon={<SyncOutlined />} onClick={loadData}>Refresh</Button>
    </>
  );

  return (
    <ListView<ApprovalTemplate>
      title="Approval Template"
      toolbar={toolbar}
      searchPlaceholder="Search approval templates..."
      onOpenRecord={(template) => router.push(`/system/approval-templates/${template.docEntry}`)}
      gridProps={{
        rowData: data,
        columnDefs,
        loading,
      }}
    />
  );
}

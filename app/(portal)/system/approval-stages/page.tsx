'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Button } from 'antd';
import { PlusOutlined, SyncOutlined, EditOutlined } from '@ant-design/icons';
import type { ColDef } from 'ag-grid-community';
import { useRouter } from 'next/navigation';
import { approvalStagesAPI } from '@/lib/apiClient';
import { useCanChange } from '@/stores/accessStore';
import { ListView } from '@/components/ui/ListView';
import type { ApprovalStage } from '@/types';

export default function ApprovalStageListPage() {
  const router = useRouter();
  // Read Only screen (the user's roles): no New
  const canChange = useCanChange();
  const [data, setData] = useState<ApprovalStage[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const response = await approvalStagesAPI.getList();
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

  const columnDefs = useMemo<ColDef<ApprovalStage>[]>(() => [
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
      cellRenderer: (p: { data?: ApprovalStage }) => (
        <Button
          type="text"
          size="small"
          icon={<EditOutlined />}
          title="Edit"
          onClick={() => p.data && router.push(`/system/approval-stages/${p.data.docEntry}?edit=1`)}
        />
      ),
    },
    { field: 'wstCode', headerName: 'Stage Code', width: 240, sort: 'asc' },
    { field: 'wstName', headerName: 'Description', flex: 1, minWidth: 240 },
    { field: 'maxReqr', headerName: 'Approval Required', width: 170 },
  ], [router]);

  // Button order: New, Edit, then the rest
  const toolbar = (
    <>
      {canChange && (
        <Button type="primary" icon={<PlusOutlined />} onClick={() => router.push('/system/approval-stages/new')}>
          New
        </Button>
      )}
      <Button icon={<SyncOutlined />} onClick={loadData}>Refresh</Button>
    </>
  );

  return (
    <ListView<ApprovalStage>
      title="Approval Stage"
      toolbar={toolbar}
      searchPlaceholder="Search approval stages..."
      onOpenRecord={(stage) => router.push(`/system/approval-stages/${stage.docEntry}`)}
      gridProps={{
        rowData: data,
        columnDefs,
        loading,
      }}
    />
  );
}

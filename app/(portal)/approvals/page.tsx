'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Button } from 'antd';
import { SyncOutlined } from '@ant-design/icons';
import type { ColDef } from 'ag-grid-community';
import dayjs from 'dayjs';
import { useRouter } from 'next/navigation';
import { approvalsAPI } from '@/lib/apiClient';
import { ListView } from '@/components/ui/ListView';
import { CREDIT_MEMO_SCREEN, SALES_ORDER_SCREEN, SALES_QUOTATION_SCREEN } from '@/components/sales/salesScreens';
import type { MyApproval } from '@/types';

/** Where each document type opens (its detail view shows Approve / Reject) */
const SCREEN_PATHS: Record<string, string> = {
  [SALES_QUOTATION_SCREEN.objType]: SALES_QUOTATION_SCREEN.listPath,
  [SALES_ORDER_SCREEN.objType]: SALES_ORDER_SCREEN.listPath,
  [CREDIT_MEMO_SCREEN.objType]: CREDIT_MEMO_SCREEN.listPath,
  FTS11LEAD: '/leads',
  FTS11OCRD: '/convert-to-customer',
  FTS11TMPR: '/banking/temporary-receipts',
  FTS11OTRQ: '/banking/receipt-requests',
  FTS11OWTR: '/inventory/transfers',
};

const formatDate = (value: string | null | undefined, withTime = false) =>
  value ? dayjs(value).format(withTime ? 'DD.MM.YY HH:mm' : 'DD.MM.YY') : '';

/** Approvals: the documents waiting for my approval — only those where it is my stage's turn */
export default function ApprovalsPage() {
  const router = useRouter();
  const [data, setData] = useState<MyApproval[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const response = await approvalsAPI.getMine();
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

  const columnDefs = useMemo<ColDef<MyApproval>[]>(
    () => [
      { field: 'objTypeName', headerName: 'Document' },
      // Waiting documents have no No. yet: they get it once approved
      { colId: 'draft', headerName: 'Draft No.', valueGetter: (p) => p.data?.docEntry, cellDataType: 'number' },
      { field: 'cardCode', headerName: 'Customer' },
      { field: 'cardName', headerName: 'Name' },
      { colId: 'docDate', headerName: 'Posting Date', valueGetter: (p) => formatDate(p.data?.docDate) },
      {
        field: 'docTotal',
        headerName: 'Total',
        cellDataType: 'number',
        valueFormatter: (p) => (p.value == null ? '' : Number(p.value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })),
      },
      { field: 'wtmName', headerName: 'Approval Template' },
      { colId: 'stage', headerName: 'Stage', valueGetter: (p) => (p.data ? `${p.data.stageNo}. ${p.data.wstName}` : '') },
      { field: 'sentBy', headerName: 'Sent By' },
      { colId: 'sentDate', headerName: 'Sent On', valueGetter: (p) => formatDate(p.data?.sentDate, true), sort: 'asc' },
    ],
    []
  );

  const toolbar = (
    <Button icon={<SyncOutlined />} onClick={loadData}>
      Refresh
    </Button>
  );

  return (
    <ListView<MyApproval>
      title="Approvals"
      toolbar={toolbar}
      searchPlaceholder="Search approvals..."
      onOpenRecord={(a) => {
        const path = SCREEN_PATHS[a.objType];
        // ?from=approvals: an approver without access to that screen may still open it (read only) to decide
        if (path) router.push(`${path}/${a.docEntry}?from=approvals`);
      }}
      gridProps={{
        rowData: data,
        columnDefs,
        loading,
        getRowId: (p) => `${p.data.objType}-${p.data.docEntry}-${p.data.wtmCode}`,
      }}
    />
  );
}

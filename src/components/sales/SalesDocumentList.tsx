'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Button } from 'antd';
import { PlusOutlined, SyncOutlined, EditOutlined } from '@ant-design/icons';
import type { ColDef, ICellRendererParams, ValueFormatterParams } from 'ag-grid-community';
import { useRouter } from 'next/navigation';
import dayjs from 'dayjs';
import { ListView } from '@/components/ui/ListView';
import { useCanChange } from '@/stores/accessStore';
import { StatusTag } from '@/components/ui/StatusTag';
import { DOC_DATE_FORMAT } from '@/components/sales/SalesDocumentDetail';
import type { SalesDocumentScreen } from '@/components/sales/SalesDocumentDetail';
import type { SalesDocument } from '@/types';
import { isDocumentEditable } from '@/lib/postStatus';

/** Date column: real dates (so sorting and the date filter work), shown as DD.MM.YY */
const dateColumn = (field: 'docDate' | 'docDueDate', headerName: string): ColDef<SalesDocument> => ({
  colId: field,
  headerName,
  width: 150,
  cellDataType: 'date',
  valueGetter: (p) => (p.data?.[field] ? new Date(p.data[field]) : null),
  valueFormatter: (p: ValueFormatterParams<SalesDocument, Date | null>) =>
    p.value ? dayjs(p.value).format(DOC_DATE_FORMAT) : '',
});

/**
 * Status column shown as a coloured tag: the name from the status view, coloured by the code.
 * Search, filter, sort and Export still use the plain name.
 */
const statusColumn = (
  field: 'docStatusName' | 'apprStatusName' | 'postStatusName',
  codeField: 'docStatus' | 'apprStatus' | 'postStatus',
  headerName: string
): ColDef<SalesDocument> => ({
  field,
  headerName,
  cellRenderer: (p: ICellRendererParams<SalesDocument>) => (
    <StatusTag code={p.data?.[codeField]} label={p.data?.[field]} />
  ),
});

/** List view of a sales document type (Sales Quotation, Sales Order, ...); `config` says which one */
export default function SalesDocumentList({ config }: { config: SalesDocumentScreen }) {
  const router = useRouter();
  // Read Only screen (the user's roles): no New
  const canChange = useCanChange();
  const [data, setData] = useState<SalesDocument[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const response = await config.api.getList();
      if (response.success) {
        setData(response.data);
      }
    } catch {
      setData([]);
    } finally {
      setLoading(false);
    }
  }, [config]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const columnDefs = useMemo<ColDef<SalesDocument>[]>(() => [
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
      cellRenderer: (p: { data?: SalesDocument }) =>
        p.data ? (
          <Button
            type="text"
            disabled={!(canChange && isDocumentEditable(p.data))}
            size="small"
            icon={<EditOutlined />}
            title="Edit"
            onClick={() => p.data && router.push(`${config.listPath}/${p.data.docEntry}?edit=1`)}
          />
        ) : null,
    },
    { field: 'docNum', headerName: 'No.', width: 140 },
    statusColumn('docStatusName', 'docStatus', 'Status'),
    { field: 'cardCode', headerName: 'Customer', width: 150 },
    { field: 'cardName', headerName: 'Name', flex: 1, minWidth: 220 },
    dateColumn('docDate', 'Posting Date'),
    dateColumn('docDueDate', config.dueDateLabel ?? 'Delivery Date'),
    // The total in the document's own currency (Currency), and in the local currency
    { field: 'docCur', headerName: 'Currency', width: 100 },
    {
      colId: 'docTotalDoc',
      headerName: 'Total',
      cellDataType: 'number',
      valueGetter: (p) => (p.data ? (Number(p.data.docTotalFC) ? Number(p.data.docTotalFC) : Number(p.data.docTotal)) : null),
      valueFormatter: (p: ValueFormatterParams<SalesDocument, number>) =>
        Number(p.value ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    },
    {
      field: 'docTotal',
      headerName: 'Total (LC)',
      cellDataType: 'number',
      valueFormatter: (p: ValueFormatterParams<SalesDocument, number>) =>
        Number(p.value ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    },
    // After Total: approval and posting to SAP B1 (names from FTS_vw_ApprStatus / FTS_vw_PostStatus),
    // and the error SAP B1 returned when posting failed (last, as it can be long)
    statusColumn('apprStatusName', 'apprStatus', 'Approval Status'),
    statusColumn('postStatusName', 'postStatus', 'Posting Status'),
    { field: 'errorDesc', headerName: 'Error Description' },
    { field: 'slpName', headerName: 'Sales Employee', width: 180 },
  ], [router, config, canChange]);

  // Button order: New, Edit, then the rest
  const toolbar = (
    <>
      {canChange && (
        <Button type="primary" icon={<PlusOutlined />} onClick={() => router.push(`${config.listPath}/new`)}>
          New
        </Button>
      )}
      <Button icon={<SyncOutlined />} onClick={loadData}>Refresh</Button>
    </>
  );

  return (
    <ListView<SalesDocument>
      title={config.title}
      toolbar={toolbar}
      searchPlaceholder={`Search ${config.title.toLowerCase()}s...`}
      onOpenRecord={(d) => router.push(`${config.listPath}/${d.docEntry}`)}
      gridProps={{
        rowData: data,
        columnDefs,
        loading,
      }}
    />
  );
}

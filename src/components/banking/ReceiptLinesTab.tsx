'use client';

import React, { useMemo, useRef, useState } from 'react';
import { App, Button } from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import type { ColDef, ValueFormatterParams } from 'ag-grid-community';
import dayjs from 'dayjs';
import { temporaryReceiptsAPI } from '@/lib/apiClient';
import { DataGrid } from '@/components/ui/DataGrid';
import type { DataGridHandle } from '@/components/ui/DataGrid';
import { LookupListView } from '@/components/ui/LookupListView';
import type { ReceiptOpenItem, TemporaryReceiptLine } from '@/types';

/** The SAP journal line an item is: one per receipt */
export const receiptLineKey = (l: { transId: number; lineId: number }) => `${l.transId}/${l.lineId}`;

const formatAmount = (p: ValueFormatterParams) =>
  p.value == null || p.value === '' ? '' : Number(p.value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const dateColumn = <T,>(field: string, headerName: string): ColDef<T> => ({
  colId: field,
  headerName,
  cellDataType: 'date',
  valueGetter: (p) => {
    const v = (p.data as Record<string, unknown> | undefined)?.[field];
    return v ? new Date(v as string) : null;
  },
  valueFormatter: (p: ValueFormatterParams<T, Date | null>) => (p.value ? dayjs(p.value).format('DD.MM.YY') : ''),
});

/** Columns of an open item, in the lines grid and in Choose Documents */
function itemColumns<T extends ReceiptOpenItem>(): ColDef<T>[] {
  return [
    { field: 'docType' as never, headerName: 'Doc Type' },
    { field: 'docNum' as never, headerName: 'No.' },
    dateColumn<T>('postingDate', 'Posting Date'),
    dateColumn<T>('dueDate', 'Due Date'),
    // The document's own currency; its Balance Due is shown in the receipt's (converted at SAP's rate that day)
    { field: 'itemCur' as never, headerName: 'Doc. Currency', width: 120 },
    { field: 'balanceDue' as never, headerName: 'Balance Due', cellDataType: 'number', valueFormatter: formatAmount },
  ];
}

interface ReceiptLinesTabProps {
  /** The receipt's lines (kept by the receipt screen and sent with Save) */
  lines: TemporaryReceiptLine[];
  onChange: (lines: TemporaryReceiptLine[]) => void;
  editing: boolean;
  /** The receipt's customer: its open items are offered */
  cardCode: string | undefined;
  /** The receipt being edited (omit for a new one) */
  docEntry?: number;
  /** The receipt's currency and Posting Date (YYYY-MM-DD): documents in it or the local currency, balances in it */
  currency?: string;
  docDate?: string;
}

/**
 * Details tab of a Temporary Receipt: the open SAP items it pays (like the documents of an incoming payment).
 * New (edit mode) = Choose Documents: the customer's open items (FTS_fn_UnreconciledDocs), less those already on
 * this receipt or held by another one. Amount Applied starts at the balance due and can be lowered (part payment);
 * a credit item (minus balance) is applied as a minus. The server checks it all again on Save.
 */
export function ReceiptLinesTab({ lines, onChange, editing, cardCode, docEntry, currency, docDate }: ReceiptLinesTabProps) {
  const { message } = App.useApp();
  const gridRef = useRef<DataGridHandle<TemporaryReceiptLine>>(null);
  const [chooseOpen, setChooseOpen] = useState(false);

  const handleNew = () => {
    if (!cardCode) {
      message.warning('Choose a Customer first');
      return;
    }
    setChooseOpen(true);
  };

  const handleDelete = () => {
    const ticked = gridRef.current?.getSelectedRows() ?? [];
    if (ticked.length === 0) {
      message.warning('Tick the lines first');
      return;
    }
    const keys = new Set(ticked.map(receiptLineKey));
    onChange(lines.filter((l) => !keys.has(receiptLineKey(l))));
  };

  const columns = useMemo<ColDef<TemporaryReceiptLine>[]>(
    () => [
      { colId: 'lineNo', headerName: '#', valueGetter: (p) => (p.node?.rowIndex ?? 0) + 1, sortable: false, cellDataType: 'number' },
      ...itemColumns<TemporaryReceiptLine>(),
      {
        field: 'sumApplied',
        headerName: 'Amount Applied',
        cellDataType: 'number',
        valueFormatter: formatAmount,
        editable: editing,
        valueParser: (p) => {
          const n = Number(p.newValue);
          return Number.isFinite(n) ? Math.round(n * 100) / 100 : p.oldValue;
        },
      },
    ],
    [editing]
  );

  const chooseColumns = useMemo<ColDef<ReceiptOpenItem>[]>(
    () => [
      ...itemColumns<ReceiptOpenItem>(),
      { field: 'daysOverdue', headerName: 'Days Overdue', cellDataType: 'number' },
    ],
    []
  );

  // Button order: New first, then the rest; Reset View Settings is added by the grid
  const toolbar = editing ? (
    <>
      <Button size="small" icon={<PlusOutlined />} onClick={handleNew}>
        New
      </Button>
      <Button size="small" icon={<DeleteOutlined />} onClick={handleDelete}>
        Delete
      </Button>
    </>
  ) : null;

  return (
    <>
      <DataGrid<TemporaryReceiptLine>
        handleRef={gridRef}
        settingsKey="lines:FTS11TMPR"
        showToolbar
        toolbar={toolbar}
        selectable={editing}
        gridProps={{
          rowData: lines,
          columnDefs: columns,
          getRowId: (p) => receiptLineKey(p.data),
          suppressCellFocus: false,
          singleClickEdit: true,
          stopEditingWhenCellsLoseFocus: true,
          onCellValueChanged: () => onChange([...lines]),
        }}
      />

      <LookupListView<ReceiptOpenItem>
        open={chooseOpen}
        title="Choose Documents"
        searchPlaceholder="Search documents..."
        columnDefs={chooseColumns}
        width={860}
        loadRows={async () => {
          const res = await temporaryReceiptsAPI.getOpenItems(cardCode as string, docEntry, currency, docDate);
          return res.success ? res.data : [];
        }}
        getKey={receiptLineKey}
        excludeKeys={lines.map(receiptLineKey)}
        onCancel={() => setChooseOpen(false)}
        onSelect={(picked) => {
          setChooseOpen(false);
          // The whole balance due to start with (a credit item as a minus)
          onChange([...lines, ...picked.map((item) => ({ ...item, sumApplied: Number(item.balanceDue) }))]);
        }}
      />
    </>
  );
}

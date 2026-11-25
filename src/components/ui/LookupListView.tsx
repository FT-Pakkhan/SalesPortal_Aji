'use client';

import React, { useEffect, useRef, useState } from 'react';
import { App, Input, Modal } from 'antd';
import type { ColDef } from 'ag-grid-community';
import { DataGrid } from './DataGrid';
import type { DataGridHandle } from './DataGrid';

interface LookupListViewProps<T> {
  open: boolean;
  title: string;
  searchPlaceholder?: string;
  columnDefs: ColDef<T>[];
  /** Loads the records to choose from each time the popup opens */
  loadRows: () => Promise<T[]>;
  /** Unique key of a record */
  getKey: (row: T) => number | string;
  /** Records already chosen — left out of the list */
  excludeKeys: (number | string)[];
  /** Pick exactly one record by clicking it (no checkboxes, no OK button) instead of ticking several */
  singleSelect?: boolean;
  /**
   * With checkboxes: clicking a record chooses it at once (as singleSelect). Once a checkbox is ticked, clicking a
   * record ticks / unticks it instead, and OK chooses the ticked ones.
   */
  clickToChoose?: boolean;
  /** Popup width in pixels (default 640); wider for lists with many columns */
  width?: number;
  onSelect: (rows: T[]) => void;
  onCancel: () => void;
}

/** Lookup list view: a popup list to pick one or more records (tick them, then OK) */
export function LookupListView<T>({
  open,
  title,
  searchPlaceholder,
  columnDefs,
  loadRows,
  getKey,
  excludeKeys,
  singleSelect = false,
  clickToChoose = false,
  width = 640,
  onSelect,
  onCancel,
}: LookupListViewProps<T>) {
  const { message } = App.useApp();
  const gridRef = useRef<DataGridHandle<T>>(null);
  const [rows, setRows] = useState<T[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  // The popup has finished zooming in: rows are only shown then, as columns best-fitted mid-zoom come out a few
  // pixels wide (text one letter per line) until the popup is fully open
  const [opened, setOpened] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSearch('');
    // Start empty: rows kept from the last opening would be drawn (and best-fitted) mid-animation
    setRows([]);
    const load = async () => {
      setLoading(true);
      try {
        const all = await loadRows();
        setRows(all.filter((row) => !excludeKeys.includes(getKey(row))));
      } catch {
        message.error('Failed to load the list');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [open]);

  const handleOk = () => {
    const selected = gridRef.current?.getSelectedRows() ?? [];
    if (selected.length === 0) {
      message.warning('Tick at least one record');
      return;
    }
    onSelect(selected);
  };

  const handleClick = (row: T) => {
    if (singleSelect) return onSelect([row]);
    const grid = gridRef.current;
    if (grid && grid.getSelectedRows().length > 0) grid.toggleSelected(row);
    else onSelect([row]);
  };

  return (
    <Modal
      title={title}
      open={open}
      onOk={handleOk}
      onCancel={onCancel}
      okText="OK"
      // Picking one record: no checkboxes and no OK — clicking the record chooses it
      footer={singleSelect ? null : undefined}
      width={width}
      destroyOnHidden
      // The popup zooms in when opening: the rows (and their best fit) wait until it is fully open
      afterOpenChange={setOpened}
    >
      <Input.Search
        placeholder={searchPlaceholder || 'Search...'}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={{ width: 250, marginBottom: 8 }}
        allowClear
      />
      <DataGrid<T>
        handleRef={gridRef}
        // Each lookup remembers the user's hidden columns and footer under its own name
        settingsKey={`lookup:${title}`}
        showToolbar
        onResetView={() => setSearch('')}
        selectable={!singleSelect}
        onOpenRecord={singleSelect || clickToChoose ? handleClick : undefined}
        quickFilterText={search}
        gridProps={{ rowData: opened ? rows : [], columnDefs, loading: loading || !opened, getRowId: (p) => String(getKey(p.data)) }}
      />
    </Modal>
  );
}

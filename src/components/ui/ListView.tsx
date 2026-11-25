'use client';

import React, { useMemo, useRef, useState } from 'react';
import { Button, Dropdown, Input } from 'antd';
import { DownOutlined, ExportOutlined, UndoOutlined } from '@ant-design/icons';
import type { ColDef } from 'ag-grid-community';
import type { AgGridReactProps } from 'ag-grid-react';
import { useCanChange } from '@/stores/accessStore';
import { DataGrid } from './DataGrid';
import type { DataGridHandle } from './DataGrid';
import type { ExcelFormat } from '@/lib/excelExport';
import styles from './ListView.module.css';

interface ListViewProps<T> {
  title: string;
  /** Module buttons, in order: New, Edit, then the rest. Reset View Settings and Export To are added after them. */
  toolbar?: React.ReactNode;
  searchPlaceholder?: string;
  /** File name for Export To, without extension. Defaults to the title. */
  exportFileName?: string;
  /** Called when a record is clicked — open its detail view */
  onOpenRecord?: (record: T) => void;
  /** rowData, columnDefs and handlers for the grid */
  gridProps: AgGridReactProps<T>;
}

/**
 * Standard list view: toolbar, title, search box, then the standard grid (row checkboxes,
 * a filter in every column header, pager footer).
 */
export function ListView<T>({
  title,
  toolbar,
  searchPlaceholder,
  exportFileName,
  onOpenRecord,
  gridProps,
}: ListViewProps<T>) {
  const gridRef = useRef<DataGridHandle<T>>(null);
  const [search, setSearch] = useState('');
  // Read Only screen (the user's roles): the Edit button column (colId "edit") is left out
  const canChange = useCanChange();
  const listGridProps = useMemo(
    () =>
      canChange
        ? gridProps
        : { ...gridProps, columnDefs: gridProps.columnDefs?.filter((c) => (c as ColDef<T>).colId !== 'edit') },
    [gridProps, canChange]
  );

  // Back to the original view: no search, no column filters, original sort / column order / widths
  const handleResetView = () => {
    setSearch('');
    gridRef.current?.resetView();
  };

  const exportMenu = {
    items: [
      { key: 'xlsx', label: 'Excel workbook (.xlsx)' },
      { key: 'xls', label: 'Excel 97-2003 workbook (.xls)' },
    ],
    onClick: ({ key }: { key: string }) =>
      gridRef.current?.exportExcel(key as ExcelFormat, exportFileName || title, title),
  };

  return (
    <div className={styles.root}>
      <div className={styles.toolbar}>
        {toolbar}
        <Button icon={<UndoOutlined />} onClick={handleResetView}>
          Reset View Settings
        </Button>
        <Dropdown menu={exportMenu} trigger={['click']}>
          <Button icon={<ExportOutlined />}>
            Export To <DownOutlined />
          </Button>
        </Dropdown>
      </div>
      <h1 className={styles.title}>{title}</h1>
      <div className={styles.searchRow}>
        <Input.Search
          placeholder={searchPlaceholder || 'Search...'}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ width: 250 }}
          allowClear
        />
      </div>
      <DataGrid<T>
        handleRef={gridRef}
        // Each list view remembers the user's hidden columns and footer under its own name
        settingsKey={`list:${title}`}
        gridProps={listGridProps}
        quickFilterText={search}
        onOpenRecord={onOpenRecord}
      />
    </div>
  );
}

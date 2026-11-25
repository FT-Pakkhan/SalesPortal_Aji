'use client';

import React, { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { App, Button, Dropdown, Pagination, Select } from 'antd';
import { AppstoreOutlined, BorderBottomOutlined, DownOutlined, ExportOutlined, UndoOutlined } from '@ant-design/icons';
import { AgGridReact } from 'ag-grid-react';
import type { AgGridReactProps } from 'ag-grid-react';
import { AllCommunityModule, ModuleRegistry, themeQuartz } from 'ag-grid-community';
import type {
  CellClassParams,
  CellClickedEvent,
  ColDef,
  EditableCallbackParams,
  ColumnResizedEvent,
  GridApi,
  ICellRendererParams,
  IRowNode,
  PaginationChangedEvent,
  RowSelectionOptions,
  SelectionColumnDef,
} from 'ag-grid-community';
import { exportToExcel, XLS_MAX_ROWS, XLS_MAX_COLS } from '@/lib/excelExport';
import type { ExcelCell, ExcelFormat } from '@/lib/excelExport';
import styles from './DataGrid.module.css';
import { ColumnChooser } from './ColumnChooser';
import { GridContextMenu } from './GridContextMenu';
import type { GridMenuItem } from './GridContextMenu';
import { SUMMARY_LABELS, summaryText } from '@/lib/gridSummary';
import { loadGridSettings, saveGridSettings } from '@/lib/gridSettings';
import type { SummaryType } from '@/lib/gridSummary';

ModuleRegistry.registerModules([AllCommunityModule]);

/** Grid theme — keep fontFamily in sync with --app-font in globals.css, fontSize with the antd theme in app/layout.tsx */
const gridTheme = themeQuartz.withParams({
  fontFamily: "'72', '72full', Arial, Helvetica, sans-serif",
  fontSize: 13,
  headerFontWeight: 600,
  // Compact rows: one line of text plus a small gap above and below
  rowHeight: 32,
  // Same height as the pager footer under the grid
  headerHeight: 36,
  wrapperBorder: false,
  wrapperBorderRadius: 0,
});

/** Selection checkbox at the start of every row (and one in the header to select all) */
const multiRowSelection: RowSelectionOptions = {
  mode: 'multiRow',
  checkboxes: true,
  headerCheckbox: true,
  enableClickSelection: false,
};


/** The selection checkbox column: just wide enough for the box */
const SELECTION_COLUMN: SelectionColumnDef = {
  width: 36,
  minWidth: 36,
  maxWidth: 36,
  resizable: false,
  suppressAutoSize: true,
  cellStyle: { paddingLeft: 10, paddingRight: 0 },
  headerStyle: { paddingLeft: 10, paddingRight: 0 },
};

/** Widest a column gets from best fit; longer values wrap and the row grows taller */
const BEST_FIT_MAX_WIDTH = 400;

/** A column that shows record data (not the checkbox or Edit button column) */
const isDataColumn = (colDef: ColDef | undefined) => !!(colDef?.field || colDef?.valueGetter);

/**
 * SAP B1-style column filter icon: a small solid funnel — flat top, straight sides down to a short stem — drawn on a
 * 10 x 10 grid with crisp edges so it stays sharp at its small size.
 */
const filterFunnel = (color: string) =>
  `<svg viewBox="0 0 10 10" width="9" height="9" shape-rendering="crispEdges" aria-hidden="true">` +
  `<polygon points="0,1 10,1 6,5 6,9.5 4,8.5 4,5" fill="${color}"/></svg>`;

/** Header filter button: near-black like SAP B1; blue while the column has a filter */
const GRID_ICONS = {
  filter: filterFunnel('#1D1D1D'),
  filterActive: filterFunnel('#0A6ED1'),
};

/** Key of the footer row's data: its text per column (the footer row is a pinned row, not a record) */
const FOOTER_KEY = '__portalFooter';

/** The totals offered on a number column's footer, with SAP-like symbols */
const SUMMARY_MENU: GridMenuItem[] = [
  { key: 'sum', label: SUMMARY_LABELS.sum, icon: 'Σ' },
  { key: 'min', label: SUMMARY_LABELS.min, icon: '↓' },
  { key: 'max', label: SUMMARY_LABELS.max, icon: '↑' },
  { key: 'count', label: SUMMARY_LABELS.count, icon: 'N' },
  { key: 'avg', label: SUMMARY_LABELS.avg, icon: 'x̄' },
];

/** A footer cell: the total chosen for its column, if any */
function FooterCell(p: ICellRendererParams) {
  const texts = (p.data as Record<string, Record<string, string>> | undefined)?.[FOOTER_KEY];
  return <span>{texts?.[p.column?.getColId() ?? ''] ?? ''}</span>;
}

/**
 * A column as the grid gets it: on the footer row it shows the footer text (not the column's own renderer /
 * formatter, which expect a record) and can't be edited.
 */
function withFooterRow<T>(col: ColDef<T>): ColDef<T> {
  const ownSelector = col.cellRendererSelector;
  const ownFormatter = col.valueFormatter;
  const ownEditable = col.editable;
  return {
    ...col,
    cellRendererSelector: (p) => (p.node.rowPinned ? { component: FooterCell } : ownSelector?.(p)),
    valueFormatter:
      typeof ownFormatter === 'function'
        ? (p) => (p.node?.rowPinned ? '' : ownFormatter(p))
        : ownFormatter,
    editable:
      typeof ownEditable === 'function'
        ? (p) => !p.node.rowPinned && ownEditable(p)
        : ownEditable
          ? (p) => !p.node.rowPinned
          : ownEditable,
  };
}

/**
 * Edit mode (a grid with a column set `editable: true`): cells that can be changed look like white input boxes, the
 * others are greyed, as in SAP B1. A column that is changed another way (e.g. a click opens a lookup) says so with
 * `context: { editableLook: (p) => boolean }`.
 */
function withEditLook<T>(col: ColDef<T>): ColDef<T> {
  const ownEditable = col.editable;
  const look = col.context?.editableLook as ((p: CellClassParams<T>) => boolean) | undefined;
  const canEdit = (p: CellClassParams<T>) =>
    !!look?.(p) || (typeof ownEditable === 'function' ? ownEditable(p as unknown as EditableCallbackParams<T>) : !!ownEditable);
  return {
    ...col,
    cellClassRules: {
      ...col.cellClassRules,
      'dg-cell-editable': (p) => !p.node.rowPinned && canEdit(p),
      'dg-cell-locked': (p) => !p.node.rowPinned && !canEdit(p),
    },
  };
}

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100, 200];
const DEFAULT_PAGE_SIZE = 20;

/** Actions a parent can run on the grid */
export interface DataGridHandle<T> {
  /** Clear column filters, restore original sort / column order / widths and page size */
  resetView: () => void;
  /** Export the ticked rows if any are ticked, otherwise every row that passes the filters */
  exportExcel: (format: ExcelFormat, fileName: string, sheetName: string) => Promise<void>;
  getSelectedRows: () => T[];
  /** Tick a record, or untick it if ticked */
  toggleSelected: (record: T) => void;
  /** Size every column to its content again, e.g. once a popup has finished opening */
  bestFit: () => void;
}

interface DataGridProps<T> {
  /** rowData, columnDefs and handlers for the grid */
  gridProps: AgGridReactProps<T>;
  /** Search text applied across all columns */
  quickFilterText?: string;
  /** Called when a record is clicked — open its detail view */
  onOpenRecord?: (record: T) => void;
  /**
   * Show a toolbar strip inside the grid box (used for grids inside a detail view).
   * `toolbar` buttons go first; Reset View Settings is added after them.
   */
  showToolbar?: boolean;
  toolbar?: React.ReactNode;
  /** Also run when the toolbar strip's Reset View Settings is pressed, e.g. to clear a search box */
  onResetView?: () => void;
  /** Adds Export To after Reset View Settings in the toolbar strip; the file and sheet name */
  exportFileName?: string;
  /** Show the row checkboxes (default). Off for lookups where clicking a record picks it. */
  selectable?: boolean;
  /**
   * Name of this grid for remembering the user's view settings in this browser (hidden columns, footer and its
   * totals), e.g. "list:Users". Without it nothing is remembered.
   */
  settingsKey?: string;
  handleRef?: React.Ref<DataGridHandle<T>>;
}

/**
 * Standard grid: row checkboxes, a filter in every column header, and the pager footer
 * ("Page 1 of 3 (48 items)", page numbers, page size).
 */
export function DataGrid<T>({
  gridProps,
  quickFilterText,
  onOpenRecord,
  showToolbar,
  toolbar,
  onResetView,
  exportFileName,
  selectable = true,
  settingsKey,
  handleRef,
}: DataGridProps<T>) {
  const { message } = App.useApp();
  const apiRef = useRef<GridApi<T> | null>(null);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [page, setPage] = useState({ current: 1, totalPages: 1, totalRows: 0 });
  // Column Chooser open at this mouse position (header right-click menu > Column Chooser)
  const [chooserAt, setChooserAt] = useState<{ x: number; y: number } | null>(null);
  const closeChooser = useCallback(() => setChooserAt(null), []);
  // Right-click menu open: on a column header, or on a footer cell (then which column)
  const [menu, setMenu] = useState<{ kind: 'header' | 'footer'; x: number; y: number; colId?: string } | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  // Footer row on/off, and the total chosen for each column (Sum, Min, ...)
  const [footerOn, setFooterOn] = useState(false);
  const [summaries, setSummaries] = useState<Record<string, SummaryType>>({});
  // Read by the grid's events, which keep the functions they were first given
  const footerRef = useRef({ on: false, summaries: {} as Record<string, SummaryType> });
  footerRef.current = { on: footerOn, summaries };

  // Work the footer out again over the rows shown (after search and filters), or remove it when switched off
  const refreshFooter = (api: GridApi<T> | null) => {
    if (!api || api.isDestroyed()) return;
    const { on, summaries: chosen } = footerRef.current;
    if (!on) {
      api.setGridOption('pinnedBottomRowData', []);
      return;
    }
    const texts: Record<string, string> = {};
    for (const [colId, type] of Object.entries(chosen)) {
      const column = api.getColumn(colId);
      if (!column) continue;
      const values: unknown[] = [];
      api.forEachNodeAfterFilter((node) => values.push(api.getCellValue({ rowNode: node, colKey: column })));
      texts[colId] = summaryText(type, values);
    }
    api.setGridOption('pinnedBottomRowData', [{ [FOOTER_KEY]: texts } as unknown as T]);
    // A grid with row ids keeps the same footer row and only redraws cells whose value changed — the footer's
    // "values" never change (its text is shown by FooterCell), so redraw it on purpose
    const footerRow = api.getPinnedBottomRow(0);
    if (footerRow) api.refreshCells({ rowNodes: [footerRow], force: true });
  };

  useEffect(() => {
    refreshFooter(apiRef.current);
  }, [footerOn, summaries]);

  // ---- Remembered view settings (this browser, this user, this grid) ----

  // Set once the saved settings have been put back, so the defaults on first draw don't overwrite them
  const settingsLoadedRef = useRef(false);

  const saveSettings = (api: GridApi<T> | null) => {
    if (!settingsKey || !settingsLoadedRef.current || !api || api.isDestroyed()) return;
    const hidden = (api.getColumns() ?? [])
      .filter((col) => isDataColumn(col.getColDef()) && !col.isVisible())
      .map((col) => col.getColId());
    saveGridSettings(settingsKey, { hidden, footerOn: footerRef.current.on, summaries: footerRef.current.summaries });
  };

  // Put the user's saved settings back when the grid is ready (columns no longer on the screen are ignored)
  const restoreSettings = (api: GridApi<T>) => {
    if (!settingsKey) return;
    const saved = loadGridSettings(settingsKey);
    if (saved) {
      const hidden = saved.hidden.filter((colId) => api.getColumn(colId));
      if (hidden.length > 0) api.setColumnsVisible(hidden, false);
      const summaries = Object.fromEntries(Object.entries(saved.summaries).filter(([colId]) => api.getColumn(colId)));
      footerRef.current = { on: saved.footerOn, summaries };
      setFooterOn(saved.footerOn);
      setSummaries(summaries);
    }
    settingsLoadedRef.current = true;
  };

  useEffect(() => {
    saveSettings(apiRef.current);
  }, [footerOn, summaries]);

  const handlePaginationChanged = (e: PaginationChangedEvent<T>) => {
    apiRef.current = e.api;
    const next = {
      current: e.api.paginationGetCurrentPage() + 1,
      totalPages: Math.max(1, e.api.paginationGetTotalPages()),
      totalRows: e.api.paginationGetRowCount(),
    };
    setPage((prev) =>
      prev.current === next.current && prev.totalPages === next.totalPages && prev.totalRows === next.totalRows
        ? prev
        : next
    );
    gridProps.onPaginationChanged?.(e);
  };

  // A single click on a record opens it. Clicks on the checkbox and Edit button columns
  // (columns without data) are left alone.
  const handleCellClicked = (e: CellClickedEvent<T>) => {
    if (e.node.rowPinned) return; // the footer row isn't a record
    if (onOpenRecord && e.data && isDataColumn(e.colDef)) onOpenRecord(e.data);
    gridProps.onCellClicked?.(e);
  };

  // Best fit: every column as wide as its widest value or header.
  // A grid on a hidden tab (e.g. Details while Attachments is open) measures every column as 0 wide, so the
  // fit waits until the grid is shown again (the ResizeObserver below)
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const fitPendingRef = useRef(false);
  const bestFit = (api: GridApi<T>) => {
    if (api.isDestroyed()) return;
    if (!wrapperRef.current || wrapperRef.current.offsetWidth === 0) {
      fitPendingRef.current = true;
      return;
    }
    fitPendingRef.current = false;
    api.autoSizeAllColumns();
  };

  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      const api = apiRef.current;
      if (!fitPendingRef.current || el.offsetWidth === 0 || !api || api.isDestroyed()) return;
      bestFit(api);
      // Row heights worked out while hidden are wrong too
      api.resetRowHeights();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Best fit stops at BEST_FIT_MAX_WIDTH; longer values wrap onto more lines and the row grows
  const handleColumnResized = (e: ColumnResizedEvent<T>) => {
    if (e.source === 'autosizeColumns' && e.finished) {
      const tooWide = (e.columns ?? [])
        .filter((col) => col.getActualWidth() > BEST_FIT_MAX_WIDTH)
        .map((col) => ({ key: col, newWidth: BEST_FIT_MAX_WIDTH }));
      if (tooWide.length > 0) e.api.setColumnWidths(tooWide);
    }
    gridProps.onColumnResized?.(e);
  };

  // Columns are sized to their content, so stretching (flex) is switched off.
  // Only text wraps and grows the row; checkbox (Yes / No) and button columns don't, or their
  // taller boxes would make every row tall. Cells are centred top-to-bottom in the CSS.
  // Memoised: a new array on every render would make the grid reset its columns (sort, widths).
  // Text columns start at the widest best fit allows: the grid measures each row's height when it first
  // draws it and doesn't measure again, so text must not wrap at a narrower starting width. Best fit then
  // shrinks each column to its content (shrinking to fit never makes text wrap).
  // initialWidth, not width: it only applies when the column is created, so a grid whose columns are
  // rebuilt (e.g. switching to edit mode) keeps its best-fitted widths.
  const columnDefs = useMemo(() => {
    const editMode = !!gridProps.columnDefs?.some((col) => (col as ColDef<T>).editable === true);
    return gridProps.columnDefs?.map((col) => {
        const own = withFooterRow(col as ColDef<T>);
        const colDef = editMode && (isDataColumn(own) || own.context?.editableLook) ? withEditLook(own) : own;
        const noWrap = colDef.cellDataType === 'boolean' || !isDataColumn(colDef);
        if (noWrap) return { ...colDef, flex: undefined, wrapText: false, autoHeight: false };
        if (colDef.suppressAutoSize) return { ...colDef, flex: undefined };
        // Any width given by the screen is only a starting point too; best fit decides
        return { ...colDef, flex: undefined, width: undefined, initialWidth: BEST_FIT_MAX_WIDTH };
      });
  }, [gridProps.columnDefs]);

  // The footer row has its own id (the screen's getRowId reads record fields it doesn't have)
  const getRowId = useMemo(() => {
    const own = gridProps.getRowId;
    if (!own) return undefined;
    return (p: Parameters<typeof own>[0]) =>
      (p.data as Record<string, unknown> | undefined)?.[FOOTER_KEY] ? 'portal-footer-row' : own(p);
  }, [gridProps.getRowId]);

  // Every column can be sorted, resized and filtered; the filter opens from the column header.
  // Text longer than its column wraps, and the row grows to show all of it.
  // Memoised for the same reason: a new object would redraw the cells and stop any cell being edited.
  const defaultColDef = useMemo<ColDef<T>>(
    () => ({ sortable: true, resizable: true, filter: true, wrapText: true, autoHeight: true, ...gridProps.defaultColDef }),
    [gridProps.defaultColDef]
  );

  const resetView = () => {
    setPageSize(DEFAULT_PAGE_SIZE);
    // Footer off and its totals cleared: back to the original view
    setFooterOn(false);
    setSummaries({});
    const api = apiRef.current;
    if (!api) return;
    api.setFilterModel(null);
    api.resetColumnState();
    api.paginationGoToFirstPage();
    bestFit(api);
  };

  const exportExcel = async (format: ExcelFormat, fileName: string, sheetName: string) => {
    const api = apiRef.current;
    if (!api) return;

    const visibleNodes: IRowNode<T>[] = [];
    api.forEachNodeAfterFilterAndSort((node) => visibleNodes.push(node));

    const selected = api.getSelectedNodes();
    let nodes = visibleNodes;
    if (selected.length > 0) {
      // Ticked rows in on-screen order, then any ticked rows currently hidden by a filter
      const shown = visibleNodes.filter((node) => node.isSelected());
      nodes = [...shown, ...selected.filter((node) => !shown.includes(node))];
    }

    if (nodes.length === 0) {
      message.warning('There are no records to export');
      return;
    }

    // Data columns only — skips the checkbox and Edit button columns
    const columns = api.getAllDisplayedColumns().filter((col) => isDataColumn(col.getColDef()));
    const header = columns.map((col) => api.getDisplayNameForColumn(col, 'header') || col.getColId());
    const rows = nodes.map((node) =>
      columns.map((col): ExcelCell => {
        const value = api.getCellValue({ rowNode: node, colKey: col });
        if (typeof value === 'boolean') return value ? 'Yes' : 'No';
        // Dates are exported as shown on screen
        if (value instanceof Date) return api.getCellValue({ rowNode: node, colKey: col, useFormatter: true }) ?? '';
        if (typeof value === 'number') return value;
        return value == null ? '' : String(value);
      })
    );

    if (format === 'xls' && (rows.length + 1 > XLS_MAX_ROWS || columns.length > XLS_MAX_COLS)) {
      message.warning('Too many records for .xls (limit 65,536 rows). Export to .xlsx instead.');
      return;
    }

    try {
      await exportToExcel({
        fileName,
        sheetName,
        header,
        rows,
        colWidthsPx: columns.map((col) => col.getActualWidth()),
        format,
      });
    } catch {
      message.error('Export failed');
    }
  };

  useImperativeHandle(handleRef, () => ({
    resetView,
    exportExcel,
    getSelectedRows: () => apiRef.current?.getSelectedRows() ?? [],
    toggleSelected: (record) => {
      apiRef.current?.forEachNode((node) => {
        if (node.data === record) node.setSelected(!node.isSelected());
      });
    },
    bestFit: () => {
      if (apiRef.current) bestFit(apiRef.current);
    },
  }));

  // Right-click (instead of the browser's own menu):
  //   column header -> Column Chooser / Footer;   footer cell of a number column -> Sum, Min, Max, Count, Average
  const handleContextMenu = (e: React.MouseEvent) => {
    const api = apiRef.current;
    const target = e.target as HTMLElement;
    if (!api) return;
    if (target.closest('.ag-header')) {
      e.preventDefault();
      setChooserAt(null);
      setMenu({ kind: 'header', x: e.clientX, y: e.clientY });
      return;
    }
    const footerCell = target.closest('.ag-floating-bottom .ag-cell');
    if (footerCell) {
      e.preventDefault();
      const colId = footerCell.getAttribute('col-id') ?? '';
      if (api.getColumn(colId)?.getColDef().cellDataType === 'number') {
        setMenu({ kind: 'footer', x: e.clientX, y: e.clientY, colId });
      }
    }
  };

  const headerMenuItems: GridMenuItem[] = [
    { key: 'chooser', label: 'Column Chooser', icon: <AppstoreOutlined /> },
    { key: 'footer', label: 'Footer', icon: <BorderBottomOutlined />, checked: footerOn },
  ];
  const footerMenuItems: GridMenuItem[] = [
    ...SUMMARY_MENU.map((s) => ({ ...s, checked: menu?.colId ? summaries[menu.colId] === s.key : false })),
    { key: 'none', label: 'None', checked: menu?.colId ? !summaries[menu.colId] : false },
  ];

  const handleMenuSelect = (key: string) => {
    const opened = menu;
    setMenu(null);
    if (!opened) return;
    if (opened.kind === 'header') {
      if (key === 'chooser') setChooserAt({ x: opened.x, y: opened.y });
      if (key === 'footer') setFooterOn((on) => !on);
      return;
    }
    const colId = opened.colId as string;
    setSummaries((prev) => {
      const next = { ...prev };
      if (key === 'none') delete next[colId];
      else next[colId] = key as SummaryType;
      return next;
    });
  };

  return (
    <div
      ref={wrapperRef}
      className={`${styles.gridWrapper} ${onOpenRecord ? styles.clickableRows : ''}`}
      onContextMenu={handleContextMenu}
    >
      {showToolbar && (
        <div className={styles.toolbar}>
          {toolbar}
          <Button size="small" icon={<UndoOutlined />} onClick={() => { resetView(); onResetView?.(); }}>
            Reset View Settings
          </Button>
          {exportFileName && (
            <Dropdown
              trigger={['click']}
              menu={{
                items: [
                  { key: 'xlsx', label: 'Excel workbook (.xlsx)' },
                  { key: 'xls', label: 'Excel 97-2003 workbook (.xls)' },
                ],
                onClick: ({ key }) => exportExcel(key as ExcelFormat, exportFileName, exportFileName),
              }}
            >
              <Button size="small" icon={<ExportOutlined />}>
                Export To <DownOutlined />
              </Button>
            </Dropdown>
          )}
        </div>
      )}
      <AgGridReact<T>
        theme={gridTheme}
        // Column header filter button: SAP B1's small solid funnel
        icons={GRID_ICONS}
        rowSelection={selectable ? multiRowSelection : undefined}
        // Narrow checkbox column, so the row buttons next to it sit close
        selectionColumnDef={SELECTION_COLUMN}
        domLayout="autoHeight"
        suppressCellFocus
        {...gridProps}
        columnDefs={columnDefs}
        getRowId={getRowId}
        // The footer follows the rows shown: search, filters, new / changed / removed rows, typed values
        onModelUpdated={(e) => {
          refreshFooter(e.api);
          // A "#" column (lineNo) counts the rows as shown: redraw it, as rows above may have been removed or added
          if (e.api.getColumn('lineNo')) e.api.refreshCells({ columns: ['lineNo'], force: true });
          gridProps.onModelUpdated?.(e);
        }}
        onCellValueChanged={(e) => {
          gridProps.onCellValueChanged?.(e);
          refreshFooter(e.api);
        }}
        // Every column can be sorted, resized and filtered; the filter opens from the column header.
        // Text longer than its column wraps, and the row grows to show all of it.
        defaultColDef={defaultColDef}
        onColumnResized={handleColumnResized}
        onFirstDataRendered={(e) => {
          bestFit(e.api);
          gridProps.onFirstDataRendered?.(e);
        }}
        onRowDataUpdated={(e) => {
          bestFit(e.api);
          gridProps.onRowDataUpdated?.(e);
        }}
        quickFilterText={quickFilterText}
        pagination
        paginationPageSize={pageSize}
        suppressPaginationPanel
        onGridReady={(e) => {
          apiRef.current = e.api;
          restoreSettings(e.api);
          gridProps.onGridReady?.(e);
        }}
        // Hiding / showing a column (Column Chooser) is remembered
        onColumnVisible={(e) => {
          saveSettings(e.api);
          gridProps.onColumnVisible?.(e);
        }}
        onPaginationChanged={handlePaginationChanged}
        onCellClicked={handleCellClicked}
      />
      {menu && (
        <GridContextMenu
          items={menu.kind === 'header' ? headerMenuItems : footerMenuItems}
          position={menu}
          onSelect={handleMenuSelect}
          onClose={closeMenu}
        />
      )}
      {chooserAt && apiRef.current && (
        <ColumnChooser<T>
          api={apiRef.current}
          position={chooserAt}
          isChoosable={(column) => isDataColumn(column.getColDef())}
          onClose={closeChooser}
        />
      )}
      <div className={styles.pager}>
        <div className={styles.pagerLeft}>
          <span>
            Page {page.current} of {page.totalPages} ({page.totalRows} {page.totalRows === 1 ? 'item' : 'items'})
          </span>
          <Pagination
            size="small"
            current={page.current}
            total={page.totalRows}
            pageSize={pageSize}
            showSizeChanger={false}
            onChange={(p) => apiRef.current?.paginationGoToPage(p - 1)}
          />
        </div>
        <div className={styles.pagerRight}>
          <span>Page size:</span>
          <Select
            size="small"
            value={pageSize}
            onChange={setPageSize}
            options={PAGE_SIZE_OPTIONS.map((n) => ({ value: n, label: String(n) }))}
            style={{ width: 72 }}
          />
        </div>
      </div>
    </div>
  );
}

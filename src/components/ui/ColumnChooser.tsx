'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Checkbox } from 'antd';
import type { Column, GridApi } from 'ag-grid-community';
import styles from './DataGrid.module.css';

interface ColumnChooserProps<T> {
  api: GridApi<T>;
  /** Where it opens: the mouse position of the right-click (page coordinates) */
  position: { x: number; y: number };
  /** Which columns can be shown / hidden (the data columns, not the checkbox or button columns) */
  isChoosable: (column: Column) => boolean;
  onClose: () => void;
}

/**
 * Column Chooser: a small list of the grid's columns with a checkbox each, opened by right-clicking a column
 * header. Unticking hides a column, ticking shows it again (the last visible column can't be hidden).
 * Closes on a click elsewhere, Escape, or scrolling. Reset View Settings shows every column again.
 */
export function ColumnChooser<T>({ api, position, isChoosable, onClose }: ColumnChooserProps<T>) {
  const ref = useRef<HTMLDivElement>(null);
  // Bumped after each change so the ticks are read again from the grid
  const [, setVersion] = useState(0);

  useEffect(() => {
    const close = (e: Event) => {
      if (e.type === 'keydown' && (e as KeyboardEvent).key !== 'Escape') return;
      if (e.type === 'mousedown' && ref.current?.contains(e.target as Node)) return;
      onClose();
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    window.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [onClose]);

  const columns = (api.getColumns() ?? []).filter(isChoosable);
  const visibleCount = columns.filter((c) => c.isVisible()).length;

  const toggle = (column: Column, show: boolean) => {
    api.setColumnsVisible([column], show);
    setVersion((v) => v + 1);
  };

  // Keep the list on screen when the right-click is near the right or bottom edge
  const left = Math.min(position.x, window.innerWidth - 240);
  const top = Math.min(position.y, window.innerHeight - Math.min(360, 40 + columns.length * 28));

  return (
    <div ref={ref} className={styles.columnChooser} style={{ left, top }} role="menu" onContextMenu={(e) => e.preventDefault()}>
      <div className={styles.columnChooserTitle}>Column Chooser</div>
      <div className={styles.columnChooserList}>
        {columns.map((column) => {
          const visible = column.isVisible();
          return (
            <div key={column.getColId()} className={styles.columnChooserItem}>
              <Checkbox
                checked={visible}
                // The last visible column stays: a grid with no columns can't be used
                disabled={visible && visibleCount === 1}
                onChange={(e) => toggle(column, e.target.checked)}
              >
                {api.getDisplayNameForColumn(column, 'header') || column.getColId()}
              </Checkbox>
            </div>
          );
        })}
      </div>
    </div>
  );
}

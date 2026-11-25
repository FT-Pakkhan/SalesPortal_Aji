'use client';

import React, { useEffect, useRef } from 'react';
import { CheckOutlined } from '@ant-design/icons';
import styles from './DataGrid.module.css';

export interface GridMenuItem {
  key: string;
  label: string;
  /** Small symbol in front of the label */
  icon?: React.ReactNode;
  /** Shows a tick: the option is on / chosen */
  checked?: boolean;
}

interface GridContextMenuProps {
  items: GridMenuItem[];
  /** Mouse position of the right-click */
  position: { x: number; y: number };
  onSelect: (key: string) => void;
  onClose: () => void;
}

/** Right-click menu of a grid (column header, footer). Closes on a click elsewhere, Escape or scrolling. */
export function GridContextMenu({ items, position, onSelect, onClose }: GridContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

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

  // Keep the menu on screen near the right / bottom edge
  const left = Math.min(position.x, window.innerWidth - 200);
  const top = Math.min(position.y, window.innerHeight - (12 + items.length * 30));

  return (
    <div ref={ref} className={styles.gridMenu} style={{ left, top }} role="menu" onContextMenu={(e) => e.preventDefault()}>
      {items.map((item) => (
        <div
          key={item.key}
          role="menuitem"
          className={styles.gridMenuItem}
          onClick={() => onSelect(item.key)}
        >
          <span className={styles.gridMenuIcon}>{item.icon}</span>
          <span className={styles.gridMenuLabel}>{item.label}</span>
          <span className={styles.gridMenuCheck}>{item.checked ? <CheckOutlined /> : null}</span>
        </div>
      ))}
    </div>
  );
}

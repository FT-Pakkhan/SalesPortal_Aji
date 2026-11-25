'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Modal } from 'antd';
import {
  AuditOutlined,
  CloudUploadOutlined,
  EditOutlined,
  EnvironmentOutlined,
  ExclamationCircleOutlined,
  FieldTimeOutlined,
  SyncOutlined,
} from '@ant-design/icons';
import type { ColDef } from 'ag-grid-community';
import dayjs from 'dayjs';
import { useRouter } from 'next/navigation';
import { dashboardAPI } from '@/lib/apiClient';
import { useAuthStore } from '@/stores/authStore';
import { DataGrid } from '@/components/ui/DataGrid';
import { DOC_PATHS } from '@/components/layout/notificationLinks';
import { ACCENTS, WidgetView } from './WidgetView';
import type { DashboardData, DashboardTile, DashboardTileItem, DashboardWidgetData } from '@/types';
import styles from './Dashboard.module.css';

/** Icon and colour per My Work tile */
const TILE_LOOK: Record<DashboardTile['key'], { icon: React.ReactNode; color: string }> = {
  APPROVALS: { icon: <AuditOutlined />, color: '#f57c00' },
  MY_DRAFTS: { icon: <EditOutlined />, color: '#1e88e5' },
  SENT_PENDING: { icon: <FieldTimeOutlined />, color: '#8e24aa' },
  POST_FAILED: { icon: <ExclamationCircleOutlined />, color: '#e53935' },
  NOT_POSTED: { icon: <CloudUploadOutlined />, color: '#00897b' },
  CHECKED_IN: { icon: <EnvironmentOutlined />, color: '#43a047' },
};

/** The page a tile's document opens; from "Waiting for My Approval" as from the Approvals list */
const itemPath = (tile: DashboardTile, item: DashboardTileItem) => {
  const base = DOC_PATHS[item.objType];
  if (!base) return null;
  return `${base}/${item.docEntry}${tile.key === 'APPROVALS' ? '?from=approvals' : ''}`;
};

type WidgetState = { data: DashboardWidgetData | null; error: string | null };

/**
 * The Dashboard: My Work tiles (what needs the user's attention, from the portal's documents) and the widgets of
 * their roles (Dashboard Settings), in one layout for everyone. Loaded when opened and on Refresh; each widget loads on
 * its own, so a slow one doesn't hold up the rest.
 */
export default function Dashboard() {
  const router = useRouter();
  const { user } = useAuthStore();
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [widgetState, setWidgetState] = useState<Record<number, WidgetState>>({});
  const [openTile, setOpenTile] = useState<DashboardTile | null>(null);
  // The tile's popup has finished zooming in: its rows wait for that, as columns best-fitted mid-zoom come out too narrow
  const [tileOpened, setTileOpened] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await dashboardAPI.get();
      if (!res.success) return;
      setDashboard(res.data);
      setWidgetState(Object.fromEntries(res.data.widgets.map((w) => [w.docEntry, { data: null, error: null }])));
      // Each widget on its own (no LOADING overlay): the page is usable while they come in
      for (const w of res.data.widgets) {
        dashboardAPI
          .getWidgetData(w.docEntry)
          .then((r) => r.success && setWidgetState((prev) => ({ ...prev, [w.docEntry]: { data: r.data, error: null } })))
          .catch((error) => {
            const text = (error as { response?: { data?: { error?: string } } }).response?.data?.error || 'The widget could not be loaded';
            setWidgetState((prev) => ({ ...prev, [w.docEntry]: { data: null, error: text } }));
          });
      }
    } catch {
      setDashboard({ myWork: [], widgets: [] });
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const itemColumns = useMemo<ColDef<DashboardTileItem>[]>(
    () => [
      { field: 'typeName', headerName: 'Document' },
      { field: 'docNum', headerName: 'No.', valueFormatter: (p) => p.value || 'Draft' },
      { field: 'name', headerName: 'Name' },
      { field: 'docDate', headerName: 'Date', valueFormatter: (p) => (p.value ? dayjs(p.value).format('DD.MM.YY') : '') },
      {
        field: 'total',
        headerName: 'Total',
        cellDataType: 'number',
        valueFormatter: (p) => (p.value === null || p.value === undefined ? '' : Number(p.value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })),
      },
      { field: 'note', headerName: 'Details', flex: 1, minWidth: 220 },
    ],
    []
  );

  // Checked In Now: a user is checked in at one place at a time, so the tile opens that check-in itself (detail view);
  // the other tiles (and an unexpected second open check-in) show their list
  const handleTileClick = (tile: DashboardTile) => {
    const path = tile.key === 'CHECKED_IN' && tile.items.length === 1 ? itemPath(tile, tile.items[0]) : null;
    if (path) router.push(path);
    else setOpenTile(tile);
  };

  if (!dashboard) return null;

  return (
    <div className={styles.root}>
      <div className={styles.toolbar}>
        <Button icon={<SyncOutlined />} onClick={load}>
          Refresh
        </Button>
      </div>
      <h1 className={styles.title}>Dashboard</h1>
      <div className={styles.welcome}>Welcome, {user?.displayName || user?.userName}</div>

      {/* ---- My Work ---- */}
      <div className={styles.sectionTitle}>My Work</div>
      <div className={styles.tiles}>
        {dashboard.myWork.map((tile) => {
          const look = TILE_LOOK[tile.key];
          return (
            <div
              key={tile.key}
              className={`${styles.tile} ${tile.count === 0 ? styles.tileIdle : ''}`}
              style={{ '--tile-color': look.color } as React.CSSProperties}
              onClick={() => handleTileClick(tile)}
              title={tile.hint}
            >
              <span className={styles.tileIcon}>{look.icon}</span>
              <div>
                <div className={styles.tileCount}>{tile.count}</div>
                {/* The hint shows on hover (the tile's title attribute) */}
                <div className={styles.tileTitle}>{tile.title}</div>
              </div>
            </div>
          );
        })}
      </div>

      {/* ---- Widgets (Dashboard Settings) ---- */}
      {dashboard.widgets.length > 0 && (
        <>
          <div className={styles.sectionTitle}>Overview</div>
          <div className={styles.widgets}>
            {dashboard.widgets.map((w, i) => {
              const state = widgetState[w.docEntry];
              return (
                <div key={w.docEntry} className={w.width === 4 ? styles.span4 : w.width === 2 ? styles.span2 : styles.span1}>
                  <WidgetView
                    title={w.title}
                    widgetType={w.widgetType}
                    valueFormat={w.valueFormat}
                    remarks={w.remarks}
                    data={state?.data ?? null}
                    error={state?.error}
                    onOpen={w.linkPath ? () => router.push(w.linkPath as string) : undefined}
                    accent={ACCENTS[i % ACCENTS.length]}
                  />
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* The documents behind a tile; clicking one opens it */}
      <Modal
        open={!!openTile}
        title={openTile ? `${openTile.title} (${openTile.count})` : ''}
        footer={null}
        width={960}
        onCancel={() => setOpenTile(null)}
        afterOpenChange={setTileOpened}
        destroyOnHidden
      >
        {openTile && (
          <>
            <p style={{ marginTop: 0, color: 'var(--sap-text-secondary)' }}>
              {openTile.hint}
              {openTile.count > openTile.items.length ? ` - the newest ${openTile.items.length} are listed` : ''}
            </p>
            <DataGrid<DashboardTileItem>
              settingsKey={`dashboard:tile:${openTile.key}`}
              showToolbar
              selectable={false}
              onOpenRecord={(item) => {
                const path = itemPath(openTile, item);
                setOpenTile(null);
                if (path) router.push(path);
              }}
              gridProps={{
                rowData: tileOpened ? openTile.items : [],
                loading: !tileOpened,
                columnDefs: itemColumns,
                getRowId: (p) => `${p.data.objType}-${p.data.docEntry}`,
                domLayout: 'autoHeight',
              }}
            />
          </>
        )}
      </Modal>
    </div>
  );
}

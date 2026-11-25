'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Button } from 'antd';
import { CheckOutlined, SyncOutlined } from '@ant-design/icons';
import type { ColDef, ValueFormatterParams } from 'ag-grid-community';
import { useRouter } from 'next/navigation';
import dayjs from 'dayjs';
import { notificationsAPI } from '@/lib/apiClient';
import { ListView } from '@/components/ui/ListView';
import { NOTIFICATION_ICONS, notificationPath } from '@/components/layout/notificationLinks';
import type { PortalNotification } from '@/types';

/** Every user has this page (it is theirs): all their notifications of the last 60 days, newest first */
export default function NotificationListPage() {
  const router = useRouter();
  const [data, setData] = useState<PortalNotification[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const response = await notificationsAPI.getList(1000);
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

  const handleMarkAllRead = async () => {
    await notificationsAPI.markRead('ALL');
    setData((prev) => prev.map((n) => ({ ...n, isRead: true })));
  };

  // A click opens the document and marks the notification read
  const handleOpen = (n: PortalNotification) => {
    if (!n.isRead) void notificationsAPI.markRead([n.absEntry]);
    const path = notificationPath(n);
    if (path) router.push(path);
  };

  const columnDefs = useMemo<ColDef<PortalNotification>[]>(
    () => [
      {
        field: 'createdDate',
        headerName: 'Date',
        sort: 'desc',
        valueFormatter: (p: ValueFormatterParams) => (p.value ? dayjs(p.value).format('DD.MM.YY HH:mm') : ''),
      },
      {
        field: 'title',
        headerName: 'Notification',
        cellRenderer: (p: { data?: PortalNotification }) =>
          p.data ? (
            <span style={{ fontWeight: p.data.isRead ? 400 : 600 }}>
              {NOTIFICATION_ICONS[p.data.ntfType]} {p.data.title}
            </span>
          ) : null,
      },
      { field: 'message', headerName: 'Details' },
      { field: 'objTypeName', headerName: 'Document' },
      { field: 'createdBy', headerName: 'By' },
      { field: 'isRead', headerName: 'Read', cellDataType: 'boolean' },
    ],
    []
  );

  const toolbar = (
    <>
      <Button icon={<CheckOutlined />} onClick={handleMarkAllRead}>
        Mark all as read
      </Button>
      <Button icon={<SyncOutlined />} onClick={loadData}>
        Refresh
      </Button>
    </>
  );

  return (
    <ListView<PortalNotification>
      title="Notifications"
      toolbar={toolbar}
      searchPlaceholder="Search notifications..."
      onOpenRecord={handleOpen}
      gridProps={{
        rowData: data,
        columnDefs,
        loading,
        getRowId: (p) => String(p.data.absEntry),
      }}
    />
  );
}

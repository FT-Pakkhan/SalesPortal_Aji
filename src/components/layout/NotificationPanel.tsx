'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Empty, Typography } from 'antd';
import { useRouter } from 'next/navigation';
import { PORTAL_CHANGED_EVENT, notificationsAPI } from '@/lib/apiClient';
import type { PortalNotification } from '@/types';
import { NOTIFICATION_ICONS, notificationPath, timeAgo } from './notificationLinks';
import styles from './PortalLayout.module.css';

const { Text } = Typography;

/** The bell checks this often (fixed, the user's choice) */
const CHECK_EVERY_MS = 60_000;
/** Notifications the bell's list shows; the rest are on the View all page */
const BELL_LIST_SIZE = 20;

/**
 * The bell's data: the unread count, checked every 60 seconds while the portal tab is visible, at once when it
 * becomes visible again, on every page change and after the user changed something (Approve, Post to SAP ...).
 * The check only asks for the count and the newest time; the list is loaded when the bell is opened. Background
 * checks don't show the LOADING overlay.
 */
export function useNotifications(enabled: boolean, pathname: string) {
  const [unread, setUnread] = useState(0);
  const [items, setItems] = useState<PortalNotification[] | null>(null);
  const latestRef = useRef<string | null>(null);
  const openRef = useRef(false);

  const loadList = useCallback(async () => {
    try {
      const res = await notificationsAPI.getList(BELL_LIST_SIZE, true);
      if (res.success) setItems(res.data);
    } catch {
      // Keep what is shown; the next check tries again
    }
  }, []);

  const check = useCallback(async () => {
    if (!enabled || document.visibilityState !== 'visible') return;
    try {
      const res = await notificationsAPI.getSummary();
      if (!res.success) return;
      setUnread(res.data.unread ?? 0);
      // Something new arrived while the list is open: show it
      if (res.data.latest !== latestRef.current) {
        latestRef.current = res.data.latest;
        if (openRef.current) void loadList();
        else setItems(null);
      }
    } catch {
      // Server busy or offline: try again at the next check
    }
  }, [enabled, loadList]);

  // Every 60 seconds, and when the tab becomes visible again
  useEffect(() => {
    if (!enabled) return;
    void check();
    const timer = window.setInterval(() => void check(), CHECK_EVERY_MS);
    const onVisible = () => document.visibilityState === 'visible' && void check();
    // After a change by the user (e.g. Approve): a moment later, once the server has written its notifications
    const onChanged = () => window.setTimeout(() => void check(), 300);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener(PORTAL_CHANGED_EVENT, onChanged);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener(PORTAL_CHANGED_EVENT, onChanged);
    };
  }, [enabled, check]);

  // On every page change
  useEffect(() => {
    void check();
  }, [pathname]);

  const setOpen = useCallback(
    (open: boolean) => {
      openRef.current = open;
      if (open) void loadList();
    },
    [loadList]
  );

  const markRead = useCallback(async (ids: number[] | 'ALL') => {
    try {
      await notificationsAPI.markRead(ids);
    } catch {
      return;
    }
    setItems((prev) => prev?.map((n) => (ids === 'ALL' || ids.includes(n.absEntry) ? { ...n, isRead: true } : n)) ?? prev);
    setUnread((prev) => (ids === 'ALL' ? 0 : Math.max(prev - ids.length, 0)));
  }, []);

  return { unread, items, setOpen, markRead, refresh: check };
}

/** The bell's dropdown: newest notifications, unread bold with a dot; a click opens the document and marks it read */
export function NotificationPanel({
  items,
  unread,
  onMarkRead,
  onClose,
}: {
  items: PortalNotification[] | null;
  unread: number;
  onMarkRead: (ids: number[] | 'ALL') => Promise<void>;
  onClose: () => void;
}) {
  const router = useRouter();

  const open = (n: PortalNotification) => {
    if (!n.isRead) void onMarkRead([n.absEntry]);
    const path = notificationPath(n);
    onClose();
    if (path) router.push(path);
  };

  return (
    <div className={styles.notifDropdown}>
      <div className={styles.notifHeader} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text strong>Notifications</Text>
        {unread > 0 && (
          <Button type="link" size="small" onClick={() => void onMarkRead('ALL')}>
            Mark all as read
          </Button>
        )}
      </div>
      <div style={{ maxHeight: 420, overflowY: 'auto' }}>
        {items === null ? (
          <div style={{ padding: 24, textAlign: 'center', color: '#6a6d70' }}>Loading...</div>
        ) : items.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No notifications" />
        ) : (
          items.map((n) => (
            <div
              key={n.absEntry}
              onClick={() => open(n)}
              style={{
                display: 'flex',
                gap: 10,
                padding: '8px 12px',
                borderBottom: '1px solid #f0f0f0',
                cursor: 'pointer',
                background: n.isRead ? undefined : '#f5faff',
              }}
            >
              <span style={{ width: 8, flex: '0 0 8px', paddingTop: 7 }}>
                {!n.isRead && <span style={{ display: 'block', width: 8, height: 8, borderRadius: 4, background: '#0a6ed1' }} />}
              </span>
              <span style={{ fontSize: 16, paddingTop: 1 }}>{NOTIFICATION_ICONS[n.ntfType]}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ fontWeight: n.isRead ? 400 : 600 }}>{n.title}</span>
                  <span style={{ color: '#6a6d70', fontSize: 12, whiteSpace: 'nowrap' }}>{timeAgo(n.createdDate)}</span>
                </span>
                <span style={{ display: 'block', color: '#32363a', fontSize: 12, fontWeight: n.isRead ? 400 : 600 }}>{n.message}</span>
              </span>
            </div>
          ))
        )}
      </div>
      <div style={{ textAlign: 'center', borderTop: '1px solid #f0f0f0', padding: 4 }}>
        <Button
          type="link"
          size="small"
          onClick={() => {
            onClose();
            router.push('/notifications');
          }}
        >
          View all
        </Button>
      </div>
    </div>
  );
}

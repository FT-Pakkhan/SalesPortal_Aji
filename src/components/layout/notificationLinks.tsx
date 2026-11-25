import React from 'react';
import { CheckCircleOutlined, ClockCircleOutlined, CloseCircleOutlined, EditOutlined, ExclamationCircleOutlined, RiseOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import type { NotificationType, PortalNotification } from '@/types';
import { documentPath } from '@/lib/docPaths';

export { DOC_PATHS } from '@/lib/docPaths';

/** The page a notification opens: its document (see documentPath) */
export function notificationPath(n: PortalNotification): string | null {
  return documentPath(n.objType, n.docEntry, n.ntfType === 'APPR_WAITING');
}

/** Icon and colour per notification type */
export const NOTIFICATION_ICONS: Record<NotificationType, React.ReactNode> = {
  APPR_WAITING: <ClockCircleOutlined style={{ color: '#e9730c' }} />,
  APPR_STAGE: <RiseOutlined style={{ color: '#0a6ed1' }} />,
  APPR_DONE: <CheckCircleOutlined style={{ color: '#256f3a' }} />,
  APPR_REJECTED: <CloseCircleOutlined style={{ color: '#bb0000' }} />,
  APPR_CHANGED: <EditOutlined style={{ color: '#e9730c' }} />,
  POST_FAILED: <ExclamationCircleOutlined style={{ color: '#bb0000' }} />,
};

/** "2 min ago", "3 hr ago", "Yesterday", then the date */
export function timeAgo(date: string): string {
  const then = dayjs(date);
  const minutes = dayjs().diff(then, 'minute');
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = dayjs().diff(then, 'hour');
  if (hours < 24) return `${hours} hr ago`;
  if (dayjs().startOf('day').diff(then.startOf('day'), 'day') === 1) return 'Yesterday';
  return then.format('DD.MM.YY');
}

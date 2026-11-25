'use client';

import React, { useEffect, useState } from 'react';
import { App, Button, Input } from 'antd';
import { DislikeOutlined, LikeOutlined } from '@ant-design/icons';
import { approvalsAPI } from '@/lib/apiClient';

const APPR_STATUS_PENDING = 'PENDING';

/**
 * Approve / Reject on a document's screen, as on the quotation: the buttons show only while the document waits for
 * approval and it is this user's stage's turn. Each asks first (with optional remarks), then is done straight away.
 * `onDecided` gets the document as it is afterwards; `refreshKey` changes after each decision (for the Approval tab).
 */
export function useApprovalDecision<T>(options: {
  objType: string;
  docEntry: number | undefined;
  apprStatus: string | undefined;
  /** e.g. "Lead", for the popup's title */
  title: string;
  onDecided: (document: T) => void;
}) {
  const { objType, docEntry, apprStatus, title, onDecided } = options;
  const { message, modal } = App.useApp();
  const [canDecide, setCanDecide] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  // Asked only for documents still waiting; again after my own decision (the stage may be done, or not my turn)
  useEffect(() => {
    if (docEntry === undefined || apprStatus !== APPR_STATUS_PENDING) {
      setCanDecide(false);
      return;
    }
    approvalsAPI
      .getForDocument(objType, docEntry)
      .then((res) => setCanDecide(res.success && res.data.canDecide))
      .catch(() => setCanDecide(false));
  }, [objType, docEntry, apprStatus, refreshKey]);

  const decide = (decision: 'APPROVED' | 'REJECTED') => {
    const approve = decision === 'APPROVED';
    let remarks = '';
    modal.confirm({
      title: `${approve ? 'Approve' : 'Reject'} ${title}`,
      content: (
        <>
          <p>{approve ? 'Approve this document?' : "Reject this document? It can't be changed or confirmed again afterwards."}</p>
          <Input.TextArea rows={3} maxLength={254} placeholder="Remarks (optional)" onChange={(e) => (remarks = e.target.value)} />
        </>
      ),
      okText: approve ? 'Approve' : 'Reject',
      okButtonProps: { danger: !approve },
      cancelText: 'No',
      // The popup closes at once; the work runs behind the portal's LOADING overlay
      onOk: () => {
        void (async () => {
          try {
            const res = await approvalsAPI.decide<T>(objType, docEntry as number, decision, remarks.trim() || null);
            if (res.success) {
              // The last approval also posts a receipt / transfer to SAP: a warning when SAP refused it
              if ((res.data as { postStatus?: string } | null)?.postStatus === 'FAILED') message.warning(res.message, 10);
              else message.success(res.message || (approve ? 'Approved' : 'Rejected'));
              onDecided(res.data);
              setRefreshKey((n) => n + 1);
            }
          } catch (error) {
            const text = (error as { response?: { data?: { error?: string } } }).response?.data?.error;
            message.error(text || `Failed to ${approve ? 'approve' : 'reject'}`);
          }
        })();
      },
    });
  };

  const buttons = canDecide ? (
    <>
      <Button icon={<LikeOutlined />} onClick={() => decide('APPROVED')}>
        Approve
      </Button>
      <Button danger icon={<DislikeOutlined />} onClick={() => decide('REJECTED')}>
        Reject
      </Button>
    </>
  ) : null;

  return { buttons, refreshKey };
}

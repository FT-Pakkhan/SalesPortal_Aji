'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Button, Form, Modal } from 'antd';
import { SyncOutlined } from '@ant-design/icons';
import type { ColDef, ValueFormatterParams } from 'ag-grid-community';
import dayjs from 'dayjs';
import { emailLogAPI } from '@/lib/apiClient';
import { ListView } from '@/components/ui/ListView';
import { StatusTag } from '@/components/ui/StatusTag';
import { ReadOnlyText, detailFormProps } from '@/components/ui/DetailView';
import detailStyles from '@/components/ui/DetailView.module.css';
import type { EmailLogEntry } from '@/types';

/**
 * E-mail Log (System Initialization): every report, and every document printed with a layout, e-mailed from the portal,
 * newest first; a click shows the details
 */
export default function EmailLogPage() {
  const [data, setData] = useState<EmailLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [shown, setShown] = useState<EmailLogEntry | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const response = await emailLogAPI.getList();
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

  const columnDefs = useMemo<ColDef<EmailLogEntry>[]>(
    () => [
      {
        field: 'sentDate',
        headerName: 'Date',
        sort: 'desc',
        valueFormatter: (p: ValueFormatterParams) => (p.value ? dayjs(p.value).format('DD.MM.YY HH:mm') : ''),
      },
      { field: 'source', headerName: 'Type' },
      { field: 'reportName', headerName: 'Report / Layout' },
      { field: 'docRef', headerName: 'Document' },
      { field: 'paramValues', headerName: 'Parameters' },
      { field: 'mailTo', headerName: 'To' },
      { field: 'mailCc', headerName: 'CC' },
      { field: 'subject', headerName: 'Subject' },
      { field: 'fileName', headerName: 'Attachment' },
      {
        field: 'status',
        headerName: 'Status',
        cellRenderer: (p: { data?: EmailLogEntry }) =>
          p.data ? <StatusTag code={p.data.status === 'SENT' ? 'SUCCESS' : 'FAILED'} label={p.data.status === 'SENT' ? 'Sent' : 'Failed'} /> : null,
      },
      { field: 'errorDesc', headerName: 'Error' },
      { field: 'sentBy', headerName: 'Sent By' },
    ],
    []
  );

  const row = (label: string, value: React.ReactNode, multiline = false) => (
    <Form.Item label={label}>
      <ReadOnlyText value={value} multiline={multiline} />
    </Form.Item>
  );

  return (
    <>
      <ListView<EmailLogEntry>
        title="E-mail Log"
        toolbar={<Button icon={<SyncOutlined />} onClick={loadData}>Refresh</Button>}
        searchPlaceholder="Search e-mails..."
        onOpenRecord={setShown}
        gridProps={{ rowData: data, columnDefs, loading, getRowId: (p) => String(p.data.absEntry) }}
      />

      {/* One e-mail's details (read-only) */}
      <Modal open={!!shown} title="E-mail" footer={null} onCancel={() => setShown(null)} width={720} destroyOnHidden>
        {shown && (
          <Form {...detailFormProps(false)} component="div">
            <div className={detailStyles.fields} style={{ maxWidth: 'none' }}>
              {row('Date', dayjs(shown.sentDate).format('DD.MM.YY HH:mm'))}
              {row(shown.source, shown.reportName)}
              {shown.source === 'Layout' ? row('Document', shown.docRef ?? '') : row('Parameters', shown.paramValues ?? '')}
              {row('To', shown.mailTo)}
              {row('CC', shown.mailCc ?? '')}
              {row('Subject', shown.subject)}
              {row('Attachment', shown.fileName)}
              {row('Status', shown.status === 'SENT' ? 'Sent' : 'Failed')}
              {shown.errorDesc && row('Error', shown.errorDesc, true)}
              {row('Sent By', shown.sentBy)}
            </div>
          </Form>
        )}
      </Modal>
    </>
  );
}

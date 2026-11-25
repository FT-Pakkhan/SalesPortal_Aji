'use client';

import React, { useEffect, useState } from 'react';
import { App, Button, Checkbox, Form, Input, Modal } from 'antd';
import { MailOutlined, WhatsAppOutlined } from '@ant-design/icons';
import { detailFormProps } from '@/components/ui/DetailView';
import detailStyles from '@/components/ui/DetailView.module.css';
import type { ApiResponse, EmailPdfFields, ReportEmailDraft } from '@/types';

/** A PDF made in the portal (a report run, a document printed with a layout) */
export interface PortalPdf {
  title: string;
  /** Object URL of the blob, for the viewer */
  url: string;
  blob: Blob;
  /** File name without .pdf (Share) */
  fileName: string;
}

/** A file name phones and Windows accept */
const safeName = (name: string) => name.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 150) || 'Document';

/**
 * The PDF in the browser's PDF viewer (its own Print / Download buttons), with Share (WhatsApp or any app of the
 * device's share panel) and, when onEmail is given, E-mail. Rendered by the report run and the documents' Print.
 */
export function PdfViewerModal({ pdf, onClose, onEmail }: { pdf: PortalPdf | null; onClose: () => void; onEmail?: () => void }) {
  const { message } = App.useApp();

  /**
   * Share: the device's share panel with the PDF file (phones; Chrome / Edge on Windows - WhatsApp is there when the
   * WhatsApp app is installed). A browser that can't share files: the PDF is downloaded and WhatsApp Web opens, to
   * attach it there.
   */
  const share = async () => {
    if (!pdf) return;
    const file = new File([pdf.blob], `${safeName(pdf.fileName)}.pdf`, { type: 'application/pdf' });
    if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: pdf.title });
      } catch (error) {
        // Closing the share panel is not an error
        if ((error as Error).name !== 'AbortError') message.error(`Failed to share: ${(error as Error).message}`, 8);
      }
      return;
    }
    const link = document.createElement('a');
    link.href = pdf.url;
    link.download = file.name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.open('https://web.whatsapp.com/', '_blank', 'noopener');
    message.info(`This browser can't share files: ${file.name} was downloaded. Attach it in WhatsApp (the + / paperclip button).`, 10);
  };

  return (
    <Modal
      open={!!pdf}
      title={
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', paddingRight: 32 }}>
          <span style={{ marginRight: 4 }}>{pdf?.title}</span>
          {onEmail && (
            <Button size="small" icon={<MailOutlined />} onClick={onEmail}>
              E-mail
            </Button>
          )}
          <Button size="small" icon={<WhatsAppOutlined />} onClick={share} title="Share the PDF, e.g. to WhatsApp">
            Share
          </Button>
        </span>
      }
      footer={null}
      onCancel={onClose}
      width="90vw"
      destroyOnHidden
    >
      {pdf && <iframe src={pdf.url} title={pdf.title} style={{ width: '100%', height: '80vh', border: 'none' }} />}
    </Modal>
  );
}

/**
 * The E-mail form for a PDF: To / CC / Subject / Message / attachment name, filled in by loadDraft, all changeable.
 * Send makes the PDF again on the server and mails it (E-mail Log). The popup closes at once and the sending runs
 * behind the portal's LOADING overlay.
 */
export function EmailPdfModal({
  open,
  title,
  loadDraft,
  send,
  onClose,
}: {
  open: boolean;
  title: string;
  loadDraft: () => Promise<ApiResponse<ReportEmailDraft>>;
  send: (fields: EmailPdfFields) => Promise<ApiResponse<{ sent: boolean; message: string }>>;
  onClose: () => void;
}) {
  const { message } = App.useApp();
  const [form] = Form.useForm<EmailPdfFields>();
  const [myEmail, setMyEmail] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  // Filled in afresh each time it opens
  useEffect(() => {
    if (!open) return;
    setReady(false);
    loadDraft()
      .then((res) => {
        if (!res.success) return;
        setMyEmail(res.data.myEmail);
        form.setFieldsValue({ ...res.data, copyMe: false });
        setReady(true);
      })
      .catch((error) => {
        message.error((error as { response?: { data?: { error?: string } } }).response?.data?.error || 'Failed to prepare the e-mail', 8);
        onClose();
      });
  }, [open]);

  const handleSend = (v: EmailPdfFields) => {
    onClose();
    void (async () => {
      try {
        const res = await send({ ...v, cc: v.cc ?? '', body: v.body ?? '', copyMe: !!v.copyMe });
        if (!res.success) return;
        if (res.data.sent) message.success(res.data.message, 6);
        else message.error(res.data.message, 10);
      } catch (error) {
        message.error((error as { response?: { data?: { error?: string } } }).response?.data?.error || 'Failed to send the e-mail', 8);
      }
    })();
  };

  return (
    // zIndex: above the PDF viewer it is opened from (antd's popups start at 1000); forceRender: the form exists before
    // it opens, so the filled-in values can be put in it
    <Modal
      open={open && ready}
      title={title}
      okText="Send"
      onOk={() => form.submit()}
      onCancel={onClose}
      width={720}
      zIndex={1100}
      // A click outside doesn't close it (what was typed isn't lost)
      mask={{ closable: false }}
      forceRender
    >
      {/* The portal's label : value rows, compact */}
      <Form form={form} {...detailFormProps(true, 110)} onFinish={handleSend}>
        <div className={detailStyles.fields} style={{ maxWidth: 'none' }}>
          <Form.Item label="To" name="to" rules={[{ required: true, whitespace: true, message: 'Enter at least one e-mail address' }]}>
            <Input placeholder="Separate several addresses with ;" />
          </Form.Item>
          <Form.Item label="CC" name="cc">
            <Input placeholder="Optional" />
          </Form.Item>
          <Form.Item label="Subject" name="subject" rules={[{ required: true, whitespace: true, message: 'Subject is required' }, { max: 254 }]}>
            <Input />
          </Form.Item>
          <Form.Item label="Message" name="body">
            <Input.TextArea autoSize={{ minRows: 5, maxRows: 12 }} />
          </Form.Item>
          <Form.Item label="Attachment" name="fileName" rules={[{ required: true, whitespace: true, message: 'Attachment name is required' }]}>
            <Input suffix=".pdf" />
          </Form.Item>
          <Form.Item label="Copy to Me" name="copyMe" valuePropName="checked">
            <Checkbox disabled={!myEmail}>{myEmail ?? '(your user has no e-mail address)'}</Checkbox>
          </Form.Item>
        </div>
      </Form>
    </Modal>
  );
}

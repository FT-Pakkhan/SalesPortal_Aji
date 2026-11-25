'use client';

import React, { useEffect, useState } from 'react';
import { App, Button, Modal } from 'antd';
import { PrinterOutlined } from '@ant-design/icons';
import { printLayoutsAPI } from '@/lib/apiClient';
import { EmailPdfModal, PdfViewerModal, type PortalPdf } from '@/components/ui/PdfViewer';
import type { PrintLayout } from '@/types';

/**
 * Print a document with its Crystal Reports layouts (System Initialization > Layouts): the active layouts of the
 * document type; one is printed straight away, several are offered to choose; the PDF shows in the portal with Share
 * (WhatsApp) and, when the layout has Allow E-mail, E-mail.
 * docNo: the document's No. (the shared file's name, e.g. "Sales Order 1238"); empty on a draft.
 * Returns `canPrint` (the document type has at least one active layout: show the Print button only then),
 * `print()` for the Print button and `modals` to render once in the screen.
 */
export function usePrintDocument(objType: string, docEntry: number | undefined, title: string, docNo?: string | number | null) {
  const { message } = App.useApp();
  const [choices, setChoices] = useState<PrintLayout[] | null>(null);
  const [printed, setPrinted] = useState<(PortalPdf & { layout: PrintLayout }) | null>(null);
  const [emailOpen, setEmailOpen] = useState(false);
  // Whether there is any active layout for this document type (checked once when the screen opens)
  const [canPrint, setCanPrint] = useState(false);

  useEffect(() => {
    let current = true;
    printLayoutsAPI
      .getList(objType, true)
      .then((res) => current && setCanPrint(res.success && res.data.length > 0))
      .catch(() => current && setCanPrint(false));
    return () => {
      current = false;
    };
  }, [objType]);

  const printWithLayout = async (layout: PrintLayout) => {
    setChoices(null);
    try {
      const blob = await printLayoutsAPI.print(layout.docEntry, objType, docEntry as number);
      const fileName = `${title} ${docNo ? String(docNo) : 'Draft'}`;
      setPrinted({ title: layout.layoutName, url: URL.createObjectURL(blob), blob, fileName, layout });
    } catch (error) {
      // The answer was asked for as a file, so an error message arrives as a Blob holding the JSON
      const data = (error as { response?: { data?: unknown } }).response?.data;
      let text = 'Failed to print';
      if (data instanceof Blob) {
        try {
          text = (JSON.parse(await data.text()) as { error?: string }).error || text;
        } catch {
          /* not JSON: keep the general message */
        }
      }
      message.error(text);
    }
  };

  const print = async () => {
    try {
      const res = await printLayoutsAPI.getList(objType, true);
      const layouts = res.success ? res.data : [];
      if (layouts.length === 0) message.warning(`No active layout for ${title}. Add one in System Initialization > Layouts.`);
      else if (layouts.length === 1) await printWithLayout(layouts[0]);
      else setChoices(layouts);
    } catch {
      message.error('Failed to load layouts');
    }
  };

  const closePrinted = () => {
    if (printed) URL.revokeObjectURL(printed.url);
    setPrinted(null);
  };

  const modals = (
    <>
      {/* More than one active layout -> choose which one */}
      <Modal open={!!choices} title="Print - Choose a Layout" footer={null} onCancel={() => setChoices(null)} width={420}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {(choices ?? []).map((layout) => (
            <Button key={layout.docEntry} icon={<PrinterOutlined />} onClick={() => printWithLayout(layout)} style={{ justifyContent: 'flex-start' }}>
              {layout.layoutName}
            </Button>
          ))}
        </div>
      </Modal>
      {/* The printed PDF, in the browser's PDF viewer (its own Print / Download buttons), with Share and E-mail */}
      <PdfViewerModal pdf={printed} onClose={closePrinted} onEmail={printed?.layout.emailAllowed ? () => setEmailOpen(true) : undefined} />
      {printed && docEntry && (
        <EmailPdfModal
          open={emailOpen}
          title={`E-mail ${title}`}
          loadDraft={() => printLayoutsAPI.getEmailDraft(printed.layout.docEntry, objType, docEntry)}
          send={(fields) => printLayoutsAPI.sendEmail(printed.layout.docEntry, { objType, docEntry, ...fields })}
          onClose={() => setEmailOpen(false)}
        />
      )}
    </>
  );

  return { canPrint, print, modals };
}

'use client';

import React, { useRef, useState } from 'react';
import { App, Input, Modal } from 'antd';
import type { InputRef } from 'antd';

/** Longest No. a user may key in on a manual series (as the API checks) */
export const MANUAL_NO_MAX = 15;

interface ConfirmOptions {
  /** e.g. "Confirm Sales Order" */
  title: string;
  content: React.ReactNode;
  /** The document's series is Manual: the No. is keyed in here */
  manual: boolean;
  /** What the No. is called, e.g. "Lead Code"; default "No." */
  noLabel?: string;
  /** The No. typed in the document's No. field (saved with the draft), shown in the box */
  initialNo?: string;
  /** Runs once the popup has closed: the No. keyed in (manual series), otherwise undefined */
  onConfirm: (docNum?: string) => void;
}

/**
 * The Confirm popup of a document. Automatic series: the usual "Continue?" question. Manual series: the same text
 * with the No. typed on the document (still changeable here; required, up to 15 characters; the API checks it isn't
 * used yet). Render `modal` once.
 */
export function useConfirmPrompt() {
  const { modal: dialogs, message } = App.useApp();
  const [manual, setManual] = useState<ConfirmOptions | null>(null);
  const [no, setNo] = useState('');
  const inputRef = useRef<InputRef>(null);

  const confirm = (options: ConfirmOptions) => {
    if (options.manual) {
      setNo(options.initialNo ?? '');
      setManual(options);
      return;
    }
    dialogs.confirm({
      title: options.title,
      content: options.content,
      okText: 'Confirm',
      // The popup closes at once; the work runs behind the portal's LOADING overlay
      onOk: () => options.onConfirm(),
    });
  };

  const noLabel = manual?.noLabel ?? 'No.';
  const handleOk = () => {
    const value = no.trim();
    if (!value) {
      message.warning(`Key in the ${noLabel}`);
      inputRef.current?.focus();
      return;
    }
    const run = manual?.onConfirm;
    setManual(null);
    run?.(value);
  };

  const modal = (
    <Modal
      open={!!manual}
      title={manual?.title}
      okText="Confirm"
      onOk={handleOk}
      onCancel={() => setManual(null)}
      afterOpenChange={(open) => open && inputRef.current?.focus()}
      destroyOnHidden
    >
      <div style={{ marginBottom: 12 }}>{manual?.content}</div>
      <div style={{ marginBottom: 4 }}>
        {noLabel} <span style={{ color: '#888' }}>(manual series, up to {MANUAL_NO_MAX} characters)</span>
      </div>
      <Input ref={inputRef} value={no} maxLength={MANUAL_NO_MAX} onChange={(e) => setNo(e.target.value)} onPressEnter={handleOk} />
    </Modal>
  );

  return { confirm, modal };
}

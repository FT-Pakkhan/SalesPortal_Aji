'use client';

import React from 'react';
import { Tag } from 'antd';

/**
 * Colour of each status code (DocStatus / ApprStatus / PostStatus / LineStatus) by meaning:
 * grey = not started, blue = open, orange = waiting, green = done / OK, red = stopped / failed.
 * Codes not listed here (e.g. NO-APPROVAL, NO-POSTING) show as plain text, without a tag.
 */
const STATUS_COLORS: Record<string, string> = {
  DRAFT: 'default',
  OPEN: 'blue',
  CLOSED: 'green',
  CANCELED: 'red',
  PENDING: 'orange',
  APPROVED: 'green',
  REJECTED: 'red',
  SUCCESS: 'green',
  FAILED: 'red',
};

interface StatusTagProps {
  /** Status code, e.g. OPEN, PENDING */
  code: string | null | undefined;
  /** Text to show (the name from the status view); defaults to the code */
  label?: string | null;
}

/** A status as a small coloured tag, like SAP Fiori lists */
export function StatusTag({ code, label }: StatusTagProps) {
  const text = label ?? code ?? '';
  const color = code ? STATUS_COLORS[code] : undefined;
  if (!color) return <span>{text}</span>;
  return (
    // Filled: light background, coloured text, no border
    <Tag color={color} variant="filled" style={{ marginInlineEnd: 0 }}>
      {text}
    </Tag>
  );
}

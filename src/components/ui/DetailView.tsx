'use client';

import React from 'react';
import { Form } from 'antd';
import styles from './DetailView.module.css';

interface DetailViewProps {
  /** Toolbar buttons, in order: New, Edit, then the rest */
  toolbar: React.ReactNode;
  /** e.g. "My Profile - Admin" */
  title: string;
  /** The label / value rows */
  children: React.ReactNode;
  /** A second column to the right of the rows, e.g. checkboxes with their name after the box */
  sideFields?: React.ReactNode;
  /** More label / value rows that need a wide value, e.g. a long text or query */
  wideFields?: React.ReactNode;
  /** Full-width content under the fields, e.g. a grid of lines */
  below?: React.ReactNode;
  /**
   * `sideFields` close beside the rows (as two equal columns, like the tabs' pairColumns) instead of at the right
   * edge of the screen
   */
  sideClose?: boolean;
}

/**
 * Standard detail view layout: toolbar, title, a single section of label / value rows, then any lines grid.
 * When `wideFields` is used, wrap the whole DetailView in the antd Form so both sets of rows belong to it.
 */
export function DetailView({ toolbar, title, children, sideFields, wideFields, below, sideClose }: DetailViewProps) {
  return (
    <div className={styles.root}>
      <div className={styles.toolbar}>{toolbar}</div>
      <h1 className={styles.title}>{title}</h1>
      {sideFields ? (
        <div className={sideClose ? styles.pairColumns : styles.columns}>
          <div className={styles.fields}>{children}</div>
          <div className={`${styles.fields} ${styles.side}`}>{sideFields}</div>
        </div>
      ) : (
        <div className={styles.fields}>{children}</div>
      )}
      {wideFields && <div className={`${styles.fields} ${styles.wide}`}>{wideFields}</div>}
      {below && <div className={styles.below}>{below}</div>}
    </div>
  );
}

/** Width of the label column */
const DETAIL_LABEL_WIDTH = 140;

/**
 * Props for the antd Form of a detail view: label on the left, value on the right, compact rows.
 * In edit mode, mandatory fields (Form.Item `required`) get a red * after the label text.
 * The ":" sits at the right edge of the label column, so all colons line up beside the textboxes.
 * `labelWidth`: a wider label column for a view with a long label (every row of that view keeps its colons in line).
 */
export function detailFormProps(editing: boolean, labelWidth: number = DETAIL_LABEL_WIDTH) {
  return {
    layout: 'horizontal' as const,
    size: 'small' as const,
    labelAlign: 'left' as const,
    labelCol: { flex: `${labelWidth}px` },
    wrapperCol: { flex: '1 1 0' },
    colon: false,
    requiredMark: (label: React.ReactNode, { required }: { required: boolean }) => (
      <>
        {label}
        {editing && required && <span className={styles.requiredMark}>*</span>}
        <span className={styles.colon}>:</span>
      </>
    ),
  };
}

/** A row with no label (and no ":"), its content lined up under the values, e.g. a Test Connection button */
export function DetailButtonRow({ children }: { children: React.ReactNode }) {
  return <Form.Item style={{ marginLeft: DETAIL_LABEL_WIDTH }}>{children}</Form.Item>;
}

/** Heading that starts a section of rows, e.g. "Company", "SAP DI API"; `extra` sits beside the title (e.g. a checkbox) */
export function DetailSection({ title, extra }: { title: string; extra?: React.ReactNode }) {
  if (!extra) return <div className={styles.sectionTitle}>{title}</div>;
  return (
    <div className={`${styles.sectionTitle} ${styles.sectionTitleExtra}`}>
      <span>{title}</span>
      {extra}
    </div>
  );
}

/**
 * Plain-text value shown in view mode; works as a Form.Item child (receives `value`).
 * `multiline` keeps line breaks, e.g. for a query.
 */
export function ReadOnlyText({ value, multiline }: { value?: React.ReactNode; multiline?: boolean }) {
  return <span className={`${styles.readOnlyText} ${multiline ? styles.multiline : ''}`}>{value}</span>;
}

/**
 * View-mode text for a field whose stored value isn't what should be shown (a code -> its name, a number -> formatted).
 * Inside a named Form.Item the form passes the stored value as `value`; this ignores it and shows `text`.
 */
export function DisplayText({ text, multiline }: { text: React.ReactNode; value?: unknown; multiline?: boolean }) {
  return <ReadOnlyText value={text} multiline={multiline} />;
}

'use client';

import React, { useEffect, useMemo, useState } from 'react';
import type { ColDef } from 'ag-grid-community';
import dayjs from 'dayjs';
import { approvalsAPI } from '@/lib/apiClient';
import { DataGrid } from '@/components/ui/DataGrid';
import type { DocumentApprovalChange, DocumentApprovalRow } from '@/types';

interface ApprovalTabProps {
  objType: string;
  docEntry: number;
  /** Changes after an Approve / Reject, to load the rows again */
  refreshKey: number;
}

/** Round: shown only once a document has been sent for approval more than once */
const roundColumn: ColDef<DocumentApprovalRow> = { field: 'round', headerName: 'Round', cellDataType: 'number', maxWidth: 90 };

const columns: ColDef<DocumentApprovalRow>[] = [
  { field: 'wtmName', headerName: 'Approval Template' },
  { field: 'stageNo', headerName: 'Stage No.', cellDataType: 'number' },
  { field: 'wstName', headerName: 'Stage' },
  { field: 'maxReqr', headerName: 'Approvals Required', cellDataType: 'number' },
  { colId: 'approver', headerName: 'Approver', valueGetter: (p) => p.data?.displayName || p.data?.userName },
  { colId: 'decision', headerName: 'Decision', valueGetter: (p) => p.data?.apprStatusName ?? p.data?.apprStatus },
  { field: 'remarks', headerName: 'Remarks' },
  {
    colId: 'actionDate',
    headerName: 'Date',
    valueGetter: (p) => (p.data?.actionDate ? dayjs(p.data.actionDate).format('DD.MM.YY HH:mm') : ''),
    // Date and time on one line (the column is sized before any decision has a date)
    wrapText: false,
    minWidth: 120,
  },
];

/**
 * Approval tab of a document: who approves at each stage (in order), their decision, remarks and when; the latest
 * round first when it was sent for approval more than once. Below: the changes approvers made while approving.
 * Its data is only loaded when the tab is opened (the tab isn't drawn before), so opening a document costs nothing.
 */
export function ApprovalTab({ objType, docEntry, refreshKey }: ApprovalTabProps) {
  const [rows, setRows] = useState<DocumentApprovalRow[]>([]);
  const [changes, setChanges] = useState<DocumentApprovalChange[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let current = true;
    setLoading(true);
    approvalsAPI
      .getForDocument(objType, docEntry)
      .then((res) => {
        if (!current || !res.success) return;
        setRows(res.data.rows);
        setChanges(res.data.changes ?? []);
      })
      .catch(() => {
        if (!current) return;
        setRows([]);
        setChanges([]);
      })
      .finally(() => current && setLoading(false));
    return () => {
      current = false;
    };
  }, [objType, docEntry, refreshKey]);

  const severalRounds = rows.some((r) => r.round > 1);
  const columnDefs = useMemo(() => (severalRounds ? [roundColumn, ...columns] : columns), [severalRounds]);

  return (
    <>
      <DataGrid<DocumentApprovalRow>
        settingsKey={`approval:${objType}`}
        showToolbar
        selectable={false}
        gridProps={{
          rowData: rows,
          columnDefs,
          loading,
          getRowId: (p) => String(p.data.absEntry),
          overlayNoRowsTemplate: 'This document has not been through approval',
        }}
      />
      {/* Changed by an approver while approving: when, who, why */}
      {changes.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Changes</div>
          {changes.map((c) => (
            <div key={c.absEntry} style={{ lineHeight: '24px' }}>
              {dayjs(c.changeDate).format('DD.MM.YY HH:mm')} · {c.displayName || c.userName}
              {c.remarks ? ` · ${c.remarks}` : ''}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

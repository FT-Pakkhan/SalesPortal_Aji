'use client';

import React, { useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { App, Button, Modal } from 'antd';
import { DeleteOutlined, DownloadOutlined, EyeOutlined, PaperClipOutlined } from '@ant-design/icons';
import type { ColDef, ValueFormatterParams } from 'ag-grid-community';
import dayjs from 'dayjs';
import { attachmentsAPI, generalSettingsAPI } from '@/lib/apiClient';
import { ATTACH_FOLDER_NOT_SET, DEFAULT_ATTACH_MAX_MB, uploadProblem, splitFileName } from '@/lib/attachmentRules';
import { DataGrid } from './DataGrid';
import type { DataGridHandle } from './DataGrid';
import type { Attachment } from '@/types';

/** A row of the tab: an attachment already saved, or a file chosen with Browse and not saved yet */
interface AttachmentRow {
  key: string;
  /** null until the file is saved */
  absEntry: number | null;
  /** The chosen file, until it is saved */
  file: File | null;
  fileName: string;
  fileExt: string | null;
  fileSize: number;
  freeText: string | null;
  createdBy: string | null;
  createdDate: string | null;
}

/** What the document's detail view runs on the tab */
export interface AttachmentsTabHandle {
  /** Apply the changes made in edit mode (new files, deletions, Remarks) to the saved document */
  save: (docEntry: number) => Promise<void>;
}

interface AttachmentsTabProps {
  /** Document type (FTS_vw_ObjType.Code), e.g. FTS11OQUT */
  objType: string;
  /** Omit for a document that isn't saved yet: chosen files are held until its first Save */
  docEntry?: number;
  /** Edit mode: Browse / Delete / Remarks; changes are applied on Save, dropped on Cancel */
  editing: boolean;
  handleRef?: React.Ref<AttachmentsTabHandle>;
}

const toRow = (a: Attachment): AttachmentRow => ({
  key: `saved-${a.absEntry}`,
  absEntry: a.absEntry,
  file: null,
  fileName: a.fileName,
  fileExt: a.fileExt,
  fileSize: a.fileSize,
  freeText: a.freeText,
  createdBy: a.createdBy,
  createdDate: a.createdDate,
});

const formatSize = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

/**
 * Files the browser can show inside the portal (Display), by extension -> the type to show them as.
 * Not HTML / SVG: they can carry scripts that would run in the portal, so those are only downloaded.
 */
const VIEWABLE_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  bmp: 'image/bmp',
  webp: 'image/webp',
  txt: 'text/plain;charset=utf-8',
  csv: 'text/plain;charset=utf-8',
  log: 'text/plain;charset=utf-8',
};

/** Save a file to the user's PC */
const saveToPc = (blob: Blob, fileName: string) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
};

let pendingCounter = 0;

/**
 * Attachments tab of a document (beside Details), like SAP B1's Attachments tab.
 * Files are saved in the attachment folder on the server; the grid lists them.
 */
export function AttachmentsTab({ objType, docEntry, editing, handleRef }: AttachmentsTabProps) {
  const { message } = App.useApp();
  const [saved, setSaved] = useState<Attachment[]>([]);
  const [rows, setRows] = useState<AttachmentRow[]>([]);
  // Saved attachments removed in edit mode; deleted on Save
  const [removed, setRemoved] = useState<number[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<DataGridHandle<AttachmentRow>>(null);
  // Max. Attachment Size (MB) from General Settings; the server checks it again
  const [maxMB, setMaxMB] = useState(DEFAULT_ATTACH_MAX_MB);
  // Display: the file being shown
  const [preview, setPreview] = useState<{ name: string; type: string; url: string } | null>(null);

  useEffect(() => {
    generalSettingsAPI
      .get()
      .then((res) => res.success && res.data && setMaxMB(res.data.attachMaxSizeMB))
      .catch(() => undefined);
  }, []);

  // Browse: only when General Settings has an Attachment Folder (read fresh, in case it was just set)
  const handleBrowse = async () => {
    try {
      const res = await generalSettingsAPI.get();
      if (!res.success || !res.data?.attachPath) {
        message.error({ content: ATTACH_FOLDER_NOT_SET, duration: 6 });
        return;
      }
      setMaxMB(res.data.attachMaxSizeMB);
      fileInputRef.current?.click();
    } catch {
      message.error('Failed to check the attachment settings');
    }
  };

  const load = async (entry: number) => {
    try {
      const res = await attachmentsAPI.getList(objType, entry);
      if (res.success) {
        setSaved(res.data);
        setRows(res.data.map(toRow));
        setRemoved([]);
      }
    } catch {
      message.error('Failed to load attachments');
    }
  };

  useEffect(() => {
    if (docEntry !== undefined) load(docEntry);
  }, [docEntry]);

  // Leaving edit mode (Cancel, or after Save) shows the saved attachments again
  useEffect(() => {
    if (!editing) {
      setRows(saved.map(toRow));
      setRemoved([]);
    }
  }, [editing, saved]);

  const handleFilesChosen = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    const added: AttachmentRow[] = [];
    for (const file of files) {
      const problem = uploadProblem(file.name, file.size, maxMB);
      if (problem) {
        message.error(problem);
        continue;
      }
      const { name, ext } = splitFileName(file.name);
      added.push({
        key: `new-${++pendingCounter}`,
        absEntry: null,
        file,
        fileName: name,
        fileExt: ext,
        fileSize: file.size,
        freeText: null,
        createdBy: null,
        createdDate: null,
      });
    }
    if (added.length) setRows((prev) => [...prev, ...added]);
  };

  const tickedRows = () => {
    const ticked = gridRef.current?.getSelectedRows() ?? [];
    if (ticked.length === 0) message.warning('Tick the attachments first');
    return ticked;
  };

  const fullNameOf = (row: AttachmentRow) => (row.fileExt ? `${row.fileName}.${row.fileExt}` : row.fileName);

  // The file's contents: a file not saved yet comes from the PC's own copy, a saved one from the server
  const contentsOf = async (row: AttachmentRow): Promise<Blob> =>
    row.file ?? (await attachmentsAPI.download(row.absEntry as number));

  // Display: show the ticked file inside the portal (PDF, pictures, text); other types can't be shown by a browser,
  // so they are downloaded instead
  const handleDisplay = async () => {
    const ticked = tickedRows();
    if (ticked.length === 0) return;
    if (ticked.length > 1) {
      message.warning('Tick one attachment to display (Download takes several)');
      return;
    }
    const row = ticked[0];
    const fullName = fullNameOf(row);
    const type = VIEWABLE_TYPES[(row.fileExt ?? '').toLowerCase()];
    try {
      const blob = await contentsOf(row);
      if (!type) {
        message.info(`${fullName} can't be shown in the browser, so it is downloaded`);
        saveToPc(blob, fullName);
        return;
      }
      // Re-typed so the browser shows it instead of saving it (the server sends every file as plain data)
      setPreview({ name: fullName, type, url: URL.createObjectURL(new Blob([blob], { type })) });
    } catch {
      message.error(`Failed to open ${fullName}`);
    }
  };

  const closePreview = () => {
    if (preview) URL.revokeObjectURL(preview.url);
    setPreview(null);
  };

  // Download: save the ticked files to the PC
  const handleDownload = async () => {
    for (const row of tickedRows()) {
      const fullName = fullNameOf(row);
      try {
        saveToPc(await contentsOf(row), fullName);
      } catch {
        message.error(`Failed to download ${fullName}`);
      }
    }
  };

  // Delete: taken off the list now, removed for good on Save
  const handleDelete = () => {
    const ticked = tickedRows();
    if (ticked.length === 0) return;
    const keys = new Set(ticked.map((r) => r.key));
    setRemoved((prev) => [...prev, ...ticked.filter((r) => r.absEntry !== null).map((r) => r.absEntry as number)]);
    setRows((prev) => prev.filter((r) => !keys.has(r.key)));
  };

  useImperativeHandle(handleRef, () => ({
    save: async (entry: number) => {
      const failed: string[] = [];
      const savedText = new Map(saved.map((a) => [a.absEntry, a.freeText ?? null]));

      for (const absEntry of removed) {
        await attachmentsAPI.remove(absEntry).catch(() => failed.push('delete'));
      }
      for (const row of rows) {
        const fullName = row.fileExt ? `${row.fileName}.${row.fileExt}` : row.fileName;
        try {
          if (row.file) await attachmentsAPI.add(objType, entry, row.file, row.freeText);
          else if (row.absEntry !== null && (row.freeText || null) !== savedText.get(row.absEntry)) {
            await attachmentsAPI.updateText(row.absEntry, row.freeText || null);
          }
        } catch (error) {
          const text = (error as { response?: { data?: { error?: string } } }).response?.data?.error;
          failed.push(text ?? fullName);
        }
      }
      await load(entry);
      if (failed.length) message.error(`Some attachments were not saved: ${failed.join(', ')}`);
    },
  }));

  const columns = useMemo<ColDef<AttachmentRow>[]>(
    () => [
      { colId: 'lineNo', headerName: '#', valueGetter: (p) => (p.node?.rowIndex ?? 0) + 1, sortable: false, cellDataType: 'number' },
      { field: 'fileName', headerName: 'File Name' },
      { field: 'fileExt', headerName: 'File Extension' },
      { colId: 'size', headerName: 'Size', valueGetter: (p) => (p.data ? formatSize(p.data.fileSize) : '') },
      {
        colId: 'createdDate',
        headerName: 'Attachment Date',
        cellDataType: 'date',
        valueGetter: (p) => (p.data?.createdDate ? new Date(p.data.createdDate) : null),
        valueFormatter: (p: ValueFormatterParams<AttachmentRow, Date | null>) => (p.value ? dayjs(p.value).format('DD.MM.YY') : ''),
      },
      { field: 'createdBy', headerName: 'Attached By' },
      // Shown as "Remarks"; stored in FTS11ATC1.[FreeText]
      { field: 'freeText', headerName: 'Remarks', editable: editing, cellEditorParams: { maxLength: 254 } },
    ],
    [editing]
  );

  // Button order: Browse first, then the rest; Reset View Settings is added by the grid
  const toolbar = (
    <>
      {editing && (
        <Button size="small" icon={<PaperClipOutlined />} onClick={handleBrowse}>
          Browse
        </Button>
      )}
      <Button size="small" icon={<EyeOutlined />} onClick={handleDisplay}>
        Display
      </Button>
      <Button size="small" icon={<DownloadOutlined />} onClick={handleDownload}>
        Download
      </Button>
      {editing && (
        <Button size="small" icon={<DeleteOutlined />} onClick={handleDelete}>
          Delete
        </Button>
      )}
    </>
  );

  return (
    <>
      {/* Opened by Browse; styled out of sight because global styles can override the `hidden` attribute */}
      <input ref={fileInputRef} type="file" multiple style={{ display: 'none' }} onChange={handleFilesChosen} />
      <DataGrid<AttachmentRow>
        handleRef={gridRef}
        settingsKey={`attachments:${objType}`}
        showToolbar
        toolbar={toolbar}
        gridProps={{
          rowData: rows,
          columnDefs: columns,
          getRowId: (p) => p.data.key,
          suppressCellFocus: false,
          singleClickEdit: true,
          stopEditingWhenCellsLoseFocus: true,
          onCellValueChanged: () => setRows((prev) => [...prev]),
        }}
      />

      {/* Display: the file shown in the portal — PDF in the browser's viewer (its own Print / Download), pictures,
          text */}
      <Modal open={!!preview} title={preview?.name} footer={null} onCancel={closePreview} width="90vw" destroyOnHidden>
        {preview &&
          (preview.type.startsWith('image/') ? (
            <div style={{ display: 'flex', justifyContent: 'center', maxHeight: '80vh', overflow: 'auto' }}>
              <img src={preview.url} alt={preview.name} style={{ maxWidth: '100%', objectFit: 'contain' }} />
            </div>
          ) : (
            <iframe src={preview.url} title={preview.name} style={{ width: '100%', height: '80vh', border: 'none', background: '#fff' }} />
          ))}
      </Modal>
    </>
  );
}

'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { App, Button, DatePicker, Form, Input, Select, Tabs } from 'antd';
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  CloudUploadOutlined,
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  PrinterOutlined,
  SaveOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import type { ColDef, ValueFormatterParams } from 'ag-grid-community';
import dayjs, { type Dayjs } from 'dayjs';
import { useRouter } from 'next/navigation';
import { documentNumberingAPI, inventoryTransfersAPI, sapAPI, usersAPI } from '@/lib/apiClient';
import { isDocumentEditable, isSynced } from '@/lib/postStatus';
import { useCanChange } from '@/stores/accessStore';
import { useAuthStore } from '@/stores/authStore';
import { DetailView, DisplayText, ReadOnlyText, detailFormProps } from '@/components/ui/DetailView';
import detailStyles from '@/components/ui/DetailView.module.css';
import { DataGrid } from '@/components/ui/DataGrid';
import type { DataGridHandle } from '@/components/ui/DataGrid';
import { LookupListView } from '@/components/ui/LookupListView';
import { AttachmentsTab } from '@/components/ui/AttachmentsTab';
import type { AttachmentsTabHandle } from '@/components/ui/AttachmentsTab';
import { usePrintDocument } from '@/components/ui/usePrintDocument';
import { MANUAL_NO_MAX, useConfirmPrompt } from '@/components/ui/useConfirmPrompt';
import { ApprovalTab } from '@/components/sales/ApprovalTab';
import { useApprovalDecision } from '@/components/sales/useApprovalDecision';
import type {
  InventoryTransfer,
  InventoryTransferLine,
  NumberingSeries,
  SapCustomer,
  SapSalesEmployee,
  SapStockItem,
  SapWarehouse,
} from '@/types';

/** Document type (FTS_vw_ObjType.Code): numbering series, approvals, attachments and layouts are kept under it */
const OWTR_OBJTYPE = 'FTS11OWTR';
const LIST_PATH = '/inventory/transfers';
const STATUS_DRAFT = 'DRAFT';
const STATUS_OPEN = 'OPEN';
const APPR_STATUS_PENDING = 'PENDING';
/** Approval statuses that allow posting to SAP */
const POSTABLE_APPR_STATUSES = ['NO-APPROVAL', 'APPROVED'];
/** Date format on screen, as in SAP B1 (e.g. 12.08.26) */
const DATE_FORMAT = 'DD.MM.YY';

interface InventoryTransferDetailProps {
  /** Omit for a new transfer */
  docEntry?: number;
  /** Open an existing transfer directly in edit mode (list view's Edit button) */
  startInEdit?: boolean;
}

interface TransferFormValues {
  /** Typed only on a manual series (draft) */
  docNum: string;
  series: number | null;
  cardCode: string;
  cardName: string;
  docDate: Dayjs | null;
  taxDate: Dayjs | null;
  filler: string | null;
  toWhsCode: string | null;
  slpCode: number | null;
  comments: string;
}

/** A line on screen: its key stays the same while lines are added / removed */
type LineRow = InventoryTransferLine & { key: string };

let lineCounter = 0;
const toRows = (lines: InventoryTransferLine[]): LineRow[] => lines.map((l) => ({ ...l, key: `l${++lineCounter}` }));

const toFormValues = (t: InventoryTransfer): TransferFormValues => ({
  series: t.series,
  docNum: t.docNum ?? '',
  cardCode: t.cardCode ?? '',
  cardName: t.cardName ?? '',
  docDate: t.docDate ? dayjs(t.docDate) : null,
  taxDate: t.taxDate ? dayjs(t.taxDate) : null,
  filler: t.filler,
  toWhsCode: t.toWhsCode,
  slpCode: t.slpCode,
  comments: t.comments ?? '',
});

const formatQty = (value: unknown) =>
  value == null || value === '' ? '' : Number(value).toLocaleString('en-US', { maximumFractionDigits: 6 });

/** A line whose warehouses need changing before Save: one missing, or From the same as To */
const whsProblem = (l: InventoryTransferLine | undefined) => !!l && (!l.fromWhsCod || !l.whsCode || l.fromWhsCod === l.whsCode);

function DateText({ value }: { value?: Dayjs | null }) {
  return <ReadOnlyText value={value ? value.format(DATE_FORMAT) : ''} />;
}

const customerColumns: ColDef<SapCustomer>[] = [
  { field: 'cardCode', headerName: 'Code', width: 160, sort: 'asc' },
  { field: 'cardName', headerName: 'Name', flex: 1, minWidth: 220 },
];

/**
 * Inventory Transfer (FTS11OWTR / FTS11WTR1), like SAP B1's: items moved from one warehouse to another.
 * Save = DRAFT without a No.; Confirm = stock checked against SAP B1, then the No. (or sent for approval).
 * A new line's From is the item's default warehouse (or else SAP's default warehouse), its To the header's To
 * Warehouse; each line keeps its own. The header's From Warehouse is optional (list / layouts). No prices.
 */
export default function InventoryTransferDetail({ docEntry, startInEdit = false }: InventoryTransferDetailProps) {
  const isNew = docEntry === undefined;
  const { message, modal } = App.useApp();
  // Read Only screen (the user's roles): no New / Edit / Confirm / Cancel Doc (Print and Approve / Reject stay)
  const canChange = useCanChange();
  const router = useRouter();
  const authUser = useAuthStore((s) => s.user);
  const [transfer, setTransfer] = useState<InventoryTransfer | null>(null);
  const [lines, setLines] = useState<LineRow[]>([]);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(isNew || startInEdit);
  // ?edit=1 (a list's Edit button) on one that can no longer be changed (posted, closed, in approval...): view mode
  useEffect(() => {
    if (transfer && !isDocumentEditable(transfer)) setEditing(false);
  }, [transfer]);

  const [seriesList, setSeriesList] = useState<NumberingSeries[]>([]);
  const [warehouses, setWarehouses] = useState<SapWarehouse[]>([]);
  const [salesEmployees, setSalesEmployees] = useState<SapSalesEmployee[]>([]);
  const [partnerLookupOpen, setPartnerLookupOpen] = useState(false);
  const [itemLookupOpen, setItemLookupOpen] = useState(false);
  const [form] = Form.useForm<TransferFormValues>();
  const linesGridRef = useRef<DataGridHandle<LineRow>>(null);
  const attachmentsRef = useRef<AttachmentsTabHandle>(null);
  // Followed as chosen: the From / To Warehouse of new lines
  const headerFrom = Form.useWatch('filler', form);
  const headerTo = Form.useWatch('toWhsCode', form);
  const { canPrint, print, modals: printModals } = usePrintDocument(OWTR_OBJTYPE, docEntry, 'Inventory Transfer', transfer?.docNum);
  const confirmPrompt = useConfirmPrompt();
  // A manual series is chosen: the No. is typed in the No. field
  const seriesValue = Form.useWatch('series', form);
  const manualSeries = !!seriesList.find((s) => s.docEntry === seriesValue)?.isManual;

  const showTransfer = (t: InventoryTransfer) => {
    setTransfer(t);
    form.setFieldsValue(toFormValues(t));
    setLines(toRows(t.lines ?? []));
  };

  const approval = useApprovalDecision<InventoryTransfer>({
    objType: OWTR_OBJTYPE,
    docEntry,
    apprStatus: transfer?.apprStatus,
    title: 'Inventory Transfer',
    onDecided: showTransfer,
  });

  useEffect(() => {
    // Inventory Transfer series (Document Numbering); a new transfer starts with the one ticked Default
    documentNumberingAPI
      .getList(OWTR_OBJTYPE)
      .then((res) => {
        if (!res.success) return;
        setSeriesList(res.data);
        const defaultSeries = res.data.find((s) => s.isDefault && s.active);
        if (isNew && defaultSeries && !form.getFieldValue('series')) form.setFieldsValue({ series: defaultSeries.docEntry });
      })
      .catch(() => message.error('Failed to load numbering series'));
    sapAPI.getWarehouses().then((res) => res.success && setWarehouses(res.data)).catch(() => message.error('Failed to load warehouses'));
    sapAPI.getSalesEmployees().then((res) => res.success && setSalesEmployees(res.data)).catch(() => undefined);
    if (isNew) {
      form.setFieldsValue({ docDate: dayjs(), taxDate: dayjs() });
      // The logged-in user's Sales Employee to start with
      if (authUser?.id) {
        usersAPI
          .getById(authUser.id)
          .then((res) => {
            if (res.success && res.data.slpCode !== null && form.getFieldValue('slpCode') == null) form.setFieldsValue({ slpCode: res.data.slpCode });
          })
          .catch(() => undefined);
      }
    }
  }, []);

  useEffect(() => {
    if (isNew) return;
    inventoryTransfersAPI
      .getById(docEntry)
      .then((res) => res.success && setTransfer(res.data))
      .catch(() => {
        message.error('Failed to load inventory transfer');
        router.push(LIST_PATH);
      })
      .finally(() => setLoading(false));
  }, [docEntry]);

  useEffect(() => {
    if (!loading && transfer) showTransfer(transfer);
  }, [loading]);

  const errorText = (error: unknown, fallback: string) =>
    (error as { response?: { data?: { error?: string } } }).response?.data?.error || fallback;

  const status = transfer?.docStatus ?? STATUS_DRAFT;
  const isDraft = status === STATUS_DRAFT;
  const inApproval = transfer?.apprStatus === APPR_STATUS_PENDING || !!transfer?.apprLocked;
  const synced = isSynced(transfer?.postStatus);
  // CANCELED can't be changed; nor one in / after approval, nor one synced to SAP
  const canEdit = (isDraft || status === STATUS_OPEN) && !inApproval && !synced && canChange;

  const handleCancelEdit = () => {
    if (isNew) {
      router.push(LIST_PATH);
      return;
    }
    form.resetFields();
    if (transfer) showTransfer(transfer);
    setEditing(false);
  };

  const handleSave = async (values: TransferFormValues) => {
    if (!editing) return;
    const payload = {
      series: values.series ?? null,
      // Manual series: the No. typed in the No. field (checked on Confirm)
      docNum: manualSeries ? values.docNum?.trim() || null : null,
      cardCode: values.cardCode || null,
      cardName: values.cardName || null,
      docDate: (values.docDate ?? dayjs()).format('YYYY-MM-DD'),
      taxDate: values.taxDate ? values.taxDate.format('YYYY-MM-DD') : null,
      filler: values.filler || null,
      toWhsCode: values.toWhsCode || null,
      slpCode: values.slpCode ?? null,
      comments: values.comments || null,
      lines: lines.map((l) => ({
        lineNum: l.lineNum ?? null,
        itemCode: l.itemCode,
        dscription: l.dscription,
        quantity: Number(l.quantity),
        uomCode: l.uomCode,
        fromWhsCod: l.fromWhsCod,
        whsCode: l.whsCode,
        text: l.text,
      })),
    };
    setSaving(true);
    try {
      if (isNew) {
        const res = await inventoryTransfersAPI.create(payload);
        if (res.success) {
          await attachmentsRef.current?.save(res.data.docEntry);
          message.success('Inventory transfer saved as draft');
          router.replace(`${LIST_PATH}/${res.data.docEntry}`);
        }
      } else {
        const res = await inventoryTransfersAPI.update(docEntry, payload);
        if (res.success) {
          await attachmentsRef.current?.save(docEntry);
          message.success('Inventory transfer updated');
          showTransfer(res.data);
          setEditing(false);
        }
      }
    } catch (error) {
      message.error(errorText(error, 'Failed to save inventory transfer'));
    } finally {
      setSaving(false);
    }
  };

  // Confirm / Cancel Doc: asked first; the popup closes at once and the work runs behind the LOADING overlay
  const runCall = async (title: string, call: () => Promise<{ success: boolean; data: InventoryTransfer; message?: string }>, done: string) => {
    try {
      const res = await call();
      if (res.success) {
        // Confirm also posts it to SAP: a warning when SAP refused it (FAILED, to post again)
        if (title.startsWith('Confirm') && (res.data as { postStatus?: string } | null)?.postStatus === 'FAILED') message.warning(res.message ?? done, 10);
        else message.success(res.message || done);
        showTransfer(res.data);
      }
    } catch (error) {
      message.error({ content: errorText(error, `Failed: ${title}`), duration: 6 });
    }
  };
  const runAction = (title: string, content: string, okText: string, danger: boolean, call: () => Promise<{ success: boolean; data: InventoryTransfer; message?: string }>, done: string) => {
    modal.confirm({
      title,
      content,
      okText,
      okButtonProps: { danger },
      cancelText: 'No',
      onOk: () => {
        void runCall(title, call, done);
      },
    });
  };

  // A manual series: the No. is keyed in on the popup
  const handleConfirm = () => {
    const manual = !!seriesList.find((s) => s.docEntry === transfer?.series)?.isManual;
    const title = 'Confirm Inventory Transfer';
    confirmPrompt.confirm({
      title,
      content: `The stock in the From warehouses is checked, then ${manual ? 'the No. keyed in below is given to it' : 'the No. is assigned'} and it is posted to SAP as an Inventory Transfer Request (or it is sent for approval first). Continue?`,
      manual,
      initialNo: transfer?.docNum ?? '',
      onConfirm: (docNum) => void runCall(title, () => inventoryTransfersAPI.confirm(docEntry as number, docNum), 'Inventory transfer confirmed'),
    });
  };

  const handleCancelDoc = () =>
    runAction(
      'Cancel Inventory Transfer',
      "Cancel this inventory transfer? It can't be changed or confirmed afterwards.",
      'Cancel Doc',
      true,
      () => inventoryTransfersAPI.cancel(docEntry as number),
      'Inventory transfer cancelled'
    );

  // Post to SAP: asked first, then posted behind the LOADING overlay. SAP's refusal leaves it FAILED with the
  // reason in the Posting tab (it can then be corrected and posted again).
  const handlePostToSap = () => {
    modal.confirm({
      title: 'Post to SAP',
      content: "Post this inventory transfer to SAP as an Inventory Transfer Request? Once posted it can't be changed in the portal.",
      okText: 'Post',
      cancelText: 'No',
      onOk: () => {
        void (async () => {
          try {
            const res = await inventoryTransfersAPI.postToSap(docEntry as number);
            if (res.success) {
              if (res.data.posted) message.success(res.data.message);
              else message.error(res.data.message, 8);
              showTransfer(res.data.transfer);
            }
          } catch (error) {
            message.error({ content: errorText(error, 'Failed to post to SAP'), duration: 6 });
          }
        })();
      },
    });
  };

  // New line(s): choose items. From = the header's From Warehouse if keyed in, else the item's default warehouse (or
  // else SAP's default warehouse); To = the header's To Warehouse; quantity 1.
  const handleNewLine = () => {
    if (!form.getFieldValue('toWhsCode')) {
      message.warning('Choose the To Warehouse first');
      return;
    }
    setItemLookupOpen(true);
  };

  const handleDeleteLines = () => {
    const ticked = linesGridRef.current?.getSelectedRows() ?? [];
    if (ticked.length === 0) {
      message.warning('Tick the lines first');
      return;
    }
    const keys = new Set(ticked.map((l) => l.key));
    setLines((prev) => prev.filter((l) => !keys.has(l.key)));
  };

  const whsCodes = useMemo(() => warehouses.map((w) => w.whsCode), [warehouses]);
  const whsOptions = useMemo(() => warehouses.map((w) => ({ value: w.whsCode, label: `${w.whsCode} - ${w.whsName}` })), [warehouses]);
  const whsName = (code: string | null | undefined) => warehouses.find((w) => w.whsCode === code)?.whsName ?? '';

  const lineColumns = useMemo<ColDef<LineRow>[]>(
    () => [
      { colId: 'lineNo', headerName: '#', valueGetter: (p) => (p.node?.rowIndex ?? 0) + 1, sortable: false, cellDataType: 'number', width: 44 },
      { field: 'itemCode', headerName: 'Item No.' },
      { field: 'dscription', headerName: 'Item Description' },
      {
        field: 'quantity',
        headerName: 'Quantity',
        cellDataType: 'number',
        editable: editing,
        valueFormatter: (p: ValueFormatterParams) => formatQty(p.value),
        valueParser: (p) => {
          const n = Number(p.newValue);
          return Number.isFinite(n) && n > 0 ? n : p.oldValue;
        },
      },
      { field: 'uomCode', headerName: 'UoM' },
      {
        field: 'fromWhsCod',
        headerName: 'From Warehouse',
        editable: editing,
        cellEditor: 'agSelectCellEditor',
        cellEditorParams: { values: whsCodes },
        cellStyle: (p) => (whsProblem(p.data) ? { color: '#bb0000', fontWeight: 600 } : null),
      },
      {
        field: 'whsCode',
        headerName: 'To Warehouse',
        editable: editing,
        cellEditor: 'agSelectCellEditor',
        cellEditorParams: { values: whsCodes },
        cellStyle: (p) => (whsProblem(p.data) ? { color: '#bb0000', fontWeight: 600 } : null),
      },
      // Stock in the line's From warehouse (SAP B1), for reference; worked out again on Save; checked on Confirm
      {
        field: 'onHand',
        headerName: 'In Stock (From)',
        cellDataType: 'number',
        valueFormatter: (p: ValueFormatterParams) => formatQty(p.value),
        cellStyle: (p) => (p.data && p.data.onHand != null && Number(p.data.quantity) > Number(p.data.onHand) ? { color: '#bb0000', fontWeight: 600 } : null),
      },
      { field: 'text', headerName: 'Item Details', editable: editing, cellEditor: 'agLargeTextCellEditor', cellEditorPopup: true },
    ],
    [editing, whsCodes]
  );

  const itemColumns = useMemo<ColDef<SapStockItem>[]>(
    () => [
      { field: 'itemCode', headerName: 'Item No.', sort: 'asc' },
      { field: 'itemName', headerName: 'Item Description' },
      { field: 'invntryUom', headerName: 'UoM' },
      // The new line's From Warehouse: the item's default warehouse, or else SAP's default warehouse
      { field: 'dfltWH', headerName: 'Default Warehouse' },
      { field: 'whsOnHand', headerName: 'In Stock (Default)', cellDataType: 'number', valueFormatter: (p: ValueFormatterParams) => formatQty(p.value) },
      { field: 'totalOnHand', headerName: 'In Stock (All)', cellDataType: 'number', valueFormatter: (p: ValueFormatterParams) => formatQty(p.value) },
    ],
    []
  );

  if (loading) return null;
  if (!isNew && !transfer) return null;

  // Button order: New, Edit, then the rest
  const toolbar = editing ? (
    <>
      <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={() => form.submit()}>
        Save
      </Button>
      <Button disabled={saving} onClick={handleCancelEdit}>
        Cancel
      </Button>
    </>
  ) : (
    <>
      {canChange && (
        <Button type="primary" icon={<PlusOutlined />} onClick={() => router.push(`${LIST_PATH}/new`)}>
          New
        </Button>
      )}
      {canEdit && (
        <Button icon={<EditOutlined />} onClick={() => setEditing(true)}>
          Edit
        </Button>
      )}
      {/* Beside Edit, only when a layout exists for Inventory Transfer; drafts too (the layout can mark a draft) */}
      {!isNew && canPrint && (
        <Button icon={<PrinterOutlined />} onClick={print}>
          Print
        </Button>
      )}
      {isDraft && !inApproval && canChange && (
        <Button icon={<CheckCircleOutlined />} onClick={handleConfirm}>
          Confirm
        </Button>
      )}
      {approval.buttons}
      {/* OPEN, needing no (more) approval, not posted yet (or failed before) */}
      {status === STATUS_OPEN && POSTABLE_APPR_STATUSES.includes(transfer?.apprStatus ?? '') && !synced && canChange && (
        <Button icon={<CloudUploadOutlined />} onClick={handlePostToSap}>
          Post to SAP
        </Button>
      )}
      {/* SAP B1 doesn't close transfers: only Cancel Doc (also while waiting for approval; not once synced) */}
      {(isDraft || status === STATUS_OPEN) && !synced && canChange && (
        <Button danger icon={<CloseCircleOutlined />} onClick={handleCancelDoc}>
          Cancel Doc
        </Button>
      )}
    </>
  );

  const seriesOptions = seriesList
    .filter((s) => s.active)
    .map((s) => ({ value: s.docEntry, label: s.series, listLabel: [s.series, s.seriesName].filter(Boolean).join(' - ') }));
  const greyed = (value: string) => (editing ? <Input value={value} disabled /> : <ReadOnlyText value={value} />);

  const linesToolbar = editing ? (
    <>
      <Button size="small" icon={<PlusOutlined />} onClick={handleNewLine}>
        New
      </Button>
      <Button size="small" icon={<DeleteOutlined />} onClick={handleDeleteLines}>
        Delete
      </Button>
    </>
  ) : null;

  return (
    <>
      <Form form={form} {...detailFormProps(editing)} onFinish={handleSave}>
        <DetailView
          toolbar={toolbar}
          title={`Inventory Transfer - ${isNew ? 'New' : transfer?.docNum ?? 'Draft'}`}
          // Right column, as in SAP B1: statuses and dates
          sideFields={
            <>
              <Form.Item label="Status">{greyed(transfer?.docStatusName ?? status)}</Form.Item>
              <Form.Item label="Approval Status">{greyed(transfer?.apprStatusName ?? transfer?.apprStatus ?? '')}</Form.Item>
              <Form.Item label="Posting Date" name="docDate" rules={[{ required: true, message: 'Posting Date is required' }]}>
                {editing ? <DatePicker format={DATE_FORMAT} disabled={!isDraft} /> : <DateText />}
              </Form.Item>
              <Form.Item label="Document Date" name="taxDate">
                {editing ? <DatePicker format={DATE_FORMAT} /> : <DateText />}
              </Form.Item>
            </>
          }
          below={
            <>
              <Tabs
                type="card"
                items={[
                  {
                    key: 'details',
                    label: 'Details',
                    children: (
                      <DataGrid<LineRow>
                        handleRef={linesGridRef}
                        settingsKey="lines:FTS11OWTR"
                        showToolbar
                        toolbar={linesToolbar}
                        selectable={editing}
                        gridProps={{
                          rowData: lines,
                          columnDefs: lineColumns,
                          getRowId: (p) => p.data.key,
                          suppressCellFocus: false,
                          singleClickEdit: true,
                          stopEditingWhenCellsLoseFocus: true,
                          onCellValueChanged: (e) => {
                            // Another From warehouse: its stock isn't known until saved
                            if (e.colDef.field === 'fromWhsCod' && e.data) e.data.onHand = undefined;
                            setLines((prev) => [...prev]);
                          },
                        }}
                      />
                    ),
                  },
                  {
                    key: 'attachments',
                    label: 'Attachments',
                    children: <AttachmentsTab handleRef={attachmentsRef} objType={OWTR_OBJTYPE} docEntry={docEntry} editing={editing} />,
                  },
                  {
                    // Posting to SAP B1: set by the posting, never typed
                    key: 'posting',
                    label: 'Posting',
                    children: (
                      <div className={detailStyles.tabPanel}>
                        <div className={detailStyles.fields}>
                          <Form.Item label="SAP Request No.">
                            <ReadOnlyText value={transfer?.sapDocNum != null ? String(transfer.sapDocNum) : ''} />
                          </Form.Item>
                          <Form.Item label="Posting Status">
                            <ReadOnlyText value={transfer?.postStatusName ?? transfer?.postStatus ?? ''} />
                          </Form.Item>
                          <Form.Item label="Error Description">
                            <ReadOnlyText value={transfer?.errorDesc ?? ''} multiline />
                          </Form.Item>
                        </div>
                      </div>
                    ),
                  },
                  ...(isNew
                    ? []
                    : [
                        {
                          key: 'approval',
                          label: 'Approval',
                          children: <ApprovalTab objType={OWTR_OBJTYPE} docEntry={docEntry as number} refreshKey={approval.refreshKey} />,
                        },
                      ]),
                ]}
              />
              {/* Under the tabs, as on the quotation */}
              <div className={`${detailStyles.columns} ${detailStyles.footer}`}>
                <div className={detailStyles.fields}>
                  <Form.Item label="Remarks" name="comments" rules={[{ max: 254, message: 'Maximum 254 characters' }]}>
                    {editing ? <Input.TextArea rows={3} maxLength={254} /> : <ReadOnlyText multiline />}
                  </Form.Item>
                </div>
              </div>
            </>
          }
        >
          {/* The No. is taken from it on Confirm; fixed once confirmed */}
          <Form.Item label="Series" name="series" rules={[{ required: true, message: 'Series is required' }]}>
            {editing ? (
              <Select
                placeholder="Select a series"
                disabled={!isDraft}
                options={seriesOptions}
                optionRender={(o) => (o.data as { listLabel: string }).listLabel}
                notFoundContent="No active Inventory Transfer series — add one in Document Numbering"
              />
            ) : (
              <DisplayText text={transfer?.seriesCode ?? ''} />
            )}
          </Form.Item>
          <Form.Item label="No.">
            {/* Given on Confirm from Document Numbering; typed here on a manual series (checked on Confirm) */}
            {editing && isDraft && manualSeries ? (
              <Form.Item name="docNum" noStyle>
                <Input maxLength={MANUAL_NO_MAX} placeholder="Key in the No." />
              </Form.Item>
            ) : editing ? (
              <Input value={isDraft ? '' : (transfer?.docNum ?? '')} placeholder="On confirm" disabled />
            ) : (
              <ReadOnlyText value={transfer?.docNum ?? ''} />
            )}
          </Form.Item>
          {/* Optional, as in SAP B1 */}
          <Form.Item label="Business Partner" name="cardCode">
            {editing ? (
              <Input
                readOnly
                allowClear
                placeholder="Optional — click to choose"
                onClick={() => setPartnerLookupOpen(true)}
                onChange={(e) => !e.target.value && form.setFieldsValue({ cardCode: '', cardName: '' })}
                suffix={<SearchOutlined onClick={() => setPartnerLookupOpen(true)} style={{ cursor: 'pointer' }} />}
              />
            ) : (
              <ReadOnlyText />
            )}
          </Form.Item>
          <Form.Item label="Name" name="cardName">
            {editing ? <Input disabled /> : <ReadOnlyText />}
          </Form.Item>
          {/* Optional: shown in the list and on layouts. New lines take it as their From (else the item's default warehouse). */}
          <Form.Item label="From Warehouse" name="filler">
            {editing ? (
              <Select allowClear showSearch optionFilterProp="label" placeholder="Optional" options={whsOptions} />
            ) : (
              <DisplayText text={transfer?.filler ? `${transfer.filler} - ${transfer.fillerName ?? whsName(transfer.filler)}` : ''} />
            )}
          </Form.Item>
          <Form.Item
            label="To Warehouse"
            name="toWhsCode"
            dependencies={['filler']}
            rules={[
              { required: true, message: 'To Warehouse is required' },
              ({ getFieldValue }) => ({
                validator: (_, value) =>
                  value && value === getFieldValue('filler') ? Promise.reject(new Error('Must differ from the From Warehouse')) : Promise.resolve(),
              }),
            ]}
          >
            {editing ? (
              <Select showSearch optionFilterProp="label" placeholder="Select a warehouse" options={whsOptions} />
            ) : (
              <DisplayText text={transfer?.toWhsCode ? `${transfer.toWhsCode} - ${transfer.toWhsName ?? whsName(transfer.toWhsCode)}` : ''} />
            )}
          </Form.Item>
          <Form.Item label="Sales Employee" name="slpCode">
            {editing ? (
              <Select
                allowClear
                showSearch
                optionFilterProp="label"
                placeholder="Select a sales employee"
                options={salesEmployees.map((s) => ({ value: s.slpCode, label: s.slpName }))}
              />
            ) : (
              <DisplayText text={transfer?.slpName ?? ''} />
            )}
          </Form.Item>
        </DetailView>
      </Form>

      <LookupListView<SapCustomer>
        open={partnerLookupOpen}
        title="Choose Business Partner"
        searchPlaceholder="Search business partners..."
        columnDefs={customerColumns}
        loadRows={async () => {
          const res = await sapAPI.getCustomers();
          return res.success ? res.data : [];
        }}
        getKey={(c) => c.cardCode}
        excludeKeys={[]}
        singleSelect
        onCancel={() => setPartnerLookupOpen(false)}
        onSelect={(picked) => {
          setPartnerLookupOpen(false);
          if (picked[0]) form.setFieldsValue({ cardCode: picked[0].cardCode, cardName: picked[0].cardName });
        }}
      />

      {/* New line(s): inventory items, with their default warehouse and the stock there */}
      <LookupListView<SapStockItem>
        open={itemLookupOpen}
        title="Choose Items"
        searchPlaceholder="Search items..."
        columnDefs={itemColumns}
        width={860}
        loadRows={async () => {
          const res = await inventoryTransfersAPI.getStockItems();
          return res.success ? res.data : [];
        }}
        getKey={(i) => i.itemCode}
        excludeKeys={[]}
        // One click adds that item; tick checkboxes to add several
        clickToChoose
        onCancel={() => setItemLookupOpen(false)}
        onSelect={(picked) => {
          setItemLookupOpen(false);
          setLines((prev) => [
            ...prev,
            ...toRows(
              picked.map((i) => {
                const from = (headerFrom as string) || i.dfltWH || '';
                return {
                  itemCode: i.itemCode,
                  dscription: i.itemName,
                  quantity: 1,
                  uomCode: i.invntryUom,
                  fromWhsCod: from,
                  whsCode: headerTo as string,
                  text: null,
                  // The lookup knows the stock of the default warehouse only; another one is worked out on Save
                  onHand: from === i.dfltWH ? (i.whsOnHand ?? 0) : undefined,
                };
              })
            ),
          ]);
        }}
      />

      {printModals}
      {confirmPrompt.modal}
    </>
  );
}

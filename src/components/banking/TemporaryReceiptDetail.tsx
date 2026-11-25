'use client';

import React, { useState, useEffect, useRef } from 'react';
import { App, Button, DatePicker, Form, Input, Modal, Select, Tabs } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { SaveOutlined, EditOutlined, PlusOutlined, CheckCircleOutlined, SearchOutlined, WalletOutlined, ApartmentOutlined, CloudUploadOutlined, CloseCircleOutlined, PrinterOutlined } from '@ant-design/icons';
import { RelationshipMap } from '@/components/sales/RelationshipMap';
import type { ColDef } from 'ag-grid-community';
import { useRouter } from 'next/navigation';
import { documentNumberingAPI, payTypesAPI, sapAPI, temporaryReceiptsAPI } from '@/lib/apiClient';
import { useCanChange } from '@/stores/accessStore';
import { isDocumentEditable, isSynced } from '@/lib/postStatus';
import { DetailView, DisplayText, ReadOnlyText, detailFormProps } from '@/components/ui/DetailView';
import detailStyles from '@/components/ui/DetailView.module.css';
import { LookupListView } from '@/components/ui/LookupListView';
import { AttachmentsTab } from '@/components/ui/AttachmentsTab';
import { MANUAL_NO_MAX, useConfirmPrompt } from '@/components/ui/useConfirmPrompt';
import type { AttachmentsTabHandle } from '@/components/ui/AttachmentsTab';
import { ApprovalTab } from '@/components/sales/ApprovalTab';
import { useApprovalDecision } from '@/components/sales/useApprovalDecision';
import { ReceiptLinesTab } from './ReceiptLinesTab';
import { EMPTY_MEANS, PaymentMeansModal, RECEIPT_COPY_KEY, payTypeOf, totalOf } from './PaymentMeansModal';
import type {
  NumberingSeries,
  PayType,
  ReceiptPaymentMeans,
  SapCustomer,
  SapHouseBank,
  TemporaryReceipt,
  TemporaryReceiptLine,
  ReceiptRequestCopy,
  SapCurrencies,
} from '@/types';
import { CurrencyField, receiptCurrencyOptions, toLocalAmount } from './CurrencyField';
import { usePrintDocument } from '@/components/ui/usePrintDocument';

/** A receipt's payment means, as saved */
const meansOf = (r: TemporaryReceipt): ReceiptPaymentMeans => ({
  cheques: (r.cheques ?? []).map((c) => ({ checkNum: c.checkNum, checkSum: Number(c.checkSum) })),
  checkSum: Number(r.checkSum ?? 0),
  trsfrSum: Number(r.trsfrSum ?? 0),
  trsfrBank: r.trsfrBank,
  creditSum: Number(r.creditSum ?? 0),
  cashSum: Number(r.cashSum ?? 0),
  bcgSum: Number(r.bcgSum ?? 0),
});

/** Document type (FTS_vw_ObjType.Code); its numbering series are kept under it */
const TMPR_OBJTYPE = 'FTS11TMPR';
const STATUS_DRAFT = 'DRAFT';
const STATUS_OPEN = 'OPEN';
const APPR_STATUS_PENDING = 'PENDING';
/** Approval statuses that allow posting to SAP */
const POSTABLE_APPR_STATUSES = ['NO-APPROVAL', 'APPROVED'];
const LIST_PATH = '/banking/temporary-receipts';
const DATE_FORMAT = 'DD.MM.YY';

interface TemporaryReceiptDetailProps {
  /** Omit to create a new receipt */
  docEntry?: number;
  /** Open an existing receipt directly in edit mode (list view's Edit button) */
  startInEdit?: boolean;
}

interface ReceiptFormValues {
  /** Typed only on a manual series (draft) */
  docNum: string;
  series: number | null;
  docDate: Dayjs | null;
  taxDate: Dayjs | null;
  cardCode: string;
  cardName: string;
  comments: string;
  /** The currency the money came in (SAP OCRN) */
  docCur: string | null;
}

const toFormValues = (r: TemporaryReceipt): ReceiptFormValues => ({
  series: r.series,
  docNum: r.docNum ?? '',
  docDate: r.docDate ? dayjs(r.docDate) : null,
  taxDate: r.taxDate ? dayjs(r.taxDate) : null,
  cardCode: r.cardCode,
  cardName: r.cardName ?? '',
  comments: r.comments ?? '',
  docCur: r.docCur ?? null,
});

const formatAmount = (value: number | null | undefined) =>
  value == null ? '' : Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const customerColumns: ColDef<SapCustomer>[] = [
  { field: 'cardCode', headerName: 'Customer Code', width: 180, sort: 'asc' },
  { field: 'cardName', headerName: 'Customer Name', flex: 1, minWidth: 220 },
];

/** A date field in view mode */
function DateText({ value }: { value?: Dayjs | null }) {
  return <ReadOnlyText value={value ? value.format(DATE_FORMAT) : ''} />;
}

/**
 * Detail view of a Temporary Receipt (FTS11TMPR) — a payment received from a customer, kept as a document like an
 * incoming payment: Save = DRAFT without a No.; Confirm = No. from the chosen series, OPEN (Series and Customer then
 * fixed). Existing receipts open in view mode.
 */
export default function TemporaryReceiptDetail({ docEntry, startInEdit = false }: TemporaryReceiptDetailProps) {
  const isNew = docEntry === undefined;
  const { message, modal } = App.useApp();
  // Read Only screen (the user's roles): no New / Edit / Confirm (Approve / Reject stay: approvals are per stage)
  const canChange = useCanChange();
  const router = useRouter();
  const [receipt, setReceipt] = useState<TemporaryReceipt | null>(null);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  // Detail views open in view mode; Edit switches to edit mode
  const [editing, setEditing] = useState(isNew || startInEdit);
  // ?edit=1 (a list's Edit button) on one that can no longer be changed (posted, closed, in approval...): view mode.
  // Waiting for this user's approval: they may change it while approving.
  useEffect(() => {
    if (receipt && !isDocumentEditable(receipt) && !receipt.canApproverEdit) setEditing(false);
  }, [receipt]);
  // Save by an approver while approving: the reason asked first (kept on the Approval tab, sent to the sender)
  const [reasonFor, setReasonFor] = useState<ReceiptFormValues | null>(null);
  const [reason, setReason] = useState('');
  // Bumped after an approver's save, so the Approval tab shows the new change
  const [changeCount, setChangeCount] = useState(0);

  const [seriesList, setSeriesList] = useState<NumberingSeries[]>([]);
  const [payTypes, setPayTypes] = useState<PayType[]>([]);
  const [customerLookupOpen, setCustomerLookupOpen] = useState(false);
  // Details tab: the documents the receipt pays (sent with Save)
  const [lines, setLines] = useState<TemporaryReceiptLine[]>([]);
  // Payment Means (popup): how the customer paid; Payment Type and Amount follow from it
  const [means, setMeans] = useState<ReceiptPaymentMeans>(EMPTY_MEANS);
  const [meansOpen, setMeansOpen] = useState(false);
  const [houseBanks, setHouseBanks] = useState<SapHouseBank[]>([]);
  const [mapOpen, setMapOpen] = useState(false);
  // Print (Crystal Reports layouts, System Initialization > Layouts): only when Temporary Receipt has an active one
  const { canPrint, print, modals: printModals } = usePrintDocument(TMPR_OBJTYPE, docEntry, 'Temporary Receipt', receipt?.docNum);
  // A new receipt started by Copy To from a Temporary Receipt Request: which one, and what it said
  const [copiedFrom, setCopiedFrom] = useState<ReceiptRequestCopy | null>(null);
  const [form] = Form.useForm<ReceiptFormValues>();
  // Followed as they are typed / chosen: the Details tab offers this customer's documents; On Account is worked out
  const cardCode = Form.useWatch('cardCode', form);
  // Amount = the payment means + bank charge
  const docTotal = totalOf(means);
  const payTyp = payTypeOf(means);
  const payTypeName = payTyp ? payTypes.find((p) => p.code === payTyp)?.name ?? payTyp : '';
  const attachmentsRef = useRef<AttachmentsTabHandle>(null);
  const confirmPrompt = useConfirmPrompt();
  // A manual series is chosen: the No. is typed in the No. field
  const seriesValue = Form.useWatch('series', form);
  const manualSeries = !!seriesList.find((s) => s.docEntry === seriesValue)?.isManual;
  // Currency: SAP's currencies and their rates on the Posting Date; the customer's own currency ('##' = all)
  const [currencies, setCurrencies] = useState<SapCurrencies | null>(null);
  const [cardCurrency, setCardCurrency] = useState<string | null>(null);
  const docCurValue = Form.useWatch('docCur', form) as string | null | undefined;
  const docDateValue = Form.useWatch('docDate', form) as Dayjs | null | undefined;
  const docDateText = docDateValue ? dayjs(docDateValue).format('YYYY-MM-DD') : '';
  const localCur = currencies?.local ?? '';
  const receiptCur = docCurValue || receipt?.docCur || localCur;
  const isForeign = !!receiptCur && !!localCur && receiptCur !== localCur;
  useEffect(() => {
    sapAPI
      .getCurrencies(docDateText || undefined)
      .then((res) => res.success && setCurrencies(res.data))
      .catch(() => undefined);
  }, [docDateText]);
  // A new receipt starts in the local currency until a customer (or the request it is copied from) says otherwise
  useEffect(() => {
    if (isNew && localCur && !form.getFieldValue('docCur')) form.setFieldsValue({ docCur: localCur });
  }, [localCur]);

  useEffect(() => {
    // Temporary Receipt series (Document Numbering); a new receipt starts with the one ticked Default
    documentNumberingAPI
      .getList(TMPR_OBJTYPE)
      .then((res) => {
        if (!res.success) return;
        setSeriesList(res.data);
        const defaultSeries = res.data.find((s) => s.isDefault && s.active);
        if (isNew && defaultSeries && !form.getFieldValue('series')) form.setFieldsValue({ series: defaultSeries.docEntry });
      })
      .catch(() => message.error('Failed to load numbering series'));
    // Payment Type choices (FTS_vw_PayTyp)
    payTypesAPI
      .getList()
      .then((res) => res.success && setPayTypes(res.data))
      .catch(() => message.error('Failed to load payment types'));
    // Banks for a bank transfer (SAP house bank accounts)
    sapAPI
      .getHouseBanks()
      .then((res) => res.success && setHouseBanks(res.data))
      .catch(() => message.error('Failed to load banks'));
    // Copy To from a Temporary Receipt Request: start with what is left on it (handed over once, then forgotten)
    if (isNew) {
      form.setFieldsValue({ docDate: dayjs(), taxDate: dayjs() });
      try {
        const raw = sessionStorage.getItem(RECEIPT_COPY_KEY);
        sessionStorage.removeItem(RECEIPT_COPY_KEY);
        if (raw) {
          const copy = JSON.parse(raw) as ReceiptRequestCopy;
          setCopiedFrom(copy);
          // The receipt is in the request's currency
          if (copy.docCur) form.setFieldsValue({ docCur: copy.docCur });
          form.setFieldsValue({
            // A known customer stays that customer; otherwise it is chosen here (the request only has a name)
            cardCode: copy.knownCust ? copy.cardCode ?? '' : '',
            cardName: copy.knownCust ? copy.cardName : '',
            comments: copy.comments ?? '',
          });
          const cheques = copy.means.cheques ?? [];
          setMeans({ ...copy.means, cheques, checkSum: Math.round(cheques.reduce((s, c) => s + Number(c.checkSum), 0) * 100) / 100 });
        }
      } catch {
        // Nothing to copy (or storage blocked): an empty receipt
      }
    }
  }, []);

  useEffect(() => {
    if (isNew) return;
    const load = async () => {
      try {
        const res = await temporaryReceiptsAPI.getById(docEntry);
        if (res.success) {
          setReceipt(res.data);
          setCardCurrency(res.data.cardCurrency ?? null);
        }
      } catch {
        message.error('Failed to load temporary receipt');
        router.push(LIST_PATH);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [docEntry]);

  // Fill the form once it is on screen (it isn't rendered while loading)
  useEffect(() => {
    if (!loading && receipt) {
      form.setFieldsValue(toFormValues(receipt));
      setMeans(meansOf(receipt));
    }
  }, [loading]);

  // Show a receipt as saved (after load, Save, Confirm, Approve / Reject, or Cancel of edit mode)
  const showReceipt = (r: TemporaryReceipt) => {
    setReceipt(r);
    form.setFieldsValue(toFormValues(r));
    setLines(r.lines ?? []);
    setMeans(meansOf(r));
  };

  useEffect(() => {
    if (receipt) setLines(receipt.lines ?? []);
  }, [receipt?.docEntry]);

  // Total Amount Applied, and the rest of the Amount left On Account
  const totalApplied = Math.round(lines.reduce((sum, l) => sum + Number(l.sumApplied || 0), 0) * 100) / 100;
  const onAccount = Math.round((Number(docTotal ?? 0) - totalApplied) * 100) / 100;

  // Approve / Reject while it waits for this user's approval
  const approval = useApprovalDecision<TemporaryReceipt>({
    objType: TMPR_OBJTYPE,
    docEntry,
    apprStatus: receipt?.apprStatus,
    title: 'Temporary Receipt',
    onDecided: (updated) => showReceipt(updated),
  });

  const status = receipt?.docStatus ?? STATUS_DRAFT;
  const isDraft = status === STATUS_DRAFT;
  // Been through approval (waiting, approved or rejected): never editable or confirmed again
  const inApproval = receipt?.apprStatus === APPR_STATUS_PENDING || !!receipt?.apprLocked;
  // Except by an approver whose turn it is, while approving (Series and Customer stay as sent)
  const approverEditing = !!receipt?.canApproverEdit;
  // CLOSED / CANCELED receipts can't be changed, nor one synced to SAP (or being synced)
  const canEdit = ((isDraft || status === STATUS_OPEN) && !inApproval && !isSynced(receipt?.postStatus) && canChange) || approverEditing;
  // Series and Customer: fixed once confirmed, and while approving
  const headerFixed = !isDraft || approverEditing;

  const errorText = (error: unknown, fallback: string) =>
    (error as { response?: { data?: { error?: string } } }).response?.data?.error || fallback;

  const handleCancelEdit = () => {
    if (isNew) {
      router.push(LIST_PATH);
      return;
    }
    form.resetFields();
    if (receipt) showReceipt(receipt);
    setEditing(false);
  };

  const handleSave = async (values: ReceiptFormValues) => {
    if (!editing) return;
    if (approverEditing) {
      setReason('');
      setReasonFor(values);
      return;
    }
    await saveReceipt(values);
  };

  const saveReceipt = async (values: ReceiptFormValues, changeReason?: string) => {
    const payload = {
      series: values.series ?? null,
      // Manual series: the No. typed in the No. field (checked on Confirm)
      docNum: manualSeries ? values.docNum?.trim() || null : null,
      docDate: (values.docDate ?? dayjs()).format('YYYY-MM-DD'),
      taxDate: values.taxDate ? values.taxDate.format('YYYY-MM-DD') : null,
      cardCode: values.cardCode,
      cardName: values.cardName || null,
      // Payment Type and Amount are worked out by the server from these
      ...means,
      comments: values.comments || null,
      docCur: values.docCur || null,
      lines: lines.map((l) => ({ transId: l.transId, lineId: l.lineId, sumApplied: Number(l.sumApplied) })),
      // A new receipt copied from a Temporary Receipt Request stays linked to it
      baseEntry: isNew ? copiedFrom?.baseEntry ?? null : undefined,
      // Changed by an approver while approving: why
      changeReason: changeReason?.trim() || undefined,
    };
    setSaving(true);
    try {
      if (isNew) {
        const res = await temporaryReceiptsAPI.create(payload);
        if (res.success) {
          // Files chosen before the first Save are attached now that the receipt exists
          await attachmentsRef.current?.save(res.data.docEntry);
          message.success('Temporary receipt saved as draft');
          router.replace(`${LIST_PATH}/${res.data.docEntry}`);
        }
      } else {
        const res = await temporaryReceiptsAPI.update(docEntry, payload);
        if (res.success) {
          await attachmentsRef.current?.save(docEntry);
          message.success('Temporary receipt updated');
          if (approverEditing) setChangeCount((n) => n + 1);
          showReceipt(res.data);
          setEditing(false);
        }
      }
    } catch (error) {
      message.error(errorText(error, 'Failed to save temporary receipt'));
    } finally {
      setSaving(false);
    }
  };

  // Confirm: No. from the series, status OPEN, Series and Customer fixed. The popup closes at once and the work runs
  // behind the portal's LOADING overlay (no spinner on the popup's button).
  // A manual series: the No. is keyed in on the popup.
  const handleConfirm = () => {
    const manual = !!seriesList.find((s) => s.docEntry === receipt?.series)?.isManual;
    confirmPrompt.confirm({
      title: 'Confirm Temporary Receipt',
      content: `${manual ? 'The No. keyed in below is given to it' : 'The No. will be assigned'} and the Posting Date, Series and Customer can no longer be changed. It is then posted to SAP as an Incoming Payment (after approval, if approval is needed). Continue?`,
      manual,
      initialNo: receipt?.docNum ?? '',
      onConfirm: (docNum) => {
        void (async () => {
          try {
            const res = await temporaryReceiptsAPI.confirm(docEntry as number, docNum);
            if (res.success) {
              // Also says how posting to SAP went: a warning when SAP refused it (FAILED, to post again)
              if (res.data.postStatus === 'FAILED') message.warning(res.message, 10);
              else message.success(res.message || `Temporary receipt confirmed: No. ${res.data.docNum}`);
              showReceipt(res.data);
            }
          } catch (error) {
            message.error(errorText(error, 'Failed to confirm temporary receipt'));
          }
        })();
      },
    });
  };

  // Cancel Doc: asked first, then run behind the LOADING overlay. Posted to SAP: the incoming payment is cancelled
  // there too; if SAP refuses, nothing changes in the portal and SAP's reason is shown.
  const handleCancelDoc = () => {
    const posted = receipt?.postStatus === 'SUCCESS';
    modal.confirm({
      title: 'Cancel Temporary Receipt',
      content: posted
        ? `Cancel this temporary receipt? It can't be undone. SAP Incoming Payment ${receipt?.sapDocNum ?? ''} is cancelled too.`
        : "Cancel this temporary receipt? It can't be undone.",
      okText: 'Cancel Doc',
      okButtonProps: { danger: true },
      cancelText: 'No',
      onOk: () => {
        void (async () => {
          try {
            const res = await temporaryReceiptsAPI.cancel(docEntry as number);
            if (res.success) {
              message.success(res.message || 'Temporary receipt cancelled');
              showReceipt(res.data);
            }
          } catch (error) {
            message.error({ content: errorText(error, 'Failed to cancel temporary receipt'), duration: 8 });
          }
        })();
      },
    });
  };

  // Post to SAP as an Incoming Payment: asked first, then posted behind the LOADING overlay. SAP's refusal leaves it
  // FAILED with the reason in the Posting tab (it can then be corrected and posted again).
  const handlePostToSap = () => {
    modal.confirm({
      title: 'Post to SAP',
      content: "Post this temporary receipt to SAP as an Incoming Payment? Once posted it can't be changed in the portal.",
      okText: 'Post',
      onOk: () => {
        void (async () => {
          try {
            const res = await temporaryReceiptsAPI.postToSap(docEntry as number);
            if (res.success) {
              if (res.data.posted) message.success(res.data.message);
              else message.error(res.data.message, 8);
              showReceipt(res.data.receipt);
            }
          } catch (error) {
            message.error(errorText(error, 'Failed to post to SAP'));
          }
        })();
      },
    });
  };

  if (loading) {
    // The portal's own loading overlay (LOADING... bar) shows while the data is fetched; nothing else is drawn meanwhile
    return null;
  }

  if (!isNew && !receipt) return null;

  // Button order: New, Edit, then the rest
  const toolbar = editing ? (
    <>
      <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={() => form.submit()}>
        Save
      </Button>
      <Button disabled={saving} onClick={handleCancelEdit}>Cancel</Button>
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
      {status === STATUS_OPEN && POSTABLE_APPR_STATUSES.includes(receipt?.apprStatus ?? '') && !isSynced(receipt?.postStatus) && canChange && (
        <Button icon={<CloudUploadOutlined />} onClick={handlePostToSap}>
          Post to SAP
        </Button>
      )}
      {/* DRAFT / OPEN (also waiting for approval, and once posted: cancelled in SAP too); not while being posted */}
      {!isNew && (isDraft || status === STATUS_OPEN) && receipt?.postStatus !== 'PENDING' && canChange && (
        <Button danger icon={<CloseCircleOutlined />} onClick={handleCancelDoc}>
          Cancel Doc
        </Button>
      )}
      {/* Last: the Temporary Receipt Request it was copied from, and that request's other receipts */}
      {!isNew && (
        <Button icon={<ApartmentOutlined />} onClick={() => setMapOpen(true)}>
          Relationship Map
        </Button>
      )}
    </>
  );

  // Copied from a request: its No. (a new receipt: the request it is being copied from)
  const baseDocNum = isNew ? copiedFrom?.baseDocNum : receipt?.baseDocNum;
  const baseEntry = isNew ? copiedFrom?.baseEntry : receipt?.baseEntry;
  // A known customer on the request stays the receipt's customer
  const customerFixed = isNew && !!copiedFrom?.knownCust;
  // Currency: chosen on a draft before any documents are added (their balances are in it); not on a copy of a request
  // (it is in the request's currency), nor while approving
  const currencyChangeable = isDraft && !approverEditing && !copiedFrom && !receipt?.baseEntry && lines.length === 0;
  const shownRate = isDraft && !approverEditing ? currencies?.currencies.find((c) => c.code === receiptCur)?.rate : receipt?.docRate;

  // The box shows the series code (as in SAP B1); the drop-down list shows code and name. Only active series.
  const seriesOptions = seriesList
    .filter((s) => s.active)
    .map((s) => ({ value: s.docEntry, label: s.series, listLabel: [s.series, s.seriesName].filter(Boolean).join(' - ') }));

  return (
    <>
      {confirmPrompt.modal}
      {/* An approver saving while approving: the reason for the change (optional), then saved */}
      <Modal
        title="Reason for change"
        open={!!reasonFor}
        okText="Save"
        onOk={() => {
          const values = reasonFor;
          setReasonFor(null);
          if (values) void saveReceipt(values, reason);
        }}
        onCancel={() => setReasonFor(null)}
        destroyOnHidden
      >
        <p>The person who sent it for approval is told, and the change shows on the Approval tab. Approvals given so far still count.</p>
        <Input.TextArea rows={3} maxLength={254} placeholder="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} />
      </Modal>
      <Form form={form} {...detailFormProps(editing)} onFinish={handleSave}>
        <DetailView
          toolbar={toolbar}
          title={`Temporary Receipt - ${isNew ? 'New' : receipt?.docNum ?? 'Draft'}`}
          // Right column, as in SAP B1: the statuses
          sideFields={
            <>
              <Form.Item label="Status">
                {editing ? (
                  <Input value={receipt?.docStatusName ?? status} disabled />
                ) : (
                  <ReadOnlyText value={receipt?.docStatusName ?? status} />
                )}
              </Form.Item>
              <Form.Item label="Approval Status">
                {editing ? (
                  <Input value={receipt?.apprStatusName ?? receipt?.apprStatus ?? ''} disabled />
                ) : (
                  <ReadOnlyText value={receipt?.apprStatusName ?? receipt?.apprStatus ?? ''} />
                )}
              </Form.Item>
              {/* The incoming payment's dates in SAP; Posting Date locked once confirmed (the No. was made from it) */}
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
                  // The documents the receipt pays (Choose Documents); applied on Save
                  key: 'details',
                  label: 'Details',
                  children: (
                    <ReceiptLinesTab
                      lines={lines}
                      onChange={setLines}
                      editing={editing}
                      cardCode={cardCode}
                      docEntry={docEntry}
                      currency={receiptCur}
                      docDate={docDateText}
                    />
                  ),
                },
                {
                  // Files of the receipt (e.g. a bank-in slip); changes are applied on Save (held until the first Save
                  // for a new receipt)
                  key: 'attachments',
                  label: 'Attachments',
                  children: (
                    <AttachmentsTab handleRef={attachmentsRef} objType={TMPR_OBJTYPE} docEntry={docEntry} editing={editing} />
                  ),
                },
                {
                  // Posting to SAP B1: set by the posting, never typed, so always read-only
                  key: 'posting',
                  label: 'Posting',
                  children: (
                    <div className={detailStyles.tabPanel}>
                      <div className={detailStyles.fields}>
                        <Form.Item label="SAP No.">
                          <ReadOnlyText value={receipt?.sapDocNum != null ? String(receipt.sapDocNum) : ''} />
                        </Form.Item>
                        <Form.Item label="Posting Status">
                          <ReadOnlyText value={receipt?.postStatusName ?? receipt?.postStatus ?? ''} />
                        </Form.Item>
                        <Form.Item label="Error Description">
                          <ReadOnlyText value={receipt?.errorDesc ?? ''} multiline />
                        </Form.Item>
                      </div>
                    </div>
                  ),
                },
                // Approval history (FTS11WDD1); a new receipt has none. Loaded only when this tab is opened.
                ...(isNew
                  ? []
                  : [
                      {
                        key: 'approval',
                        label: 'Approval',
                        children: <ApprovalTab objType={TMPR_OBJTYPE} docEntry={docEntry as number} refreshKey={approval.refreshKey + changeCount} />,
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
          {/* Series the No. is taken from on Confirm; fixed once confirmed */}
          <Form.Item label="Series" name="series" rules={[{ required: true, message: 'Series is required' }]}>
            {editing ? (
              <Select
                placeholder="Select a series"
                disabled={headerFixed}
                options={seriesOptions}
                optionRender={(o) => (o.data as { listLabel: string }).listLabel}
                notFoundContent="No active Temporary Receipt series — add one in Document Numbering"
              />
            ) : (
              <DisplayText text={receipt?.seriesCode ?? ''} />
            )}
          </Form.Item>
          {/* Given on Confirm from Document Numbering — never typed */}
          <Form.Item label="No.">
            {/* Given on Confirm from Document Numbering; typed here on a manual series (checked on Confirm) */}
            {editing && isDraft && !approverEditing && manualSeries ? (
              <Form.Item name="docNum" noStyle>
                <Input maxLength={MANUAL_NO_MAX} placeholder="Key in the No." />
              </Form.Item>
            ) : editing ? (
              <Input value={isDraft ? '' : (receipt?.docNum ?? '')} placeholder="On confirm" disabled />
            ) : (
              <ReadOnlyText value={receipt?.docNum ?? ''} />
            )}
          </Form.Item>
          {/* Copy To from a Temporary Receipt Request: which one (a click opens it) */}
          {baseEntry && (
            <Form.Item label="Copied From">
              <span style={{ paddingLeft: 8 }}>
                <a onClick={() => router.push(`/banking/receipt-requests/${baseEntry}`)}>Temporary Receipt Request {baseDocNum ?? ''}</a>
              </span>
            </Form.Item>
          )}
          <Form.Item label="Customer" name="cardCode" rules={[{ required: true, message: 'Customer is required' }]}>
            {editing && (headerFixed || customerFixed) ? (
              // Fixed once confirmed, and when the request it is copied from is for a known customer
              <Input disabled />
            ) : editing ? (
              // Chosen from the SAP customer list, not typed
              <Input
                readOnly
                placeholder={
                  copiedFrom && !copiedFrom.knownCust ? `Choose the customer for "${copiedFrom.cardName}"` : 'Click to choose a customer'
                }
                onClick={() => setCustomerLookupOpen(true)}
                suffix={<SearchOutlined onClick={() => setCustomerLookupOpen(true)} style={{ cursor: 'pointer' }} />}
              />
            ) : (
              <ReadOnlyText />
            )}
          </Form.Item>
          <Form.Item label="Name" name="cardName" rules={[{ max: 200, message: 'Maximum 200 characters' }]}>
            {editing ? <Input /> : <ReadOnlyText />}
          </Form.Item>
          {/* The currency the money came in, with SAP's rate for the Posting Date: the customer's (local for an "all
              currencies" one); a foreign-currency customer may also pay in the local currency, the others in any */}
          <CurrencyField
            editing={editing}
            changeable={currencyChangeable}
            currency={receiptCur}
            isForeign={isForeign}
            rate={shownRate}
            dateText={docDateValue ? dayjs(docDateValue).format(DATE_FORMAT) : ''}
            options={receiptCurrencyOptions(currencies, cardCurrency)}
          />
          {/* Never chosen: follows from the Payment Means (the one used, or Multiple Type). The button beside it opens
              them (read-only in view mode). */}
          <Form.Item label="Payment Type" required>
            <div style={{ display: 'flex', gap: 4 }}>
              {editing ? (
                <Input value={payTypeName} placeholder="Key in the Payment Means" disabled style={{ flex: 1 }} />
              ) : (
                <span style={{ flex: 1 }}>
                  <ReadOnlyText value={payTypeName} />
                </span>
              )}
              <Button icon={<WalletOutlined />} onClick={() => setMeansOpen(true)}>
                Payment Means
              </Button>
            </div>
          </Form.Item>
          {/* The Payment Means' total (+ bank charge): never typed */}
          <Form.Item label={isForeign ? `Amount (${receiptCur})` : 'Amount'}>
            {editing ? <Input value={formatAmount(docTotal)} disabled /> : <ReadOnlyText value={formatAmount(receipt?.docTotal)} />}
          </Form.Item>
          {/* A foreign currency: the Amount in the local currency at SAP's rate (saved: as kept) */}
          {isForeign && (
            <Form.Item label={`Amount (${localCur})`}>
              {editing ? (
                <Input value={formatAmount(toLocalAmount(docTotal, shownRate, currencies?.direct))} disabled />
              ) : (
                <ReadOnlyText value={formatAmount(receipt?.docTotalLC)} />
              )}
            </Form.Item>
          )}
          {/* Worked out from the Details tab: never typed */}
          <Form.Item label="Total Applied">
            {editing ? <Input value={formatAmount(totalApplied)} disabled /> : <ReadOnlyText value={formatAmount(totalApplied)} />}
          </Form.Item>
          <Form.Item label="Bal. On Account">
            {editing ? <Input value={formatAmount(onAccount)} disabled /> : <ReadOnlyText value={formatAmount(onAccount)} />}
          </Form.Item>
        </DetailView>
      </Form>

      {printModals}

      {!isNew && <RelationshipMap open={mapOpen} objType={TMPR_OBJTYPE} docEntry={docEntry as number} onClose={() => setMapOpen(false)} />}

      <PaymentMeansModal
        open={meansOpen}
        means={means}
        editing={editing}
        houseBanks={houseBanks}
        totalApplied={totalApplied}
        onCancel={() => setMeansOpen(false)}
        onOk={(m) => {
          setMeans(m);
          setMeansOpen(false);
        }}
      />

      <LookupListView<SapCustomer>
        open={customerLookupOpen}
        title="Choose Customer"
        searchPlaceholder="Search customers..."
        columnDefs={customerColumns}
        loadRows={async () => {
          const res = await sapAPI.getCustomers();
          return res.success ? res.data : [];
        }}
        getKey={(c) => c.cardCode}
        excludeKeys={[]}
        singleSelect
        onCancel={() => setCustomerLookupOpen(false)}
        onSelect={(picked) => {
          setCustomerLookupOpen(false);
          const chosen = picked[0];
          if (!chosen || chosen.cardCode === cardCode) return;
          const apply = () => {
            form.setFieldsValue({ cardCode: chosen.cardCode, cardName: chosen.cardName });
            setLines([]);
            // Currency: the customer's (local for an "all currencies" or local-currency customer), unless the request
            // it is copied from fixes it
            const own = (chosen.currency ?? '').trim();
            setCardCurrency(own || null);
            if (!copiedFrom) form.setFieldsValue({ docCur: !own || own === '##' ? localCur : own });
          };
          // The chosen documents belong to the old customer: they go, after asking
          if (lines.length === 0) {
            apply();
            return;
          }
          modal.confirm({
            title: 'Change Customer',
            content: `The ${lines.length} document(s) on the Details tab belong to ${cardCode} and will be removed. Continue?`,
            okText: 'Change',
            cancelText: 'No',
            onOk: apply,
          });
        }}
      />
    </>
  );
}

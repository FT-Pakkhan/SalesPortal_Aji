'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { App, Button, Checkbox, DatePicker, Form, Input, Select, Tabs } from 'antd';
import {
  ApartmentOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  CopyOutlined,
  EditOutlined,
  PlusOutlined,
  PrinterOutlined,
  SaveOutlined,
  SearchOutlined,
  WalletOutlined,
} from '@ant-design/icons';
import type { ColDef, ValueFormatterParams } from 'ag-grid-community';
import dayjs, { type Dayjs } from 'dayjs';
import { useRouter } from 'next/navigation';
import { documentNumberingAPI, payTypesAPI, receiptRequestsAPI, sapAPI, usersAPI } from '@/lib/apiClient';
import { useCanChange } from '@/stores/accessStore';
import { useAuthStore } from '@/stores/authStore';
import { DetailView, DisplayText, ReadOnlyText, detailFormProps } from '@/components/ui/DetailView';
import detailStyles from '@/components/ui/DetailView.module.css';
import { DataGrid } from '@/components/ui/DataGrid';
import { LookupListView } from '@/components/ui/LookupListView';
import { AttachmentsTab } from '@/components/ui/AttachmentsTab';
import type { AttachmentsTabHandle } from '@/components/ui/AttachmentsTab';
import { usePrintDocument } from '@/components/ui/usePrintDocument';
import { MANUAL_NO_MAX, useConfirmPrompt } from '@/components/ui/useConfirmPrompt';
import { StatusTag } from '@/components/ui/StatusTag';
import { ApprovalTab } from '@/components/sales/ApprovalTab';
import { useApprovalDecision } from '@/components/sales/useApprovalDecision';
import { RelationshipMap } from '@/components/sales/RelationshipMap';
import { EMPTY_MEANS, PaymentMeansModal, RECEIPT_COPY_KEY, payTypeOf, totalOf } from './PaymentMeansModal';
import type { NumberingSeries, PayType, ReceiptPaymentMeans, ReceiptRequest, SapCurrencies, SapCustomer, SapHouseBank, SapSalesEmployee } from '@/types';
import { CurrencyField, receiptCurrencyOptions, toLocalAmount } from './CurrencyField';
import { isDocumentEditable } from '@/lib/postStatus';

/** Document type (FTS_vw_ObjType.Code): numbering series, approvals, attachments and layouts are kept under it */
const TRQ_OBJTYPE = 'FTS11OTRQ';
const LIST_PATH = '/banking/receipt-requests';
const STATUS_DRAFT = 'DRAFT';
const STATUS_OPEN = 'OPEN';
const APPR_STATUS_PENDING = 'PENDING';
/** Date format on screen, as in SAP B1 (e.g. 12.08.26) */
const DATE_FORMAT = 'DD.MM.YY';

interface ReceiptRequestDetailProps {
  /** Omit for a new request */
  docEntry?: number;
  /** Open an existing request directly in edit mode (list view's Edit button) */
  startInEdit?: boolean;
}

interface RequestFormValues {
  /** Typed only on a manual series (draft) */
  docNum: string;
  series: number | null;
  docDate: Dayjs | null;
  knownCust: boolean;
  cardCode: string;
  cardName: string;
  slpCode: number | null;
  comments: string;
  /** The currency the money comes in (SAP OCRN) */
  docCur: string | null;
}

const toFormValues = (r: ReceiptRequest): RequestFormValues => ({
  series: r.series,
  docNum: r.docNum ?? '',
  docDate: r.docDate ? dayjs(r.docDate) : null,
  knownCust: r.knownCust,
  cardCode: r.cardCode ?? '',
  cardName: r.cardName ?? '',
  slpCode: r.slpCode,
  comments: r.comments ?? '',
  docCur: r.docCur ?? null,
});

/** A request's payment means, as saved */
const meansOf = (r: ReceiptRequest): ReceiptPaymentMeans => ({
  cheques: (r.cheques ?? []).map((c) => ({ checkNum: c.checkNum, checkSum: Number(c.checkSum) })),
  checkSum: Number(r.checkSum ?? 0),
  trsfrSum: Number(r.trsfrSum ?? 0),
  trsfrBank: r.trsfrBank,
  creditSum: Number(r.creditSum ?? 0),
  cashSum: Number(r.cashSum ?? 0),
  bcgSum: Number(r.bcgSum ?? 0),
});

const formatAmount = (value: number | null | undefined) =>
  value == null ? '' : Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const customerColumns: ColDef<SapCustomer>[] = [
  { field: 'cardCode', headerName: 'Customer Code', width: 180, sort: 'asc' },
  { field: 'cardName', headerName: 'Customer Name', flex: 1, minWidth: 220 },
];

type ReceiptRow = ReceiptRequest['receipts'][number];

/**
 * Temporary Receipt Request (FTS11OTRQ): a payment noted down before the Temporary Receipt is made — header and Payment
 * Means only. The customer is optional: tick Known Customer to choose one from SAP, otherwise only key in the name.
 * Save = DRAFT; Confirm = its No. (or sent for approval). Copy To Temporary Receipt (several receipts allowed, together
 * not more than the request); CLOSED once its confirmed receipts reach its Amount.
 */
export default function ReceiptRequestDetail({ docEntry, startInEdit = false }: ReceiptRequestDetailProps) {
  const isNew = docEntry === undefined;
  const { message, modal } = App.useApp();
  // Read Only screen (the user's roles): no New / Edit / Confirm / Copy To / Cancel Doc (Print and Approve / Reject stay)
  const canChange = useCanChange();
  const router = useRouter();
  const authUser = useAuthStore((s) => s.user);
  const [request, setRequest] = useState<ReceiptRequest | null>(null);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(isNew || startInEdit);
  // ?edit=1 (a list's Edit button) on one that can no longer be changed (posted, closed, in approval...): view mode
  useEffect(() => {
    if (request && (!isDocumentEditable(request) || (request.receiptCount ?? 0) > 0)) setEditing(false);
  }, [request]);

  const [seriesList, setSeriesList] = useState<NumberingSeries[]>([]);
  const [salesEmployees, setSalesEmployees] = useState<SapSalesEmployee[]>([]);
  const [payTypes, setPayTypes] = useState<PayType[]>([]);
  const [houseBanks, setHouseBanks] = useState<SapHouseBank[]>([]);
  const [customerLookupOpen, setCustomerLookupOpen] = useState(false);
  // Payment Means (popup): how the customer paid; Payment Type and Amount follow from it
  const [means, setMeans] = useState<ReceiptPaymentMeans>(EMPTY_MEANS);
  const [meansOpen, setMeansOpen] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const [form] = Form.useForm<RequestFormValues>();
  const attachmentsRef = useRef<AttachmentsTabHandle>(null);
  // Followed as ticked: the customer can be chosen only for a known customer
  const knownCust = !!Form.useWatch('knownCust', form);
  const { canPrint, print, modals: printModals } = usePrintDocument(TRQ_OBJTYPE, docEntry, 'Temporary Receipt Request', request?.docNum);
  const confirmPrompt = useConfirmPrompt();
  // A manual series is chosen: the No. is typed in the No. field
  const seriesValue = Form.useWatch('series', form);
  const manualSeries = !!seriesList.find((s) => s.docEntry === seriesValue)?.isManual;
  // Currency: SAP's currencies and their rates on the Date; the known customer's own currency ('##' = all)
  const [currencies, setCurrencies] = useState<SapCurrencies | null>(null);
  const [cardCurrency, setCardCurrency] = useState<string | null>(null);
  const docCurValue = Form.useWatch('docCur', form) as string | null | undefined;
  const docDateValue = Form.useWatch('docDate', form) as Dayjs | null | undefined;
  const docDateText = docDateValue ? dayjs(docDateValue).format('YYYY-MM-DD') : '';
  const localCur = currencies?.local ?? '';
  const requestCur = docCurValue || request?.docCur || localCur;
  const isForeign = !!requestCur && !!localCur && requestCur !== localCur;
  useEffect(() => {
    sapAPI
      .getCurrencies(docDateText || undefined)
      .then((res) => res.success && setCurrencies(res.data))
      .catch(() => undefined);
  }, [docDateText]);
  useEffect(() => {
    if (isNew && localCur && !form.getFieldValue('docCur')) form.setFieldsValue({ docCur: localCur });
  }, [localCur]);

  const docTotal = totalOf(means);
  const payTyp = payTypeOf(means);
  const payTypeName = payTyp ? payTypes.find((p) => p.code === payTyp)?.name ?? payTyp : '';

  const showRequest = (r: ReceiptRequest) => {
    setRequest(r);
    setCardCurrency(r.knownCust ? (r.cardCurrency ?? null) : null);
    form.setFieldsValue(toFormValues(r));
    setMeans(meansOf(r));
  };

  const approval = useApprovalDecision<ReceiptRequest>({
    objType: TRQ_OBJTYPE,
    docEntry,
    apprStatus: request?.apprStatus,
    title: 'Temporary Receipt Request',
    onDecided: showRequest,
  });

  useEffect(() => {
    // Temporary Receipt Request series (Document Numbering); a new request starts with the one ticked Default
    documentNumberingAPI
      .getList(TRQ_OBJTYPE)
      .then((res) => {
        if (!res.success) return;
        setSeriesList(res.data);
        const defaultSeries = res.data.find((s) => s.isDefault && s.active);
        if (isNew && defaultSeries && !form.getFieldValue('series')) form.setFieldsValue({ series: defaultSeries.docEntry });
      })
      .catch(() => message.error('Failed to load numbering series'));
    sapAPI.getSalesEmployees().then((res) => res.success && setSalesEmployees(res.data)).catch(() => undefined);
    payTypesAPI.getList().then((res) => res.success && setPayTypes(res.data)).catch(() => undefined);
    sapAPI.getHouseBanks().then((res) => res.success && setHouseBanks(res.data)).catch(() => undefined);
    if (isNew) {
      form.setFieldsValue({ docDate: dayjs(), knownCust: false });
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
    receiptRequestsAPI
      .getById(docEntry)
      .then((res) => res.success && setRequest(res.data))
      .catch(() => {
        message.error('Failed to load temporary receipt request');
        router.push(LIST_PATH);
      })
      .finally(() => setLoading(false));
  }, [docEntry]);

  useEffect(() => {
    if (!loading && request) showRequest(request);
  }, [loading]);

  const errorText = (error: unknown, fallback: string) =>
    (error as { response?: { data?: { error?: string } } }).response?.data?.error || fallback;

  const status = request?.docStatus ?? STATUS_DRAFT;
  const isDraft = status === STATUS_DRAFT;
  const inApproval = request?.apprStatus === APPR_STATUS_PENDING || !!request?.apprLocked;
  const copied = (request?.receiptCount ?? 0) > 0;
  // CLOSED / CANCELED can't be changed; nor one in / after approval, nor one already copied into a receipt
  const canEdit = (isDraft || status === STATUS_OPEN) && !inApproval && !copied && canChange;
  const remaining = Math.max(Number(request?.docTotal ?? 0) - Number(request?.copiedTotal ?? 0), 0);

  const handleCancelEdit = () => {
    if (isNew) {
      router.push(LIST_PATH);
      return;
    }
    form.resetFields();
    if (request) showRequest(request);
    setEditing(false);
  };

  const handleSave = async (values: RequestFormValues) => {
    if (!editing) return;
    const payload = {
      series: values.series ?? null,
      // Manual series: the No. typed in the No. field (checked on Confirm)
      docNum: manualSeries ? values.docNum?.trim() || null : null,
      docDate: (values.docDate ?? dayjs()).format('YYYY-MM-DD'),
      knownCust: !!values.knownCust,
      cardCode: values.knownCust ? values.cardCode || null : null,
      cardName: values.cardName,
      slpCode: values.slpCode ?? null,
      comments: values.comments || null,
      docCur: values.docCur || null,
      // Payment Type and Amount are worked out by the server from these
      ...means,
    };
    setSaving(true);
    try {
      if (isNew) {
        const res = await receiptRequestsAPI.create(payload);
        if (res.success) {
          await attachmentsRef.current?.save(res.data.docEntry);
          message.success('Temporary receipt request saved as draft');
          router.replace(`${LIST_PATH}/${res.data.docEntry}`);
        }
      } else {
        const res = await receiptRequestsAPI.update(docEntry, payload);
        if (res.success) {
          await attachmentsRef.current?.save(docEntry);
          message.success('Temporary receipt request updated');
          showRequest(res.data);
          setEditing(false);
        }
      }
    } catch (error) {
      message.error(errorText(error, 'Failed to save temporary receipt request'));
    } finally {
      setSaving(false);
    }
  };

  // Confirm / Cancel Doc: asked first; the popup closes at once and the work runs behind the LOADING overlay
  const runAction = (
    title: string,
    content: string,
    okText: string,
    danger: boolean,
    call: () => Promise<{ success: boolean; data: ReceiptRequest; message?: string }>,
    done: string
  ) => {
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
  const runCall = async (title: string, call: () => Promise<{ success: boolean; data: ReceiptRequest; message?: string }>, done: string) => {
    try {
      const res = await call();
      if (res.success) {
        message.success(res.message || done);
        showRequest(res.data);
      }
    } catch (error) {
      message.error({ content: errorText(error, `Failed: ${title}`), duration: 6 });
    }
  };

  // A manual series: the No. is keyed in on the popup
  const handleConfirm = () => {
    const manual = !!seriesList.find((s) => s.docEntry === request?.series)?.isManual;
    const title = 'Confirm Temporary Receipt Request';
    confirmPrompt.confirm({
      title,
      content: `${manual ? 'The No. keyed in below is given to it' : 'The No. will be assigned'} (or it is sent for approval). Continue?`,
      manual,
      initialNo: request?.docNum ?? '',
      onConfirm: (docNum) => void runCall(title, () => receiptRequestsAPI.confirm(docEntry as number, docNum), 'Temporary receipt request confirmed'),
    });
  };

  const handleCancelDoc = () =>
    runAction(
      'Cancel Temporary Receipt Request',
      "Cancel this request? It can't be changed or copied afterwards.",
      'Cancel Doc',
      true,
      () => receiptRequestsAPI.cancel(docEntry as number),
      'Temporary receipt request cancelled'
    );

  // Copy To Temporary Receipt: what is still left on the request goes to a new receipt (in this browser session)
  const handleCopyTo = async () => {
    try {
      const res = await receiptRequestsAPI.getCopy(docEntry as number);
      if (!res.success) return;
      sessionStorage.setItem(RECEIPT_COPY_KEY, JSON.stringify(res.data));
      router.push('/banking/temporary-receipts/new');
    } catch (error) {
      message.error(errorText(error, "Couldn't start the temporary receipt"));
    }
  };

  const receiptColumns = useMemo<ColDef<ReceiptRow>[]>(
    () => [
      { field: 'docNum', headerName: 'No.', valueFormatter: (p: ValueFormatterParams) => p.value ?? 'Draft' },
      { field: 'cardCode', headerName: 'Customer' },
      // The Amount is in the document's own currency
      { field: 'docCur', headerName: 'Currency', width: 100 },
      { field: 'docTotal', headerName: 'Amount', cellDataType: 'number', valueFormatter: (p: ValueFormatterParams) => formatAmount(p.value) },
      {
        field: 'docStatus',
        headerName: 'Status',
        cellRenderer: (p: { data?: ReceiptRow }) => (p.data ? <StatusTag code={p.data.docStatus} /> : null),
      },
      { field: 'apprStatus', headerName: 'Approval' },
    ],
    []
  );

  if (loading) return null;
  if (!isNew && !request) return null;

  // Button order: New, Edit, then the rest; Relationship Map last
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
      {/* OPEN with something still left: a request may be split into several receipts */}
      {status === STATUS_OPEN && remaining > 0 && canChange && (
        <Button icon={<CopyOutlined />} onClick={handleCopyTo}>
          Copy To Temporary Receipt
        </Button>
      )}
      {(isDraft || status === STATUS_OPEN) && !copied && canChange && (
        <Button danger icon={<CloseCircleOutlined />} onClick={handleCancelDoc}>
          Cancel Doc
        </Button>
      )}
      {!isNew && (
        <Button icon={<ApartmentOutlined />} onClick={() => setMapOpen(true)}>
          Relationship Map
        </Button>
      )}
    </>
  );

  const seriesOptions = seriesList
    .filter((s) => s.active)
    .map((s) => ({ value: s.docEntry, label: s.series, listLabel: [s.series, s.seriesName].filter(Boolean).join(' - ') }));
  const greyed = (value: string) => (editing ? <Input value={value} disabled /> : <ReadOnlyText value={value} />);

  return (
    <>
      <Form form={form} {...detailFormProps(editing)} initialValues={{ knownCust: false }} onFinish={handleSave}>
        <DetailView
          toolbar={toolbar}
          title={`Temporary Receipt Request - ${isNew ? 'New' : request?.docNum ?? 'Draft'}`}
          sideClose
          // Right column: statuses, date and what has been copied into receipts
          sideFields={
            <>
              <Form.Item label="Status">{greyed(request?.docStatusName ?? status)}</Form.Item>
              <Form.Item label="Approval Status">{greyed(request?.apprStatusName ?? request?.apprStatus ?? '')}</Form.Item>
              <Form.Item label="Posting Date" name="docDate" rules={[{ required: true, message: 'Posting Date is required' }]}>
                {editing ? (
                  <DatePicker format={DATE_FORMAT} disabled={!isDraft} />
                ) : (
                  <DisplayText text={request?.docDate ? dayjs(request.docDate).format(DATE_FORMAT) : ''} />
                )}
              </Form.Item>
              {!isNew && <Form.Item label="Copied to Receipts">{greyed(formatAmount(request?.copiedTotal))}</Form.Item>}
              {!isNew && <Form.Item label="Left to Copy">{greyed(formatAmount(remaining))}</Form.Item>}
            </>
          }
          below={
            <>
              <Tabs
                type="card"
                items={[
                  {
                    key: 'attachments',
                    label: 'Attachments',
                    children: <AttachmentsTab handleRef={attachmentsRef} objType={TRQ_OBJTYPE} docEntry={docEntry} editing={editing} />,
                  },
                  ...(isNew
                    ? []
                    : [
                        {
                          // The Temporary Receipts copied from it; a click opens one
                          key: 'receipts',
                          label: `Receipts (${request?.receipts?.length ?? 0})`,
                          children: (
                            <DataGrid<ReceiptRow>
                              settingsKey="receipt-request:receipts"
                              showToolbar
                              selectable={false}
                              onOpenRecord={(r) => router.push(`/banking/temporary-receipts/${r.docEntry}`)}
                              gridProps={{ rowData: request?.receipts ?? [], columnDefs: receiptColumns, getRowId: (p) => String(p.data.docEntry) }}
                            />
                          ),
                        },
                        {
                          key: 'approval',
                          label: 'Approval',
                          children: <ApprovalTab objType={TRQ_OBJTYPE} docEntry={docEntry as number} refreshKey={approval.refreshKey} />,
                        },
                      ]),
                ]}
              />
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
                notFoundContent="No active Temporary Receipt Request series — add one in Document Numbering"
              />
            ) : (
              <DisplayText text={request?.seriesCode ?? ''} />
            )}
          </Form.Item>
          <Form.Item label="No.">
            {/* Given on Confirm from Document Numbering; typed here on a manual series (checked on Confirm) */}
            {editing && isDraft && manualSeries ? (
              <Form.Item name="docNum" noStyle>
                <Input maxLength={MANUAL_NO_MAX} placeholder="Key in the No." />
              </Form.Item>
            ) : editing ? (
              <Input value={isDraft ? '' : (request?.docNum ?? '')} placeholder="On confirm" disabled />
            ) : (
              <ReadOnlyText value={request?.docNum ?? ''} />
            )}
          </Form.Item>
          {/* Ticked: the customer is chosen from SAP; not ticked: only the name is keyed in */}
          <Form.Item label="Known Customer" name="knownCust" valuePropName="checked">
            <Checkbox
              disabled={!editing}
              onChange={(e) => {
                // Unticked: no customer code any more (the name stays, to key in); any currency may be chosen
                if (!e.target.checked) {
                  form.setFieldsValue({ cardCode: '' });
                  setCardCurrency(null);
                }
              }}
            />
          </Form.Item>
          <Form.Item
            label="Customer"
            name="cardCode"
            required={knownCust}
            rules={[{ validator: (_, v) => (!knownCust || v ? Promise.resolve() : Promise.reject(new Error('Choose the customer'))) }]}
          >
            {editing ? (
              <Input
                readOnly
                disabled={!knownCust}
                placeholder={knownCust ? 'Click to choose a customer' : 'Tick Known Customer to choose one'}
                onClick={() => knownCust && setCustomerLookupOpen(true)}
                // Always there (antd loses focus if a suffix comes and goes); greyed and inactive until Known Customer is ticked
                suffix={
                  <SearchOutlined
                    onClick={() => knownCust && setCustomerLookupOpen(true)}
                    style={{ cursor: knownCust ? 'pointer' : 'not-allowed', color: knownCust ? undefined : '#bfbfbf' }}
                  />
                }
              />
            ) : (
              <ReadOnlyText />
            )}
          </Form.Item>
          <Form.Item
            label="Name"
            name="cardName"
            rules={[
              { required: true, whitespace: true, message: 'Name is required' },
              { max: 200, message: 'Maximum 200 characters' },
            ]}
          >
            {/* A known customer's name comes from SAP */}
            {editing ? <Input disabled={knownCust} placeholder={knownCust ? '' : "Key in the customer's name"} /> : <ReadOnlyText />}
          </Form.Item>
          {/* The currency the money comes in, with SAP's rate for the Date: a known customer's (local for an "all
              currencies" one, which may choose any); a foreign-currency customer may also pay in the local currency */}
          <CurrencyField
            editing={editing}
            changeable={isDraft}
            currency={requestCur}
            isForeign={isForeign}
            rate={isDraft ? currencies?.currencies.find((c) => c.code === requestCur)?.rate : request?.docRate}
            dateText={docDateValue ? dayjs(docDateValue).format('DD.MM.YY') : ''}
            options={receiptCurrencyOptions(currencies, cardCurrency)}
          />
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
              <DisplayText text={request?.slpName ?? ''} />
            )}
          </Form.Item>
          {/* Never chosen: follows from the Payment Means; the button beside it opens them (read-only in view mode) */}
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
          <Form.Item label={isForeign ? `Amount (${requestCur})` : 'Amount'}>
            {editing ? <Input value={formatAmount(docTotal)} disabled /> : <ReadOnlyText value={formatAmount(request?.docTotal)} />}
          </Form.Item>
          {/* A foreign currency: the Amount in the local currency at SAP's rate (saved: as kept) */}
          {isForeign && (
            <Form.Item label={`Amount (${localCur})`}>
              {editing ? (
                <Input
                  value={formatAmount(
                    toLocalAmount(docTotal, isDraft ? currencies?.currencies.find((c) => c.code === requestCur)?.rate : request?.docRate, currencies?.direct)
                  )}
                  disabled
                />
              ) : (
                <ReadOnlyText value={formatAmount(request?.docTotalLC)} />
              )}
            </Form.Item>
          )}
        </DetailView>
      </Form>

      <PaymentMeansModal
        open={meansOpen}
        means={means}
        editing={editing}
        houseBanks={houseBanks}
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
          if (picked[0]) {
            form.setFieldsValue({ cardCode: picked[0].cardCode, cardName: picked[0].cardName ?? '' });
            // Currency: the customer's (local for an "all currencies" or local-currency customer)
            const own = (picked[0].currency ?? '').trim();
            setCardCurrency(own || null);
            form.setFieldsValue({ docCur: !own || own === '##' ? localCur : own });
          }
        }}
      />

      {printModals}
      {confirmPrompt.modal}
      {!isNew && <RelationshipMap open={mapOpen} objType={TRQ_OBJTYPE} docEntry={docEntry as number} onClose={() => setMapOpen(false)} />}
    </>
  );
}

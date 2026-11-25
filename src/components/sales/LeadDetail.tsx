'use client';

import React, { useState, useEffect, useRef } from 'react';
import { App, Button, Form, Input, Select, Tabs } from 'antd';
import { SaveOutlined, EditOutlined, PlusOutlined, CheckCircleOutlined, CopyOutlined, ApartmentOutlined, PrinterOutlined } from '@ant-design/icons';
import { usePrintDocument } from '@/components/ui/usePrintDocument';
import { useRouter } from 'next/navigation';
import { documentNumberingAPI, leadsAPI, sapAPI } from '@/lib/apiClient';
import { useAccessStore, useCanChange } from '@/stores/accessStore';
import { accessTo } from '@/lib/screens';
import { isDocumentEditable, isSynced } from '@/lib/postStatus';
import { DetailView, DisplayText, ReadOnlyText, detailFormProps } from '@/components/ui/DetailView';
import { AttachmentsTab } from '@/components/ui/AttachmentsTab';
import { MANUAL_NO_MAX, useConfirmPrompt } from '@/components/ui/useConfirmPrompt';
import { ApprovalTab } from './ApprovalTab';
import { RelationshipMap } from './RelationshipMap';
import { useApprovalDecision } from './useApprovalDecision';
import type { AttachmentsTabHandle } from '@/components/ui/AttachmentsTab';
import type { Lead, NumberingSeries, SapCurrencies } from '@/types';

/** Document type of a lead (FTS_vw_ObjType.Code); its numbering series and attachments are kept under it */
const LEAD_OBJTYPE = 'FTS11LEAD';
const STATUS_DRAFT = 'DRAFT';
const STATUS_OPEN = 'OPEN';
const APPR_STATUS_PENDING = 'PENDING';

interface LeadDetailProps {
  /** Omit to create a new lead */
  docEntry?: number;
  /** Open an existing lead directly in edit mode (list view's Edit button) */
  startInEdit?: boolean;
}

interface LeadFormValues {
  series: number | null;
  /** Typed only on a manual series (draft) */
  leadCode: string;
  leadName: string;
  /** The lead's currency: its quotations are in it */
  currency: string | null;
}

/**
 * Detail view of a lead (FTS11LEAD), a short registration: Lead Name and Series. Save = DRAFT without a Lead Code;
 * Confirm = the Lead Code from the chosen series (Document Numbering), OPEN (or approval first). An OPEN lead is used
 * on Sales Quotations, and becomes an SAP customer through Convert to Customer (its application form, SAP BP Code and
 * approval are there); Customer then shows the SAP customer code. Tabs: Attachments, Approval. Existing leads open in
 * view mode.
 */
export default function LeadDetail({ docEntry, startInEdit = false }: LeadDetailProps) {
  const isNew = docEntry === undefined;
  const { message } = App.useApp();
  // Read Only screen (the user's roles): no New / Edit / Confirm (Approve / Reject stay: approvals are per stage)
  const canChange = useCanChange();
  // Convert to Customer is its own screen (roles): the button only for users who may create one there
  const canConvert = useAccessStore((s) => accessTo(s.access, 'CNVC') === 'FULL');
  const router = useRouter();
  const [lead, setLead] = useState<Lead | null>(null);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  // Detail views open in view mode; Edit switches to edit mode
  const [editing, setEditing] = useState(isNew || startInEdit);
  // ?edit=1 (a list's Edit button) on one that can no longer be changed (posted, closed, in approval...): view mode
  useEffect(() => {
    if (lead && !isDocumentEditable(lead)) setEditing(false);
  }, [lead]);

  const [seriesList, setSeriesList] = useState<NumberingSeries[]>([]);
  const [mapOpen, setMapOpen] = useState(false);
  // Print (Crystal Reports layouts, System Initialization > Layouts): only when Lead has an active one
  const { canPrint, print, modals: printModals } = usePrintDocument(LEAD_OBJTYPE, docEntry, 'Lead', lead?.leadCode);
  const [form] = Form.useForm<LeadFormValues>();
  const attachmentsRef = useRef<AttachmentsTabHandle>(null);
  const confirmPrompt = useConfirmPrompt();
  // A manual series is chosen: the Lead Code is typed in its field
  const seriesValue = Form.useWatch('series', form);
  const manualSeries = !!seriesList.find((s) => s.docEntry === seriesValue)?.isManual;
  // SAP's currencies for the Currency drop-down; a new lead starts in the local one
  const [currencies, setCurrencies] = useState<SapCurrencies | null>(null);
  useEffect(() => {
    sapAPI
      .getCurrencies()
      .then((res) => {
        if (!res.success) return;
        setCurrencies(res.data);
        if (isNew && !form.getFieldValue('currency')) form.setFieldsValue({ currency: res.data.local });
      })
      .catch(() => undefined);
  }, []);

  // Lead series (Document Numbering); a new lead starts with the one ticked Default
  useEffect(() => {
    documentNumberingAPI
      .getList(LEAD_OBJTYPE)
      .then((res) => {
        if (!res.success) return;
        setSeriesList(res.data);
        const defaultSeries = res.data.find((s) => s.isDefault && s.active);
        if (isNew && defaultSeries && !form.getFieldValue('series')) form.setFieldsValue({ series: defaultSeries.docEntry });
      })
      .catch(() => message.error('Failed to load numbering series'));
  }, []);

  useEffect(() => {
    if (isNew) return;
    const load = async () => {
      try {
        const res = await leadsAPI.getById(docEntry);
        if (res.success) setLead(res.data);
      } catch {
        message.error('Failed to load lead');
        router.push('/leads');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [docEntry]);

  const showLead = (l: Lead) => {
    setLead(l);
    form.setFieldsValue({ series: l.series, leadCode: l.leadCode ?? '', leadName: l.leadName, currency: l.currency ?? null });
  };

  // Fill the form once it is on screen (it isn't rendered while loading)
  useEffect(() => {
    if (!loading && lead) showLead(lead);
  }, [loading]);

  // Approve / Reject while it waits for this user's approval
  const approval = useApprovalDecision<Lead>({
    objType: LEAD_OBJTYPE,
    docEntry,
    apprStatus: lead?.apprStatus,
    title: 'Lead',
    onDecided: showLead,
  });

  const status = lead?.docStatus ?? STATUS_DRAFT;
  const isDraft = status === STATUS_DRAFT;
  // Been through approval (waiting, approved or rejected): never editable or confirmed again
  const inApproval = lead?.apprStatus === APPR_STATUS_PENDING || !!lead?.apprLocked;
  // CLOSED / CANCELED leads can't be changed, nor one that is an SAP customer now (or being made one)
  const canEdit = (isDraft || status === STATUS_OPEN) && !inApproval && !isSynced(lead?.postStatus) && canChange;
  // Convert to Customer: an OPEN lead that isn't an SAP customer yet
  const showConvert = !isNew && status === STATUS_OPEN && !lead?.cardCode && canConvert;

  const handleCancelEdit = () => {
    if (isNew) {
      router.push('/leads');
      return;
    }
    // Discard unsaved changes, including attachments chosen / removed in edit mode
    form.resetFields();
    if (lead) showLead(lead);
    setEditing(false);
  };

  const errorText = (error: unknown, fallback: string) =>
    (error as { response?: { data?: { error?: string } } }).response?.data?.error || fallback;

  const handleSave = async () => {
    if (!editing) return;
    const v = form.getFieldsValue(true) as LeadFormValues;
    const payload = {
      leadName: v.leadName,
      series: v.series ?? null,
      leadCode: manualSeries ? v.leadCode?.trim() || null : null,
      currency: v.currency || null,
    };
    setSaving(true);
    try {
      if (isNew) {
        const res = await leadsAPI.create(payload);
        if (res.success) {
          // Files chosen before the first Save are attached now that the lead exists
          await attachmentsRef.current?.save(res.data.docEntry);
          message.success('Lead saved as draft');
          router.replace(`/leads/${res.data.docEntry}`);
        }
      } else {
        const res = await leadsAPI.update(docEntry, payload);
        if (res.success) {
          await attachmentsRef.current?.save(docEntry);
          message.success('Lead updated');
          showLead(res.data);
          setEditing(false);
        }
      }
    } catch (error) {
      message.error(errorText(error, 'Failed to save lead'));
    } finally {
      setSaving(false);
    }
  };

  // Confirm: the Lead Code from the series, status OPEN, Series locked — or, when an approval template applies, sent
  // for approval (Lead Code once approved). The popup closes at once and the work runs behind the LOADING overlay.
  // A manual series: the popup shows the Lead Code typed on the lead (still changeable there).
  const handleConfirm = () => {
    const manual = !!seriesList.find((s) => s.docEntry === lead?.series)?.isManual;
    confirmPrompt.confirm({
      title: 'Confirm Lead',
      content: `${manual ? 'The Lead Code keyed in below is given to it' : 'The Lead Code will be assigned'} and the Series can no longer be changed. Continue?`,
      manual,
      noLabel: 'Lead Code',
      initialNo: lead?.leadCode ?? '',
      onConfirm: (leadCode) => {
        void (async () => {
          try {
            const res = await leadsAPI.confirm(docEntry as number, leadCode);
            if (res.success) {
              message.success(res.message || `Lead confirmed: ${res.data.leadCode}`);
              showLead(res.data);
            }
          } catch (error) {
            message.error(errorText(error, 'Failed to confirm lead'), 8);
          }
        })();
      },
    });
  };

  if (loading) {
    // The portal's own loading overlay (LOADING... bar) shows while the data is fetched; nothing else is drawn meanwhile
    return null;
  }

  if (!isNew && !lead) return null;

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
        <Button type="primary" icon={<PlusOutlined />} onClick={() => router.push('/leads/new')}>
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
      {/* Copy To: opens a new Convert to Customer filled from this lead */}
      {showConvert && (
        <Button icon={<CopyOutlined />} onClick={() => router.push(`/convert-to-customer/new?lead=${docEntry}`)}>
          Copy To Convert to Customer
        </Button>
      )}
      {approval.buttons}
      {/* Last: its Convert to Customer documents (also on a Read Only screen) */}
      {!isNew && (
        <Button icon={<ApartmentOutlined />} onClick={() => setMapOpen(true)}>
          Relationship Map
        </Button>
      )}
    </>
  );

  // The box shows the series code (as in SAP B1); the drop-down list shows code and name. Only active series
  // are offered; a confirmed lead shows its own series even if it was made inactive since.
  const seriesOptions = seriesList
    .filter((s) => s.active)
    .map((s) => ({ value: s.docEntry, label: s.series, listLabel: [s.series, s.seriesName].filter(Boolean).join(' - ') }));

  return (
    <>
      {confirmPrompt.modal}
      <Form form={form} {...detailFormProps(editing)} onFinish={handleSave}>
        <DetailView
          toolbar={toolbar}
          title={`Lead - ${isNew ? 'New' : lead?.leadCode ?? 'Draft'}`}
          sideClose
          // Right column, as in SAP B1: the statuses
          sideFields={
            <>
              <Form.Item label="Status">
                {editing ? <Input value={lead?.docStatusName ?? status} disabled /> : <ReadOnlyText value={lead?.docStatusName ?? status} />}
              </Form.Item>
              <Form.Item label="Approval Status">
                {editing ? (
                  <Input value={lead?.apprStatusName ?? lead?.apprStatus ?? ''} disabled />
                ) : (
                  <ReadOnlyText value={lead?.apprStatusName ?? lead?.apprStatus ?? ''} />
                )}
              </Form.Item>
            </>
          }
          below={
            <Tabs
              type="card"
              items={[
                {
                  // Files of the lead; changes are applied on Save
                  key: 'attachments',
                  label: 'Attachments',
                  children: <AttachmentsTab handleRef={attachmentsRef} objType={LEAD_OBJTYPE} docEntry={docEntry} editing={editing} />,
                },
                // Approval history (FTS11WDD1); a new lead has none. Loaded only when this tab is opened.
                ...(isNew
                  ? []
                  : [
                      {
                        key: 'approval',
                        label: 'Approval',
                        children: <ApprovalTab objType={LEAD_OBJTYPE} docEntry={docEntry as number} refreshKey={approval.refreshKey} />,
                      },
                    ]),
              ]}
            />
          }
        >
          {/* Series the Lead Code is taken from on Confirm; fixed once confirmed */}
          <Form.Item label="Series" name="series" rules={[{ required: true, message: 'Series is required' }]}>
            {editing ? (
              <Select
                placeholder="Select a series"
                disabled={!isDraft}
                options={seriesOptions}
                optionRender={(o) => (o.data as { listLabel: string }).listLabel}
                notFoundContent="No active Lead series — add one in Document Numbering"
              />
            ) : (
              <DisplayText text={lead?.seriesCode ?? ''} />
            )}
          </Form.Item>
          {/* Given on Confirm from Document Numbering — never typed */}
          {/* Given on Confirm from the series; typed here on a manual series (checked on Confirm) */}
          {editing && isDraft && manualSeries ? (
            <Form.Item label="Lead Code" name="leadCode">
              <Input maxLength={MANUAL_NO_MAX} placeholder="Key in the Lead Code" />
            </Form.Item>
          ) : (
            <Form.Item label="Lead Code">
              {editing ? <Input value={isDraft ? '' : (lead?.leadCode ?? '')} placeholder="On confirm" disabled /> : <ReadOnlyText value={lead?.leadCode ?? ''} />}
            </Form.Item>
          )}
          <Form.Item
            label="Lead Name"
            name="leadName"
            rules={[
              { required: true, whitespace: true, message: 'Lead Name is required' },
              { max: 100, message: 'Maximum 100 characters' },
            ]}
          >
            {editing ? <Input /> : <ReadOnlyText />}
          </Form.Item>
          {/* The lead's currency (SAP's currencies; All Currencies not offered for now): its quotations are in it, and
              Convert to Customer creates the customer in it. Fixed once the lead has a quotation. */}
          <Form.Item
            label="Currency"
            name="currency"
            extra={editing && lead?.currencyLocked ? 'Fixed: the lead already has a sales quotation' : undefined}
          >
            {editing ? (
              <Select
                showSearch
                optionFilterProp="label"
                disabled={!!lead?.currencyLocked}
                options={(currencies?.currencies ?? []).map((c) => ({ value: c.code, label: `${c.code} - ${c.name}` }))}
              />
            ) : (
              <ReadOnlyText />
            )}
          </Form.Item>
          {/* The SAP customer the lead became through Convert to Customer — never typed */}
          <Form.Item label="Customer">
            {editing ? <Input value={lead?.cardCode ?? ''} disabled /> : <ReadOnlyText value={lead?.cardCode ?? ''} />}
          </Form.Item>
        </DetailView>
      </Form>
      {printModals}
      {!isNew && <RelationshipMap open={mapOpen} objType={LEAD_OBJTYPE} docEntry={docEntry as number} onClose={() => setMapOpen(false)} />}
    </>
  );
}

'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { App, Button, DatePicker, Form, Input, InputNumber, Select, Tabs } from 'antd';
import {
  SaveOutlined,
  EditOutlined,
  PlusOutlined,
  CheckCircleOutlined,
  CloudUploadOutlined,
  DeleteOutlined,
  CloseCircleOutlined,
  CopyOutlined,
  ApartmentOutlined,
  PrinterOutlined,
} from '@ant-design/icons';
import { usePrintDocument } from '@/components/ui/usePrintDocument';
import type { ColDef, ICellRendererParams } from 'ag-grid-community';
import { useRouter } from 'next/navigation';
import dayjs, { type Dayjs } from 'dayjs';
import { customerConversionsAPI, documentNumberingAPI, leadsAPI, sapAPI, usersAPI } from '@/lib/apiClient';
import { useCanChange } from '@/stores/accessStore';
import { isDocumentEditable, isSynced } from '@/lib/postStatus';
import { useAuthStore } from '@/stores/authStore';
import { DetailView, DisplayText, ReadOnlyText, detailFormProps } from '@/components/ui/DetailView';
import detailStyles from '@/components/ui/DetailView.module.css';
import { DataGrid } from '@/components/ui/DataGrid';
import type { DataGridHandle } from '@/components/ui/DataGrid';
import { AttachmentsTab } from '@/components/ui/AttachmentsTab';
import { LookupListView } from '@/components/ui/LookupListView';
import { ApprovalTab } from './ApprovalTab';
import ConversionAddressDetail, { addressTypeLabel, deliveryZoneLabel } from './ConversionAddressDetail';
import { RelationshipMap } from './RelationshipMap';
import { useApprovalDecision } from './useApprovalDecision';
import type { AttachmentsTabHandle } from '@/components/ui/AttachmentsTab';
import type {
  ConversionAddress,
  CustomerConversion,
  Lead,
  LeadContact,
  LeadContactRole,
  LeadFormFields,
  NumberingSeries,
  SapAddressLists,
  SapSalesEmployee,
} from '@/types';

/** Document type (FTS_vw_ObjType.Code); its numbering series, approvals and attachments are kept under it */
const OCRD_OBJTYPE = 'FTS11OCRD';
const LIST_PATH = '/convert-to-customer';
const STATUS_DRAFT = 'DRAFT';
const STATUS_OPEN = 'OPEN';
const APPR_STATUS_PENDING = 'PENDING';
/** Approval statuses it can be posted to SAP with */
const POSTABLE_APPR_STATUSES = ['NO-APPROVAL', 'APPROVED'];
/** Dates on screen as in SAP B1 */
const DATE_FORMAT = 'DD.MM.YY';
/** The form's labels are long ("Tax Identification No. (TIN)"): a wider label column keeps the colons in line */
const LABEL_WIDTH = 200;
/** Columns of the Copy From Lead list */
const leadLookupColumns: ColDef<Lead>[] = [
  { field: 'leadCode', headerName: 'Lead Code' },
  { field: 'leadName', headerName: 'Lead Name', flex: 1 },
  { field: 'slpName', headerName: 'Sales Employee' },
];

/** Contact person roles: the form's In-Charge Persons and Directors */
const CONTACT_ROLES: { value: LeadContactRole; label: string }[] = [
  { value: 'PURCHASING', label: 'Purchasing Dept' },
  { value: 'RECEIVING', label: 'Receiving Dept' },
  { value: 'ACCOUNT', label: 'Account Dept' },
  { value: 'DIRECTOR', label: 'Director / Boss' },
  { value: 'OTHERS', label: 'Others' },
];
const roleLabel = (v: string) => CONTACT_ROLES.find((r) => r.value === v)?.label ?? v;
const roleValue = (label: string) => CONTACT_ROLES.find((r) => r.label === label)?.value ?? 'OTHERS';

/** A row of the Contacts tab (key: the grid's row id) */
type ContactRow = LeadContact & { key: string };
let contactSeq = 0;
const toContactRows = (contacts: LeadContact[]): ContactRow[] => contacts.map((c) => ({ ...c, key: `c${++contactSeq}` }));
/**
 * The form's rows to fill in, as on paper: 6. In-Charge Persons (Purchasing, Receiving, Account, Others) and
 * 9. Full Name of Director / Boss (a - d). Rows left without a name aren't saved.
 */
const FORM_CONTACT_ROLES: LeadContactRole[] = ['PURCHASING', 'RECEIVING', 'ACCOUNT', 'OTHERS', 'DIRECTOR', 'DIRECTOR', 'DIRECTOR', 'DIRECTOR'];

/** In edit mode the form's rows are always there to fill in: any role with fewer rows than the form gets blank ones */
const withFormRows = (rows: ContactRow[]): ContactRow[] => {
  const missing: LeadContactRole[] = [];
  for (const role of new Set(FORM_CONTACT_ROLES)) {
    const wanted = FORM_CONTACT_ROLES.filter((r) => r === role).length;
    const have = rows.filter((r) => r.role === role).length;
    for (let i = have; i < wanted; i++) missing.push(role);
  }
  if (missing.length === 0) return rows;
  // In the form's order: the in-charge persons before the directors
  return [...rows, ...toContactRows(missing.map((role) => ({ role, roleDesc: null, name: '', tel: null, email: null })))].sort(
    (a, b) => FORM_CONTACT_ROLES.indexOf(a.role) - FORM_CONTACT_ROLES.indexOf(b.role)
  );
};

/** A row of the Addresses tab (key: the grid's row id) */
type AddressRow = ConversionAddress & { key: string };
let addressSeq = 0;
const toAddressRows = (addresses: ConversionAddress[]): AddressRow[] => addresses.map((a) => ({ ...a, key: `a${++addressSeq}` }));

/** One default per type, as in SAP B1: the first ticked one, or the type's first address when none is ticked */
const withOneDefault = (rows: AddressRow[]): AddressRow[] => {
  const defaults = new Set(
    (['B', 'S'] as const).map((type) => {
      const ofType = rows.filter((r) => r.adresType === type);
      return (ofType.find((r) => r.isDefault) ?? ofType[0])?.key;
    })
  );
  return rows.map((r) => (r.isDefault === defaults.has(r.key) ? r : { ...r, isDefault: defaults.has(r.key) }));
};

/**
 * A lead's addresses as rows: its Business Address -> Bill To "Bill To", its Delivery Address (or the business
 * address) -> Ship To "Ship To"; both defaults. Empty ones are left out.
 */
const addressesFromLead = (f: LeadFormFields): AddressRow[] => {
  const of = (p: 'bill' | 'ship') => ({
    street: f[`${p}Street`],
    streetNo: f[`${p}StreetNo`],
    block: f[`${p}Block`],
    city: f[`${p}City`],
    zipCode: f[`${p}ZipCode`],
    state: f[`${p}State`],
    country: f[`${p}Country`],
    deliveryZone: null,
  });
  const bill = of('bill');
  const ship = f.shipSameAsBill ? bill : of('ship');
  const filled = (a: ReturnType<typeof of>) => Object.values(a).some((v) => v);
  return toAddressRows([
    ...(filled(bill) ? [{ lineNum: null, adresType: 'B' as const, address: 'Bill To', ...bill, isDefault: true }] : []),
    ...(filled(ship) ? [{ lineNum: null, adresType: 'S' as const, address: 'Ship To', ...ship, isDefault: true }] : []),
  ]);
};

/** Small icon button in a grid row (the row's edit button) */
const rowButton = (title: string, icon: React.ReactNode, onClick: () => void) => (
  <Button type="text" size="small" icon={icon} title={title} onClick={onClick} />
);

interface CustomerConversionDetailProps {
  /** Omit to create a new one */
  docEntry?: number;
  /** Open an existing one directly in edit mode (list view's Edit button) */
  startInEdit?: boolean;
  /** New: start from this lead (the Lead screen's Convert to Customer button) */
  leadEntry?: number;
}

/** The form's fields (text and numbers as on the screen; the date as a day) */
interface ConversionFormValues {
  series: number | null;
  leadEntry: number | null;
  leadName: string;
  cardCode: string;
  creditLine: number | null;
  slpCode: number | null;
  groupCode: number | null;
  comments: string;
  docDate: Dayjs | null;
  regNo: string;
  yearsInBiz: number | null;
  email: string;
  eInvEmail: string;
  natureOfBiz: string;
  mainProducts: string;
  supplier1: string;
  supplier2: string;
  recCreditLine: number | null;
  groupNum: number | null;
  msicCode: string;
  tin: string;
  sstNo: string;
}

/**
 * The application form's values on screen (from a conversion, or from the lead it starts from); its addresses are the
 * Addresses tab's rows
 */
const formValuesOf = (f: LeadFormFields) => ({
  regNo: f.regNo ?? '',
  yearsInBiz: f.yearsInBiz,
  email: f.email ?? '',
  eInvEmail: f.eInvEmail ?? '',
  natureOfBiz: f.natureOfBiz ?? '',
  mainProducts: f.mainProducts ?? '',
  supplier1: f.supplier1 ?? '',
  supplier2: f.supplier2 ?? '',
  recCreditLine: f.recCreditLine,
  groupNum: f.groupNum,
  msicCode: f.msicCode ?? '',
  tin: f.tin ?? '',
  sstNo: f.sstNo ?? '',
});

const toFormValues = (c: CustomerConversion): ConversionFormValues => ({
  series: c.series,
  leadEntry: c.leadEntry,
  leadName: c.leadName,
  cardCode: c.cardCode ?? '',
  creditLine: c.creditLine,
  slpCode: c.slpCode,
  groupCode: c.groupCode,
  comments: c.comments ?? '',
  docDate: c.docDate ? dayjs(c.docDate) : null,
  ...formValuesOf(c),
});

const money = (v: number | null | undefined) =>
  v === null || v === undefined ? '' : Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Detail view of a Convert to Customer (FTS11OCRD): an OPEN lead's New Account Application Form, completed, with the
 * SAP BP Code and Approved Credit Limit. Save = DRAFT without a No.; Confirm = the form's * fields and the BP code
 * checked, then the No. from the series and OPEN (or approval first), and it is posted to SAP as a customer.
 * Tabs: General, Addresses, Contacts, Attachments, Posting, Approval. Existing ones open in view mode.
 */
export default function CustomerConversionDetail({ docEntry, startInEdit = false, leadEntry }: CustomerConversionDetailProps) {
  const isNew = docEntry === undefined;
  const { message, modal } = App.useApp();
  // Read Only screen (the user's roles): no New / Edit / Confirm / Cancel Doc (Approve / Reject stay: approvals are per stage)
  const canChange = useCanChange();
  const router = useRouter();
  const [conversion, setConversion] = useState<CustomerConversion | null>(null);
  const [contacts, setContacts] = useState<ContactRow[]>(isNew ? withFormRows([]) : []);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  // Detail views open in view mode; Edit switches to edit mode
  const [editing, setEditing] = useState(isNew || startInEdit);
  // ?edit=1 (a list's Edit button) on one that can no longer be changed (posted, closed, in approval...): view mode
  useEffect(() => {
    if (conversion && !isDocumentEditable(conversion)) setEditing(false);
  }, [conversion]);

  const [seriesList, setSeriesList] = useState<NumberingSeries[]>([]);
  const [salesEmployees, setSalesEmployees] = useState<SapSalesEmployee[]>([]);
  const [lists, setLists] = useState<SapAddressLists>({ countries: [], states: [], paymentTerms: [], customerGroups: [], deliveryZones: [] });
  // The lead converted, as shown in the Lead field ("L00001 - Bee Fong Sdn Bhd"), and while it is being read
  const [leadLabel, setLeadLabel] = useState('');
  // The lead's currency: the SAP customer is created in it
  const [leadCurrency, setLeadCurrency] = useState('');
  const [leadLoading, setLeadLoading] = useState(false);
  // Copy From Lead lookup open
  const [copyFromOpen, setCopyFromOpen] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  // Print (Crystal Reports layouts, System Initialization > Layouts): only when Convert to Customer has an active one
  const { canPrint, print, modals: printModals } = usePrintDocument(OCRD_OBJTYPE, docEntry, 'Convert to Customer', conversion?.docNum);
  // Logged-in user (their Sales Employee is the default when the lead has none)
  const authUser = useAuthStore((s) => s.user);
  const [form] = Form.useForm<ConversionFormValues>();
  const attachmentsRef = useRef<AttachmentsTabHandle>(null);
  const contactsGridRef = useRef<DataGridHandle<ContactRow>>(null);
  // Addresses tab: its rows, and the one open in the popup (new: not in the rows yet)
  const [addresses, setAddresses] = useState<AddressRow[]>([]);
  const [openAddress, setOpenAddress] = useState<{ row: AddressRow; isNew: boolean } | null>(null);
  const addressesGridRef = useRef<DataGridHandle<AddressRow>>(null);

  useEffect(() => {
    // Convert to Customer series (Document Numbering); a new one starts with the one ticked Default
    documentNumberingAPI
      .getList(OCRD_OBJTYPE)
      .then((res) => {
        if (!res.success) return;
        setSeriesList(res.data);
        const defaultSeries = res.data.find((s) => s.isDefault && s.active);
        if (isNew && defaultSeries && !form.getFieldValue('series')) form.setFieldsValue({ series: defaultSeries.docEntry });
      })
      .catch(() => message.error('Failed to load numbering series'));
    // Sales Employee choices (SAP B1 OSLP)
    sapAPI
      .getSalesEmployees()
      .then((res) => res.success && setSalesEmployees(res.data))
      .catch(() => message.error('Failed to load sales employees'));
    // Countries, states and payment terms (SAP B1 OCRY / OCST / OCTG)
    sapAPI
      .getAddressLists()
      .then((res) => res.success && setLists(res.data))
      .catch(() => message.error('Failed to load countries and payment terms'));
    if (isNew) {
      form.setFieldsValue({ docDate: dayjs() });
      // Started from a lead (the Lead screen's Convert to Customer button)
      if (leadEntry) void fillFromLead(leadEntry);
    }
  }, []);

  useEffect(() => {
    if (isNew) return;
    const load = async () => {
      try {
        const res = await customerConversionsAPI.getById(docEntry);
        if (res.success) setConversion(res.data);
      } catch {
        message.error('Failed to load convert to customer');
        router.push(LIST_PATH);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [docEntry]);

  const showConversion = (c: CustomerConversion) => {
    setConversion(c);
    setLeadLabel([c.leadCode, c.leadName].filter(Boolean).join(' - '));
    setLeadCurrency(c.currency ?? '');
    setContacts(toContactRows(c.contacts ?? []));
    setAddresses(toAddressRows(c.addresses ?? []));
    form.setFieldsValue(toFormValues(c));
  };

  // Fill the form once it is on screen (it isn't rendered while loading)
  useEffect(() => {
    if (!loading && conversion) showConversion(conversion);
  }, [loading]);

  // Edit mode: the form's In-Charge Person and Director / Boss rows are there to fill in (blank ones aren't saved)
  useEffect(() => {
    if (editing && !loading) setContacts((prev) => withFormRows(prev));
  }, [editing, loading, conversion]);

  /**
   * Fill the form from a lead: its name, Sales Employee (or the user's own) and the application form it has (a lead
   * saved before Convert to Customer existed may have one). Its contacts become this document's own.
   */
  const fillFromLead = async (entry: number) => {
    setLeadLoading(true);
    try {
      const res = await leadsAPI.getById(entry);
      if (!res.success) return;
      const lead = res.data;
      setLeadLabel([lead.leadCode, lead.leadName].filter(Boolean).join(' - '));
      setLeadCurrency(lead.currency ?? '');
      let slpCode = lead.slpCode;
      if (slpCode === null && authUser?.id) {
        const me = await usersAPI.getById(authUser.id).catch(() => null);
        slpCode = me?.success ? me.data.slpCode : null;
      }
      form.setFieldsValue({ leadEntry: lead.docEntry, leadName: lead.leadName, slpCode, ...formValuesOf(lead) });
      setContacts(withFormRows(toContactRows((lead.contacts ?? []).map((c) => ({ ...c, lineNum: null })))));
      setAddresses(addressesFromLead(lead));
    } catch {
      message.error('Failed to load the lead');
    } finally {
      setLeadLoading(false);
    }
  };

  // Approve / Reject while it waits for this user's approval
  const approval = useApprovalDecision<CustomerConversion>({
    objType: OCRD_OBJTYPE,
    docEntry,
    apprStatus: conversion?.apprStatus,
    title: 'Convert to Customer',
    onDecided: showConversion,
  });

  const status = conversion?.docStatus ?? STATUS_DRAFT;
  const isDraft = status === STATUS_DRAFT;
  const synced = isSynced(conversion?.postStatus);
  // Update Customer: changes an existing SAP business partner (lead and SAP BP Code fixed)
  const isUpdate = conversion?.baseEntry != null;
  // Been through approval (waiting, approved or rejected): never editable or confirmed again
  const inApproval = conversion?.apprStatus === APPR_STATUS_PENDING || !!conversion?.apprLocked;
  // DRAFT, or OPEN whose posting FAILED (to correct it); never once synced to SAP
  const canEdit = (isDraft || status === STATUS_OPEN) && !inApproval && !synced && canChange;

  const handleCancelEdit = () => {
    if (isNew) {
      router.push(LIST_PATH);
      return;
    }
    // Discard unsaved changes, including contacts and attachments chosen / removed in edit mode
    form.resetFields();
    if (conversion) showConversion(conversion);
    setEditing(false);
  };

  const errorText = (error: unknown, fallback: string) =>
    (error as { response?: { data?: { error?: string } } }).response?.data?.error || fallback;

  const handleSave = async () => {
    if (!editing) return;
    // Every field, including those on tabs not opened yet
    const v = form.getFieldsValue(true) as ConversionFormValues;
    const text = (s: string | null | undefined) => (s ?? '').trim() || null;
    const payload = {
      leadEntry: v.leadEntry as number,
      leadName: v.leadName,
      cardCode: text(v.cardCode),
      creditLine: v.creditLine ?? null,
      slpCode: v.slpCode ?? null,
      groupCode: v.groupCode ?? null,
      series: v.series ?? null,
      comments: text(v.comments),
      docDate: v.docDate ? v.docDate.format('YYYY-MM-DD') : null,
      regNo: text(v.regNo),
      yearsInBiz: v.yearsInBiz ?? null,
      email: text(v.email),
      eInvEmail: text(v.eInvEmail),
      natureOfBiz: text(v.natureOfBiz),
      mainProducts: text(v.mainProducts),
      supplier1: text(v.supplier1),
      supplier2: text(v.supplier2),
      recCreditLine: v.recCreditLine ?? null,
      groupNum: v.groupNum ?? null,
      msicCode: text(v.msicCode),
      tin: text(v.tin),
      sstNo: text(v.sstNo),
      // Rows left without a name (e.g. the form's empty in-charge rows) aren't saved
      contacts: contacts
        .filter((c) => c.name.trim())
        .map(({ key: _key, ...c }) => ({ ...c, name: c.name.trim(), roleDesc: c.role === 'OTHERS' ? text(c.roleDesc) : null, tel: text(c.tel), email: text(c.email) })),
      addresses: addresses.map(({ key: _key, ...a }) => a),
    };
    setSaving(true);
    try {
      if (isNew) {
        const res = await customerConversionsAPI.create(payload);
        if (res.success) {
          // Files chosen before the first Save are attached now that the document exists
          await attachmentsRef.current?.save(res.data.docEntry);
          message.success('Convert to customer saved as draft');
          router.replace(`${LIST_PATH}/${res.data.docEntry}`);
        }
      } else {
        const res = await customerConversionsAPI.update(docEntry, payload);
        if (res.success) {
          await attachmentsRef.current?.save(docEntry);
          message.success('Convert to customer updated');
          showConversion(res.data);
          setEditing(false);
        }
      }
    } catch (error) {
      message.error(errorText(error, 'Failed to save convert to customer'));
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
    call: () => Promise<{ success: boolean; data: CustomerConversion; message?: string }>,
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
  const runCall = async (title: string, call: () => Promise<{ success: boolean; data: CustomerConversion; message?: string }>, done: string) => {
    try {
      const res = await call();
      if (res.success) {
        // Confirm also posts it to SAP: a warning when SAP refused it (FAILED, to post again)
        if (title.startsWith('Confirm') && res.data?.postStatus === 'FAILED') message.warning(res.message ?? done, 10);
        else message.success(res.message || done);
        showConversion(res.data);
      }
    } catch (error) {
      message.error({ content: errorText(error, `Failed: ${title}`), duration: 8 });
    }
  };

  // Its No. is the SAP BP Code (an Update Customer: BP Code-2, -3, ...), so nothing to key in here
  const handleConfirm = () =>
    runAction(
      isUpdate ? 'Confirm Update Customer' : 'Confirm Convert to Customer',
      isUpdate
        ? `The application form is checked, then customer ${conversion?.cardCode ?? ''} is updated in SAP (or it is sent for approval first). Continue?`
        : 'The application form and the SAP BP Code are checked, then the SAP BP Code becomes its No. and the customer is created in SAP (or it is sent for approval first). Continue?',
      'Confirm',
      false,
      () => customerConversionsAPI.confirm(docEntry as number),
      'Convert to customer confirmed'
    );

  // Update Customer: a new draft filled from this customer's latest posted one, opened in edit mode (or the update
  // already on its way, opened as it is)
  const handleUpdateCustomer = () => {
    void (async () => {
      try {
        const res = await customerConversionsAPI.updateCustomer(docEntry as number);
        if (res.success) {
          if (res.data.existing) message.info(res.message ?? 'An update of this customer is already on its way');
          router.push(`${LIST_PATH}/${res.data.docEntry}${res.data.existing ? '' : '?edit=1'}`);
        }
      } catch (error) {
        message.error({ content: errorText(error, 'Failed to start Update Customer'), duration: 8 });
      }
    })();
  };

  const handleCancelDoc = () =>
    runAction(
      'Cancel Convert to Customer',
      "Cancel this convert to customer? It can't be changed or confirmed afterwards; the lead can be converted again with a new one.",
      'Cancel Doc',
      true,
      () => customerConversionsAPI.cancel(docEntry as number),
      'Convert to customer cancelled'
    );

  // Post to SAP again after it FAILED: asked first, then posted behind the LOADING overlay. SAP's refusal leaves it
  // FAILED with the reason in the Posting tab (it can then be corrected and posted again).
  const handlePostToSap = () => {
    modal.confirm({
      title: 'Post to SAP',
      content: isUpdate
        ? `Update customer ${conversion?.cardCode ?? ''} in SAP with this form? Once posted it can't be changed in the portal.`
        : `Create ${conversion?.leadName ?? 'the lead'} in SAP as customer ${conversion?.cardCode ?? ''}? Once posted it can't be changed in the portal.`,
      okText: 'Post',
      cancelText: 'No',
      onOk: () => {
        void (async () => {
          try {
            const res = await customerConversionsAPI.postToSap(docEntry as number);
            if (res.success) {
              if (res.data.posted) message.success(res.data.message);
              else message.error(res.data.message, 8);
              showConversion(res.data.conversion);
            }
          } catch (error) {
            message.error({ content: errorText(error, 'Failed to post to SAP'), duration: 8 });
          }
        })();
      },
    });
  };

  const handleDeleteContacts = () => {
    const ticked = contactsGridRef.current?.getSelectedRows() ?? [];
    if (ticked.length === 0) {
      message.warning('Tick the contacts to delete');
      return;
    }
    const keys = new Set(ticked.map((c) => c.key));
    setContacts((prev) => prev.filter((c) => !keys.has(c.key)));
  };

  const handleDeleteAddresses = () => {
    const ticked = addressesGridRef.current?.getSelectedRows() ?? [];
    if (ticked.length === 0) {
      message.warning('Tick the addresses to delete');
      return;
    }
    const keys = new Set(ticked.map((a) => a.key));
    setAddresses((prev) => withOneDefault(prev.filter((a) => !keys.has(a.key))));
  };

  // A new address: Bill To while there is none, else Ship To
  const handleNewAddress = () => {
    const adresType = addresses.some((a) => a.adresType === 'B') ? 'S' : 'B';
    const [row] = toAddressRows([
      { lineNum: null, adresType, address: '', street: null, streetNo: null, block: null, city: null, zipCode: null, state: null, country: null, deliveryZone: null, isDefault: false },
    ]);
    setOpenAddress({ row, isNew: true });
  };

  // OK in the popup: the address is added / replaced; Default ticked moves the type's default to it
  const handleAddressOk = (row: AddressRow) => {
    const id = row.address.toLowerCase();
    if (addresses.some((a) => a.key !== row.key && a.adresType === row.adresType && a.address.toLowerCase() === id)) {
      message.error(`${addressTypeLabel(row.adresType)} Address ID "${row.address}" is already used`);
      return;
    }
    setAddresses((prev) => {
      const others = prev.map((a) => (row.isDefault && a.adresType === row.adresType && a.key !== row.key ? { ...a, isDefault: false } : a));
      const next = openAddress?.isNew ? [...others, row] : others.map((a) => (a.key === row.key ? row : a));
      return withOneDefault(next);
    });
    setOpenAddress(null);
  };

  const countryName = (code: string | null | undefined) => lists.countries.find((c) => c.code === code)?.name ?? code ?? '';
  const stateName = (country: string | null | undefined, code: string | null | undefined) =>
    lists.states.find((s) => s.country === country && s.code === code)?.name ?? code ?? '';

  const addressColumns = useMemo<ColDef<AddressRow>[]>(
    () => [
      // Edit mode: the row's button opens it in the popup; view mode: clicking the row does
      ...(editing
        ? [
            {
              colId: 'openAddress',
              headerName: '',
              width: 30,
              sortable: false,
              resizable: false,
              filter: false,
              suppressAutoSize: true,
              cellStyle: { padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' },
              cellRenderer: (p: ICellRendererParams<AddressRow>) =>
                p.data ? rowButton('Edit address', <EditOutlined />, () => setOpenAddress({ row: p.data as AddressRow, isNew: false })) : null,
            } as ColDef<AddressRow>,
          ]
        : []),
      { colId: 'adresType', headerName: 'Type', valueGetter: (p) => (p.data ? addressTypeLabel(p.data.adresType) : '') },
      { field: 'address', headerName: 'Address ID' },
      { field: 'street', headerName: 'Address Line 1' },
      { field: 'streetNo', headerName: 'Address Line 2' },
      { field: 'block', headerName: 'Address Line 3' },
      { field: 'city', headerName: 'Address Line 4' },
      { field: 'zipCode', headerName: 'Postcode' },
      {
        colId: 'deliveryZone',
        headerName: 'Delivery Zone',
        valueGetter: (p) => {
          const zone = lists.deliveryZones.find((z) => z.code === p.data?.deliveryZone);
          return zone ? deliveryZoneLabel(zone) : p.data?.deliveryZone ?? '';
        },
      },
      { colId: 'state', headerName: 'State', valueGetter: (p) => (p.data ? stateName(p.data.country, p.data.state) : '') },
      { colId: 'country', headerName: 'Country', valueGetter: (p) => (p.data ? countryName(p.data.country) : '') },
      { colId: 'isDefault', headerName: 'Default', valueGetter: (p) => (p.data?.isDefault ? 'Yes' : '') },
    ],
    [editing, lists]
  );

  const contactColumns = useMemo<ColDef<ContactRow>[]>(
    () => [
      {
        colId: 'role',
        headerName: 'Role',
        valueGetter: (p) => (p.data ? roleLabel(p.data.role) : ''),
        valueSetter: (p) => {
          if (!p.data) return false;
          p.data.role = roleValue(String(p.newValue));
          if (p.data.role !== 'OTHERS') p.data.roleDesc = null;
          return true;
        },
        editable: editing,
        cellEditor: 'agSelectCellEditor',
        cellEditorParams: { values: CONTACT_ROLES.map((r) => r.label) },
      },
      // The form's "Others (Pls mention)"
      { field: 'roleDesc', headerName: 'Department (Others)', editable: (p) => editing && p.data?.role === 'OTHERS' },
      { field: 'name', headerName: 'Name', editable: editing },
      {
        field: 'tel',
        headerName: 'Contact No.',
        editable: editing,
        // Account Dept's contact no. is required on Confirm (e-invoice)
        cellStyle: (p) => (editing && p.data?.role === 'ACCOUNT' && !p.data.tel ? { background: '#fff4f4' } : null),
      },
      { field: 'email', headerName: 'E-mail', editable: editing },
    ],
    [editing]
  );

  if (loading) {
    // The portal's own loading overlay (LOADING... bar) shows while the data is fetched; nothing else is drawn meanwhile
    return null;
  }

  if (!isNew && !conversion) return null;

  // Button order: New, Edit, then the rest
  const toolbar = editing ? (
    <>
      <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={() => form.submit()}>
        Save
      </Button>
      <Button disabled={saving} onClick={handleCancelEdit}>Cancel</Button>
      {/* The lead is fixed once confirmed, and on an Update Customer */}
      {isDraft && !isUpdate && (
        <Button icon={<CopyOutlined />} disabled={saving} onClick={() => setCopyFromOpen(true)}>
          Copy From Lead
        </Button>
      )}
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
      {status === STATUS_OPEN && POSTABLE_APPR_STATUSES.includes(conversion?.apprStatus ?? '') && !synced && canChange && (
        <Button icon={<CloudUploadOutlined />} onClick={handlePostToSap}>
          Post to SAP
        </Button>
      )}
      {/* Also while waiting for approval; not once synced to SAP */}
      {(isDraft || status === STATUS_OPEN) && !synced && canChange && (
        <Button danger icon={<CloseCircleOutlined />} onClick={handleCancelDoc}>
          Cancel Doc
        </Button>
      )}
      {/* Posted to SAP: change the customer's details through a new document and approval */}
      {synced && conversion?.postStatus === 'SUCCESS' && status !== 'CANCELED' && canChange && (
        <Button icon={<EditOutlined />} onClick={handleUpdateCustomer}>
          Update Customer
        </Button>
      )}
      {/* Last: the lead it converts (also on a Read Only screen) */}
      {!isNew && (
        <Button icon={<ApartmentOutlined />} onClick={() => setMapOpen(true)}>
          Relationship Map
        </Button>
      )}
    </>
  );

  // The box shows the series code (as in SAP B1); the drop-down list shows code and name. Only active series
  // are offered; a confirmed one shows its own series even if it was made inactive since.
  const seriesOptions = seriesList
    .filter((s) => s.active)
    .map((s) => ({ value: s.docEntry, label: s.series, listLabel: [s.series, s.seriesName].filter(Boolean).join(' - ') }));

  /** A text row: a textbox in edit mode, plain text in view mode. `star`: one of the form's * fields (needed on Confirm) */
  const textRow = (label: string, name: keyof ConversionFormValues, max: number, star = false, multiline = false) => (
    <Form.Item label={label} name={name} required={star} rules={[{ max, message: `Maximum ${max} characters` }]}>
      {editing ? multiline ? <Input.TextArea rows={2} maxLength={max} /> : <Input maxLength={max} /> : <ReadOnlyText multiline={multiline} />}
    </Form.Item>
  );

  const contactsToolbar = editing ? (
    <>
      <Button
        size="small"
        icon={<PlusOutlined />}
        onClick={() => setContacts((prev) => [...prev, ...toContactRows([{ role: 'OTHERS', roleDesc: null, name: '', tel: null, email: null }])])}
      >
        New
      </Button>
      <Button size="small" icon={<DeleteOutlined />} onClick={handleDeleteContacts}>
        Delete
      </Button>
    </>
  ) : null;

  return (
    <Form form={form} {...detailFormProps(editing, LABEL_WIDTH)} onFinish={handleSave}>
      <DetailView
        toolbar={toolbar}
        title={`${isUpdate ? 'Update Customer' : 'Convert to Customer'} - ${isNew ? 'New' : conversion?.docNum ?? 'Draft'}`}
        // Status / Approval Status / Date close beside the rows, lined up with the tabs' right-hand column
        sideClose
        // Right column, as in SAP B1: the statuses
        sideFields={
          <>
            <Form.Item label="Status">
              {editing ? <Input value={conversion?.docStatusName ?? status} disabled /> : <ReadOnlyText value={conversion?.docStatusName ?? status} />}
            </Form.Item>
            <Form.Item label="Approval Status">
              {editing ? (
                <Input value={conversion?.apprStatusName ?? conversion?.apprStatus ?? ''} disabled />
              ) : (
                <ReadOnlyText value={conversion?.apprStatusName ?? conversion?.apprStatus ?? ''} />
              )}
            </Form.Item>
            <Form.Item label="Date" name="docDate">
              {editing ? <DatePicker format={DATE_FORMAT} /> : <DisplayText text={conversion?.docDate ? dayjs(conversion.docDate).format(DATE_FORMAT) : ''} />}
            </Form.Item>
          </>
        }
        below={
          <>
            <Tabs
              type="card"
              items={[
                {
                  // The application form's company details (forceRender: its fields belong to the form even unopened)
                  key: 'general',
                  label: 'General',
                  forceRender: true,
                  children: (
                    <div className={`${detailStyles.tabPanel} ${detailStyles.pairPanel}`}>
                      <div className={detailStyles.pairColumns}>
                        <div className={detailStyles.fields}>
                          {textRow('E-mail', 'email', 100)}
                          {textRow('E-mail (E-invoice)', 'eInvEmail', 100, true)}
                          {textRow('Nature of Business', 'natureOfBiz', 254, true)}
                          {textRow('Main Products', 'mainProducts', 254)}
                          {textRow('Major Supplier a.', 'supplier1', 100)}
                          {textRow('Major Supplier b.', 'supplier2', 100)}
                        </div>
                        <div className={detailStyles.fields}>
                          <Form.Item label="MSIC Code" name="msicCode" required rules={[{ pattern: /^\d{5}$/, message: 'MSIC Code is 5 digits' }]}>
                            {editing ? <Input maxLength={5} /> : <ReadOnlyText />}
                          </Form.Item>
                          {textRow('Tax Identification No. (TIN)', 'tin', 20, true)}
                          {textRow('SST No', 'sstNo', 30)}
                          <Form.Item label="Recommended Credit Limit" name="recCreditLine">
                            {editing ? <InputNumber controls={false} min={0} precision={2} /> : <DisplayText text={money(conversion?.recCreditLine)} />}
                          </Form.Item>
                          <Form.Item label="Credit Term" name="groupNum">
                            {editing ? (
                              <Select
                                allowClear
                                showSearch
                                optionFilterProp="label"
                                placeholder="Select a payment term"
                                options={lists.paymentTerms.map((t) => ({ value: t.groupNum, label: t.pymntGroup }))}
                              />
                            ) : (
                              <DisplayText text={conversion?.pymntGroup ?? ''} />
                            )}
                          </Form.Item>
                          {/* The customer's credit limit in SAP */}
                          <Form.Item label="Approved Credit Limit" name="creditLine">
                            {editing ? <InputNumber controls={false} min={0} precision={2} /> : <DisplayText text={money(conversion?.creditLine)} />}
                          </Form.Item>
                        </div>
                      </div>
                    </div>
                  ),
                },
                {
                  // Bill To / Ship To addresses with their Address IDs, as SAP B1; the default Bill To is required on Confirm
                  key: 'addresses',
                  label: `Addresses (${addresses.length})`,
                  children: (
                    <DataGrid<AddressRow>
                      settingsKey="conversion:addresses"
                      handleRef={addressesGridRef}
                      showToolbar
                      toolbar={
                        editing ? (
                          <>
                            <Button size="small" icon={<PlusOutlined />} onClick={handleNewAddress}>
                              New
                            </Button>
                            <Button size="small" icon={<DeleteOutlined />} onClick={handleDeleteAddresses}>
                              Delete
                            </Button>
                          </>
                        ) : null
                      }
                      selectable={editing}
                      onOpenRecord={editing ? undefined : (row) => setOpenAddress({ row, isNew: false })}
                      gridProps={{
                        rowData: addresses,
                        columnDefs: addressColumns,
                        getRowId: (p) => p.data.key,
                      }}
                    />
                  ),
                },
                {
                  // In-charge persons and directors; Account Dept's contact no. is required on Confirm
                  key: 'contacts',
                  // The form's 6. In-Charge Persons and 9. Full Name of Director / Boss
                  label: `Contacts / Directors (${contacts.filter((c) => c.name.trim()).length})`,
                  children: (
                    <DataGrid<ContactRow>
                      settingsKey="lead:contacts"
                      handleRef={contactsGridRef}
                      showToolbar
                      toolbar={contactsToolbar}
                      selectable={editing}
                      gridProps={{
                        rowData: contacts,
                        columnDefs: contactColumns,
                        getRowId: (p) => p.data.key,
                        suppressCellFocus: false,
                        singleClickEdit: true,
                        stopEditingWhenCellsLoseFocus: true,
                        onCellValueChanged: () => setContacts((prev) => [...prev]),
                      }}
                    />
                  ),
                },
                {
                  // Files (e.g. the signed application form); changes are applied on Save
                  key: 'attachments',
                  label: 'Attachments',
                  children: <AttachmentsTab handleRef={attachmentsRef} objType={OCRD_OBJTYPE} docEntry={docEntry} editing={editing} />,
                },
                {
                  // Posting to SAP B1: set by the posting, never typed, so always read-only
                  key: 'posting',
                  label: 'Posting',
                  children: (
                    <div className={detailStyles.tabPanel}>
                      <div className={detailStyles.fields}>
                        <Form.Item label="Posting Status">
                          <ReadOnlyText value={conversion?.postStatusName ?? conversion?.postStatus ?? ''} />
                        </Form.Item>
                        <Form.Item label="Error Description">
                          <ReadOnlyText value={conversion?.errorDesc ?? ''} multiline />
                        </Form.Item>
                      </div>
                    </div>
                  ),
                },
                // Approval history (FTS11WDD1); a new one has none. Loaded only when this tab is opened.
                ...(isNew
                  ? []
                  : [
                      {
                        key: 'approval',
                        label: 'Approval',
                        children: <ApprovalTab objType={OCRD_OBJTYPE} docEntry={docEntry as number} refreshKey={approval.refreshKey} />,
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
              disabled={!isDraft}
              options={seriesOptions}
              optionRender={(o) => (o.data as { listLabel: string }).listLabel}
              notFoundContent="No active Convert to Customer series — add one in Document Numbering"
            />
          ) : (
            <DisplayText text={conversion?.seriesCode ?? ''} />
          )}
        </Form.Item>
        {/* No No. field: the No. is the SAP BP Code (kept as the document's No. on Save) */}
        {/* The lead converted: never chosen here, only through Copy From Lead (or the Lead's Copy To) */}
        {/* Shows the lead's code and name as soon as it is read (no wait for a list of leads) */}
        <Form.Item label="Lead" required={editing}>
          <Form.Item name="leadEntry" noStyle rules={[{ required: true, message: 'Use Copy From Lead to choose the lead to convert' }]}>
            <Input type="hidden" />
          </Form.Item>
          {editing ? (
            <Input disabled value={leadLabel} placeholder={leadLoading ? 'Loading the lead...' : 'Use Copy From Lead'} />
          ) : (
            <DisplayText text={leadLabel} />
          )}
        </Form.Item>
        {/* The lead's currency: the customer is created in it in SAP (set on the Lead; Update Customer keeps it) */}
        <Form.Item label="Currency">
          {editing ? <Input disabled value={leadCurrency} /> : <DisplayText text={leadCurrency} />}
        </Form.Item>
        <Form.Item
          label="Company Name"
          name="leadName"
          rules={[
            { required: true, whitespace: true, message: 'Company Name is required' },
            { max: 100, message: 'Maximum 100 characters' },
          ]}
        >
          {editing ? <Input /> : <ReadOnlyText />}
        </Form.Item>
        {/* The Business Partner code the customer gets in SAP B1: required on Confirm, checked to be free */}
        <Form.Item label="SAP BP Code" name="cardCode" required rules={[{ max: 15, message: 'Maximum 15 characters' }]}>
          {/* An Update Customer changes this existing business partner: fixed */}
          {editing ? <Input maxLength={15} disabled={isUpdate} /> : <ReadOnlyText />}
        </Form.Item>
        {/* Update Customer: the conversion it was filled from (a click opens it) */}
        {isUpdate && (
          <Form.Item label="Updates">
            <span style={{ paddingLeft: 8 }}>
              <a onClick={() => router.push(`${LIST_PATH}/${conversion?.baseEntry}`)}>Convert to Customer {conversion?.baseDocNum ?? ''}</a>
            </span>
          </Form.Item>
        )}
        {/* The SAP customer group the business partner goes in: required on Confirm */}
        <Form.Item label="BP Group" name="groupCode" required>
          {editing ? (
            <Select
              showSearch
              optionFilterProp="label"
              placeholder="Select a BP group"
              options={lists.customerGroups.map((g) => ({ value: g.groupCode, label: g.groupName }))}
            />
          ) : (
            <DisplayText text={conversion?.groupName ?? ''} />
          )}
        </Form.Item>
        {textRow('Company Register No', 'regNo', 50, true)}
        <Form.Item label="Year in Business" name="yearsInBiz">
          {editing ? <InputNumber controls={false} min={0} precision={0} /> : <ReadOnlyText />}
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
            <DisplayText text={conversion?.slpName ?? ''} />
          )}
        </Form.Item>
      </DetailView>

      {/* Copy From Lead: pick an OPEN lead that isn't a customer yet; the form is filled from it */}
      <LookupListView<Lead>
        open={copyFromOpen}
        title="Copy From Lead"
        searchPlaceholder="Search leads..."
        columnDefs={leadLookupColumns}
        loadRows={async () => {
          const res = await leadsAPI.getList();
          if (!res.success) return [];
          return res.data.filter((l) => l.docStatus === STATUS_OPEN && !l.cardCode);
        }}
        getKey={(l) => l.docEntry}
        excludeKeys={[]}
        singleSelect
        onCancel={() => setCopyFromOpen(false)}
        onSelect={(picked) => {
          setCopyFromOpen(false);
          if (picked[0]) void fillFromLead(picked[0].docEntry);
        }}
      />
      {/* One address in a popup: changed in edit mode, read-only in view mode */}
      <ConversionAddressDetail<AddressRow>
        address={openAddress?.row ?? null}
        isNew={!!openAddress?.isNew}
        editable={editing}
        lists={lists}
        onOk={handleAddressOk}
        onCancel={() => setOpenAddress(null)}
      />
      {printModals}
      {!isNew && <RelationshipMap open={mapOpen} objType={OCRD_OBJTYPE} docEntry={docEntry as number} onClose={() => setMapOpen(false)} />}
    </Form>
  );
}

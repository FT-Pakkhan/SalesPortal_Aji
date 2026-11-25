'use client';

import React, { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { App, Button, Form, Input, Select, Tabs } from 'antd';
import { EditOutlined, EnvironmentOutlined, LogoutOutlined, PlusOutlined, PrinterOutlined, SaveOutlined, SearchOutlined } from '@ant-design/icons';
import { usePrintDocument } from '@/components/ui/usePrintDocument';
import type { ColDef } from 'ag-grid-community';
import dayjs from 'dayjs';
import { useRouter } from 'next/navigation';
import { salesCheckInsAPI, documentNumberingAPI, sapAPI, usersAPI } from '@/lib/apiClient';
import { useCanChange } from '@/stores/accessStore';
import { getCurrentLocation } from '@/lib/gps';
import { useAuthStore } from '@/stores/authStore';
import { DetailView, DisplayText, ReadOnlyText, detailFormProps } from '@/components/ui/DetailView';
import detailStyles from '@/components/ui/DetailView.module.css';
import { LookupListView } from '@/components/ui/LookupListView';
import { formatDuration } from './checkInFormat';
import type { SalesCheckIn, NumberingSeries, SapCustomer } from '@/types';

// Leaflet only runs in the browser
const CheckInMap = dynamic(() => import('./CheckInMap'), { ssr: false });

/** Document type (FTS_vw_ObjType.Code); its numbering series are kept under it */
const SCIN_OBJTYPE = 'FTS11SCIN';
const STATUS_OPEN = 'OPEN';
const LIST_PATH = '/sales-check-ins';

interface SalesCheckInDetailProps {
  /** Omit for a new visit (Check In) */
  docEntry?: number;
  /** Open an existing visit directly in edit mode (list view's Edit button) */
  startInEdit?: boolean;
}

interface VisitFormValues {
  series: number | null;
  cardCode: string;
  cardName: string;
  purpose: string;
  comments: string;
}

const toFormValues = (v: SalesCheckIn): VisitFormValues => ({
  series: v.series,
  cardCode: v.cardCode,
  cardName: v.cardName ?? '',
  purpose: v.purpose,
  comments: v.comments ?? '',
});

const formatTime = (value: string | null | undefined) => (value ? dayjs(value).format('DD.MM.YY HH:mm') : '');

/** "3.139012, 101.686855 (± 12 m)" */
const formatGps = (lat: number | null, lng: number | null, accuracy: number | null) =>
  lat == null || lng == null
    ? ''
    : `${Number(lat).toFixed(6)}, ${Number(lng).toFixed(6)}${accuracy != null ? ` (± ${Math.round(Number(accuracy))} m)` : ''}`;

const customerColumns: ColDef<SapCustomer>[] = [
  { field: 'cardCode', headerName: 'Customer Code', width: 180, sort: 'asc' },
  { field: 'cardName', headerName: 'Customer Name', flex: 1, minWidth: 220 },
];

/**
 * Sales Check In (FTS11SCIN): New = choose series and customer, key in the purpose, then Check In — the visit is
 * saved with its No., the time and the user's GPS location. Check Out records the time and location again.
 * Only the user who checked in can Check Out or Edit (Purpose / Remarks); times and locations are never typed.
 */
export default function SalesCheckInDetail({ docEntry, startInEdit = false }: SalesCheckInDetailProps) {
  const isNew = docEntry === undefined;
  const { message, modal } = App.useApp();
  // Read Only screen (the user's roles): no New / Edit / Check Out
  const canChange = useCanChange();
  const router = useRouter();
  const authUser = useAuthStore((s) => s.user);
  // Print (Crystal Reports layouts, System Initialization > Layouts): only when Sales Check In has an active one
  const [visit, setVisit] = useState<SalesCheckIn | null>(null);
  const { canPrint, print, modals: printModals } = usePrintDocument(SCIN_OBJTYPE, docEntry, 'Sales Check In', visit?.docNum);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(isNew || startInEdit);
  const [seriesList, setSeriesList] = useState<NumberingSeries[]>([]);
  const [customerLookupOpen, setCustomerLookupOpen] = useState(false);
  // The logged-in user's Sales Employee: the visit is made for it (none = can't check in)
  const [mySalesEmployee, setMySalesEmployee] = useState<{ slpCode: number | null; slpName: string | null } | null>(null);
  const [form] = Form.useForm<VisitFormValues>();

  useEffect(() => {
    if (!isNew) return;
    // Sales Check In series (Document Numbering); starts with the one ticked Default
    documentNumberingAPI
      .getList(SCIN_OBJTYPE)
      .then((res) => {
        if (!res.success) return;
        setSeriesList(res.data);
        const defaultSeries = res.data.find((s) => s.isDefault && s.active) ?? res.data.find((s) => s.active);
        if (defaultSeries && !form.getFieldValue('series')) form.setFieldsValue({ series: defaultSeries.docEntry });
      })
      .catch(() => message.error('Failed to load numbering series'));
    if (authUser?.id) {
      usersAPI
        .getById(authUser.id)
        .then((res) => res.success && setMySalesEmployee({ slpCode: res.data.slpCode, slpName: res.data.slpName ?? null }))
        .catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    if (isNew) return;
    salesCheckInsAPI
      .getById(docEntry)
      .then((res) => res.success && setVisit(res.data))
      .catch(() => {
        message.error('Failed to load sales check-in');
        router.push(LIST_PATH);
      })
      .finally(() => setLoading(false));
  }, [docEntry]);

  // Fill the form once it is on screen (it isn't rendered while loading)
  useEffect(() => {
    if (!loading && visit) form.setFieldsValue(toFormValues(visit));
  }, [loading]);

  const showVisit = (v: SalesCheckIn) => {
    setVisit(v);
    form.setFieldsValue(toFormValues(v));
  };

  const errorText = (error: unknown, fallback: string) =>
    (error as { response?: { data?: { error?: string } } }).response?.data?.error ||
    (error instanceof Error && !(error as { isAxiosError?: boolean }).isAxiosError ? error.message : '') ||
    fallback;

  // Edit / Check Out: my own visit, on a screen I have Full access to
  const isMine = !!visit && visit.userID === authUser?.id && canChange;
  const isOpen = visit?.docStatus === STATUS_OPEN;

  // Check In: the form first, then the location (the browser may ask permission), then the visit is saved
  const handleCheckIn = async (values: VisitFormValues) => {
    setSaving(true);
    try {
      const location = await getCurrentLocation();
      const res = await salesCheckInsAPI.checkIn({
        series: values.series as number,
        cardCode: values.cardCode,
        cardName: values.cardName || null,
        purpose: values.purpose,
        comments: values.comments || null,
        location,
      });
      if (res.success) {
        message.success(res.message || 'Checked in');
        router.replace(`${LIST_PATH}/${res.data.docEntry}`);
      }
    } catch (error) {
      message.error({ content: errorText(error, 'Failed to check in'), duration: 6 });
    } finally {
      setSaving(false);
    }
  };

  // Edit: Purpose and Remarks only
  const handleSave = async (values: VisitFormValues) => {
    setSaving(true);
    try {
      const res = await salesCheckInsAPI.update(docEntry as number, { purpose: values.purpose, comments: values.comments || null });
      if (res.success) {
        message.success('Sales check-in updated');
        showVisit(res.data);
        setEditing(false);
      }
    } catch (error) {
      message.error(errorText(error, 'Failed to save sales check-in'));
    } finally {
      setSaving(false);
    }
  };

  const handleFinish = (values: VisitFormValues) => (isNew ? handleCheckIn(values) : handleSave(values));

  // Check Out: asked first; the popup closes at once and the work runs behind the portal's LOADING overlay
  const handleCheckOut = () => {
    modal.confirm({
      title: 'Check Out',
      content: 'Check out of this visit now? Your current location and the time will be recorded.',
      okText: 'Check Out',
      cancelText: 'No',
      onOk: () => {
        void (async () => {
          try {
            const location = await getCurrentLocation();
            const res = await salesCheckInsAPI.checkOut(docEntry as number, location);
            if (res.success) {
              message.success(`Checked out: ${formatDuration(res.data.duration)}`);
              showVisit(res.data);
            }
          } catch (error) {
            message.error({ content: errorText(error, 'Failed to check out'), duration: 6 });
          }
        })();
      },
    });
  };

  const handleCancelEdit = () => {
    if (isNew) {
      router.push(LIST_PATH);
      return;
    }
    form.resetFields();
    if (visit) form.setFieldsValue(toFormValues(visit));
    setEditing(false);
  };

  if (loading) return null;
  if (!isNew && !visit) return null;

  // Button order: New, Edit, then the rest
  const toolbar = editing ? (
    <>
      <Button type="primary" icon={isNew ? <EnvironmentOutlined /> : <SaveOutlined />} loading={saving} onClick={() => form.submit()}>
        {isNew ? 'Check In' : 'Save'}
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
      {isMine && (
        <Button icon={<EditOutlined />} onClick={() => setEditing(true)}>
          Edit
        </Button>
      )}
      {!isNew && canPrint && (
        <Button icon={<PrinterOutlined />} onClick={print}>
          Print
        </Button>
      )}
      {isMine && isOpen && (
        <Button icon={<LogoutOutlined />} onClick={handleCheckOut}>
          Check Out
        </Button>
      )}
    </>
  );

  const seriesOptions = seriesList
    .filter((s) => s.active)
    .map((s) => ({ value: s.docEntry, label: s.series, listLabel: [s.series, s.seriesName].filter(Boolean).join(' - ') }));

  const salesEmployee = isNew ? mySalesEmployee?.slpName ?? '' : visit?.slpName ?? '';
  const greyed = (value: string) => (editing ? <Input value={value} disabled /> : <ReadOnlyText value={value} />);

  return (
    <>
      <Form form={form} {...detailFormProps(editing)} onFinish={handleFinish}>
        <DetailView
          toolbar={toolbar}
          title={`Sales Check In - ${isNew ? 'New' : visit?.docNum}`}
          // Right column, as in SAP B1: status and times (set by Check In / Check Out, never typed)
          sideFields={
            <>
              <Form.Item label="Status">{greyed(isNew ? '' : visit?.docStatusName ?? visit?.docStatus ?? '')}</Form.Item>
              <Form.Item label="Check In">{greyed(formatTime(visit?.checkInTime))}</Form.Item>
              <Form.Item label="Check Out">{greyed(formatTime(visit?.checkOutTime))}</Form.Item>
              <Form.Item label="Duration">{greyed(formatDuration(visit?.duration))}</Form.Item>
              <Form.Item label="Visited By">{greyed(isNew ? authUser?.userName ?? '' : visit?.userDisplayName || visit?.userName || '')}</Form.Item>
            </>
          }
          below={
            isNew ? (
              <div className={`${detailStyles.columns} ${detailStyles.footer}`}>
                <div className={detailStyles.fields}>
                  <Form.Item label="Remarks" name="comments" rules={[{ max: 254, message: 'Maximum 254 characters' }]}>
                    <Input.TextArea rows={3} maxLength={254} />
                  </Form.Item>
                </div>
              </div>
            ) : (
              <>
                <Tabs
                  type="card"
                  items={[
                    {
                      // Where the user checked in / out: the map, the addresses and the GPS readings
                      key: 'location',
                      label: 'Location',
                      children: (
                        <div className={detailStyles.tabPanel}>
                          <div className={detailStyles.fields}>
                            <Form.Item label="Check In Address">
                              <ReadOnlyText value={visit?.checkInAddress ?? ''} multiline />
                            </Form.Item>
                            <Form.Item label="Check In GPS">
                              <ReadOnlyText value={formatGps(visit!.checkInLat, visit!.checkInLng, visit!.checkInAccuracy)} />
                            </Form.Item>
                            <Form.Item label="Check Out Address">
                              <ReadOnlyText value={visit?.checkOutAddress ?? ''} multiline />
                            </Form.Item>
                            <Form.Item label="Check Out GPS">
                              <ReadOnlyText value={formatGps(visit!.checkOutLat, visit!.checkOutLng, visit!.checkOutAccuracy)} />
                            </Form.Item>
                          </div>
                          <CheckInMap visits={[visit!]} height={340} />
                        </div>
                      ),
                    },
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
            )
          }
        >
          {/* The No. is taken from it on Check In */}
          <Form.Item label="Series" name="series" rules={[{ required: true, message: 'Series is required' }]}>
            {isNew ? (
              <Select
                placeholder="Select a series"
                options={seriesOptions}
                optionRender={(o) => (o.data as { listLabel: string }).listLabel}
                notFoundContent="No active Sales Check In series — add one in Document Numbering"
              />
            ) : editing ? (
              <Input value={visit?.seriesCode ?? ''} disabled />
            ) : (
              <DisplayText text={visit?.seriesCode ?? ''} />
            )}
          </Form.Item>
          <Form.Item label="No.">
            {isNew ? <Input placeholder="On check in" disabled /> : greyed(visit?.docNum ?? '')}
          </Form.Item>
          <Form.Item label="Customer" name="cardCode" rules={[{ required: true, message: 'Customer is required' }]}>
            {isNew ? (
              // Chosen from the SAP customer list, not typed
              <Input
                readOnly
                placeholder="Click to choose a customer"
                onClick={() => setCustomerLookupOpen(true)}
                suffix={<SearchOutlined onClick={() => setCustomerLookupOpen(true)} style={{ cursor: 'pointer' }} />}
              />
            ) : editing ? (
              <Input disabled />
            ) : (
              <ReadOnlyText />
            )}
          </Form.Item>
          <Form.Item label="Name" name="cardName">
            {isNew ? <Input disabled /> : editing ? <Input disabled /> : <ReadOnlyText />}
          </Form.Item>
          {/* The visiting user's Sales Employee (Users > Sales Employee) — never chosen here */}
          <Form.Item label="Sales Employee">{greyed(salesEmployee)}</Form.Item>
          <Form.Item
            label="Purpose of Visit"
            name="purpose"
            rules={[
              { required: true, whitespace: true, message: 'Purpose of Visit is required' },
              { max: 254, message: 'Maximum 254 characters' },
            ]}
          >
            {editing ? <Input.TextArea rows={2} maxLength={254} /> : <ReadOnlyText multiline />}
          </Form.Item>
        </DetailView>
      </Form>

      {printModals}

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
          if (picked[0]) form.setFieldsValue({ cardCode: picked[0].cardCode, cardName: picked[0].cardName });
        }}
      />
    </>
  );
}

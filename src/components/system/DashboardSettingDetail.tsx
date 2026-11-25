'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { App, Button, Checkbox, Form, Input, InputNumber, Select, Tabs } from 'antd';
import { EditOutlined, MinusCircleOutlined, PlayCircleOutlined, PlusOutlined, SaveOutlined } from '@ant-design/icons';
import type { ColDef } from 'ag-grid-community';
import { useRouter } from 'next/navigation';
import { dashboardSettingsAPI, rolesAPI } from '@/lib/apiClient';
import { SCREENS } from '@/lib/screens';
import { useCanChange } from '@/stores/accessStore';
import { DetailView, ReadOnlyText, detailFormProps } from '@/components/ui/DetailView';
import detailStyles from '@/components/ui/DetailView.module.css';
import { DataGrid } from '@/components/ui/DataGrid';
import type { DataGridHandle } from '@/components/ui/DataGrid';
import { LookupListView } from '@/components/ui/LookupListView';
import { WidgetView } from '@/components/dashboard/WidgetView';
import type { DashboardWidgetData, DashboardWidgetSettingDetail, ReportRole, Role, WidgetType, WidgetValueFormat } from '@/types';

const LIST_PATH = '/system/dashboard-settings';

export const WIDGET_TYPE_OPTIONS: { value: WidgetType; label: string }[] = [
  { value: 'KPI', label: 'KPI (one figure)' },
  { value: 'BAR', label: 'Bar Chart' },
  { value: 'LINE', label: 'Line Chart' },
  { value: 'PIE', label: 'Pie Chart' },
  { value: 'TABLE', label: 'Table' },
];
export const WIDTH_OPTIONS = [
  { value: 1, label: 'Quarter Row' },
  { value: 2, label: 'Half Row' },
  { value: 4, label: 'Whole Row' },
];
export const VALUE_FORMAT_OPTIONS: { value: WidgetValueFormat; label: string }[] = [
  { value: 'NUMBER', label: 'Number' },
  { value: 'AMOUNT', label: 'Amount (2 decimals)' },
  { value: 'PERCENT', label: 'Percent' },
];
/** The pages a widget can open: the portal's screens */
const LINK_OPTIONS = SCREENS.map((s) => ({ value: s.path, label: `${s.name} (${s.path})` }));

/** What each widget type expects from its query */
const QUERY_SHAPE: Record<WidgetType, string> = {
  KPI: '1st column = the figure; optional 2nd column = the figure to compare with (e.g. last month), shown as up / down %.',
  BAR: '1st column = the label (e.g. month); every other column = a series of bars, named after the column.',
  LINE: '1st column = the label (e.g. month); every other column = a line, named after the column.',
  PIE: '1st column = the label; 2nd column = the value.',
  TABLE: 'The rows as returned (the first 50), with the column names as headers.',
};

interface WidgetFormValues {
  widgetCode: string;
  title: string;
  widgetType: WidgetType;
  width: number;
  sequence: number;
  valueFormat: WidgetValueFormat;
  linkPath: string | null;
  remarks: string;
  useSapConn: boolean;
  isActive: boolean;
  query: string;
}

const toFormValues = (w: DashboardWidgetSettingDetail): WidgetFormValues => ({
  widgetCode: w.widgetCode,
  title: w.title,
  widgetType: w.widgetType,
  width: w.width,
  sequence: w.sequence,
  valueFormat: w.valueFormat,
  linkPath: w.linkPath,
  remarks: w.remarks ?? '',
  useSapConn: w.useSapConn,
  isActive: w.isActive,
  query: w.query,
});

const labelOf = (options: { value: unknown; label: string }[], value: unknown) => options.find((o) => o.value === value)?.label ?? String(value ?? '');

interface DashboardSettingDetailProps {
  /** Omit to create a new widget */
  docEntry?: number;
  /** Open an existing widget directly in edit mode (list view's Edit button) */
  startInEdit?: boolean;
}

/**
 * Dashboard Settings (System Initialization): a Dashboard widget - its query and how it is shown (Query tab, with
 * Test Query and a preview as the Dashboard will show it), and the roles that see it (Roles tab; admin roles see all).
 * Opens in view mode.
 */
export default function DashboardSettingDetail({ docEntry, startInEdit = false }: DashboardSettingDetailProps) {
  const isNew = docEntry === undefined;
  const { message } = App.useApp();
  const router = useRouter();
  const canChange = useCanChange();
  const [widget, setWidget] = useState<DashboardWidgetSettingDetail | null>(null);
  const [roles, setRoles] = useState<ReportRole[]>([]);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(isNew || startInEdit);
  const [roleLookupOpen, setRoleLookupOpen] = useState(false);
  const [preview, setPreview] = useState<DashboardWidgetData | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [form] = Form.useForm<WidgetFormValues>();
  const rolesGridRef = useRef<DataGridHandle<ReportRole>>(null);
  const widgetType = (Form.useWatch('widgetType', form) ?? 'KPI') as WidgetType;
  const valueFormat = (Form.useWatch('valueFormat', form) ?? 'NUMBER') as WidgetValueFormat;
  const title = Form.useWatch('title', form) as string | undefined;
  const useSapConn = !!Form.useWatch('useSapConn', form);

  const showWidget = (w: DashboardWidgetSettingDetail) => {
    setWidget(w);
    setRoles(w.roles);
    form.setFieldsValue(toFormValues(w));
  };

  useEffect(() => {
    if (isNew) return;
    dashboardSettingsAPI
      .getById(docEntry)
      .then((res) => res.success && setWidget(res.data))
      .catch(() => {
        message.error('Failed to load widget');
        router.push(LIST_PATH);
      })
      .finally(() => setLoading(false));
  }, [docEntry]);

  // Fill the form once it is on screen (it isn't rendered while loading)
  useEffect(() => {
    if (!loading && widget) showWidget(widget);
  }, [loading]);

  const errorText = (error: unknown, fallback: string) =>
    (error as { response?: { data?: { error?: string } } }).response?.data?.error || fallback;

  const handleCancelEdit = () => {
    if (isNew) {
      router.push(LIST_PATH);
      return;
    }
    form.resetFields();
    if (widget) showWidget(widget);
    setEditing(false);
  };

  const handleSave = async (values: WidgetFormValues) => {
    if (!editing) return;
    const payload = {
      widgetCode: values.widgetCode,
      title: values.title,
      widgetType: values.widgetType,
      query: values.query,
      useSapConn: !!values.useSapConn,
      width: values.width,
      sequence: values.sequence ?? 0,
      valueFormat: values.valueFormat,
      linkPath: values.linkPath || null,
      remarks: values.remarks || null,
      isActive: !!values.isActive,
      roleIds: roles.map((r) => r.roleEntry),
    };
    setSaving(true);
    try {
      if (isNew) {
        const res = await dashboardSettingsAPI.create(payload);
        if (res.success) {
          message.success('Widget created');
          router.replace(`${LIST_PATH}/${res.data.docEntry}`);
        }
      } else {
        const res = await dashboardSettingsAPI.update(docEntry, payload);
        if (res.success) {
          message.success('Widget updated');
          showWidget(res.data);
          setEditing(false);
        }
      }
    } catch (error) {
      message.error(errorText(error, 'Failed to save widget'));
    } finally {
      setSaving(false);
    }
  };

  // Test Query: run the query as typed (with my @variables, rolled back) and show the widget as the Dashboard will
  const handleTestQuery = async () => {
    const query = String(form.getFieldValue('query') ?? '').trim();
    if (!query) {
      message.warning('Key in the Query first');
      return;
    }
    try {
      const res = await dashboardSettingsAPI.testQuery(query, form.getFieldValue('widgetType'), !!form.getFieldValue('useSapConn'));
      if (res.success) {
        setPreview(res.data);
        setPreviewError(null);
      }
    } catch (error) {
      setPreview(null);
      setPreviewError(errorText(error, 'The query failed'));
    }
  };

  const handleRemoveRoles = () => {
    const ticked = rolesGridRef.current?.getSelectedRows() ?? [];
    if (ticked.length === 0) {
      message.warning('Tick the roles to remove');
      return;
    }
    const ids = new Set(ticked.map((r) => r.roleEntry));
    setRoles((prev) => prev.filter((r) => !ids.has(r.roleEntry)));
  };

  const roleColumns = useMemo<ColDef<ReportRole>[]>(
    () => [
      { field: 'roleName', headerName: 'Role', sort: 'asc' },
      { field: 'isAdmin', headerName: 'Administrator', cellDataType: 'boolean' },
    ],
    []
  );
  const roleLookupColumns = useMemo<ColDef<Role>[]>(
    () => [
      { field: 'roleName', headerName: 'Role', sort: 'asc' },
      { field: 'isAdmin', headerName: 'Administrator', cellDataType: 'boolean' },
      { field: 'userCount', headerName: 'Users', cellDataType: 'number' },
    ],
    []
  );

  if (loading) return null;
  if (!isNew && !widget) return null;

  const toolbar = editing ? (
    <>
      <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={() => form.submit()}>
        Save
      </Button>
      <Button disabled={saving} onClick={handleCancelEdit}>
        Cancel
      </Button>
    </>
  ) : canChange ? (
    <>
      <Button type="primary" icon={<PlusOutlined />} onClick={() => router.push(`${LIST_PATH}/new`)}>
        New
      </Button>
      <Button icon={<EditOutlined />} onClick={() => setEditing(true)}>
        Edit
      </Button>
    </>
  ) : null;

  const greyedSelect = (options: { value: unknown; label: string }[]) => (value?: unknown) => <ReadOnlyText value={labelOf(options, value)} />;
  const ViewType = greyedSelect(WIDGET_TYPE_OPTIONS);
  const ViewWidth = greyedSelect(WIDTH_OPTIONS);
  const ViewFormat = greyedSelect(VALUE_FORMAT_OPTIONS);

  return (
    <>
      <Form
        form={form}
        {...detailFormProps(editing, 180)}
        initialValues={{ widgetType: 'KPI', width: 1, sequence: 0, valueFormat: 'NUMBER', isActive: true, useSapConn: true, linkPath: null }}
        onFinish={handleSave}
      >
        <DetailView
          toolbar={toolbar}
          title={`Dashboard Settings - ${isNew ? 'New' : widget?.title}`}
          sideFields={
            <>
              <Form.Item label="Width" name="width" rules={[{ required: true, message: 'Choose the Width' }]}>
                {editing ? <Select options={WIDTH_OPTIONS} /> : <ViewValue render={ViewWidth} />}
              </Form.Item>
              <Form.Item label="Sequence" name="sequence" tooltip="Position on the Dashboard: lower first">
                {editing ? <InputNumber min={0} max={9999} precision={0} controls={false} style={{ width: '100%' }} /> : <ReadOnlyText />}
              </Form.Item>
              <Form.Item label="Value Format" name="valueFormat">
                {editing ? <Select options={VALUE_FORMAT_OPTIONS} /> : <ViewValue render={ViewFormat} />}
              </Form.Item>
              {/* Ticked: the query runs in the SAP company database (SAP tables need no prefix) */}
              <Form.Item label="Use SAP DB Connection" name="useSapConn" valuePropName="checked">
                <Checkbox disabled={!editing} />
              </Form.Item>
              <Form.Item label="Active" name="isActive" valuePropName="checked">
                <Checkbox disabled={!editing} />
              </Form.Item>
            </>
          }
          below={
            <Tabs
              type="card"
              items={[
                {
                  key: 'query',
                  label: 'Query',
                  forceRender: true,
                  children: (
                    <div className={detailStyles.tabPanel}>
                      <div className={detailStyles.pairColumns}>
                        <div className={detailStyles.pairPanel}>
                          <Form.Item
                            label="Query"
                            name="query"
                            rules={[{ required: true, whitespace: true, message: 'Query is required' }]}
                            labelCol={{ flex: '0 0 0' }}
                            style={{ marginBottom: 8 }}
                          >
                            {editing ? (
                              <Input.TextArea rows={14} spellCheck={false} style={{ fontFamily: 'Consolas, monospace', fontSize: 12 }} />
                            ) : (
                              <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'Consolas, monospace', fontSize: 12 }}>{form.getFieldValue('query')}</pre>
                            )}
                          </Form.Item>
                          <div style={{ fontSize: 12, color: 'var(--sap-text-secondary)', lineHeight: 1.5 }}>
                            <div>
                              <b>{labelOf(WIDGET_TYPE_OPTIONS, widgetType)}:</b> {QUERY_SHAPE[widgetType]}
                            </div>
                            <div>
                              <b>Variables:</b> @UserID @UserName @SlpCode (the user&apos;s Sales Employee; empty for users without one) @Today
                              @MonthStart @YearStart. Write per-salesperson filters as <code>(@SlpCode IS NULL OR T0.SlpCode = @SlpCode)</code> so
                              users without a Sales Employee see everyone.
                            </div>
                            <div>
                              {useSapConn
                                ? 'Use SAP DB Connection is ticked: the query runs in the SAP company database (e.g. FROM OINV); portal tables need the portal database in front.'
                                : 'The query runs in the portal database: SAP tables need the company database in front, e.g. FROM SBODemoGB..OINV.'}
                            </div>
                          </div>
                        </div>
                        <div className={detailStyles.pairPanel}>
                          <div style={{ marginBottom: 8 }}>
                            <Button size="small" icon={<PlayCircleOutlined />} onClick={handleTestQuery}>
                              Test Query
                            </Button>
                            <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--sap-text-secondary)' }}>Preview with your own @variables</span>
                          </div>
                          {preview || previewError ? (
                            <WidgetView title={title || 'Preview'} widgetType={widgetType} valueFormat={valueFormat} data={preview} error={previewError} />
                          ) : (
                            <div style={{ color: 'var(--sap-text-secondary)', fontSize: 12 }}>Click Test Query to see the widget as the Dashboard shows it.</div>
                          )}
                        </div>
                      </div>
                    </div>
                  ),
                },
                {
                  key: 'roles',
                  label: `Roles (${roles.length})`,
                  children: (
                    <DataGrid<ReportRole>
                      settingsKey="dashboard-settings:roles"
                      handleRef={rolesGridRef}
                      showToolbar
                      toolbar={
                        editing ? (
                          <>
                            <Button size="small" icon={<PlusOutlined />} onClick={() => setRoleLookupOpen(true)}>
                              Add
                            </Button>
                            <Button size="small" icon={<MinusCircleOutlined />} onClick={handleRemoveRoles}>
                              Remove
                            </Button>
                          </>
                        ) : null
                      }
                      selectable={editing}
                      gridProps={{ rowData: roles, columnDefs: roleColumns, getRowId: (p) => String(p.data.roleEntry) }}
                    />
                  ),
                },
              ]}
            />
          }
        >
          <Form.Item
            label="Widget Code"
            name="widgetCode"
            rules={[
              { required: true, whitespace: true, message: 'Widget Code is required' },
              { max: 50, message: 'Maximum 50 characters' },
            ]}
          >
            {editing ? <Input placeholder="e.g. SALES-MTD" /> : <ReadOnlyText />}
          </Form.Item>
          <Form.Item
            label="Title"
            name="title"
            rules={[
              { required: true, whitespace: true, message: 'Title is required' },
              { max: 100, message: 'Maximum 100 characters' },
            ]}
          >
            {editing ? <Input placeholder="e.g. Sales This Month" /> : <ReadOnlyText />}
          </Form.Item>
          <Form.Item label="Widget Type" name="widgetType" rules={[{ required: true, message: 'Choose the Widget Type' }]}>
            {editing ? <Select options={WIDGET_TYPE_OPTIONS} /> : <ViewValue render={ViewType} />}
          </Form.Item>
          {/* Clicking the widget opens this page */}
          <Form.Item label="Link" name="linkPath">
            {editing ? (
              <Select allowClear showSearch optionFilterProp="label" options={LINK_OPTIONS} placeholder="Optional: the page the widget opens" />
            ) : (
              <ViewValue render={(v) => <ReadOnlyText value={v ? labelOf(LINK_OPTIONS, v) : ''} />} />
            )}
          </Form.Item>
          <Form.Item label="Remarks" name="remarks" rules={[{ max: 254, message: 'Maximum 254 characters' }]}>
            {editing ? <Input.TextArea rows={2} maxLength={254} placeholder="Shown as the widget's tooltip" /> : <ReadOnlyText multiline />}
          </Form.Item>
        </DetailView>
      </Form>

      <LookupListView<Role>
        open={roleLookupOpen}
        title="Add Role"
        searchPlaceholder="Search roles..."
        columnDefs={roleLookupColumns}
        loadRows={async () => {
          const res = await rolesAPI.getList();
          return res.success ? res.data : [];
        }}
        getKey={(r) => r.docEntry}
        excludeKeys={roles.map((r) => r.roleEntry)}
        onCancel={() => setRoleLookupOpen(false)}
        onSelect={(picked) => {
          setRoles((prev) => [...prev, ...picked.map((r) => ({ roleEntry: r.docEntry, roleName: r.roleName, isAdmin: r.isAdmin }))]);
          setRoleLookupOpen(false);
        }}
      />
    </>
  );
}

/** A Form.Item child that shows its value through `render` (view mode of a drop-down) */
function ViewValue({ value, render }: { value?: unknown; render: (value?: unknown) => React.ReactNode }) {
  return <>{render(value)}</>;
}

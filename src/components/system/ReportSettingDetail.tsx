'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { App, Button, Checkbox, Form, Input, Modal, Tabs } from 'antd';
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  DeleteOutlined,
  EditOutlined,
  FileSearchOutlined,
  MinusCircleOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  SaveOutlined,
} from '@ant-design/icons';
import type { ColDef } from 'ag-grid-community';
import { useRouter } from 'next/navigation';
import { reportSettingsAPI, rolesAPI } from '@/lib/apiClient';
import { useCanChange } from '@/stores/accessStore';
import { useReportMenuStore } from '@/stores/reportMenuStore';
import { DetailView, ReadOnlyText, detailFormProps } from '@/components/ui/DetailView';
import detailStyles from '@/components/ui/DetailView.module.css';
import { DataGrid } from '@/components/ui/DataGrid';
import type { DataGridHandle } from '@/components/ui/DataGrid';
import { LookupListView } from '@/components/ui/LookupListView';
import type {
  ReportInputType,
  ReportParam,
  ReportParamType,
  ReportRole,
  ReportSettingDetail as ReportDetailData,
  Role,
  RptParameter,
} from '@/types';

const LIST_PATH = '/system/report-settings';

interface ReportSettingDetailProps {
  /** Omit to create a new report */
  docEntry?: number;
  /** Open an existing report directly in edit mode (list view's Edit button) */
  startInEdit?: boolean;
}

interface ReportFormValues {
  reportCode: string;
  reportName: string;
  reportPath: string;
  category: string;
  remarks: string;
  isActive: boolean;
  useSapConn: boolean;
  emailAllowed: boolean;
  emailTo: string;
  emailCc: string;
  emailToQuery: string;
  emailSubject: string;
  emailBody: string;
  emailFileName: string;
}

/** A row of the Parameters tab (key: the grid's row id, also for rows not saved yet) */
type ParamRow = ReportParam & { key: string };

const PARAM_TYPES: { value: ReportParamType; label: string }[] = [
  { value: 'STRING', label: 'String' },
  { value: 'INTEGER', label: 'Integer' },
  { value: 'DECIMAL', label: 'Decimal' },
  { value: 'DATE', label: 'Date' },
  { value: 'DATETIME', label: 'Date & Time' },
  { value: 'BOOLEAN', label: 'Boolean' },
];
const INPUT_TYPES: { value: ReportInputType; label: string }[] = [
  { value: 'KEYIN', label: 'Key In' },
  { value: 'LIST', label: 'Choose from List' },
];
const typeLabel = (v: string) => PARAM_TYPES.find((t) => t.value === v)?.label ?? v;
const typeValue = (label: string) => PARAM_TYPES.find((t) => t.label === label)?.value ?? 'STRING';
const inputLabel = (v: string) => INPUT_TYPES.find((t) => t.value === v)?.label ?? v;
const inputValue = (label: string) => INPUT_TYPES.find((t) => t.label === label)?.value ?? 'KEYIN';

let keySeq = 0;
const newKey = () => `p${++keySeq}`;
const toRows = (params: ReportParam[]): ParamRow[] => params.map((p) => ({ ...p, key: newKey() }));

const toFormValues = (r: ReportDetailData): ReportFormValues => ({
  reportCode: r.reportCode,
  reportName: r.reportName,
  reportPath: r.reportPath,
  category: r.category ?? '',
  remarks: r.remarks ?? '',
  isActive: r.isActive,
  useSapConn: r.useSapConn,
  emailAllowed: r.emailAllowed,
  emailTo: r.emailTo ?? '',
  emailCc: r.emailCc ?? '',
  emailToQuery: r.emailToQuery ?? '',
  emailSubject: r.emailSubject ?? '',
  emailBody: r.emailBody ?? '',
  emailFileName: r.emailFileName ?? '',
});

/** SAP B1's display-only parameters (headings / separators on its selection screen): not used, need no value */
const isSapDisplayOnly = (p: RptParameter) => !p.inUse && /@\s*(title|separator)\s*$/i.test(p.name);

/**
 * A parameter read from the .rpt, as a new row. SAP B1 reports keep the list query in the name
 * ("Item@Select * from OITM"): such a parameter becomes Choose from List with that query (as it is when the report uses
 * the SAP DB connection; otherwise it runs in the portal database and SAP tables need SBODemoGB.. in front).
 */
const fromRpt = (p: RptParameter): ParamRow => {
  const [base, ...rest] = p.name.split('@');
  const sapQuery = rest.join('@').trim();
  const isQuery = /^\s*(select|with)\b/i.test(sapQuery);
  const caption = (p.prompt || base).replace(/\s*:\s*$/, '').trim() || base;
  return {
    key: newKey(),
    paramName: p.name,
    caption: caption.slice(0, 100),
    paramType: p.type,
    inputType: isQuery ? 'LIST' : 'KEYIN',
    query: isQuery ? sapQuery : null,
    allowMulti: p.multi && !p.range,
    isRange: p.range,
    mandatory: false,
    defaultValue: null,
  };
};

/**
 * Report Settings (System Initialization): a Crystal Reports file for the Reports module, the parameters the user
 * fills in before running it (Parameters tab) and the roles that may run it (Roles tab; admin roles run every report).
 * Opens in view mode.
 */
export default function ReportSettingDetail({ docEntry, startInEdit = false }: ReportSettingDetailProps) {
  const isNew = docEntry === undefined;
  const { message } = App.useApp();
  const router = useRouter();
  const canChange = useCanChange();
  const loadReports = useReportMenuStore((s) => s.loadReports);
  const [report, setReport] = useState<ReportDetailData | null>(null);
  const [params, setParams] = useState<ParamRow[]>([]);
  const [roles, setRoles] = useState<ReportRole[]>([]);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(isNew || startInEdit);
  const [roleLookupOpen, setRoleLookupOpen] = useState(false);
  const [queryResult, setQueryResult] = useState<{ title: string; columns: string[]; rows: Record<string, unknown>[] } | null>(null);
  // The Test Query popup has finished zooming in: its rows wait for that, as columns best-fitted mid-zoom come out too narrow
  const [queryOpened, setQueryOpened] = useState(false);
  const [form] = Form.useForm<ReportFormValues>();
  const paramsGridRef = useRef<DataGridHandle<ParamRow>>(null);
  const rolesGridRef = useRef<DataGridHandle<ReportRole>>(null);
  // Followed as ticked: the queries' hints show which database they run in
  const useSapConn = !!Form.useWatch('useSapConn', form);

  const showReport = (r: ReportDetailData) => {
    setReport(r);
    setParams(toRows(r.params));
    setRoles(r.roles);
    form.setFieldsValue(toFormValues(r));
  };

  useEffect(() => {
    if (isNew) return;
    reportSettingsAPI
      .getById(docEntry)
      .then((res) => res.success && setReport(res.data))
      .catch(() => {
        message.error('Failed to load report');
        router.push(LIST_PATH);
      })
      .finally(() => setLoading(false));
  }, [docEntry]);

  // Fill the form once it is on screen (it isn't rendered while loading)
  useEffect(() => {
    if (!loading && report) showReport(report);
  }, [loading]);

  const errorText = (error: unknown, fallback: string) =>
    (error as { response?: { data?: { error?: string } } }).response?.data?.error || fallback;

  const handleCancelEdit = () => {
    if (isNew) {
      router.push(LIST_PATH);
      return;
    }
    // Discard unsaved changes, including parameters and roles
    form.resetFields();
    if (report) showReport(report);
    setEditing(false);
  };

  const handleSave = async (values: ReportFormValues) => {
    if (!editing) return;
    const payload = {
      reportCode: values.reportCode,
      reportName: values.reportName,
      reportPath: values.reportPath,
      category: values.category || null,
      remarks: values.remarks || null,
      isActive: !!values.isActive,
      useSapConn: !!values.useSapConn,
      emailAllowed: !!values.emailAllowed,
      emailTo: values.emailTo || null,
      emailCc: values.emailCc || null,
      emailToQuery: values.emailToQuery || null,
      emailSubject: values.emailSubject || null,
      emailBody: values.emailBody || null,
      emailFileName: values.emailFileName || null,
      params: params.map(({ key: _key, lineNum: _line, ...p }) => p),
      roleIds: roles.map((r) => r.roleEntry),
    };
    setSaving(true);
    try {
      if (isNew) {
        const res = await reportSettingsAPI.create(payload);
        if (res.success) {
          message.success('Report created');
          // The sidebar's Reports tree follows at once
          await loadReports();
          router.replace(`${LIST_PATH}/${res.data.docEntry}`);
        }
      } else {
        const res = await reportSettingsAPI.update(docEntry, payload);
        if (res.success) {
          message.success('Report updated');
          showReport(res.data);
          setEditing(false);
          await loadReports();
        }
      }
    } catch (error) {
      message.error(errorText(error, 'Failed to save report'));
    } finally {
      setSaving(false);
    }
  };

  // Read Parameters from Report: the .rpt's parameters in its order. Lines already set up keep their settings;
  // new ones are added; lines the report no longer has are dropped. Left out: SAP B1's display-only parameters
  // (Title_Items@Title, Sep_item@separator ...). Crystal's "in use" flag isn't used to leave any out: a parameter
  // used only inside a SQL Command shows as not in use.
  const handleReadParameters = async () => {
    const reportPath = String(form.getFieldValue('reportPath') ?? '').trim();
    if (!reportPath) {
      message.warning('Fill in the Report Path first');
      return;
    }
    try {
      const res = await reportSettingsAPI.readParameters(reportPath);
      if (!res.success) return;
      const found = res.data;
      const byName = new Map(params.map((p) => [p.paramName.toLowerCase(), p]));
      const next = found
        .filter((p) => !isSapDisplayOnly(p) || byName.has(p.name.toLowerCase()))
        .map((p) => byName.get(p.name.toLowerCase()) ?? fromRpt(p));
      const foundNames = new Set(found.map((p) => p.name.toLowerCase()));
      const dropped = params.filter((p) => !foundNames.has(p.paramName.toLowerCase()));
      const added = next.length - (params.length - dropped.length);
      setParams(next);
      if (found.length === 0) {
        message.info('This report has no parameters');
        return;
      }
      const notes = [`${found.length} parameter(s) in the report`, `${Math.max(added, 0)} added`];
      if (dropped.length > 0) notes.push(`removed (not in the report): ${dropped.map((p) => p.paramName).join(', ')}`);
      message.success(notes.join('; '), 6);
    } catch (error) {
      message.error(errorText(error, 'Failed to read the report'));
    }
  };

  const tickedParams = () => paramsGridRef.current?.getSelectedRows() ?? [];

  const handleNewParam = () =>
    setParams((prev) => [
      ...prev,
      {
        key: newKey(),
        paramName: '',
        caption: '',
        paramType: 'STRING',
        inputType: 'KEYIN',
        query: null,
        allowMulti: false,
        isRange: false,
        mandatory: false,
        defaultValue: null,
      },
    ]);

  const handleDeleteParams = () => {
    const ticked = tickedParams();
    if (ticked.length === 0) {
      message.warning('Tick the parameters to delete');
      return;
    }
    const keys = new Set(ticked.map((p) => p.key));
    setParams((prev) => prev.filter((p) => !keys.has(p.key)));
  };

  // Move the ticked parameters one place up / down (the order on the run screen)
  const handleMove = (step: -1 | 1) => {
    const keys = new Set(tickedParams().map((p) => p.key));
    if (keys.size === 0) {
      message.warning('Tick the parameters to move');
      return;
    }
    setParams((prev) => {
      const next = [...prev];
      const order = step === -1 ? next.map((_, i) => i) : next.map((_, i) => next.length - 1 - i);
      for (const i of order) {
        const j = i + step;
        if (keys.has(next[i].key) && j >= 0 && j < next.length && !keys.has(next[j].key)) [next[i], next[j]] = [next[j], next[i]];
      }
      return next;
    });
  };

  // Test Query: run the ticked line's query (as typed, not yet saved) and show what it returns
  const handleTestQuery = async () => {
    const ticked = tickedParams();
    if (ticked.length !== 1 || !ticked[0].query) {
      message.warning('Tick one Choose from List parameter that has a query');
      return;
    }
    try {
      // In the database the report's queries use: the SAP company database when Use SAP DB Connection is ticked
      const res = await reportSettingsAPI.testQuery(ticked[0].query, !!form.getFieldValue('useSapConn'));
      if (!res.success) return;
      const columns = res.data.columnList.map((c) => c.name);
      const rows = res.data.rowList.map((r, i) => Object.fromEntries([['__row', i], ...columns.map((c, n) => [`c${n}`, r.cells[n]])]));
      setQueryResult({ title: `Test Query - ${ticked[0].caption || ticked[0].paramName} (${rows.length} rows)`, columns, rows });
    } catch (error) {
      message.error(errorText(error, 'The query failed'));
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

  // Every column but # is edited in the row (one click); Query in a larger popup box
  const paramColumns = useMemo<ColDef<ParamRow>[]>(
    () => [
      { colId: 'lineNo', headerName: '#', valueGetter: (p) => (p.node?.rowIndex ?? 0) + 1, sortable: false, cellDataType: 'number', width: 44 },
      { field: 'paramName', headerName: 'Parameter Name', editable: editing },
      { field: 'caption', headerName: 'Caption', editable: editing },
      {
        colId: 'paramType',
        headerName: 'Type',
        valueGetter: (p) => (p.data ? typeLabel(p.data.paramType) : ''),
        valueSetter: (p) => {
          if (!p.data) return false;
          p.data.paramType = typeValue(String(p.newValue));
          return true;
        },
        editable: editing,
        cellEditor: 'agSelectCellEditor',
        cellEditorParams: { values: PARAM_TYPES.map((t) => t.label) },
      },
      {
        colId: 'inputType',
        headerName: 'Input',
        valueGetter: (p) => (p.data ? inputLabel(p.data.inputType) : ''),
        valueSetter: (p) => {
          if (!p.data) return false;
          p.data.inputType = inputValue(String(p.newValue));
          return true;
        },
        editable: editing,
        cellEditor: 'agSelectCellEditor',
        cellEditorParams: { values: INPUT_TYPES.map((t) => t.label) },
      },
      {
        field: 'query',
        headerName: 'Query',
        // Typing a query makes the parameter Choose from List (see onCellValueChanged)
        editable: editing,
        cellEditor: 'agLargeTextCellEditor',
        cellEditorPopup: true,
        cellEditorParams: { maxLength: 100000, rows: 12, cols: 80 },
      },
      { field: 'allowMulti', headerName: 'Multiple Values', cellDataType: 'boolean', editable: editing },
      { field: 'isRange', headerName: 'Range', cellDataType: 'boolean', editable: editing },
      { field: 'mandatory', headerName: 'Mandatory', cellDataType: 'boolean', editable: editing },
      { field: 'defaultValue', headerName: 'Default Value', editable: editing },
    ],
    [editing]
  );

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
  if (!isNew && !report) return null;

  // Button order: New, Edit, then the rest (none on a Read Only screen)
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

  const paramsToolbar = editing ? (
    <>
      <Button size="small" icon={<FileSearchOutlined />} onClick={handleReadParameters}>
        Read Parameters from Report
      </Button>
      <Button size="small" icon={<PlusOutlined />} onClick={handleNewParam}>
        New
      </Button>
      <Button size="small" icon={<DeleteOutlined />} onClick={handleDeleteParams}>
        Delete
      </Button>
      <Button size="small" icon={<ArrowUpOutlined />} onClick={() => handleMove(-1)}>
        Move Up
      </Button>
      <Button size="small" icon={<ArrowDownOutlined />} onClick={() => handleMove(1)}>
        Move Down
      </Button>
      <Button size="small" icon={<PlayCircleOutlined />} onClick={handleTestQuery}>
        Test Query
      </Button>
    </>
  ) : null;

  const rolesToolbar = editing ? (
    <>
      <Button size="small" icon={<PlusOutlined />} onClick={() => setRoleLookupOpen(true)}>
        Add
      </Button>
      <Button size="small" icon={<MinusCircleOutlined />} onClick={handleRemoveRoles}>
        Remove
      </Button>
    </>
  ) : null;

  return (
    <>
      {/* Wider labels: "Use SAP DB Connection" doesn't fit the standard label column */}
      <Form form={form} {...detailFormProps(editing, 180)} initialValues={{ isActive: true, useSapConn: false, emailAllowed: false }} onFinish={handleSave}>
        <DetailView
          toolbar={toolbar}
          title={`Report Settings - ${isNew ? 'New' : report?.reportName}`}
          below={
            <Tabs
              type="card"
              items={[
                {
                  key: 'params',
                  label: `Parameters (${params.length})`,
                  children: (
                    <DataGrid<ParamRow>
                      settingsKey="report-settings:params"
                      handleRef={paramsGridRef}
                      showToolbar
                      toolbar={paramsToolbar}
                      selectable={editing}
                      gridProps={{
                        rowData: params,
                        columnDefs: paramColumns,
                        getRowId: (p) => p.data.key,
                        suppressCellFocus: false,
                        singleClickEdit: true,
                        stopEditingWhenCellsLoseFocus: true,
                        onCellValueChanged: (e) => {
                          // A query typed in -> Choose from List; switched back to Key In -> no query
                          if (e.data && e.colDef.field === 'query' && String(e.data.query ?? '').trim()) e.data.inputType = 'LIST';
                          if (e.data && e.colDef.colId === 'inputType' && e.data.inputType === 'KEYIN') e.data.query = null;
                          if (e.data && e.data.isRange && e.data.allowMulti) {
                            if (e.colDef.field === 'isRange') e.data.allowMulti = false;
                            else e.data.isRange = false;
                          }
                          setParams((prev) => [...prev]);
                        },
                      }}
                    />
                  ),
                },
                {
                  // E-mailing the report after Run (forceRender: its fields belong to the form even when not opened)
                  key: 'email',
                  label: 'E-mail',
                  forceRender: true,
                  children: (
                    <div className={detailStyles.tabPanel}>
                      <div className={`${detailStyles.fields} ${detailStyles.wide}`}>
                        <Form.Item label="Allow E-mail" name="emailAllowed" valuePropName="checked">
                          <Checkbox disabled={!editing} />
                        </Form.Item>
                        <Form.Item label="Default To" name="emailTo" rules={[{ max: 254, message: 'Maximum 254 characters' }]}>
                          {editing ? <Input placeholder="e.g. finance@aji.com.my; manager@aji.com.my" /> : <ReadOnlyText />}
                        </Form.Item>
                        <Form.Item label="Default CC" name="emailCc" rules={[{ max: 254, message: 'Maximum 254 characters' }]}>
                          {editing ? <Input placeholder="Optional" /> : <ReadOnlyText />}
                        </Form.Item>
                        {/* Finds the To address from the report's parameters, e.g. the customer's e-mail */}
                        <Form.Item label="To Query" name="emailToQuery">
                          {editing ? (
                            <Input.TextArea
                              rows={3}
                              spellCheck={false}
                              placeholder={`Optional, e.g. SELECT E_Mail FROM ${useSapConn ? '' : 'SBODemoGB..'}OCRD WHERE CardCode = @CardCode`}
                            />
                          ) : (
                            <ReadOnlyText multiline />
                          )}
                        </Form.Item>
                        <Form.Item label="Subject" name="emailSubject" rules={[{ max: 254, message: 'Maximum 254 characters' }]}>
                          {editing ? <Input placeholder="e.g. {ReportName} - {CardCode}" /> : <ReadOnlyText />}
                        </Form.Item>
                        <Form.Item label="Message" name="emailBody">
                          {editing ? (
                            <Input.TextArea rows={6} placeholder={'e.g. Dear Sir/Madam,\n\nPlease find attached your {ReportName} as at {Today}.\n\nRegards,\n{DisplayName}'} />
                          ) : (
                            <ReadOnlyText multiline />
                          )}
                        </Form.Item>
                        <Form.Item label="Attachment Name" name="emailFileName" rules={[{ max: 100, message: 'Maximum 100 characters' }]}>
                          {editing ? <Input placeholder="e.g. {ReportName} {CardCode} (.pdf is added)" /> : <ReadOnlyText />}
                        </Form.Item>
                        <Form.Item label="Placeholders">
                          <ReadOnlyText
                            multiline
                            value={`{ReportName}  {Today}  {UserName}  {DisplayName}  and every parameter: ${
                              params.length > 0
                                ? params.map((p) => `{${p.paramName.split('@')[0].replace(/[^A-Za-z0-9_]/g, '')}}`).join('  ')
                                : '(none yet)'
                            }\nThe To Query uses the parameters as @names, e.g. @CardCode.\n${
                              useSapConn
                                ? 'Use SAP DB Connection is ticked: the queries run in the SAP company database (SAP tables need no prefix, e.g. FROM OCRD).'
                                : 'The queries run in the portal database: SAP tables need the company database in front, e.g. FROM SBODemoGB..OCRD.'
                            }`}
                          />
                        </Form.Item>
                      </div>
                    </div>
                  ),
                },
                {
                  key: 'roles',
                  label: `Roles (${roles.length})`,
                  children: (
                    <DataGrid<ReportRole>
                      settingsKey="report-settings:roles"
                      handleRef={rolesGridRef}
                      showToolbar
                      toolbar={rolesToolbar}
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
            label="Report Code"
            name="reportCode"
            rules={[
              { required: true, whitespace: true, message: 'Report Code is required' },
              { max: 50, message: 'Maximum 50 characters' },
            ]}
          >
            {editing ? <Input /> : <ReadOnlyText />}
          </Form.Item>
          <Form.Item
            label="Report Name"
            name="reportName"
            rules={[
              { required: true, whitespace: true, message: 'Report Name is required' },
              { max: 100, message: 'Maximum 100 characters' },
            ]}
          >
            {editing ? <Input /> : <ReadOnlyText />}
          </Form.Item>
          {/* The .rpt file on the server */}
          <Form.Item
            label="Report Path"
            name="reportPath"
            rules={[
              { required: true, whitespace: true, message: 'Report Path is required' },
              { max: 254, message: 'Maximum 254 characters' },
            ]}
          >
            {editing ? <Input placeholder="e.g. D:\SalesPortal_Reports\SalesAnalysis.rpt" /> : <ReadOnlyText />}
          </Form.Item>
          {/* Groups the reports in the Reports module */}
          <Form.Item label="Category" name="category" rules={[{ max: 50, message: 'Maximum 50 characters' }]}>
            {editing ? <Input placeholder="e.g. Sales" /> : <ReadOnlyText />}
          </Form.Item>
          <Form.Item label="Remarks" name="remarks" rules={[{ max: 254, message: 'Maximum 254 characters' }]}>
            {editing ? <Input.TextArea rows={2} maxLength={254} /> : <ReadOnlyText multiline />}
          </Form.Item>
          {/* Ticked: the report logs on with General Settings > SAP DI API (SAP company database for every table);
              not ticked: with the portal's own database setting */}
          <Form.Item label="Use SAP DB Connection" name="useSapConn" valuePropName="checked">
            <Checkbox disabled={!editing} />
          </Form.Item>
          <Form.Item label="Active" name="isActive" valuePropName="checked">
            <Checkbox disabled={!editing} />
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

      {/* What the ticked parameter's query returns: 1st column = value passed to the report, 2nd = description */}
      <Modal
        open={!!queryResult}
        title={queryResult?.title}
        footer={null}
        width={900}
        onCancel={() => setQueryResult(null)}
        afterOpenChange={setQueryOpened}
        destroyOnHidden
      >
        {queryResult && (
          <DataGrid<Record<string, unknown>>
            settingsKey="report-settings:test-query"
            showToolbar
            selectable={false}
            gridProps={{
              rowData: queryOpened ? queryResult.rows : [],
              loading: !queryOpened,
              columnDefs: queryResult.columns.map((name, n) => ({
                field: `c${n}`,
                headerName: n === 0 ? `${name} (value)` : n === 1 ? `${name} (description)` : name,
              })),
              getRowId: (p) => String(p.data.__row),
            }}
          />
        )}
      </Modal>
    </>
  );
}

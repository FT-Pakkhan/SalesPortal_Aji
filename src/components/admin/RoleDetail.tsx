'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { App, Button, Checkbox, Form, Input, Tabs } from 'antd';
import { EditOutlined, PlusOutlined, SaveOutlined, UserAddOutlined, UserDeleteOutlined } from '@ant-design/icons';
import type { ColDef } from 'ag-grid-community';
import { useRouter } from 'next/navigation';
import { reportSettingsAPI, rolesAPI } from '@/lib/apiClient';
import { useReportMenuStore } from '@/stores/reportMenuStore';
import { ACCESS_LEVELS, SCREENS } from '@/lib/screens';
import type { ScreenAccess } from '@/lib/screens';
import { useAccessStore, useCanChange } from '@/stores/accessStore';
import { DetailView, ReadOnlyText, detailFormProps } from '@/components/ui/DetailView';
import { DataGrid } from '@/components/ui/DataGrid';
import type { DataGridHandle } from '@/components/ui/DataGrid';
import UserLookup from '@/components/admin/UserLookup';
import type { RoleDetail as RoleDetailData, RoleReport, RoleUser } from '@/types';

const LIST_PATH = '/admin/roles';

interface RoleDetailProps {
  /** Omit to create a new role */
  docEntry?: number;
  /** Open an existing role directly in edit mode (list view's Edit button) */
  startInEdit?: boolean;
}

interface RoleFormValues {
  roleName: string;
  isAdmin: boolean;
}

/**
 * A row of the Screens tab: every portal screen, with this role's access to it, then every report (Report Settings)
 * under the "Reports" menu: Full = the role may run it, None = not (the same as the report's Roles tab)
 */
interface ScreenRow {
  code: string;
  group: string;
  name: string;
  access: ScreenAccess;
  /** Set on a report row */
  reportEntry?: number;
}

/** Row code of a report (never a screen code) */
const REPORT_ROW = 'RPT:';

const accessLabel = (value: ScreenAccess) => ACCESS_LEVELS.find((a) => a.value === value)?.label ?? value;
const accessValue = (label: string) => ACCESS_LEVELS.find((a) => a.label === label)?.value ?? 'NONE';
/** A report is run or not: Full / None */
const REPORT_ACCESS = ACCESS_LEVELS.filter((a) => a.value !== 'READ');

/** Every screen, with the role's access (screens the role doesn't list are None), then every report */
const toScreenRows = (role: RoleDetailData | null, reports: RoleReport[]): ScreenRow[] => [
  ...SCREENS.map((s) => ({
    code: s.code,
    group: s.group,
    name: s.name,
    access: role?.screens.find((x) => x.screenCode === s.code)?.access ?? ('NONE' as ScreenAccess),
  })),
  ...reports.map((r) => ({
    code: `${REPORT_ROW}${r.reportEntry}`,
    group: 'Reports',
    name: `${r.category ? `${r.category} - ` : ''}${r.reportName}${r.isActive ? '' : ' (inactive)'}`,
    access: (r.allowed ? 'FULL' : 'NONE') as ScreenAccess,
    reportEntry: r.reportEntry,
  })),
];

/**
 * Role (Administration): its name, whether it is an administrator role, the users who have it (Users tab) and what
 * it can do on each portal screen (Screens tab: Full / Read Only / None). An administrator role has every screen
 * with Full access. A user may have several roles: the best access of their roles counts.
 */
export default function RoleDetail({ docEntry, startInEdit = false }: RoleDetailProps) {
  const isNew = docEntry === undefined;
  const { message } = App.useApp();
  const router = useRouter();
  const canChange = useCanChange();
  const loadAccess = useAccessStore((s) => s.loadAccess);
  const [role, setRole] = useState<RoleDetailData | null>(null);
  const [users, setUsers] = useState<RoleUser[]>([]);
  const [screens, setScreens] = useState<ScreenRow[]>(toScreenRows(null, []));
  const loadReports = useReportMenuStore((s) => s.loadReports);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(isNew || startInEdit);
  const [lookupOpen, setLookupOpen] = useState(false);
  const [form] = Form.useForm<RoleFormValues>();
  // Followed as ticked: an administrator role has every screen with Full access
  const isAdmin = Form.useWatch('isAdmin', form) ?? role?.isAdmin ?? false;
  const usersGridRef = useRef<DataGridHandle<RoleUser>>(null);

  const showRole = (r: RoleDetailData) => {
    setRole(r);
    setUsers(r.users);
    setScreens(toScreenRows(r, r.reports));
    form.setFieldsValue({ roleName: r.roleName, isAdmin: r.isAdmin });
  };

  // A new role: every report, none allowed yet
  useEffect(() => {
    if (!isNew) return;
    reportSettingsAPI
      .getList()
      .then((res) => {
        if (!res.success) return;
        const reports = res.data.map((r) => ({ reportEntry: r.docEntry, reportName: r.reportName, category: r.category, isActive: r.isActive, allowed: false }));
        setScreens((prev) => [...prev.filter((s) => s.reportEntry === undefined), ...toScreenRows(null, reports).filter((s) => s.reportEntry !== undefined)]);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (isNew) return;
    rolesAPI
      .getById(docEntry)
      .then((res) => res.success && setRole(res.data))
      .catch(() => {
        message.error('Failed to load role');
        router.push(LIST_PATH);
      })
      .finally(() => setLoading(false));
  }, [docEntry]);

  // Fill the form once it is on screen (it isn't rendered while loading)
  useEffect(() => {
    if (!loading && role) showRole(role);
  }, [loading]);

  const handleCancelEdit = () => {
    if (isNew) {
      router.push(LIST_PATH);
      return;
    }
    // Discard unsaved changes, including added / removed users and changed access
    form.resetFields();
    if (role) showRole(role);
    setEditing(false);
  };

  const handleSave = async (values: RoleFormValues) => {
    if (!editing) return;
    const payload = {
      roleName: values.roleName,
      isAdmin: !!values.isAdmin,
      userIds: users.map((u) => u.userId),
      screens: screens
        .filter((s) => s.reportEntry === undefined && s.access !== 'NONE')
        .map((s) => ({ screenCode: s.code, access: s.access })),
      reportIds: screens.filter((s) => s.reportEntry !== undefined && s.access !== 'NONE').map((s) => s.reportEntry as number),
    };
    setSaving(true);
    try {
      if (isNew) {
        const res = await rolesAPI.create(payload);
        if (res.success) {
          message.success('Role created');
          await loadAccess();
          await loadReports();
          router.replace(`${LIST_PATH}/${res.data.docEntry}`);
        }
      } else {
        const res = await rolesAPI.update(docEntry, payload);
        if (res.success) {
          message.success('Role updated');
          showRole(res.data);
          setEditing(false);
          // My own access may have changed (e.g. I am in this role): the sidebar follows at once, reports too
          await loadAccess();
          await loadReports();
        }
      }
    } catch (error) {
      const err = error as { response?: { data?: { error?: string } } };
      message.error(err.response?.data?.error || 'Failed to save role');
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveUsers = () => {
    const ticked = usersGridRef.current?.getSelectedRows() ?? [];
    if (ticked.length === 0) {
      message.warning('Tick the users to remove');
      return;
    }
    const ids = new Set(ticked.map((u) => u.userId));
    setUsers((prev) => prev.filter((u) => !ids.has(u.userId)));
  };

  const userColumns = useMemo<ColDef<RoleUser>[]>(
    () => [
      { field: 'userName', headerName: 'User Name', sort: 'asc' },
      { field: 'displayName', headerName: 'Display Name' },
      { field: 'isActive', headerName: 'Active', cellDataType: 'boolean' },
    ],
    []
  );

  // Access: a drop-down in edit mode (one click); an administrator role shows Full on every screen, not changeable
  const screenColumns = useMemo<ColDef<ScreenRow>[]>(
    () => [
      { field: 'group', headerName: 'Menu' },
      { field: 'name', headerName: 'Screen' },
      {
        colId: 'access',
        headerName: 'Access',
        valueGetter: (p) => (isAdmin ? 'Full (Administrator)' : p.data ? accessLabel(p.data.access) : ''),
        valueSetter: (p) => {
          if (!p.data) return false;
          p.data.access = accessValue(String(p.newValue));
          return true;
        },
        editable: editing && !isAdmin,
        cellEditor: 'agSelectCellEditor',
        // A report is Full (may run it) or None
        cellEditorParams: (p: { data?: ScreenRow }) => ({
          values: (p.data?.reportEntry !== undefined ? REPORT_ACCESS : ACCESS_LEVELS).map((a) => a.label),
        }),
        cellStyle: (p) =>
          isAdmin || p.data?.access === 'FULL'
            ? { color: '#256f3a', fontWeight: 600 }
            : p.data?.access === 'READ'
              ? { color: '#0a6ed1', fontWeight: 400 }
              : { color: '#6a6d70', fontWeight: 400 },
      },
    ],
    [editing, isAdmin]
  );

  if (loading) return null;
  if (!isNew && !role) return null;

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

  const usersToolbar = editing ? (
    <>
      <Button size="small" icon={<UserAddOutlined />} onClick={() => setLookupOpen(true)}>
        Add
      </Button>
      <Button size="small" icon={<UserDeleteOutlined />} onClick={handleRemoveUsers}>
        Remove
      </Button>
    </>
  ) : null;

  return (
    <>
      <Form form={form} {...detailFormProps(editing)} initialValues={{ isAdmin: false }} onFinish={handleSave}>
        <DetailView
          toolbar={toolbar}
          title={`Role - ${isNew ? 'New' : role?.roleName}`}
          below={
            <Tabs
              type="card"
              items={[
                {
                  key: 'users',
                  label: `Users (${users.length})`,
                  children: (
                    <DataGrid<RoleUser>
                      settingsKey="role:users"
                      handleRef={usersGridRef}
                      showToolbar
                      toolbar={usersToolbar}
                      selectable={editing}
                      gridProps={{ rowData: users, columnDefs: userColumns, getRowId: (p) => String(p.data.userId) }}
                    />
                  ),
                },
                {
                  key: 'screens',
                  label: 'Screens Permission',
                  children: (
                    <DataGrid<ScreenRow>
                      settingsKey="role:screens"
                      showToolbar
                      selectable={false}
                      gridProps={{
                        rowData: screens,
                        columnDefs: screenColumns,
                        getRowId: (p) => p.data.code,
                        suppressCellFocus: false,
                        singleClickEdit: true,
                        stopEditingWhenCellsLoseFocus: true,
                        onCellValueChanged: () => setScreens((prev) => [...prev]),
                      }}
                    />
                  ),
                },
              ]}
            />
          }
        >
          <Form.Item
            label="Role Name"
            name="roleName"
            rules={[
              { required: true, whitespace: true, message: 'Role Name is required' },
              { max: 100, message: 'Maximum 100 characters' },
            ]}
          >
            {editing ? <Input /> : <ReadOnlyText />}
          </Form.Item>
          {/* Every screen with Full access */}
          <Form.Item label="Is Administrator" name="isAdmin" valuePropName="checked">
            <Checkbox disabled={!editing} />
          </Form.Item>
        </DetailView>
      </Form>

      <UserLookup
        open={lookupOpen}
        title="Add User"
        excludeIds={users.map((u) => u.userId)}
        onCancel={() => setLookupOpen(false)}
        onSelect={(picked) => {
          setUsers((prev) => [
            ...prev,
            ...picked.map((u) => ({ userId: u.id, userName: u.userName, displayName: u.displayName ?? null, isActive: true })),
          ]);
          setLookupOpen(false);
        }}
      />
    </>
  );
}

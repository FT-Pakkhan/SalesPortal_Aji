'use client';

import React, { useState, useEffect } from 'react';
import { App, Button, Checkbox, Form, Input, Modal, Select } from 'antd';
import { SaveOutlined, EditOutlined, PlusOutlined, KeyOutlined } from '@ant-design/icons';
import { useRouter } from 'next/navigation';
import { sapAPI, usersAPI } from '@/lib/apiClient';
import { branchLabel } from '@/lib/branch';
import { useCanChange } from '@/stores/accessStore';
import { useAuthStore } from '@/stores/authStore';
import { DetailView, DisplayText, ReadOnlyText, detailFormProps } from '@/components/ui/DetailView';
import type { ApproverStage, PortalUserDetail, SapBranch, SapSalesEmployee } from '@/types';

interface UserDetailProps {
  /** Omit to create a new user */
  userId?: number;
  /** Open an existing user directly in edit mode (list view's Edit button) */
  startInEdit?: boolean;
}

interface UserFormValues {
  userName: string;
  displayName: string;
  email: string;
  slpCode: number | null;
  branch: string | null;
  password?: string;
  isActive: boolean;
  chgPwdOnLogon: boolean;
}

const toFormValues = (user: PortalUserDetail): UserFormValues => ({
  userName: user.userName,
  displayName: user.displayName || '',
  email: user.email || '',
  slpCode: user.slpCode,
  branch: user.branch,
  isActive: user.isActive,
  chgPwdOnLogon: user.chgPwdOnLogon,
});

/** Detail view of a system user. Existing users open in view mode; a new user starts in edit mode. */
export default function UserDetail({ userId, startInEdit = false }: UserDetailProps) {
  const isNew = userId === undefined;
  const { message, modal } = App.useApp();
  // Read Only screen (the user's roles): no New / Edit
  const canChange = useCanChange();
  const router = useRouter();
  const { user: authUser, updateUser } = useAuthStore();
  const [userData, setUserData] = useState<PortalUserDetail | null>(null);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  // Detail views open in view mode; Edit switches to edit mode
  const [editing, setEditing] = useState(isNew || startInEdit);
  const [salesEmployees, setSalesEmployees] = useState<SapSalesEmployee[]>([]);
  const [branches, setBranches] = useState<SapBranch[]>([]);
  const [form] = Form.useForm<UserFormValues>();
  // Reset Password popup
  const [resetOpen, setResetOpen] = useState(false);
  const [resetForm] = Form.useForm<{ newPassword: string; confirmPassword: string; chgPwdOnLogon: boolean }>();

  // Choices for Sales Employee (SAP B1 OSLP)
  useEffect(() => {
    sapAPI
      .getSalesEmployees()
      .then((res) => res.success && setSalesEmployees(res.data))
      .catch(() => message.error('Failed to load sales employees'));
    // Branch: SAP cost centres of Dimension 1 (OOCR)
    sapAPI
      .getBranches()
      .then((res) => res.success && setBranches(res.data))
      .catch(() => message.error('Failed to load branches'));
  }, []);

  useEffect(() => {
    if (isNew) return;
    const load = async () => {
      try {
        const res = await usersAPI.getById(userId);
        if (res.success) {
          setUserData(res.data);
        }
      } catch {
        message.error('Failed to load user');
        router.push('/admin/users');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [userId]);

  // Fill the form once it is on screen (it isn't rendered while loading)
  useEffect(() => {
    if (!loading && userData) form.setFieldsValue(toFormValues(userData));
  }, [loading]);

  const handleCancelEdit = () => {
    if (isNew) {
      router.push('/admin/users');
      return;
    }
    // Discard unsaved changes and any validation errors
    form.resetFields();
    if (userData) form.setFieldsValue(toFormValues(userData));
    setEditing(false);
  };

  // Save. Deactivating an approver asks first: their approval stages are listed, and those left unable to approve
  // (fewer active approvers than Approvals Required) are marked — documents using them can't be confirmed.
  const handleSave = async (values: UserFormValues) => {
    if (!editing) return;
    if (!isNew && userData?.isActive && !values.isActive) {
      let stages: ApproverStage[] = [];
      try {
        const res = await usersAPI.getApprovalStages(userId);
        if (res.success) stages = res.data;
      } catch {
        message.error('Failed to check the approval stages');
        return;
      }
      if (stages.length > 0) {
        const left = (s: ApproverStage) => s.activeApprovers - 1;
        const anyBroken = stages.some((s) => left(s) < s.maxReqr);
        modal.confirm({
          title: 'Deactivate Approver',
          width: 560,
          content: (
            <>
              <p>
                {userData.userName} is an approver in these approval stages. Check Approval Stage first and assign
                another approver where needed.
              </p>
              <ul style={{ paddingLeft: 18, margin: '8px 0' }}>
                {stages.map((s) => (
                  <li key={s.wstCode} style={{ color: left(s) < s.maxReqr ? '#bb0000' : undefined }}>
                    <b>{s.wstCode}</b> {s.wstName}: needs {s.maxReqr}, {left(s)} active approver(s) left
                    {left(s) < s.maxReqr ? ' — can no longer approve' : ''}
                    {s.templates ? ` (used by ${s.templates})` : ''}
                  </li>
                ))}
              </ul>
              {anyBroken && (
                <p>
                  Documents that need a stage marked in red can&apos;t be confirmed until another approver is added.
                </p>
              )}
              <p>Deactivate anyway?</p>
            </>
          ),
          okText: 'Deactivate',
          okButtonProps: { danger: true },
          cancelText: 'No',
          // The popup closes at once; the save runs behind the portal's LOADING overlay
          onOk: () => {
            void saveUser(values);
          },
        });
        return;
      }
    }
    await saveUser(values);
  };

  // Reset Password: the popup closes at once and the reset runs behind the portal's LOADING overlay
  const handleResetPassword = (values: { newPassword?: string; chgPwdOnLogon: boolean }) => {
    setResetOpen(false);
    resetForm.resetFields();
    void (async () => {
      try {
        const res = await usersAPI.resetPassword(userId as number, {
          newPassword: values.newPassword || '',
          chgPwdOnLogon: !!values.chgPwdOnLogon,
        });
        if (res.success) {
          message.success(values.newPassword ? 'Password reset' : 'Password reset to no password');
          setUserData(res.data);
          form.setFieldsValue(toFormValues(res.data));
        }
      } catch (error) {
        const err = error as { response?: { data?: { error?: string } } };
        message.error(err.response?.data?.error || 'Failed to reset password');
      }
    })();
  };

  const saveUser = async (values: UserFormValues) => {
    setSaving(true);
    try {
      if (isNew) {
        const res = await usersAPI.create({
          userName: values.userName,
          password: values.password || '',
          displayName: values.displayName || '',
          email: values.email || '',
          slpCode: values.slpCode ?? null,
          branch: values.branch ?? null,
          isActive: values.isActive,
          chgPwdOnLogon: !!values.chgPwdOnLogon,
        });
        if (res.success) {
          message.success('User created');
          router.replace(`/admin/users/${res.data.id}`);
        }
      } else {
        const res = await usersAPI.update(userId, {
          userName: values.userName,
          displayName: values.displayName || '',
          email: values.email || '',
          slpCode: values.slpCode ?? null,
          branch: values.branch ?? null,
          isActive: values.isActive,
          chgPwdOnLogon: !!values.chgPwdOnLogon,
        });
        if (res.success) {
          message.success('User updated');
          setUserData(res.data);
          form.setFieldsValue(toFormValues(res.data));
          // Editing yourself: keep the shell bar in step
          if (authUser?.id === res.data.id) {
            updateUser({ userName: res.data.userName, displayName: res.data.displayName, email: res.data.email });
          }
          setEditing(false);
        }
      }
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: string } } };
      message.error(err.response?.data?.error || 'Failed to save user');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    // The portal's own loading overlay (LOADING... bar) shows while the data is fetched; nothing else is drawn meanwhile
    return null;
  }

  if (!isNew && !userData) return null;

  // Button order: New, Edit, then the rest
  const toolbar = editing ? (
    <>
      <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={() => form.submit()}>
        Save
      </Button>
      <Button disabled={saving} onClick={handleCancelEdit}>Cancel</Button>
    </>
  ) : !canChange ? null : (
    <>
      <Button type="primary" icon={<PlusOutlined />} onClick={() => router.push('/admin/users/new')}>
        New
      </Button>
      <Button icon={<EditOutlined />} onClick={() => setEditing(true)}>
        Edit
      </Button>
      {/* Forgotten password: set a new one for the user */}
      {!isNew && (
        <Button icon={<KeyOutlined />} onClick={() => setResetOpen(true)}>
          Reset Password
        </Button>
      )}
    </>
  );

  return (
    <DetailView toolbar={toolbar} title={`User - ${isNew ? 'New' : userData?.userName}`}>
      <Form
        form={form}
        {...detailFormProps(editing)}
        initialValues={{ isActive: true, chgPwdOnLogon: false }}
        onFinish={handleSave}
      >
        <Form.Item
          label="User Name"
          name="userName"
          rules={[
            { required: true, whitespace: true, message: 'User name is required' },
            { max: 50, message: 'Maximum 50 characters' },
          ]}
        >
          {editing ? <Input /> : <ReadOnlyText />}
        </Form.Item>
        <Form.Item
          label="Display Name"
          name="displayName"
          rules={[{ max: 100, message: 'Maximum 100 characters' }]}
        >
          {editing ? <Input /> : <ReadOnlyText />}
        </Form.Item>
        <Form.Item
          label="E-mail"
          name="email"
          rules={[
            { type: 'email', message: 'Enter a valid email' },
            { max: 200, message: 'Maximum 200 characters' },
          ]}
        >
          {editing ? <Input type="email" /> : <ReadOnlyText />}
        </Form.Item>
        {/* The user's SAP B1 Sales Employee (OSLP) */}
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
            <DisplayText text={userData?.slpName ?? ''} />
          )}
        </Form.Item>
        {/* The user's Branch: an SAP cost centre of Dimension 1 (OOCR); new quotations / orders / credit memos start with it */}
        <Form.Item label="Branch" name="branch">
          {editing ? (
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder="Select a branch"
              options={branches.map((b) => ({ value: b.ocrCode, label: branchLabel(b) }))}
            />
          ) : (
            <DisplayText text={userData?.branch ? branchLabel({ ocrCode: userData.branch, ocrName: userData.branchName ?? '' }) : ''} />
          )}
        </Form.Item>
        {/* Password is only entered when creating a user */}
        {isNew && (
          <Form.Item
            label="Password"
            name="password"
            rules={[
              { required: true, message: 'Password is required' },
              { min: 6, message: 'Minimum 6 characters' },
            ]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>
        )}
        <Form.Item label="Active" name="isActive" valuePropName="checked">
          <Checkbox disabled={!editing} />
        </Form.Item>
        {/* Must choose a new password after signing in; cleared once they do (Reset Password ticks it) */}
        <Form.Item label="Change Pwd on Logon" name="chgPwdOnLogon" valuePropName="checked">
          <Checkbox disabled={!editing} />
        </Form.Item>
      </Form>

      {/* Reset Password: a forgotten password. Blank = no password (signs in with the user name only). */}
      <Modal
        title={`Reset Password - ${userData?.userName ?? ''}`}
        open={resetOpen}
        okText="Reset Password"
        onOk={() => resetForm.submit()}
        onCancel={() => {
          setResetOpen(false);
          resetForm.resetFields();
        }}
        destroyOnHidden
      >
        <Form form={resetForm} layout="vertical" initialValues={{ chgPwdOnLogon: true }} onFinish={handleResetPassword}>
          <Form.Item
            label="New Password"
            name="newPassword"
            extra="Leave blank for no password (the user signs in with the user name only)."
            rules={[{ min: 6, message: 'Minimum 6 characters' }]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>
          <Form.Item
            label="Confirm New Password"
            name="confirmPassword"
            dependencies={['newPassword']}
            rules={[
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if ((value || '') === (getFieldValue('newPassword') || '')) return Promise.resolve();
                  return Promise.reject(new Error('Passwords do not match'));
                },
              }),
            ]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>
          <Form.Item name="chgPwdOnLogon" valuePropName="checked">
            <Checkbox>User must change the password at next logon</Checkbox>
          </Form.Item>
        </Form>
      </Modal>
    </DetailView>
  );
}

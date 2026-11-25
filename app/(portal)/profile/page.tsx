'use client';

import React, { useState, useEffect } from 'react';
import {
  App,
  Checkbox,
  Button,
  Input,
  Form,
  Space,
  Modal,
} from 'antd';
import { SaveOutlined, KeyOutlined, EditOutlined } from '@ant-design/icons';
import { usersAPI } from '@/lib/apiClient';
import { useAuthStore } from '@/stores/authStore';
import { DetailView, ReadOnlyText, detailFormProps } from '@/components/ui/DetailView';
import type { PortalUserDetail } from '@/types';

export default function ProfilePage() {
  const { message } = App.useApp();
  const { user: authUser, updateUser } = useAuthStore();
  const [profile, setProfile] = useState<PortalUserDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // Detail views open in view mode; Edit switches to edit mode
  const [editing, setEditing] = useState(false);
  const [form] = Form.useForm();
  const [pwModalOpen, setPwModalOpen] = useState(false);
  const [pwForm] = Form.useForm();
  const [changingPw, setChangingPw] = useState(false);

  const loadProfile = async () => {
    if (!authUser?.id) return;
    try {
      const res = await usersAPI.getById(authUser.id);
      if (res.success) {
        setProfile(res.data);
      }
    } catch {
      message.error('Failed to load profile');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProfile();
  }, [authUser?.id]);

  // Fill the form once it is on screen (it isn't rendered while loading)
  useEffect(() => {
    if (!loading && profile) {
      form.setFieldsValue({
        displayName: profile.displayName || '',
        email: profile.email || '',
      });
    }
  }, [loading]);

  const handleCancelEdit = () => {
    // Discard unsaved changes and any validation errors
    form.resetFields();
    form.setFieldsValue({
      displayName: profile?.displayName || '',
      email: profile?.email || '',
    });
    setEditing(false);
  };

  const handleSaveProfile = async (values: Record<string, unknown>) => {
    if (!authUser?.id || !editing) return;
    setSaving(true);
    try {
      const res = await usersAPI.update(authUser.id, {
        displayName: (values.displayName as string) || '',
        email: (values.email as string) || '',
      });
      if (res.success) {
        message.success('Profile updated');
        setProfile(res.data);
        updateUser({ displayName: res.data.displayName, email: res.data.email });
        setEditing(false);
      }
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: string } } };
      message.error(err.response?.data?.error || 'Failed to update profile');
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async (values: Record<string, unknown>) => {
    if (!authUser?.id) return;
    setChangingPw(true);
    try {
      const res = await usersAPI.changePassword(authUser.id, {
        currentPassword: (values.currentPassword as string) || '',
        newPassword: values.newPassword as string,
      });
      if (res.success) {
        message.success('Password changed successfully');
        setPwModalOpen(false);
        pwForm.resetFields();
        setProfile((prev) => (prev ? { ...prev, hasPassword: true } : prev));
      }
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: string } } };
      message.error(err.response?.data?.error || 'Failed to change password');
    } finally {
      setChangingPw(false);
    }
  };

  if (loading) {
    // The portal's own loading overlay (LOADING... bar) shows while the data is fetched; nothing else is drawn meanwhile
    return null;
  }

  if (!profile) return null;

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
      <Button type="primary" icon={<EditOutlined />} onClick={() => setEditing(true)}>
        Edit
      </Button>
      <Button icon={<KeyOutlined />} onClick={() => setPwModalOpen(true)}>
        Change My Password
      </Button>
    </>
  );

  return (
    <>
      <DetailView toolbar={toolbar} title={`My Profile - ${profile.userName}`}>
        <Form form={form} {...detailFormProps(editing)} onFinish={handleSaveProfile}>
          {/* Mandatory, but not editable here — greyed out in edit mode */}
          <Form.Item label="User Name" required>
            {editing ? <Input value={profile.userName} disabled /> : <ReadOnlyText value={profile.userName} />}
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
          {/* Set in Users, not by the user themselves — greyed out in edit mode */}
          <Form.Item label="Sales Employee">
            {editing ? (
              <Input value={profile.slpName ?? ''} disabled />
            ) : (
              <ReadOnlyText value={profile.slpName ?? ''} />
            )}
          </Form.Item>
          <Form.Item label="Active">
            <Checkbox checked={profile.isActive} disabled />
          </Form.Item>
        </Form>
      </DetailView>

      {/* Change Password Modal */}
      <Modal
        title="Change My Password"
        open={pwModalOpen}
        onCancel={() => { setPwModalOpen(false); pwForm.resetFields(); }}
        footer={null}
      >
        <Form form={pwForm} layout="vertical" onFinish={handleChangePassword}>
          {/* A user with no password set has no current password to enter */}
          {profile.hasPassword && (
            <Form.Item
              label="Current Password"
              name="currentPassword"
              rules={[{ required: true, message: 'Required' }]}
            >
              <Input.Password />
            </Form.Item>
          )}
          <Form.Item
            label="New Password"
            name="newPassword"
            rules={[
              { required: true, message: 'Required' },
              { min: 6, message: 'Minimum 6 characters' },
            ]}
          >
            <Input.Password />
          </Form.Item>
          <Form.Item
            label="Confirm New Password"
            name="confirmPassword"
            dependencies={['newPassword']}
            rules={[
              { required: true, message: 'Required' },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue('newPassword') === value) return Promise.resolve();
                  return Promise.reject(new Error('Passwords do not match'));
                },
              }),
            ]}
          >
            <Input.Password />
          </Form.Item>
          <Space>
            <Button type="primary" htmlType="submit" loading={changingPw}>
              Change My Password
            </Button>
            <Button onClick={() => { setPwModalOpen(false); pwForm.resetFields(); }}>
              Cancel
            </Button>
          </Space>
        </Form>
      </Modal>
    </>
  );
}

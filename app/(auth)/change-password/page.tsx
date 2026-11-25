'use client';

import React, { useEffect, useState } from 'react';
import { App, Button, Form, Input } from 'antd';
import { LockOutlined } from '@ant-design/icons';
import { useRouter } from 'next/navigation';
import { usersAPI } from '@/lib/apiClient';
import { useAuthStore } from '@/stores/authStore';
import styles from '../login/login.module.css';

interface PasswordValues {
  newPassword: string;
  confirmPassword: string;
}

/**
 * Change Password on logon (SystemUsers.ChgPwdOnLogon): after a password reset the user must choose a new one before
 * using the portal. The password they just signed in with isn't asked again.
 */
export default function ChangePasswordOnLogonPage() {
  const { message } = App.useApp();
  const router = useRouter();
  const { user, isAuthenticated, loadFromStorage, updateUser, logout } = useAuthStore();
  const [checked, setChecked] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm<PasswordValues>();

  useEffect(() => {
    loadFromStorage();
    setChecked(true);
  }, [loadFromStorage]);

  // Not signed in: back to Login; nothing to change: on to the portal
  useEffect(() => {
    if (!checked) return;
    if (!isAuthenticated) router.replace('/login');
    else if (!user?.chgPwdOnLogon) router.replace('/dashboard');
  }, [checked, isAuthenticated, user?.chgPwdOnLogon]);

  const handleSave = async (values: PasswordValues) => {
    if (!user) return;
    setSaving(true);
    try {
      const res = await usersAPI.changePassword(user.id, { currentPassword: '', newPassword: values.newPassword });
      if (res.success) {
        message.success('Password changed');
        updateUser({ chgPwdOnLogon: false });
        router.replace('/dashboard');
      }
    } catch (error) {
      const err = error as { response?: { data?: { error?: string } } };
      message.error(err.response?.data?.error || 'Failed to change password');
    } finally {
      setSaving(false);
    }
  };

  if (!checked || !isAuthenticated || !user?.chgPwdOnLogon) return null;

  return (
    <div className={styles.container}>
      <div className={styles.imageSection}>
        <div className={styles.logo}>
          <span className={styles.logoSap}>SAP</span>
          <span className={styles.logoBusiness}> Business One</span>
        </div>
        <div className={styles.portalBadge}>Sales Portal</div>
        <img src="/fast-track-logo.png" alt="Fast Track" className={styles.fastTrackLogo} />
      </div>

      <div className={styles.formSection}>
        <div className={styles.formContainer}>
          <h1 className={styles.title}>Change Password</h1>
          <p style={{ marginBottom: 16, color: '#6a6d70' }}>
            Hello {user.displayName || user.userName}. Your password was reset — please choose a new one to continue.
          </p>
          <Form form={form} layout="vertical" onFinish={handleSave} requiredMark={false}>
            <Form.Item
              name="newPassword"
              rules={[
                { required: true, message: 'Enter a new password' },
                { min: 6, message: 'Minimum 6 characters' },
              ]}
            >
              <Input.Password
                size="large"
                placeholder="New Password"
                autoComplete="new-password"
                prefix={<LockOutlined style={{ color: '#A8A8A8' }} />}
                className={styles.input}
              />
            </Form.Item>
            <Form.Item
              name="confirmPassword"
              dependencies={['newPassword']}
              rules={[
                { required: true, message: 'Confirm the new password' },
                ({ getFieldValue }) => ({
                  validator(_, value) {
                    if (!value || getFieldValue('newPassword') === value) return Promise.resolve();
                    return Promise.reject(new Error('Passwords do not match'));
                  },
                }),
              ]}
            >
              <Input.Password
                size="large"
                placeholder="Confirm New Password"
                autoComplete="new-password"
                prefix={<LockOutlined style={{ color: '#A8A8A8' }} />}
                className={styles.input}
              />
            </Form.Item>
            <Button type="primary" size="large" block htmlType="submit" loading={saving} className={styles.loginButton}>
              Change Password
            </Button>
          </Form>
          <Button
            type="link"
            block
            style={{ marginTop: 8 }}
            onClick={() => {
              logout();
              router.replace('/login');
            }}
          >
            Log Out
          </Button>
        </div>
      </div>
    </div>
  );
}

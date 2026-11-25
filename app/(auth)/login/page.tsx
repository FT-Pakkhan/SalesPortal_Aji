'use client';

import React, { useState, useEffect } from 'react';
import { App, Input, Button, Select } from 'antd';
import { UserOutlined, LockOutlined, BankOutlined } from '@ant-design/icons';
import { useRouter } from 'next/navigation';
import { authAPI } from '@/lib/apiClient';
import { useAuthStore } from '@/stores/authStore';
import type { LoginCompany } from '@/types';
import styles from './login.module.css';

// The company chosen last on this PC, chosen again next time
const LAST_COMPANY_KEY = 'loginCompany';

export default function LoginPage() {
  const { message } = App.useApp();
  const [userName, setUserName] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  // Several companies: the Company drop-down (null = one company, no drop-down)
  const [companies, setCompanies] = useState<LoginCompany[] | null>(null);
  const [company, setCompany] = useState<string | undefined>(undefined);
  const router = useRouter();
  const { login, isAuthenticated, loadFromStorage, user } = useAuthStore();

  useEffect(() => {
    loadFromStorage();
  }, [loadFromStorage]);

  useEffect(() => {
    authAPI
      .getCompanies()
      .then((res) => {
        if (!res.success || !res.data.multiCompany) return;
        const list = res.data.companies;
        setCompanies(list);
        let last: string | null = null;
        try {
          last = localStorage.getItem(LAST_COMPANY_KEY);
        } catch {
          // No storage: nothing remembered
        }
        const remembered = list.find((c) => c.database === last);
        setCompany(remembered?.database ?? (list.length === 1 ? list[0].database : undefined));
      })
      .catch(() => message.error('Failed to load the company list'));
  }, []);

  // Signed in: to the portal — or first to Change Password after a password reset
  useEffect(() => {
    if (isAuthenticated) {
      router.push(user?.chgPwdOnLogon ? '/change-password' : '/dashboard');
    }
  }, [isAuthenticated, router]);

  const handleLogin = async () => {
    // Password may be blank: users without a password set log in with user name only
    if (companies && !company) {
      message.warning('Please choose the company');
      return;
    }
    if (!userName.trim()) {
      message.warning('Please enter user name');
      return;
    }

    setLoading(true);
    try {
      const response = await authAPI.login({ userName, password, ...(companies ? { company } : {}) });
      if (response.success) {
        if (company) {
          try {
            localStorage.setItem(LAST_COMPANY_KEY, company);
          } catch {
            // Not remembered; the login still works
          }
        }
        login(response.data.user, response.data.token);
        message.success('Login successful');
        router.push(response.data.user.chgPwdOnLogon ? '/change-password' : '/dashboard');
      }
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: string } } };
      message.error(err.response?.data?.error || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleLogin();
    }
  };

  return (
    <div className={styles.container}>
      {/* Left side - Background image */}
      <div className={styles.imageSection}>
        <div className={styles.logo}>
          <span className={styles.logoSap}>SAP</span>
          <span className={styles.logoBusiness}> Business One</span>
        </div>
        <div className={styles.portalBadge}>Sales Portal</div>
        <img
          src="/fast-track-logo.png"
          alt="Fast Track"
          className={styles.fastTrackLogo}
        />
        <div className={styles.tagline}>
          <h2 className={styles.taglineText}>Accelerate your sales</h2>
          <p className={styles.taglineSub}>
            Sales Quotations &middot; Sales Orders &middot; SAP B1 Sync
          </p>
        </div>
      </div>

      {/* Right side - Login form */}
      <div className={styles.formSection}>
        <div className={styles.formContainer}>
          <h1 className={styles.title}>Login</h1>

          {companies && (
            <div className={styles.field}>
              <Select
                size="large"
                placeholder="Company"
                prefix={<BankOutlined style={{ color: '#A8A8A8' }} />}
                value={company}
                onChange={setCompany}
                options={companies.map((c) => ({ value: c.database, label: c.name }))}
                showSearch={{ optionFilterProp: 'label' }}
                notFoundContent="No companies in the company list"
                style={{ width: '100%' }}
              />
            </div>
          )}

          <div className={styles.field}>
            <Input
              size="large"
              placeholder="User Name"
              prefix={<UserOutlined style={{ color: '#A8A8A8' }} />}
              value={userName}
              onChange={(e) => setUserName(e.target.value)}
              onKeyDown={handleKeyPress}
              className={styles.input}
            />
          </div>

          <div className={styles.field}>
            <Input.Password
              size="large"
              placeholder="Password"
              prefix={<LockOutlined style={{ color: '#A8A8A8' }} />}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={handleKeyPress}
              className={styles.input}
            />
          </div>

          <Button
            type="primary"
            size="large"
            block
            loading={loading}
            onClick={handleLogin}
            className={styles.loginButton}
          >
            Log In
          </Button>
        </div>
      </div>
    </div>
  );
}

'use client';

import React, { useEffect, useState } from 'react';
import { App, Button, Checkbox, Form, Input, InputNumber, Select } from 'antd';
import { ApiOutlined, EditOutlined, MailOutlined, SaveOutlined } from '@ant-design/icons';
import { generalSettingsAPI, sapAPI } from '@/lib/apiClient';
import { useCanChange } from '@/stores/accessStore';
import { useAuthStore } from '@/stores/authStore';
import { DetailButtonRow, DetailSection, DetailView, DisplayText, ReadOnlyText, detailFormProps } from '@/components/ui/DetailView';
import type { GeneralSettings, SapPaymentAccounts, SapPriceList, ServerType } from '@/types';

interface SettingsFormValues {
  compnyName: string;
  attachPath: string;
  attachMaxSizeMB: number;
  sapServer: string;
  sapDbServerType: string | null;
  sapCompanyDB: string;
  sapUseTrusted: boolean;
  sapDbUserName: string;
  sapDbPassword: string;
  sapUserName: string;
  sapPassword: string;
  sapLicenseServer: string;
  sapSLDServer: string;
  smtpHost: string;
  smtpPort: number | null;
  smtpSecurity: string | null;
  smtpUserName: string;
  smtpPassword: string;
  smtpFromEmail: string;
  smtpFromName: string;
  apprEmail: boolean;
  portalUrl: string;
  payCashAcct: string | null;
  payCheckAcct: string | null;
  payCreditCard: number | null;
  defaultPriceList: number | null;
}

/** SMTP Security (FTS11OADM.SmtpSecurity) */
const SMTP_SECURITY_OPTIONS = [
  { value: 'STARTTLS', label: 'STARTTLS' },
  { value: 'SSL', label: 'SSL' },
  { value: 'NONE', label: 'None' },
];

/** Provider: a helper that fills in the usual server, port and security (not saved) */
const SMTP_PROVIDERS: Record<string, { smtpHost: string; smtpPort: number; smtpSecurity: string } | null> = {
  gmail: { smtpHost: 'smtp.gmail.com', smtpPort: 587, smtpSecurity: 'STARTTLS' },
  microsoft365: { smtpHost: 'smtp.office365.com', smtpPort: 587, smtpSecurity: 'STARTTLS' },
  other: null,
};

const toFormValues = (s: GeneralSettings): SettingsFormValues => ({
  compnyName: s.compnyName ?? '',
  attachPath: s.attachPath ?? '',
  attachMaxSizeMB: s.attachMaxSizeMB,
  sapServer: s.sapServer ?? '',
  sapDbServerType: s.sapDbServerType,
  sapCompanyDB: s.sapCompanyDB ?? '',
  sapUseTrusted: s.sapUseTrusted,
  sapDbUserName: s.sapDbUserName ?? '',
  // Saved passwords are never sent to the screen; typing one replaces it
  sapDbPassword: '',
  sapUserName: s.sapUserName ?? '',
  sapPassword: '',
  sapLicenseServer: s.sapLicenseServer ?? '',
  sapSLDServer: s.sapSLDServer ?? '',
  smtpHost: s.smtpHost ?? '',
  smtpPort: s.smtpPort,
  smtpSecurity: s.smtpSecurity,
  smtpUserName: s.smtpUserName ?? '',
  smtpPassword: '',
  smtpFromEmail: s.smtpFromEmail ?? '',
  smtpFromName: s.smtpFromName ?? '',
  apprEmail: !!s.apprEmail,
  portalUrl: s.portalUrl ?? '',
  payCashAcct: s.payCashAcct,
  payCheckAcct: s.payCheckAcct,
  payCreditCard: s.payCreditCard,
  defaultPriceList: s.defaultPriceList,
});

/** Defaults the first time, before the settings have been saved */
const NEW_VALUES: Partial<SettingsFormValues> = { attachMaxSizeMB: 20, sapUseTrusted: false, apprEmail: false };

/** The SMTP fields of the form, as the server takes them (empty password = keep / use the saved one) */
const smtpPayload = (v: SettingsFormValues) => ({
  smtpHost: v.smtpHost || null,
  smtpPort: v.smtpPort ?? null,
  smtpSecurity: v.smtpSecurity || null,
  smtpUserName: v.smtpUserName || null,
  smtpPassword: v.smtpPassword || null,
  smtpFromEmail: v.smtpFromEmail || null,
  smtpFromName: v.smtpFromName || null,
});

/** View-mode DB Server Type: the name for the stored code */
function ServerTypeName({ value, serverTypes }: { value?: string | null; serverTypes: ServerType[] }) {
  return <ReadOnlyText value={serverTypes.find((t) => t.code === value)?.name ?? value} />;
}

/** View-mode SMTP Security: its label for the stored code */
function SmtpSecurityName({ value }: { value?: string | null }) {
  return <ReadOnlyText value={SMTP_SECURITY_OPTIONS.find((o) => o.value === value)?.label ?? value ?? ''} />;
}

/**
 * View-mode password: dots when one is saved, nothing when not. DisplayText, not ReadOnlyText: inside a named
 * Form.Item the form would pass its own (empty) value and hide the dots.
 */
const savedPassword = (saved: boolean) => <DisplayText text={saved ? '••••••••' : ''} />;

/**
 * General Settings (FTS11OADM): one record for the whole portal — company name, attachment folder and size,
 * SAP B1 DI API connection. Always opens in view mode (even before anything is saved); Edit unlocks it.
 */
export default function GeneralSettingsDetail() {
  const { message, modal } = App.useApp();
  // Read Only screen (the user's roles): no New / Edit
  const canChange = useCanChange();
  // My own e-mail: where the test e-mail goes to start with
  const authUser = useAuthStore((s) => s.user);
  const [settings, setSettings] = useState<GeneralSettings | null>(null);
  const [serverTypes, setServerTypes] = useState<ServerType[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [form] = Form.useForm<SettingsFormValues>();
  const useTrusted = Form.useWatch('sapUseTrusted', form);
  // Incoming Payment choices: SAP's postable G/L accounts and credit cards
  const [paymentLists, setPaymentLists] = useState<SapPaymentAccounts>({ accounts: [], creditCards: [] });
  // Default Price List choices: SAP's price lists
  const [priceLists, setPriceLists] = useState<SapPriceList[]>([]);

  useEffect(() => {
    generalSettingsAPI
      .getServerTypes()
      .then((res) => res.success && setServerTypes(res.data))
      .catch(() => message.error('Failed to load DB server types'));
    sapAPI
      .getPaymentAccounts()
      .then((res) => res.success && setPaymentLists(res.data))
      .catch(() => undefined);
    sapAPI
      .getPriceLists()
      .then((res) => res.success && setPriceLists(res.data))
      .catch(() => undefined);
    generalSettingsAPI
      .get()
      .then((res) => {
        if (!res.success) return;
        setSettings(res.data);
      })
      .catch(() => message.error('Failed to load general settings'))
      .finally(() => setLoading(false));
  }, []);

  // Fill the form once it is on screen (it isn't rendered while loading)
  useEffect(() => {
    if (!loading) form.setFieldsValue(settings ? toFormValues(settings) : NEW_VALUES);
  }, [loading]);

  const handleCancelEdit = () => {
    form.resetFields();
    form.setFieldsValue(settings ? toFormValues(settings) : NEW_VALUES);
    setEditing(false);
  };

  const handleSave = async (values: SettingsFormValues) => {
    if (!editing) return;
    setSaving(true);
    try {
      const res = await generalSettingsAPI.save({
        compnyName: values.compnyName || null,
        attachPath: values.attachPath || null,
        attachMaxSizeMB: values.attachMaxSizeMB,
        sapServer: values.sapServer || null,
        sapDbServerType: values.sapDbServerType || null,
        sapCompanyDB: values.sapCompanyDB || null,
        sapUseTrusted: !!values.sapUseTrusted,
        sapDbUserName: values.sapDbUserName || null,
        sapUserName: values.sapUserName || null,
        sapLicenseServer: values.sapLicenseServer || null,
        sapSLDServer: values.sapSLDServer || null,
        // Empty = keep the saved password
        sapDbPassword: values.sapDbPassword || null,
        sapPassword: values.sapPassword || null,
        ...smtpPayload(values),
        apprEmail: !!values.apprEmail,
        portalUrl: values.portalUrl || null,
        payCashAcct: values.payCashAcct || null,
        payCheckAcct: values.payCheckAcct || null,
        payCreditCard: values.payCreditCard ?? null,
        defaultPriceList: values.defaultPriceList ?? null,
      });
      if (res.success) {
        message.success('General settings saved');
        setSettings(res.data);
        form.setFieldsValue(toFormValues(res.data));
        setEditing(false);
      }
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: string } } };
      message.error(err.response?.data?.error || 'Failed to save general settings');
    } finally {
      setSaving(false);
    }
  };

  // Uses what is on screen, so settings can be tried before saving; an empty password means the saved one.
  // While it runs, the portal's LOADING overlay shows (a DI API log-on can take some seconds).
  const handleTestConnection = async () => {
    const v = form.getFieldsValue(true) as SettingsFormValues;
    setTesting(true);
    try {
      const res = await generalSettingsAPI.testConnection({
        sapServer: v.sapServer || null,
        sapDbServerType: v.sapDbServerType || null,
        sapCompanyDB: v.sapCompanyDB || null,
        sapUseTrusted: !!v.sapUseTrusted,
        sapDbUserName: v.sapDbUserName || null,
        sapDbPassword: v.sapDbPassword || null,
        sapUserName: v.sapUserName || null,
        sapPassword: v.sapPassword || null,
        sapLicenseServer: v.sapLicenseServer || null,
        sapSLDServer: v.sapSLDServer || null,
      });
      if (!res.success) return;
      const result = res.data;
      const content = `${result.message} (${result.seconds} s)`;
      if (result.success) modal.success({ title: 'Diapi Successfully connected !', content });
      else modal.error({ title: 'Connection failed', content });
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: string } } };
      modal.error({ title: 'Connection failed', content: err.response?.data?.error || 'Failed to test the connection' });
    } finally {
      setTesting(false);
    }
  };

  // Send Test Email: to an address asked first (my own e-mail to start with), with the SMTP settings on screen — they
  // may not be saved yet; an empty password means the saved one. The popup closes at once; the sending runs behind the
  // portal's LOADING overlay, then the mail server's answer (or error) is shown.
  const handleSendTestEmail = () => {
    let to = authUser?.email ?? '';
    modal.confirm({
      title: 'Send Test Email',
      icon: <MailOutlined />,
      content: (
        <>
          <p>Send a test e-mail with the SMTP settings on screen to:</p>
          <Input defaultValue={to} placeholder="e.g. you@company.com" onChange={(e) => (to = e.target.value)} />
        </>
      ),
      okText: 'Send',
      cancelText: 'Cancel',
      onOk: () => {
        void (async () => {
          const v = form.getFieldsValue(true) as SettingsFormValues;
          setTesting(true);
          try {
            const res = await generalSettingsAPI.testEmail({ ...smtpPayload(v), to: to.trim() });
            if (!res.success) return;
            const content = `${res.data.message} (${res.data.seconds} s)`;
            if (res.data.success) modal.success({ title: `Test e-mail sent to ${to.trim()}`, content });
            else modal.error({ title: 'Sending failed', content });
          } catch (error: unknown) {
            const err = error as { response?: { data?: { error?: string } } };
            modal.error({ title: 'Sending failed', content: err.response?.data?.error || 'Failed to send the test e-mail' });
          } finally {
            setTesting(false);
          }
        })();
      },
    });
  };

  // Incoming Payment accounts as "160000 - Cash"
  const accountOptions = paymentLists.accounts.map((a) => ({ value: a.acctCode, label: `${a.acctCode} - ${a.acctName}` }));
  const priceListOptions = priceLists.map((l) => ({ value: l.listNum, label: `${l.listNum} - ${l.listName}` }));
  const accountName = (code: string | null | undefined) => {
    if (!code) return '';
    const a = paymentLists.accounts.find((x) => x.acctCode === code);
    return a ? `${a.acctCode} - ${a.acctName}` : code;
  };

  if (loading) {
    // The portal's own loading overlay (LOADING... bar) shows while the data is fetched; nothing else is drawn meanwhile
    return null;
  }

  const toolbar = editing ? (
    <>
      <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={() => form.submit()}>
        Save
      </Button>
      <Button disabled={saving} onClick={handleCancelEdit}>Cancel</Button>
    </>
  ) : !canChange ? null : (
    <Button icon={<EditOutlined />} onClick={() => setEditing(true)}>
      Edit
    </Button>
  );

  const text = (max: number, placeholder?: string) =>
    editing ? <Input maxLength={max} placeholder={placeholder} /> : <ReadOnlyText />;

  const passwordBox = (saved: boolean, disabled = false) =>
    editing ? (
      <Input.Password
        autoComplete="new-password"
        maxLength={200}
        disabled={disabled}
        placeholder={saved ? 'Saved — type a new one to change it' : ''}
      />
    ) : (
      savedPassword(saved)
    );

  return (
    <Form form={form} {...detailFormProps(editing)} onFinish={handleSave}>
      <DetailView toolbar={toolbar} title={`General Settings${settings?.compnyName ? ` - ${settings.compnyName}` : ''}`}>
        <DetailSection title="Company" />
        <Form.Item label="Company Name" name="compnyName">
          {text(100)}
        </Form.Item>

        <DetailSection title="Files" />
        {/* Folder on the server where attachments are saved */}
        <Form.Item label="Attachment Folder" name="attachPath">
          {text(254, 'e.g. D:\\SalesPortal_Attachments')}
        </Form.Item>
        <Form.Item
          label="Max. File Size (MB)"
          name="attachMaxSizeMB"
          rules={[{ required: true, message: 'Max. File Size is required' }]}
        >
          {editing ? <InputNumber min={1} max={100} precision={0} /> : <ReadOnlyText />}
        </Form.Item>

        {/* SAP Business One DI API connection */}
        <DetailSection title="SAP DI API" />
        <Form.Item label="Trusted Connection" name="sapUseTrusted" valuePropName="checked">
          <Checkbox disabled={!editing} />
        </Form.Item>
        <Form.Item label="DB Server Type" name="sapDbServerType">
          {editing ? (
            <Select
              allowClear
              placeholder="Select a server type"
              options={serverTypes.map((t) => ({ value: t.code, label: t.name }))}
            />
          ) : (
            <ServerTypeName serverTypes={serverTypes} />
          )}
        </Form.Item>
        <Form.Item label="SAP DB Server" name="sapServer">
          {text(100, 'e.g. FT-PC')}
        </Form.Item>
        {/* SAP company database (SapCompanyDB) */}
        <Form.Item label="SAP Database" name="sapCompanyDB">
          {text(100, 'e.g. SBODemoGB')}
        </Form.Item>
        {/* A trusted (Windows) connection needs no database user / password */}
        <Form.Item label="DB User Name" name="sapDbUserName">
          {editing ? <Input maxLength={100} disabled={!!useTrusted} placeholder="e.g. sa" /> : <ReadOnlyText />}
        </Form.Item>
        <Form.Item label="DB Password" name="sapDbPassword">
          {passwordBox(!!settings?.hasSapDbPassword, !!useTrusted)}
        </Form.Item>
        <Form.Item label="SAP User Name" name="sapUserName">
          {text(100, 'e.g. manager')}
        </Form.Item>
        <Form.Item label="SAP Password" name="sapPassword">
          {passwordBox(!!settings?.hasSapPassword)}
        </Form.Item>
        <Form.Item label="License Server" name="sapLicenseServer">
          {text(100, 'e.g. FT-PC:40000')}
        </Form.Item>
        <Form.Item label="SLD Server" name="sapSLDServer">
          {text(100, 'e.g. https://FT-PC:40000')}
        </Form.Item>
        {/* Under the values, no label: logs on to SAP through DI API with the settings on screen */}
        <DetailButtonRow>
          <Button icon={<ApiOutlined />} disabled={testing || saving} onClick={handleTestConnection}>
            Test Connection
          </Button>
        </DetailButtonRow>

        {/* The mail server the portal sends e-mail through */}
        <DetailSection title="SMTP" />
        {/* Edit mode only: fills in the usual server, port and security; not saved */}
        {editing && (
          <Form.Item label="Provider">
            <Select
              allowClear
              placeholder="Gmail / Microsoft 365 / Other (fills in the settings below)"
              options={[
                { value: 'gmail', label: 'Gmail' },
                { value: 'microsoft365', label: 'Microsoft 365 (Office 365)' },
                { value: 'other', label: 'Other' },
              ]}
              onChange={(value?: string) => {
                const preset = value ? SMTP_PROVIDERS[value] : null;
                if (preset) form.setFieldsValue(preset);
              }}
            />
          </Form.Item>
        )}
        <Form.Item label="SMTP Server" name="smtpHost">
          {text(200, 'e.g. smtp.gmail.com')}
        </Form.Item>
        <Form.Item label="Port" name="smtpPort">
          {editing ? <InputNumber min={1} max={65535} precision={0} controls={false} placeholder="e.g. 587" /> : <ReadOnlyText />}
        </Form.Item>
        <Form.Item label="Security" name="smtpSecurity">
          {editing ? (
            <Select allowClear placeholder="Select security" options={SMTP_SECURITY_OPTIONS} />
          ) : (
            <SmtpSecurityName />
          )}
        </Form.Item>
        <Form.Item label="User Name" name="smtpUserName">
          {text(200, 'e.g. sales@company.com')}
        </Form.Item>
        {/* Gmail / Microsoft 365 usually need an app password, not the account's normal password */}
        <Form.Item
          label="Password"
          name="smtpPassword"
          extra={editing ? 'Gmail / Microsoft 365: use an app password, not the normal sign-in password.' : undefined}
        >
          {passwordBox(!!settings?.hasSmtpPassword)}
        </Form.Item>
        <Form.Item
          label="From E-mail"
          name="smtpFromEmail"
          rules={[{ type: 'email', message: 'Enter a valid e-mail address' }]}
        >
          {text(200, 'e.g. sales@company.com')}
        </Form.Item>
        <Form.Item label="From Name" name="smtpFromName">
          {text(200, 'e.g. AJI Sales Portal')}
        </Form.Item>
        {/* Approvers get an e-mail when a document waits for them; the sender when it is approved / rejected / changed
            while approving. To each user's E-mail (Users); a user without one gets the bell only. */}
        <Form.Item label="E-mail Approvals" name="apprEmail" valuePropName="checked">
          <Checkbox disabled={!editing} />
        </Form.Item>
        {/* The portal's address as users open it: the approval e-mails link to the document there */}
        <Form.Item
          label="Portal Address"
          name="portalUrl"
          extra={editing ? 'As users open the portal, e.g. https://portal.company.com - the approval e-mails link to it.' : undefined}
          rules={[{ pattern: /^https?:\/\/\S+$/i, message: 'Start with https:// or http://' }]}
        >
          {text(200, 'e.g. https://portal.company.com')}
        </Form.Item>
        {/* Under the values, no label: sends a test e-mail with the SMTP settings on screen */}
        <DetailButtonRow>
          <Button icon={<MailOutlined />} disabled={testing || saving} onClick={handleSendTestEmail}>
            Send Test Email
          </Button>
        </DetailButtonRow>

        {/* Posting a Temporary Receipt to SAP as an Incoming Payment: where its cash / cheques / credit card go. A bank
            transfer uses the chosen bank's G/L account; the bank charge SAP's own Bank Charges account. */}
        <DetailSection title="Incoming Payment" />
        <Form.Item label="Cash Account" name="payCashAcct">
          {editing ? (
            <Select allowClear showSearch optionFilterProp="label" placeholder="G/L account for cash" options={accountOptions} />
          ) : (
            <DisplayText text={accountName(settings?.payCashAcct)} />
          )}
        </Form.Item>
        <Form.Item label="Cheque Account" name="payCheckAcct">
          {editing ? (
            <Select allowClear showSearch optionFilterProp="label" placeholder="G/L account for cheques" options={accountOptions} />
          ) : (
            <DisplayText text={accountName(settings?.payCheckAcct)} />
          )}
        </Form.Item>
        <Form.Item label="Credit Card" name="payCreditCard">
          {editing ? (
            <Select
              allowClear
              placeholder="SAP credit card"
              options={paymentLists.creditCards.map((c) => ({ value: c.creditCard, label: c.cardName }))}
            />
          ) : (
            <DisplayText text={paymentLists.creditCards.find((c) => c.creditCard === settings?.payCreditCard)?.cardName ?? ''} />
          )}
        </Form.Item>

        {/* Item prices on quotations and orders come from the customer's own price list (as in SAP B1); this one is used
            when there is no SAP customer to take one from: a lead, or no customer chosen yet */}
        <DetailSection title="Sales" />
        <Form.Item label="Default Price List" name="defaultPriceList">
          {editing ? (
            <Select allowClear showSearch optionFilterProp="label" placeholder="For a lead or no customer" options={priceListOptions} />
          ) : (
            <DisplayText text={priceListOptions.find((o) => o.value === settings?.defaultPriceList)?.label ?? ''} />
          )}
        </Form.Item>
      </DetailView>
    </Form>
  );
}

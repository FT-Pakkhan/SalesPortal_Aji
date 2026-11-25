import { access, mkdir } from 'fs/promises';
import { constants } from 'fs';
import path from 'path';
import { db } from './db';
import { ValidationError } from './errors';
import { decryptSecret, encryptSecret } from './secretBox';
import type { DiApiLogon } from './diApi';
import { DEFAULT_ATTACH_MAX_MB } from './attachmentRules';
import { sapTable } from './sapDb';
import { rememberSapDatabase } from './companyContext';

interface SettingsRow {
  CompnyName: string | null;
  AttachPath: string | null;
  AttachMaxSizeMB: number;
  SapServer: string | null;
  SapDbServerType: string | null;
  SapCompanyDB: string | null;
  SapUseTrusted: boolean;
  SapDbUserName: string | null;
  SapDbPassword: string | null;
  SapUserName: string | null;
  SapPassword: string | null;
  SapLicenseServer: string | null;
  SapSLDServer: string | null;
  SmtpHost: string | null;
  SmtpPort: number | null;
  SmtpSecurity: string | null;
  SmtpUserName: string | null;
  SmtpPassword: string | null;
  SmtpFromEmail: string | null;
  SmtpFromName: string | null;
  ApprEmail: boolean;
  PortalUrl: string | null;
  PayCashAcct: string | null;
  PayCheckAcct: string | null;
  PayCreditCard: number | null;
  DefaultPriceList: number | null;
  UpdatedBy: string | null;
  UpdatedDate: Date | null;
}

async function readRow(): Promise<SettingsRow | null> {
  const rows = await db.query<SettingsRow>(
    `SELECT CompnyName, AttachPath, AttachMaxSizeMB, SapServer, SapDbServerType, SapCompanyDB, SapUseTrusted,
            SapDbUserName, SapDbPassword, SapUserName, SapPassword, SapLicenseServer, SapSLDServer,
            SmtpHost, SmtpPort, SmtpSecurity, SmtpUserName, SmtpPassword, SmtpFromEmail, SmtpFromName,
            ApprEmail, PortalUrl,
            PayCashAcct, PayCheckAcct, PayCreditCard, DefaultPriceList,
            UpdatedBy, UpdatedDate
     FROM FTS11OADM WHERE DocEntry = 1`
  );
  return rows[0] ?? null;
}

/**
 * General Settings for the screen. Passwords are never sent out: only whether one has been saved.
 * Null when the settings have never been saved.
 */
export async function getGeneralSettings() {
  const row = await readRow();
  if (!row) return null;
  const { SapDbPassword, SapPassword, SmtpPassword, ...rest } = row;
  return { ...rest, HasSapDbPassword: !!SapDbPassword, HasSapPassword: !!SapPassword, HasSmtpPassword: !!SmtpPassword };
}

/** SMTP security: NONE (plain), SSL (SSL/TLS from the start, usually 465), STARTTLS (usually 587) */
export const SMTP_SECURITY = ['NONE', 'SSL', 'STARTTLS'] as const;
export type SmtpSecurity = (typeof SMTP_SECURITY)[number];

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Attachment folder and size limit, for the attachments feature */
export async function getAttachmentSettings(): Promise<{ folder: string | null; maxMB: number }> {
  const row = await readRow();
  return { folder: row?.AttachPath ?? null, maxMB: row?.AttachMaxSizeMB ?? DEFAULT_ATTACH_MAX_MB };
}

export interface SettingsFields {
  compnyName: string | null;
  attachPath: string | null;
  attachMaxSizeMB: number;
  sapServer: string | null;
  sapDbServerType: string | null;
  sapCompanyDB: string | null;
  sapUseTrusted: boolean;
  sapDbUserName: string | null;
  sapUserName: string | null;
  sapLicenseServer: string | null;
  sapSLDServer: string | null;
  /** New password typed; null = keep the saved one */
  sapDbPassword: string | null;
  sapPassword: string | null;
  smtpHost: string | null;
  smtpPort: number | null;
  smtpSecurity: SmtpSecurity | null;
  smtpUserName: string | null;
  /** New password typed; null = keep the saved one */
  smtpPassword: string | null;
  smtpFromEmail: string | null;
  smtpFromName: string | null;
  /** E-mail approval notifications on (approvers when waiting; the sender when approved / rejected / changed) */
  apprEmail: boolean;
  /** The portal's address as users open it, for links in e-mails */
  portalUrl: string | null;
  /** Incoming Payment: Cash / Cheque G/L accounts and credit card, for posting Temporary Receipts to SAP */
  payCashAcct: string | null;
  payCheckAcct: string | null;
  payCreditCard: number | null;
  /** SAP price list (OPLN.ListNum) for a lead or no customer; a customer's own price list comes first */
  defaultPriceList: number | null;
}

const optionalText = (value: unknown, label: string, max: number): string | null => {
  const text = String(value ?? '').trim();
  if (text.length > max) throw new ValidationError(`${label} must be ${max} characters or fewer`);
  return text || null;
};

/** Passwords are kept exactly as typed (spaces included); empty means "keep the saved one" */
const newPassword = (value: unknown, label: string): string | null => {
  const text = String(value ?? '');
  if (text.length > 200) throw new ValidationError(`${label} is too long`);
  return text.length > 0 ? text : null;
};

/** Validate a save request for General Settings */
export function parseSettingsFields(body: Record<string, unknown>): SettingsFields {
  const attachMaxSizeMB = Number(body.attachMaxSizeMB);
  if (!Number.isInteger(attachMaxSizeMB) || attachMaxSizeMB < 1 || attachMaxSizeMB > 100) {
    throw new ValidationError('Max. File Size must be a whole number from 1 to 100 MB');
  }

  const attachPath = optionalText(body.attachPath, 'Attachment Folder', 254);
  if (attachPath && !path.isAbsolute(attachPath)) {
    throw new ValidationError('Attachment Folder must be a full path on the server, e.g. D:\\SalesPortal_Attachments');
  }

  const smtpPort = body.smtpPort === null || body.smtpPort === undefined || body.smtpPort === '' ? null : Number(body.smtpPort);
  if (smtpPort !== null && (!Number.isInteger(smtpPort) || smtpPort < 1 || smtpPort > 65535)) {
    throw new ValidationError('SMTP Port must be a whole number from 1 to 65535');
  }
  const smtpSecurity = (optionalText(body.smtpSecurity, 'Security', 20) as SmtpSecurity | null) ?? null;
  if (smtpSecurity && !SMTP_SECURITY.includes(smtpSecurity)) throw new ValidationError('Security must be None, SSL or STARTTLS');
  const smtpFromEmail = optionalText(body.smtpFromEmail, 'From E-mail', 200);
  if (smtpFromEmail && !EMAIL_PATTERN.test(smtpFromEmail)) throw new ValidationError('From E-mail is not a valid e-mail address');
  const portalUrl = optionalText(body.portalUrl, 'Portal Address', 200)?.replace(/\/+$/, '') ?? null;
  if (portalUrl && !/^https?:\/\/[^\s/]+(\/[^\s]*)?$/i.test(portalUrl)) {
    throw new ValidationError('Portal Address must start with https:// or http://, e.g. https://portal.company.com');
  }
  const apprEmail = body.apprEmail === true;
  if (apprEmail && !portalUrl) throw new ValidationError('Fill in Portal Address to e-mail approval notifications (the e-mails link to it)');

  return {
    smtpHost: optionalText(body.smtpHost, 'SMTP Server', 200),
    smtpPort,
    smtpSecurity,
    smtpUserName: optionalText(body.smtpUserName, 'SMTP User Name', 200),
    smtpPassword: newPassword(body.smtpPassword, 'SMTP Password'),
    smtpFromEmail,
    smtpFromName: optionalText(body.smtpFromName, 'From Name', 200),
    apprEmail,
    portalUrl,
    payCashAcct: optionalText(body.payCashAcct, 'Cash Account', 15),
    payCheckAcct: optionalText(body.payCheckAcct, 'Cheque Account', 15),
    payCreditCard: body.payCreditCard === null || body.payCreditCard === undefined || body.payCreditCard === '' ? null : Number(body.payCreditCard),
    defaultPriceList: body.defaultPriceList === null || body.defaultPriceList === undefined || body.defaultPriceList === '' ? null : Number(body.defaultPriceList),
    compnyName: optionalText(body.compnyName, 'Company Name', 100),
    attachPath,
    attachMaxSizeMB,
    sapServer: optionalText(body.sapServer, 'Server', 100),
    sapDbServerType: optionalText(body.sapDbServerType, 'DB Server Type', 30),
    sapCompanyDB: optionalText(body.sapCompanyDB, 'SAP Database', 100),
    sapUseTrusted: body.sapUseTrusted === true,
    sapDbUserName: optionalText(body.sapDbUserName, 'DB User Name', 100),
    sapUserName: optionalText(body.sapUserName, 'SAP User Name', 100),
    sapLicenseServer: optionalText(body.sapLicenseServer, 'License Server', 100),
    sapSLDServer: optionalText(body.sapSLDServer, 'SLD Server', 100),
    sapDbPassword: newPassword(body.sapDbPassword, 'DB Password'),
    sapPassword: newPassword(body.sapPassword, 'SAP Password'),
  };
}

/**
 * DI API log-on details for Test Connection: the SAP DI API settings as typed on the screen (they may not be saved
 * yet); a password left empty means the saved one. Checks that everything DI API needs is there.
 */
export async function getDiApiLogon(body: Record<string, unknown>): Promise<DiApiLogon> {
  const fields = parseSettingsFields({ ...body, attachMaxSizeMB: body.attachMaxSizeMB ?? DEFAULT_ATTACH_MAX_MB });
  const saved = await readRow();
  const dbPassword = fields.sapDbPassword ?? (saved?.SapDbPassword ? decryptSecret(saved.SapDbPassword) : null);
  const password = fields.sapPassword ?? (saved?.SapPassword ? decryptSecret(saved.SapPassword) : null);

  const missing = [
    !fields.sapDbServerType && 'DB Server Type',
    !fields.sapServer && 'SAP DB Server',
    !fields.sapCompanyDB && 'SAP Database',
    !fields.sapUseTrusted && !fields.sapDbUserName && 'DB User Name',
    !fields.sapUseTrusted && !dbPassword && 'DB Password',
    !fields.sapUserName && 'SAP User Name',
    !password && 'SAP Password',
  ].filter(Boolean);
  if (missing.length > 0) throw new ValidationError(`Fill in ${missing.join(', ')} to test the connection`);

  return {
    server: fields.sapServer as string,
    dbServerType: fields.sapDbServerType as string,
    companyDB: fields.sapCompanyDB as string,
    useTrusted: fields.sapUseTrusted,
    dbUserName: fields.sapDbUserName,
    dbPassword,
    userName: fields.sapUserName as string,
    password: password as string,
    licenseServer: fields.sapLicenseServer,
    sldServer: fields.sapSLDServer,
  };
}

/**
 * DI API log-on details as saved in General Settings (passwords decrypted), for posting to SAP. Checks that
 * everything DI API needs has been saved.
 */
export async function getSavedDiApiLogon(): Promise<DiApiLogon> {
  const s = await readRow();
  if (!s) throw new ValidationError('Fill in SAP DI API in General Settings before posting to SAP');
  const dbPassword = s.SapDbPassword ? decryptSecret(s.SapDbPassword) : null;
  const password = s.SapPassword ? decryptSecret(s.SapPassword) : null;
  const missing = [
    !s.SapDbServerType && 'DB Server Type',
    !s.SapServer && 'SAP DB Server',
    !s.SapCompanyDB && 'SAP Database',
    !s.SapUseTrusted && !s.SapDbUserName && 'DB User Name',
    !s.SapUseTrusted && !dbPassword && 'DB Password',
    !s.SapUserName && 'SAP User Name',
    !password && 'SAP Password',
  ].filter(Boolean);
  if (missing.length > 0) throw new ValidationError(`Fill in ${missing.join(', ')} in General Settings > SAP DI API before posting to SAP`);
  return {
    server: s.SapServer as string,
    dbServerType: s.SapDbServerType as string,
    companyDB: s.SapCompanyDB as string,
    useTrusted: s.SapUseTrusted,
    dbUserName: s.SapDbUserName,
    dbPassword,
    userName: s.SapUserName as string,
    password: password as string,
    licenseServer: s.SapLicenseServer,
    sldServer: s.SapSLDServer,
  };
}

/** A database login (server, database, user) for programs that connect on their own, e.g. Crystal Reports */
export interface DbLogon {
  server: string;
  database: string;
  /** Empty = Windows login */
  user: string;
  password: string;
}

/**
 * The SAP company database login saved in General Settings > SAP DI API (SAP DB Server, SAP Database, DB User Name /
 * DB Password, or the Windows login when Use Trusted is ticked), password decrypted. Only the database part is
 * needed, not the SAP user.
 */
export async function getSapDbLogon(): Promise<DbLogon> {
  const s = await readRow();
  const dbPassword = s?.SapDbPassword ? decryptSecret(s.SapDbPassword) : null;
  const missing = [
    !s?.SapServer && 'SAP DB Server',
    !s?.SapCompanyDB && 'SAP Database',
    !s?.SapUseTrusted && !s?.SapDbUserName && 'DB User Name',
    !s?.SapUseTrusted && !dbPassword && 'DB Password',
  ].filter(Boolean);
  if (!s || missing.length > 0) {
    throw new ValidationError(`Fill in ${missing.join(', ') || 'SAP DI API'} in General Settings > SAP DI API: this report uses its connection`);
  }
  return {
    server: s.SapServer as string,
    database: s.SapCompanyDB as string,
    user: s.SapUseTrusted ? '' : (s.SapDbUserName as string),
    password: s.SapUseTrusted ? '' : (dbPassword as string),
  };
}

/** How the portal sends e-mail (General Settings > SMTP) */
export interface SmtpConfig {
  host: string;
  port: number;
  security: SmtpSecurity;
  userName: string | null;
  password: string | null;
  fromEmail: string;
  fromName: string | null;
}

/**
 * SMTP settings for Send Test Email: as typed on the screen (they may not be saved yet); a password left empty means
 * the saved one. Checks that everything needed to send is there.
 */
export async function getSmtpConfig(body: Record<string, unknown>): Promise<SmtpConfig> {
  const fields = parseSettingsFields({ ...body, attachMaxSizeMB: body.attachMaxSizeMB ?? DEFAULT_ATTACH_MAX_MB });
  const saved = await readRow();
  const password = fields.smtpPassword ?? (saved?.SmtpPassword ? decryptSecret(saved.SmtpPassword) : null);
  const missing = [
    !fields.smtpHost && 'SMTP Server',
    !fields.smtpPort && 'Port',
    !fields.smtpSecurity && 'Security',
    !fields.smtpFromEmail && 'From E-mail',
    fields.smtpUserName && !password && 'Password',
  ].filter(Boolean);
  if (missing.length > 0) throw new ValidationError(`Fill in ${missing.join(', ')} to send a test e-mail`);
  return {
    host: fields.smtpHost as string,
    port: fields.smtpPort as number,
    security: fields.smtpSecurity as SmtpSecurity,
    userName: fields.smtpUserName,
    password,
    fromEmail: fields.smtpFromEmail as string,
    fromName: fields.smtpFromName,
  };
}

/**
 * The SAP company database's name: SAP Database in General Settings > SAP DI API, or else SAP_DB_NAME. Only letters,
 * digits, _ and - (it is placed into SQL text).
 */
export async function getSapCompanyDbName(): Promise<string> {
  const s = await readRow();
  const name = (s?.SapCompanyDB as string | null) || process.env.SAP_DB_NAME || '';
  if (!/^[A-Za-z0-9_-]+$/.test(name)) throw new ValidationError('The SAP Database in General Settings > SAP DI API is not set or not valid');
  return name;
}

/**
 * Incoming Payment settings must exist in SAP: the Cash / Cheque accounts as active postable G/L accounts (OACT), the
 * credit card in OCRC. Checked when General Settings are saved.
 */
export async function assertIncomingPaymentSettings(fields: SettingsFields): Promise<void> {
  for (const [code, label] of [[fields.payCashAcct, 'Cash Account'], [fields.payCheckAcct, 'Cheque Account']] as const) {
    if (!code) continue;
    const acct = await db.query<{ Postable: string; FrozenFor: string }>(
      `SELECT Postable, FrozenFor FROM ${sapTable('OACT')} WHERE AcctCode = @code`,
      [{ name: 'code', value: code }]
    );
    if (acct.length === 0) throw new ValidationError(`Incoming Payment: ${label} ${code} is not a G/L account in SAP`);
    if (acct[0].Postable !== 'Y') throw new ValidationError(`Incoming Payment: ${label} ${code} is a title account; choose an active account`);
  }
  if (fields.payCreditCard !== null) {
    if (!Number.isInteger(fields.payCreditCard)) throw new ValidationError('Incoming Payment: Credit Card is not valid');
    const card = await db.query(`SELECT CreditCard FROM ${sapTable('OCRC')} WHERE CreditCard = @card`, [{ name: 'card', value: fields.payCreditCard }]);
    if (card.length === 0) throw new ValidationError("Incoming Payment: the Credit Card is not one of SAP's credit cards");
  }
}

/** The Default Price List must be one of SAP's price lists (OPLN). Checked when General Settings are saved. */
export async function assertPriceListExists(listNum: number | null): Promise<void> {
  if (listNum === null) return;
  if (!Number.isInteger(listNum)) throw new ValidationError('Default Price List is not valid');
  const found = await db.query(`SELECT ListNum FROM ${sapTable('OPLN')} WHERE ListNum = @listNum`, [{ name: 'listNum', value: listNum }]);
  if (found.length === 0) throw new ValidationError("Default Price List is not one of SAP's price lists");
}

/** The Incoming Payment settings (General Settings), for posting a Temporary Receipt to SAP */
export async function getIncomingPaymentSettings(): Promise<{ cashAcct: string | null; checkAcct: string | null; creditCard: number | null }> {
  const s = await readRow();
  return { cashAcct: s?.PayCashAcct ?? null, checkAcct: s?.PayCheckAcct ?? null, creditCard: s?.PayCreditCard ?? null };
}

/** The SMTP settings as saved in General Settings (password decrypted), for e-mailing from the portal */
export async function getSavedSmtpConfig(): Promise<SmtpConfig> {
  const s = await readRow();
  const password = s?.SmtpPassword ? decryptSecret(s.SmtpPassword) : null;
  const missing = [
    !s?.SmtpHost && 'SMTP Server',
    !s?.SmtpPort && 'Port',
    !s?.SmtpSecurity && 'Security',
    !s?.SmtpFromEmail && 'From E-mail',
    s?.SmtpUserName && !password && 'Password',
  ].filter(Boolean);
  if (!s || missing.length > 0) throw new ValidationError(`Fill in ${missing.join(', ') || 'SMTP'} in General Settings > SMTP before sending e-mail`);
  return {
    host: s.SmtpHost as string,
    port: Number(s.SmtpPort),
    security: s.SmtpSecurity as SmtpSecurity,
    userName: s.SmtpUserName,
    password,
    fromEmail: s.SmtpFromEmail as string,
    fromName: s.SmtpFromName,
  };
}

/** E-mail approval notifications: on, and the portal's address for the links (null when off) */
export async function getApprovalEmailSettings(): Promise<{ portalUrl: string } | null> {
  const s = await readRow();
  return s?.ApprEmail && s.PortalUrl ? { portalUrl: s.PortalUrl } : null;
}

/** DB Server Type must be one of FTS_vw_SvrTyp (a view can't carry a foreign key) */
export async function assertServerTypeExists(code: string | null): Promise<void> {
  if (!code) return;
  const found = await db.query(`SELECT Code FROM FTS_vw_SvrTyp WHERE Code = @code`, [{ name: 'code', value: code }]);
  if (found.length === 0) throw new ValidationError('DB Server Type is not valid');
}

/** The attachment folder must exist (it is created if missing) and be writable by the portal */
export async function assertFolderUsable(folder: string | null): Promise<void> {
  if (!folder) return;
  try {
    await mkdir(folder, { recursive: true });
    await access(folder, constants.W_OK);
  } catch {
    throw new ValidationError(`The portal can't create or write to the folder ${folder}`);
  }
}

/** Insert the settings row the first time, update it afterwards. A new password replaces the saved one; none keeps it. */
export async function saveGeneralSettings(fields: SettingsFields, userName: string): Promise<void> {
  const params = [
    { name: 'compnyName', value: fields.compnyName },
    { name: 'attachPath', value: fields.attachPath },
    { name: 'attachMaxSizeMB', value: fields.attachMaxSizeMB },
    { name: 'sapServer', value: fields.sapServer },
    { name: 'sapDbServerType', value: fields.sapDbServerType },
    { name: 'sapCompanyDB', value: fields.sapCompanyDB },
    { name: 'sapUseTrusted', value: fields.sapUseTrusted ? 1 : 0 },
    { name: 'sapDbUserName', value: fields.sapDbUserName },
    { name: 'sapUserName', value: fields.sapUserName },
    { name: 'sapLicenseServer', value: fields.sapLicenseServer },
    { name: 'sapSLDServer', value: fields.sapSLDServer },
    { name: 'sapDbPassword', value: fields.sapDbPassword ? encryptSecret(fields.sapDbPassword) : null },
    { name: 'sapPassword', value: fields.sapPassword ? encryptSecret(fields.sapPassword) : null },
    { name: 'smtpHost', value: fields.smtpHost },
    { name: 'smtpPort', value: fields.smtpPort },
    { name: 'smtpSecurity', value: fields.smtpSecurity },
    { name: 'smtpUserName', value: fields.smtpUserName },
    { name: 'smtpPassword', value: fields.smtpPassword ? encryptSecret(fields.smtpPassword) : null },
    { name: 'smtpFromEmail', value: fields.smtpFromEmail },
    { name: 'smtpFromName', value: fields.smtpFromName },
    { name: 'apprEmail', value: fields.apprEmail ? 1 : 0 },
    { name: 'portalUrl', value: fields.portalUrl },
    { name: 'payCashAcct', value: fields.payCashAcct },
    { name: 'payCheckAcct', value: fields.payCheckAcct },
    { name: 'payCreditCard', value: fields.payCreditCard },
    { name: 'defaultPriceList', value: fields.defaultPriceList },
    { name: 'userName', value: userName },
  ];

  await db.query(
    `IF EXISTS (SELECT 1 FROM FTS11OADM WHERE DocEntry = 1)
       UPDATE FTS11OADM
       SET CompnyName = @compnyName, AttachPath = @attachPath, AttachMaxSizeMB = @attachMaxSizeMB,
           SapServer = @sapServer, SapDbServerType = @sapDbServerType, SapCompanyDB = @sapCompanyDB,
           SapUseTrusted = @sapUseTrusted, SapDbUserName = @sapDbUserName, SapUserName = @sapUserName,
           SapLicenseServer = @sapLicenseServer, SapSLDServer = @sapSLDServer,
           -- CAST: an empty parameter is sent as 1 character wide, which would cut the kept password short
           SapDbPassword = ISNULL(CAST(@sapDbPassword AS NVARCHAR(500)), SapDbPassword),
           SapPassword = ISNULL(CAST(@sapPassword AS NVARCHAR(500)), SapPassword),
           SmtpHost = @smtpHost, SmtpPort = @smtpPort, SmtpSecurity = @smtpSecurity, SmtpUserName = @smtpUserName,
           SmtpPassword = ISNULL(CAST(@smtpPassword AS NVARCHAR(1000)), SmtpPassword),
           SmtpFromEmail = @smtpFromEmail, SmtpFromName = @smtpFromName,
           ApprEmail = @apprEmail, PortalUrl = @portalUrl,
           PayCashAcct = @payCashAcct, PayCheckAcct = @payCheckAcct, PayCreditCard = @payCreditCard,
           DefaultPriceList = @defaultPriceList,
           UpdatedBy = @userName, UpdatedDate = GETDATE()
       WHERE DocEntry = 1
     ELSE
       INSERT INTO FTS11OADM (DocEntry, CompnyName, AttachPath, AttachMaxSizeMB, SapServer, SapDbServerType, SapCompanyDB,
                              SapUseTrusted, SapDbUserName, SapDbPassword, SapUserName, SapPassword, SapLicenseServer, SapSLDServer,
                              SmtpHost, SmtpPort, SmtpSecurity, SmtpUserName, SmtpPassword, SmtpFromEmail, SmtpFromName,
                              ApprEmail, PortalUrl,
                              PayCashAcct, PayCheckAcct, PayCreditCard, DefaultPriceList,
                              CreatedBy, CreatedDate, UpdatedBy, UpdatedDate)
       VALUES (1, @compnyName, @attachPath, @attachMaxSizeMB, @sapServer, @sapDbServerType, @sapCompanyDB,
               @sapUseTrusted, @sapDbUserName, @sapDbPassword, @sapUserName, @sapPassword, @sapLicenseServer, @sapSLDServer,
               @smtpHost, @smtpPort, @smtpSecurity, @smtpUserName, @smtpPassword, @smtpFromEmail, @smtpFromName,
               @apprEmail, @portalUrl,
               @payCashAcct, @payCheckAcct, @payCreditCard, @defaultPriceList,
               @userName, GETDATE(), @userName, GETDATE())`,
    params
  );
  // Several companies: SAP data is read from the new SAP Database straight away (logins carry the old one)
  rememberSapDatabase(fields.sapCompanyDB);
}

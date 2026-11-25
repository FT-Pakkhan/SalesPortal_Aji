import nodemailer from 'nodemailer';
import type { SmtpConfig } from './generalSettings';

// Sending e-mail through the mail server in General Settings > SMTP (nodemailer).

/** How long to wait for the mail server at each step */
const TIMEOUT_MS = 20_000;

function transportFor(config: SmtpConfig) {
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    // SSL: encrypted from the start (usually 465). STARTTLS: starts plain, must switch to encrypted (usually 587).
    // NONE: plain, never encrypted.
    secure: config.security === 'SSL',
    requireTLS: config.security === 'STARTTLS',
    ignoreTLS: config.security === 'NONE',
    auth: config.userName ? { user: config.userName, pass: config.password ?? '' } : undefined,
    connectionTimeout: TIMEOUT_MS,
    greetingTimeout: TIMEOUT_MS,
    socketTimeout: TIMEOUT_MS,
  });
}

export interface MailResult {
  success: boolean;
  /** Sent: the mail server's answer. Failed: its error, as it gave it. */
  message: string;
  seconds: number;
}

/** An e-mail: To / CC may hold several addresses separated by ";" or ","; attachments are files in memory */
export interface MailMessage {
  to: string;
  cc?: string | null;
  subject: string;
  text: string;
  /** Optional HTML version (the text one stays for mail programs that show plain text) */
  html?: string;
  attachments?: { filename: string; content: Buffer; contentType?: string }[];
}

/** Send one e-mail; never throws — a failure comes back with the mail server's own error */
export async function sendMail(config: SmtpConfig, mail: MailMessage): Promise<MailResult> {
  const started = Date.now();
  const seconds = () => Math.round((Date.now() - started) / 100) / 10;
  try {
    const info = await transportFor(config).sendMail({
      from: config.fromName ? { name: config.fromName, address: config.fromEmail } : config.fromEmail,
      to: mail.to,
      cc: mail.cc || undefined,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
      attachments: mail.attachments,
    });
    return { success: true, message: `Accepted by the mail server: ${info.response ?? 'OK'}`, seconds: seconds() };
  } catch (error) {
    const err = error as { message?: string; response?: string; code?: string };
    const detail = err.response || err.message || String(error);
    return { success: false, message: err.code ? `${err.code}: ${detail}` : detail, seconds: seconds() };
  }
}

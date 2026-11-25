import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

// Encrypts secrets kept in the database (the SAP passwords in General Settings) with AES-256-GCM.
// The key is SETTINGS_SECRET_KEY in .env.local (32 random bytes, base64) — never stored in the database.
// Stored form: v1:<iv>:<auth tag>:<encrypted>, each part base64.

function secretKey(): Buffer {
  const key = Buffer.from(process.env.SETTINGS_SECRET_KEY ?? '', 'base64');
  if (key.length !== 32) throw new Error('SETTINGS_SECRET_KEY is missing or not 32 bytes');
  return key;
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', secretKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), encrypted.toString('base64')].join(':');
}

export function decryptSecret(stored: string): string {
  const [version, iv, tag, data] = stored.split(':');
  if (version !== 'v1' || !iv || !tag || !data) throw new Error('Stored secret is not in a known format');
  const decipher = createDecipheriv('aes-256-gcm', secretKey(), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
}

/**
 * Symmetric encryption helpers for storing OAuth tokens & API keys at rest.
 *
 * Algorithm: AES-256-GCM with a 12-byte random nonce per ciphertext.
 * Output format (base64): `<nonce(12)><ciphertext><authTag(16)>` packed,
 * then base64-encoded as a single string for easy DB storage.
 *
 * Key: 32 bytes, supplied via APP_ENCRYPTION_KEY env (base64).
 *      Generate with: `openssl rand -base64 32`
 *
 * NOTE: Rotating the key requires a one-off migration that decrypts every
 * stored ciphertext with the old key and re-encrypts with the new one.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { env } from '../config/env.js';

const ALGO = 'aes-256-gcm';
const NONCE_LEN = 12;
const TAG_LEN = 16;

let cachedKey: Buffer | null = null;
function getKey(): Buffer {
  if (cachedKey) return cachedKey;
  const raw = Buffer.from(env.APP_ENCRYPTION_KEY, 'base64');
  if (raw.length !== 32) {
    throw new Error(
      `APP_ENCRYPTION_KEY must decode to 32 bytes (got ${raw.length}). ` +
      `Generate one with: openssl rand -base64 32`,
    );
  }
  cachedKey = raw;
  return cachedKey;
}

export function encryptString(plaintext: string): string {
  const key = getKey();
  const nonce = randomBytes(NONCE_LEN);
  const cipher = createCipheriv(ALGO, key, nonce);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([nonce, ciphertext, tag]).toString('base64');
}

export function decryptString(encoded: string): string {
  const key = getKey();
  const buf = Buffer.from(encoded, 'base64');
  if (buf.length < NONCE_LEN + TAG_LEN + 1) {
    throw new Error('Ciphertext too short to be valid');
  }
  const nonce = buf.subarray(0, NONCE_LEN);
  const tag = buf.subarray(buf.length - TAG_LEN);
  const ciphertext = buf.subarray(NONCE_LEN, buf.length - TAG_LEN);
  const decipher = createDecipheriv(ALGO, key, nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

/** Helper used by routes that may receive either an encrypted token (existing
 *  row) or a brand-new plaintext token (just provided by user). Always returns
 *  the encrypted form for storage. */
export function ensureEncrypted(value: string): string {
  // Heuristic: an encrypted blob is base64 and ≥ 40 chars. Plaintext API keys
  // (e.g. `sk-ant-...`, `gho_...`) usually contain non-base64 chars.
  if (/^[A-Za-z0-9+/=]+$/.test(value) && value.length >= 40) {
    try {
      // Attempt a decrypt round-trip; if it succeeds, value is already encrypted.
      decryptString(value);
      return value;
    } catch {
      // fall through and treat as plaintext
    }
  }
  return encryptString(value);
}

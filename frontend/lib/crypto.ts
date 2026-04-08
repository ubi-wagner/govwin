import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';

function getKey(): Buffer {
  const secret = process.env.API_KEY_ENCRYPTION_SECRET;
  if (!secret) throw new Error('API_KEY_ENCRYPTION_SECRET is required');
  return createHash('sha256').update(secret).digest();
}

export function encryptApiKey(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, encrypted, tag]).toString('base64');
}

export function decryptApiKey(encryptedBase64: string): string {
  const data = Buffer.from(encryptedBase64, 'base64');
  const iv = data.subarray(0, 12);
  const tag = data.subarray(data.length - 16);
  const encrypted = data.subarray(12, data.length - 16);
  const decipher = createDecipheriv(ALGORITHM, getKey(), iv);
  decipher.setAuthTag(tag);
  return decipher.update(encrypted) + decipher.final('utf8');
}

/**
 * Returns a 4-char masked + last-4-char tail hint of an API key for
 * display in the admin UI ("the SAM.gov key currently loaded ends in
 * ...x4z9"). For keys 4 characters or shorter, returns just `****`
 * to avoid leaking the entire plaintext — `slice(-4)` on a 3-char
 * string returns the whole string, which would have meant `keyHint('abc')`
 * → `'****abc'` exposing the entire key.
 *
 * Real API keys are 32+ characters so the short-key branch only
 * matters as a defensive guard against test fixtures or accidental
 * misuse, but a key-display helper that ever leaks its input is
 * a bug regardless of how unlikely the input is.
 */
export function keyHint(plaintext: string): string {
  if (plaintext.length <= 4) return '****';
  return '****' + plaintext.slice(-4);
}

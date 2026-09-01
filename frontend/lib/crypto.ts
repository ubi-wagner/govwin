/**
 * AES-256-GCM for stored third-party API keys — the WRITER half of a cross-language pair.
 *
 * ⚠️ NOTHING IN THE FRONTEND IMPORTS THIS, and that is the whole story of the module. It is kept,
 * not deleted, because it is half of something live: `pipeline/src/crypto.py` holds the matching
 * `decrypt_api_key`, and `pipeline/src/ingest/sam_gov.py` calls it against
 * `api_key_registry.encrypted_key`. Deleting this file would leave the reader with no
 * documentation of the format it reads.
 *
 * The design was: an admin enters a source API key in the UI → it is encrypted here with
 * `API_KEY_ENCRYPTION_SECRET` → the pipeline decrypts it. Only the second half was built. No route
 * or page writes `encrypted_key`, and measured on 2026-09-01 all four `api_key_registry` rows have
 * it NULL — so `sam_gov.py` always takes its documented fallback, `config.SAM_GOV_API_KEY` from the
 * environment. That fallback is the live path; this is not a broken feature, it is an unfinished
 * one whose replacement works.
 *
 * If the admin key-entry surface is ever built, this is what it should call, and the wire format is
 * already fixed by the Python side: `iv:authTag:ciphertext`, hex, with the key being the SHA-256 of
 * the shared secret. If that surface is decided against, delete this file AND
 * `pipeline/src/crypto.py`'s decrypt path together — half a pair is what created the ambiguity in
 * the first place.
 */
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

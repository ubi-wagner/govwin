/**
 * AES-256-GCM encryption for API keys stored in api_key_registry.
 *
 * Uses a single env var (API_KEY_ENCRYPTION_SECRET) as the master key.
 * Format: base64(iv:ciphertext:authTag)
 */
import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12
const AUTH_TAG_LENGTH = 16

function getEncryptionKey(): Buffer {
  const secret = process.env.API_KEY_ENCRYPTION_SECRET
  if (!secret) {
    throw new Error('API_KEY_ENCRYPTION_SECRET environment variable is not set')
  }
  // Derive a 32-byte key from the secret via SHA-256
  return createHash('sha256').update(secret).digest()
}

/**
 * Encrypt a plaintext API key.
 * Returns a base64 string containing iv:ciphertext:authTag.
 */
export function encryptApiKey(plaintext: string): string {
  const key = getEncryptionKey()
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH })

  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()

  // Pack as iv:ciphertext:authTag, then base64 the whole thing
  const packed = Buffer.concat([iv, encrypted, authTag])
  return packed.toString('base64')
}

/**
 * Decrypt an encrypted API key.
 * Input: base64 string from encryptApiKey().
 */
export function decryptApiKey(encryptedBase64: string): string {
  const key = getEncryptionKey()
  const packed = Buffer.from(encryptedBase64, 'base64')

  const iv = packed.subarray(0, IV_LENGTH)
  const authTag = packed.subarray(packed.length - AUTH_TAG_LENGTH)
  const ciphertext = packed.subarray(IV_LENGTH, packed.length - AUTH_TAG_LENGTH)

  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH })
  decipher.setAuthTag(authTag)

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()])
  return decrypted.toString('utf8')
}

/**
 * Get the last 4 characters of a key for display as a hint.
 */
export function keyHint(plaintext: string): string {
  if (plaintext.length <= 4) return '****'
  return '****' + plaintext.slice(-4)
}

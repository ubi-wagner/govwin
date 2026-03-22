"""
AES-256-GCM decryption for API keys stored in api_key_registry.

Mirrors the Node.js implementation in frontend/lib/crypto.ts.
Uses API_KEY_ENCRYPTION_SECRET env var as the master key.
Format: base64(iv + ciphertext + authTag)
"""

import base64
import hashlib
import os
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

IV_LENGTH = 12
AUTH_TAG_LENGTH = 16


def _get_encryption_key() -> bytes:
    secret = os.environ.get("API_KEY_ENCRYPTION_SECRET")
    if not secret:
        raise EnvironmentError("API_KEY_ENCRYPTION_SECRET environment variable is not set")
    return hashlib.sha256(secret.encode("utf-8")).digest()


def decrypt_api_key(encrypted_base64: str) -> str:
    """Decrypt an API key encrypted by the frontend crypto module."""
    key = _get_encryption_key()
    packed = base64.b64decode(encrypted_base64)

    iv = packed[:IV_LENGTH]
    # AESGCM expects ciphertext + authTag concatenated (which is exactly what we have after iv)
    ciphertext_with_tag = packed[IV_LENGTH:]

    aesgcm = AESGCM(key)
    plaintext = aesgcm.decrypt(iv, ciphertext_with_tag, None)
    return plaintext.decode("utf-8")

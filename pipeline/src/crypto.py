"""AES-256-GCM encryption for API keys stored in database."""
import base64
import hashlib
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from config import API_KEY_ENCRYPTION_SECRET


def _get_key() -> bytes:
    return hashlib.sha256(API_KEY_ENCRYPTION_SECRET.encode()).digest()


def encrypt_api_key(plaintext: str) -> str:
    key = _get_key()
    aesgcm = AESGCM(key)
    import os
    nonce = os.urandom(12)
    ct = aesgcm.encrypt(nonce, plaintext.encode(), None)
    return base64.b64encode(nonce + ct).decode()


def decrypt_api_key(encrypted_b64: str) -> str:
    key = _get_key()
    data = base64.b64decode(encrypted_b64)
    nonce, ct = data[:12], data[12:]
    aesgcm = AESGCM(key)
    return aesgcm.decrypt(nonce, ct, None).decode()

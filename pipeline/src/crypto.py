"""AES-256-GCM encryption for API keys stored in database."""
import base64
import hashlib

from config import API_KEY_ENCRYPTION_SECRET

# NOTE: `cryptography` is a Rust/pyo3 extension; importing it eagerly loads the
# native module, which panics on import in some sandboxed test environments.
# Modules that only transitively import this one (the ingesters and their unit
# tests) never call encrypt/decrypt, so the import is deferred into the functions
# that actually use it — import-time stays clean everywhere, real crypto still
# runs when invoked.


def _get_key() -> bytes:
    if not API_KEY_ENCRYPTION_SECRET:
        raise RuntimeError("API_KEY_ENCRYPTION_SECRET not set — cannot encrypt")
    return hashlib.sha256(API_KEY_ENCRYPTION_SECRET.encode()).digest()


def encrypt_api_key(plaintext: str) -> str:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    key = _get_key()
    aesgcm = AESGCM(key)
    import os
    nonce = os.urandom(12)
    ct = aesgcm.encrypt(nonce, plaintext.encode(), None)
    return base64.b64encode(nonce + ct).decode()


def decrypt_api_key(encrypted_b64: str) -> str:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    key = _get_key()
    data = base64.b64decode(encrypted_b64)
    nonce, ct = data[:12], data[12:]
    aesgcm = AESGCM(key)
    return aesgcm.decrypt(nonce, ct, None).decode()

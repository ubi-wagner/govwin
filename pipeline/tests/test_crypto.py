"""Unit tests for pipeline.src.crypto — AES-256-GCM encrypt/decrypt.

No DB, no HTTP. The tests patch sys.path to ensure the working
``cryptography`` package (49.x, installed at /tmp/crypto_pkg) takes
priority over the broken system-level pyo3 build.

Tests:
  1. Round-trip: encrypt → decrypt returns original plaintext.
  2. Each encrypt call produces a different ciphertext (random nonce).
  3. Tampered ciphertext → authentication failure (InvalidTag / ValueError).
  4. Wrong key → authentication failure.
  5. Missing API_KEY_ENCRYPTION_SECRET → RuntimeError.
  6. Empty-string plaintext round-trips cleanly.
  7. Unicode/high-byte plaintext round-trips cleanly.
"""
from __future__ import annotations

import base64
import importlib
import os
import sys

import pytest

# ---------------------------------------------------------------------------
# Ensure the working cryptography build is on sys.path before any import of
# the source module. The system-level cryptography (pyo3 Rust build) panics
# because _cffi_backend is absent; pip-installed 49.x at /tmp/crypto_pkg works.
# ---------------------------------------------------------------------------
_WORKING_CRYPTO_PATH = "/tmp/crypto_pkg"
if _WORKING_CRYPTO_PATH not in sys.path:
    sys.path.insert(0, _WORKING_CRYPTO_PATH)

# Evict any cached (broken) cryptography modules so our path wins.
_CRYPTO_MODS = [k for k in list(sys.modules) if k.startswith("cryptography")]
for _m in _CRYPTO_MODS:
    del sys.modules[_m]


def _is_crypto_available() -> bool:
    """Return True if the working cryptography package can be imported."""
    try:
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM  # noqa: F401
        return True
    except BaseException:
        # BaseException (not Exception): a broken pyo3 build raises
        # pyo3_runtime.PanicException, which subclasses BaseException. We must
        # catch it to skip gracefully instead of crashing collection.
        return False


_SKIP_REASON = (
    "cryptography package not functional in this environment "
    "(system pyo3 build broken, pip install needed)"
)
pytestmark = pytest.mark.skipif(
    not _is_crypto_available(), reason=_SKIP_REASON
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def _patch_env_and_reload(monkeypatch):
    """Set API_KEY_ENCRYPTION_SECRET and reload the crypto module fresh."""
    monkeypatch.setenv("API_KEY_ENCRYPTION_SECRET", "test-secret-for-unit-tests-32bytes!")
    # Evict cached copies so the fresh env is seen on first import.
    for mod_name in list(sys.modules):
        if mod_name in ("config", "crypto") or mod_name.startswith("cryptography"):
            del sys.modules[mod_name]
    yield
    # Teardown: evict again so other test modules start clean.
    for mod_name in list(sys.modules):
        if mod_name in ("config", "crypto") or mod_name.startswith("cryptography"):
            del sys.modules[mod_name]


def _load_crypto():
    """Import the src/crypto module with the working cryptography on the path."""
    # Guarantee our working path is first.
    if _WORKING_CRYPTO_PATH not in sys.path:
        sys.path.insert(0, _WORKING_CRYPTO_PATH)
    import crypto  # resolves from pytest's pythonpath = src
    return crypto


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestEncryptDecryptRoundTrip:
    def test_basic_round_trip(self):
        crypto = _load_crypto()
        plaintext = "sk-ant-api-test-key-12345"
        ciphertext = crypto.encrypt_api_key(plaintext)
        assert ciphertext != plaintext
        recovered = crypto.decrypt_api_key(ciphertext)
        assert recovered == plaintext

    def test_empty_string_round_trips(self):
        crypto = _load_crypto()
        ciphertext = crypto.encrypt_api_key("")
        assert crypto.decrypt_api_key(ciphertext) == ""

    def test_unicode_round_trips(self):
        """High-byte / unicode key values survive the encode/decode round trip."""
        crypto = _load_crypto()
        plaintext = "kéy-with-ünïcödé-中文"
        assert crypto.decrypt_api_key(crypto.encrypt_api_key(plaintext)) == plaintext

    def test_long_key_round_trips(self):
        """A very long key (e.g., 512-char token) survives intact."""
        crypto = _load_crypto()
        plaintext = "x" * 512
        assert crypto.decrypt_api_key(crypto.encrypt_api_key(plaintext)) == plaintext


class TestNonceRandomness:
    def test_each_encrypt_produces_different_ciphertext(self):
        """Two encryptions of the same plaintext must differ (random nonce)."""
        crypto = _load_crypto()
        plaintext = "same-key-every-time"
        ct1 = crypto.encrypt_api_key(plaintext)
        ct2 = crypto.encrypt_api_key(plaintext)
        assert ct1 != ct2, "nonce must be random — ciphertexts must differ"


class TestAuthenticationFailures:
    def test_tampered_ciphertext_raises(self):
        """Flipping one byte in the ciphertext must fail (GCM tag check)."""
        crypto = _load_crypto()
        ct_b64 = crypto.encrypt_api_key("secret-value")
        raw = bytearray(base64.b64decode(ct_b64))
        # Flip the last byte of the authenticated ciphertext (beyond the 12-byte nonce).
        raw[-1] ^= 0xFF
        corrupted = base64.b64encode(bytes(raw)).decode()
        # AESGCM raises cryptography's InvalidTag on auth failure.
        with pytest.raises(Exception) as exc_info:
            crypto.decrypt_api_key(corrupted)
        # Accept either InvalidTag or a ValueError from authentication failure.
        exc_name = type(exc_info.value).__name__
        assert exc_name in ("InvalidTag", "ValueError"), (
            f"Expected auth-failure exception, got {exc_name}: {exc_info.value}"
        )

    def test_wrong_key_raises(self, monkeypatch):
        """A ciphertext produced with key A must not decrypt with key B."""
        crypto = _load_crypto()
        ct = crypto.encrypt_api_key("the-secret")

        # Reload with a different secret so _get_key() produces a different key.
        monkeypatch.setenv("API_KEY_ENCRYPTION_SECRET", "completely-different-secret-xyz!")
        for mod_name in list(sys.modules):
            if mod_name in ("config", "crypto"):
                del sys.modules[mod_name]

        crypto2 = _load_crypto()
        with pytest.raises(Exception) as exc_info:
            crypto2.decrypt_api_key(ct)
        exc_name = type(exc_info.value).__name__
        assert exc_name in ("InvalidTag", "ValueError"), (
            f"Expected auth-failure exception, got {exc_name}: {exc_info.value}"
        )


class TestMissingSecret:
    def test_missing_secret_raises_runtime_error(self, monkeypatch):
        """encrypt_api_key must raise RuntimeError when the secret is not set."""
        monkeypatch.setenv("API_KEY_ENCRYPTION_SECRET", "")
        for mod_name in list(sys.modules):
            if mod_name in ("config", "crypto"):
                del sys.modules[mod_name]
        crypto = _load_crypto()
        with pytest.raises(RuntimeError, match="API_KEY_ENCRYPTION_SECRET"):
            crypto.encrypt_api_key("anything")

-- Migration 008: Add encrypted API key storage to api_key_registry
--
-- Allows admins to rotate API keys through the UI instead of redeploying.
-- Keys are AES-256-GCM encrypted at rest using API_KEY_ENCRYPTION_SECRET env var.
-- Pipeline decrypts at runtime; env var fallback preserved for backward compat.

ALTER TABLE api_key_registry
    ADD COLUMN IF NOT EXISTS encrypted_value TEXT,
    ADD COLUMN IF NOT EXISTS issued_by TEXT,
    ADD COLUMN IF NOT EXISTS rotated_at TIMESTAMPTZ;

-- Update key_hint comment for clarity
COMMENT ON COLUMN api_key_registry.key_hint IS 'Last 4 characters of the plaintext key, for identification only';
COMMENT ON COLUMN api_key_registry.encrypted_value IS 'AES-256-GCM encrypted API key (base64). Decrypted at runtime by pipeline/frontend.';
COMMENT ON COLUMN api_key_registry.rotated_at IS 'When the key was last rotated through the admin UI';
COMMENT ON COLUMN api_key_registry.issued_by IS 'User ID or email of whoever last rotated the key';

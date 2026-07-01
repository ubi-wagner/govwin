-- Migration 095: pinned opportunity-folder manifest on the tenant card (greenfield
-- pin = full copy). When a customer pins a card, the global read-only opp docs are
-- copied into the tenant's space (customers/<slug>/pinned/<opp>/) and the manifest
-- is recorded here so the customer owns + can list a local, shard-safe copy.

ALTER TABLE tenant_opportunity_cards
    ADD COLUMN IF NOT EXISTS pinned_docs JSONB NOT NULL DEFAULT '[]'::jsonb;

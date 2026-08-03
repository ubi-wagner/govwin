-- 148_archivable_artifacts.sql
-- Universal archive (soft, for sorting/visibility). Every user-sortable artifact gets a nullable
-- `archived_at`: archived rows drop out of active-view queries but stay in indexed Postgres, fully
-- reversible (restore = NULL it). This is NOT a delete and NOT cold storage — moving archived rows
-- out of indexed Postgres is a separate, later sweep. See docs/ARCHIVABLE_CONTRACT.md.
--
-- proposals + tenants already carry archived_at; amendments/solicitations already carry a terminal
-- `status` (dismissed/…) that serves the same "hide from active" purpose. These four lacked any
-- archival state:

ALTER TABLE process_instances       ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE tenant_opportunity_cards ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE library_atoms           ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE contracts               ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

-- Partial indexes: the active-view queries all read `WHERE archived_at IS NULL`.
CREATE INDEX IF NOT EXISTS idx_process_instances_active ON process_instances(archived_at) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_toc_active               ON tenant_opportunity_cards(archived_at) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_library_atoms_active     ON library_atoms(archived_at) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_contracts_active         ON contracts(archived_at) WHERE archived_at IS NULL;

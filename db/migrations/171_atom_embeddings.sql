-- 171_atom_embeddings.sql — semantic-retrieval spine for the atom library.
--
-- One embedding per atom, TENANT-SCOPED and MODEL-TAGGED so embedding spaces never mix
-- (a 'voyage-3.5' vector is never compared against a 'local-hash-v1' one). The gated engine
-- (frontend/lib/embeddings.ts) fills this; selectForSection blends cosine similarity into the
-- existing tag/context score. Inert until ATOM_EMBED / a provider key is set — no engine, no rows.
--
-- Isolation: FORCE RLS + tenant_isolation (same null-safe idiom as mig 136). This table is
-- greenfield — every access path goes through withTenant() (which SET LOCALs app.tenant_id), so
-- forcing RLS is airtight AND safe (no legacy caller reads it outside a tenant context). The ANN
-- query in selectForSection also filters ae.tenant_id explicitly → triple-scoped (WHERE + JOIN + RLS).

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS atom_embeddings (
  atom_id      uuid PRIMARY KEY REFERENCES library_atoms(id) ON DELETE CASCADE,
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  model        text NOT NULL,             -- engine id, e.g. 'voyage-3.5' | 'local-hash-v1'
  dim          int  NOT NULL,             -- vector length actually stored (defensive; = EMBED_DIM)
  content_hash text NOT NULL,             -- sha256(model || text) → skip re-embed when unchanged
  embedding    vector(1024) NOT NULL,     -- fixed dim; engines pad/hash to EMBED_DIM=1024
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_atom_embeddings_tenant       ON atom_embeddings (tenant_id);
CREATE INDEX IF NOT EXISTS idx_atom_embeddings_tenant_model ON atom_embeddings (tenant_id, model);
-- ANN (cosine). HNSW (pgvector ≥ 0.5). Per-tenant sets are small, so an exact scan within the
-- tenant filter is also correct + fast; the index just helps as libraries grow.
CREATE INDEX IF NOT EXISTS idx_atom_embeddings_hnsw
  ON atom_embeddings USING hnsw (embedding vector_cosine_ops);

-- ── tenant isolation (mirrors mig 136 ISOLATE-strict; null-safe predicate) ──
ALTER TABLE atom_embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE atom_embeddings FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON atom_embeddings;
CREATE POLICY tenant_isolation ON atom_embeddings FOR ALL
  USING      (tenant_id = (NULLIF(current_setting('app.tenant_id', true), ''))::uuid)
  WITH CHECK (tenant_id = (NULLIF(current_setting('app.tenant_id', true), ''))::uuid);

-- grants for the RLS-cutover roles (govtech_app app / rfp_agent agents), created in migs 117/136.
GRANT SELECT, INSERT, UPDATE, DELETE ON atom_embeddings TO govtech_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON atom_embeddings TO rfp_agent;

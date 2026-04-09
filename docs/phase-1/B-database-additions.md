# Phase 1 §B — Database Additions

**Mini-TODO scope:** One new migration (`009_phase1_curation_extensions.sql`) that adds the columns + tables + indexes Phase 1 needs without touching anything that already works. Verified idempotent against a real PG16 instance before commit.

**Depends on:** §A (decisions about namespace key format, state machine names)
**Blocks:** §C, §D, §E, §H, §I, §J

## Why this section exists

The 0.5 baseline (`001_baseline.sql`) already has most of what Phase 1 needs: `opportunities`, `curated_solicitations`, `solicitation_compliance`, `compliance_variables`, `agent_task_queue`, `agent_task_results`, `episodic_memories`, `semantic_memories`, `procedural_memories`. Phase 1 adds:

1. A `namespace TEXT` column on the three memory tables (so `memory.search_namespace` from §H can do prefix matching)
2. A `triage_actions` audit table (every claim/release/dismiss/push action lands here for the audit trail)
3. A `solicitation_annotations` table (highlights, text boxes, compliance tags drawn by the curator on the document)
4. A handful of indexes for the triage queue + similarity search query paths
5. Defensive CHECK constraints on the state machine column

Everything is additive. Nothing in this migration drops or alters existing data.

## Items

- [ ] **B1.** Create `db/migrations/009_phase1_curation_extensions.sql`. Sections in order:
  - **Header comment** — what this migration does, why each column exists, idempotency notes
  - **Memory namespace column** — `ALTER TABLE episodic_memories ADD COLUMN IF NOT EXISTS namespace TEXT`, same for `semantic_memories`, same for `procedural_memories`. Backfill is null (memories pre-Phase-1 don't have a namespace key).
  - **Memory namespace index** — `CREATE INDEX IF NOT EXISTS idx_episodic_namespace ON episodic_memories (namespace text_pattern_ops) WHERE namespace IS NOT NULL` (prefix-search optimized via `text_pattern_ops`); same for the other two memory tables. **Acceptance:** `EXPLAIN SELECT * FROM episodic_memories WHERE namespace LIKE 'USAF:AFWERX:%'` shows index scan, not seq scan.
  - **`triage_actions` table** — audit log for state transitions. Columns: `id UUID PK`, `solicitation_id UUID NOT NULL REFERENCES curated_solicitations(id) ON DELETE CASCADE`, `actor_id UUID NOT NULL REFERENCES users(id)`, `action TEXT NOT NULL CHECK (action IN ('claim','release','dismiss','request_review','approve','reject','push','reclaim'))`, `from_state TEXT NOT NULL`, `to_state TEXT NOT NULL`, `notes TEXT`, `metadata JSONB DEFAULT '{}'`, `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`. Index on `(solicitation_id, created_at DESC)` for the audit timeline view.
  - **`solicitation_annotations` table** — Columns: `id UUID PK`, `solicitation_id UUID NOT NULL REFERENCES curated_solicitations(id) ON DELETE CASCADE`, `actor_id UUID NOT NULL REFERENCES users(id)`, `kind TEXT NOT NULL CHECK (kind IN ('highlight','text_box','compliance_tag'))`, `source_location JSONB NOT NULL` (page number, offset, length, bbox), `payload JSONB NOT NULL DEFAULT '{}'`, `compliance_variable_name TEXT` (only set when `kind='compliance_tag'`, references `compliance_variables.name`), `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`, `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`. Trigger `solicitation_annotations_updated_at`. Indexes on `(solicitation_id)` and `(compliance_variable_name)`.
  - **State CHECK constraint on `curated_solicitations.status`** — the baseline already has the column but if it lacks an explicit CHECK, add it: `ALTER TABLE curated_solicitations DROP CONSTRAINT IF EXISTS curated_solicitations_status_check; ALTER TABLE curated_solicitations ADD CONSTRAINT curated_solicitations_status_check CHECK (status IN ('new','claimed','released_for_analysis','ai_analyzed','curation_in_progress','review_requested','approved','pushed_to_pipeline','dismissed','rejected_review'))`. The DROP is gated by `IF EXISTS` so re-runs don't fail.
  - **Triage queue indexes** — partial index `CREATE INDEX IF NOT EXISTS idx_curated_solicitations_triage ON curated_solicitations (created_at DESC) WHERE status = 'new' AND claimed_by IS NULL` for the unclaimed-triage query path; partial index `CREATE INDEX IF NOT EXISTS idx_curated_solicitations_my_claims ON curated_solicitations (claimed_by, claimed_at DESC) WHERE status IN ('claimed','curation_in_progress','review_requested')` for the "my work" query.
  - **`solicitation_compliance.solicitation_id` index** — verify it exists in the baseline; if not, add `CREATE INDEX IF NOT EXISTS idx_solicitation_compliance_sol_id ON solicitation_compliance (solicitation_id)` (probably already there from a FK auto-index, but defensive).
  - **`opportunities.content_hash` UNIQUE constraint** — the baseline has `content_hash TEXT` but no UNIQUE. Phase 1 ingesters need `ON CONFLICT (content_hash) DO NOTHING` to dedupe re-ingests. Add: `ALTER TABLE opportunities ADD CONSTRAINT IF NOT EXISTS opportunities_content_hash_key UNIQUE (content_hash) NOT VALID; ALTER TABLE opportunities VALIDATE CONSTRAINT opportunities_content_hash_key`. The two-step `NOT VALID` + `VALIDATE` form is so Phase 1 doesn't take a long lock on a table with existing data; it can be skipped on a fresh deploy.
  - **`opportunities.full_text_tsv` trigger** — verify there's a trigger that auto-populates `full_text_tsv` from `title || ' ' || description || ' ' || coalesce(agency,'')`. If not, add `CREATE OR REPLACE FUNCTION opportunities_fts_trigger ... BEGIN NEW.full_text_tsv := to_tsvector('english', coalesce(NEW.title,'')||' '||coalesce(NEW.description,'')||' '||coalesce(NEW.agency,'')); RETURN NEW; END` and a `BEFORE INSERT OR UPDATE OF title,description,agency` trigger.
  - **No DROP TABLE, no DROP COLUMN, no DELETE.** Migration is purely additive.

- [ ] **B2.** Apply the migration against a throwaway PG16 instance (the same `pg_ctl` pattern from 0.5b §F):
  ```bash
  /usr/lib/postgresql/16/bin/pg_ctl -D /tmp/pgtest/data -l /tmp/pgtest/pg.log start
  PGHOST=/tmp/pgtest PGPORT=55432 PGUSER=postgres psql -d postgres -f db/migrations/001_baseline.sql
  PGHOST=/tmp/pgtest PGPORT=55432 PGUSER=postgres psql -d postgres -f db/migrations/009_phase1_curation_extensions.sql
  ```
  - **Acceptance:** zero errors on first apply.

- [ ] **B3.** Apply the migration a SECOND time and verify it's idempotent:
  ```bash
  PGHOST=/tmp/pgtest PGPORT=55432 PGUSER=postgres psql -d postgres -f db/migrations/009_phase1_curation_extensions.sql
  ```
  - **Acceptance:** zero errors on second apply (every `CREATE TABLE` uses `IF NOT EXISTS`, every `ALTER TABLE ADD CONSTRAINT` uses `IF NOT EXISTS` or is wrapped in a `DO $$ ... pg_constraint check ... $$` block, every `CREATE INDEX` uses `IF NOT EXISTS`).

- [ ] **B4.** Functional sanity test — INSERT a row into each new table and a column in each existing table that B1 modifies:
  ```sql
  -- a fixture solicitation row (assumes opportunities row exists from baseline seed)
  INSERT INTO curated_solicitations (opportunity_id, status, namespace) 
    SELECT id, 'new', NULL FROM opportunities LIMIT 1;
  -- triage_actions
  INSERT INTO triage_actions (solicitation_id, actor_id, action, from_state, to_state) 
    SELECT cs.id, u.id, 'claim', 'new', 'claimed' 
    FROM curated_solicitations cs, users u 
    WHERE u.email = 'eric@rfppipeline.com' LIMIT 1;
  -- solicitation_annotations
  INSERT INTO solicitation_annotations (solicitation_id, actor_id, kind, source_location)
    SELECT cs.id, u.id, 'highlight', '{"page":1,"offset":0,"length":100}'::jsonb
    FROM curated_solicitations cs, users u
    WHERE u.email = 'eric@rfppipeline.com' LIMIT 1;
  -- memory namespace column
  UPDATE episodic_memories SET namespace = 'USAF:AFWERX:SBIR:Phase1' WHERE id IN (SELECT id FROM episodic_memories LIMIT 1);
  -- state CHECK constraint
  INSERT INTO curated_solicitations (opportunity_id, status) VALUES (gen_random_uuid(), 'invalid_state'); -- should fail
  ```
  - **Acceptance:** all the legitimate INSERTs succeed; the bad-state INSERT fails with a CHECK violation.

- [ ] **B5.** Verify the indexes are actually used:
  ```sql
  EXPLAIN ANALYZE SELECT * FROM curated_solicitations WHERE status = 'new' AND claimed_by IS NULL ORDER BY created_at DESC LIMIT 50;
  EXPLAIN ANALYZE SELECT * FROM episodic_memories WHERE namespace LIKE 'USAF:%';
  ```
  - **Acceptance:** EXPLAIN output mentions `idx_curated_solicitations_triage` and `idx_episodic_namespace` respectively, not `Seq Scan on ...`.

- [ ] **B6.** Update `docs/NAMESPACES.md` if any of B1's column/table names diverge from what §A1 documented. (They shouldn't if §A was thorough, but verify.)
  - **Acceptance:** `grep -c "triage_actions\|solicitation_annotations" docs/NAMESPACES.md` returns ≥ 2.

- [ ] **B7.** Update `docs/CLAUDE_CLIFFNOTES.md` Active Branches section with a one-line note that migration 009 is queued for Phase 1.

## Anti-patterns from Phase 0.5

- ❌ **Don't ALTER TABLE without `IF NOT EXISTS` / pg_constraint checks.** 0.5b shipped a migration that re-failed on the second run. We test idempotency before commit now.
- ❌ **Don't INSERT seed data without `ON CONFLICT (...) DO NOTHING` and a real UNIQUE constraint to bind to.** The 0.5b `pipeline_schedules` bug was exactly this — `ON CONFLICT DO NOTHING` with no unique key silently appended duplicates.
- ❌ **Don't skip the second-apply test.** Idempotency is verified empirically, not assumed from `IF NOT EXISTS`.
- ❌ **Don't put DDL and seed data in the same file.** Migration 009 is DDL only. Seeds (if any are needed for testing) go in a separate `010_phase1_dev_seed.sql` that lives behind a `WHERE NOT EXISTS` guard or only runs in the test fixture path.

## Definition of Done for §B

- `db/migrations/009_phase1_curation_extensions.sql` exists and is committed
- B2 + B3 pass against throwaway PG16 — first apply succeeds, second apply is no-op (zero rows affected by ALTER, zero new constraints, zero new indexes)
- B4 functional sanity passes
- B5 EXPLAIN output confirms index usage
- Commit message: `feat(phase-1-B): migration 009 — curation extensions, memory namespaces, triage audit, annotations`
- `docs/PHASE_1_PLAN.md` Section completion tracker has §B ticked

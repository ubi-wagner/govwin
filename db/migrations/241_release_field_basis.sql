-- 241_release_field_basis.sql
--
-- A value the product did not read must never look like one it did — and NEITHER MUST A BLANK.
--
-- ── THE GAP THIS CLOSES ──────────────────────────────────────────────────────────────────────
-- Release into the customer pipeline (`solicitation.push`) asked for three things: a
-- `submission_format`, a `spotlight_summary`, and a `close_date` on every topic. Everything else a
-- customer needs to judge an opportunity was optional, and the numbers say what optional means:
--
--     award_amount     0 of 22 master opportunities   · no writer anywhere in the tree
--     naics_codes      0 of 22 non-empty              · every row is '{}', which is non-null
--     set_aside_type   0 of 22 on any released card
--
-- `award_amount` is the one a small business asks first — "is this $150k or $1.9M?" — and it was
-- unreachable: no admin field, no curation writer, carried by the bridge onto every card and
-- populated by nothing.
--
-- ── WHY A THREE-VALUED BASIS AND NOT A NULLABLE NUMBER ───────────────────────────────────────
-- Requiring a number outright would be worse than leaving it blank. A DoD SBIR topic usually states
-- a ceiling; a general BAA often states no per-award amount at all. A gate that demands one leaves
-- the admin two options — block the release, or invent a figure — and inventing it is exactly what
-- docs/INGEST_PROVENANCE.md forbids.
--
-- NULL cannot carry the distinction that matters, because it means two opposite things:
--
--     award_amount = 250000, basis 'stated'      →  "$250,000"
--     award_amount = 250000, basis 'estimated'   →  "$250,000 · our estimate"   ← admin judgement
--     award_amount = NULL,   basis 'not_stated'  →  "Not stated in the solicitation"
--     award_amount = NULL,   basis  NULL         →  nobody has decided → RELEASE BLOCKED
--
-- The middle row is the one that earns the design. An RFP admin often knows what a Phase I runs
-- even when the topic is silent; suppressing that knowledge loses real value, and presenting it as
-- read from the document would be a lie. Badged as an estimate, it is neither.
--
-- ── SHAPE: ONE JSONB MAP, MIRRORING mig 187 ──────────────────────────────────────────────────
-- `solicitation_compliance.field_provenance` already models "where did this value come from" per
-- field. This is the same idea one table over, keyed by column name, so a field added to the gate
-- later needs no migration:
--
--     {"award_amount": "estimated", "naics_codes": "not_stated",
--      "source_documents": "attached", "highlights": "none_needed"}
--
-- Absence is a FINDING, not an omission: `source_documents: 'none_published'` records that the
-- organization published nothing, which is a real and common state, and is a different claim from
-- an admin who simply never looked.

-- (No BEGIN/COMMIT: db/migrations/migrate.mjs already wraps each file in a transaction.)

ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS field_basis jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN opportunities.field_basis IS
  'Per-field release basis, keyed by column name (mig 241). Mirrors the contract of '
  'solicitation_compliance.field_provenance one table over. Vocabulary: award_amount → '
  'stated|estimated|not_stated; naics_codes / set_aside_type → stated|not_stated; source_documents '
  '→ attached|none_published; highlights → marked|none_needed. A key that is ABSENT means nobody '
  'has decided, which is what solicitation.push refuses to release on — distinct from an explicit '
  '"not_stated", which is a decision.';

-- Read on every card build and on every push preflight, both of which address a single opportunity
-- by id, so no index is warranted; a GIN here would cost writes to serve no query.

-- ── Backfill: what can be inferred WITHOUT inventing anything ────────────────────────────────
-- An opportunity already carrying an award amount was populated by the SAM-feed ingest path
-- (pipeline/src/ingest/base.py), which reads the field from the published notice. That is exactly
-- 'stated', and recording it costs the admin a decision they would otherwise have to re-make.
--
-- Everything else is deliberately left ABSENT rather than defaulted to 'not_stated'. Defaulting
-- would stamp "the solicitation does not state one" onto 22 opportunities nobody has read — which
-- is precisely the fabrication this migration exists to prevent, and it would make the new gate
-- pass vacuously on its first run.
UPDATE opportunities
   SET field_basis = field_basis || '{"award_amount":"stated"}'::jsonb
 WHERE award_amount IS NOT NULL
   AND NOT (field_basis ? 'award_amount');

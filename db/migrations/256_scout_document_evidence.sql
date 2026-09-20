-- 256 · What the DOCUMENTS said about a finding's classification
--
-- ── ANNOTATE THE EXISTING CALL, DO NOT ADD A STATE ────────────────────────────────────────────
-- `scout_findings` already carries a classification — `new` / `update` / `unknown` — with
-- `match_opportunity_id`, `similarity_score` and `match_reason` behind it. Document matching
-- (mig 255 + `lib/harvest/match.ts`) is a SECOND opinion on that same question, not a different
-- question, so it does not get its own state. A fourth value in `classification` would force
-- every reader of that column to learn a new vocabulary, and a curator to learn a new decision.
--
-- What it gets instead is one jsonb column of EVIDENCE, and permission to move the existing call
-- when the evidence is certain.
--
-- ── WHY jsonb AND NOT COLUMNS ─────────────────────────────────────────────────────────────────
-- The evidence is a LIST — one entry per document that matched something, each with its own
-- verdict, counterpart and reason. Flattening the strongest one into columns would throw away the
-- rest, and the rest is what a curator reads when the strongest is `flag`: three near-misses
-- against one opportunity is a different situation from one near-miss against three.
--
-- It is read with `coerceJsonb` and written with `sql.json` — the documented way round in this
-- codebase, because `${JSON.stringify(x)}::jsonb` reads back as a STRING and iterates per
-- character.
--
-- ── THE SHAPE, WRITTEN DOWN BECAUSE jsonb HAS NO SCHEMA ───────────────────────────────────────
--   {
--     "checkedAt":  "2026-09-20T…",
--     "documents":  3,                     -- harvested documents considered
--     "verdict":    "certain"|"flag"|"boilerplate"|"none",
--     "matches": [
--       { "verdict": "...", "ownerKind": "solicitation"|"finding",
--         "ownerId": "…", "filename": "…", "score": 1, "reason": "…" }
--     ]
--   }
--
-- `verdict: "none"` is written deliberately rather than leaving the column NULL. NULL means
-- "never checked"; `none` means "checked, and the documents said nothing" — opposite facts, and
-- the whole point of the failure-is-a-row rule one table over.

ALTER TABLE scout_findings
  ADD COLUMN IF NOT EXISTS document_evidence jsonb;

COMMENT ON COLUMN scout_findings.document_evidence IS
  'Second opinion on this finding''s classification, from its harvested documents (mig 255). '
  'NULL = never checked; {"verdict":"none"} = checked and the documents said nothing. A '
  '"certain" verdict may move classification/match_opportunity_id; "flag" never does — it is '
  'for a human to read.';

-- Finding the work: which harvested findings have not been judged yet.
CREATE INDEX IF NOT EXISTS idx_scout_findings_unjudged
  ON scout_findings (discovered_at DESC)
  WHERE document_evidence IS NULL;

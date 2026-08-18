-- 187_compliance_field_provenance.sql
--
-- PER-FIELD PROVENANCE on the compliance matrix — never present a default as a rule.
--
-- Why: driving the real DoW 2026 SBIR BAA through admin ingest, the matrix came back
--
--     page_limit_technical | 10
--     font_family          | Times New Roman
--     submission_format    | Single PDF white paper — 8.5x11 …
--
-- …and came back BYTE-IDENTICAL whether the shredder had extracted 0 characters or
-- 165,268. Those values are DEFAULT_SBIR_CSO_SKELETON (lib/ingest/skeleton.ts) — a
-- deliberate fallback so Ingest Assist always yields a workable starting skeleton.
-- The intent is sound; the PRESENTATION was not: the defaults land in
-- solicitation_compliance indistinguishable from values actually read out of the
-- solicitation, so a curator sees confident numbers with nothing behind them.
--
-- For this BAA the defaults are wrong in ways that would sink a submission:
--   • page limit — the BAA states NO number, it defers to Component-specific
--     instructions; the default asserts 10.
--   • typeface — the BAA mandates no typeface, only "no type smaller than 10-point";
--     the default asserts Times New Roman.
--   • volumes — the BAA lists SEVEN DSIP volumes (adds Vol 7, Disclosures of Foreign
--     Affiliations); the default skeleton carries six.
--   • artifact — a full Technical Volume, not a "white paper".
--
-- The parse layer already knew: ParsedSolicitation carries `source: 'ai' | 'default' |
-- 'override'`, and ingest-assist already puts it on the solicitation.ingest_assisted
-- event. It was simply never persisted onto the row or shown to the curator. This adds
-- the column so the signal survives to the screen.
--
-- Shape — one entry per compliance field. Each entry is SELF-AUDITING: it carries who set it
-- and when, so the row explains its own trustworthiness without a join.
--   {"page_limit_technical": {"source":"default"},
--    "font_size":            {"source":"hitl","by":"<user uuid>","at":"<iso>","anchor":{...}},
--    "font_family":          {"source":"verified","by":"<user uuid>","at":"<iso>"}}
--
-- TRUST ORDER (strongest → weakest). A stronger source may overwrite a weaker one silently;
-- going the other way (e.g. a re-run of Ingest Assist stamping 'default' over a curator's
-- 'hitl') must never happen — materializeSkeleton only stamps fields it writes on a fresh parse.
--
--   'hitl'     A HUMAN HIGHLIGHTED IT IN THE SOURCE. The curator drew a box / selected text on
--              the actual document and the value was lifted from that region, so the entry
--              carries a SourceAnchor (page + excerpt + rects). Strongest: human judgement AND
--              a verifiable pointer back into the PDF. Corresponds to
--              SourceAnchor.method = 'manual_selection' (lib/types/source-anchor.ts) — the same
--              vocabulary the annotation rail and compliance.custom_variables already use.
--   'verified' A curator confirmed/corrected this field against the document, but without
--              anchoring it to a specific region (typed the value, ticked it off).
--   'override' Supplied wholesale by an admin-reviewed parse (the whole matrix at once).
--   'ai'       Extracted from THIS solicitation's text by the parse.
--   'default'  A SYSTEM FALLBACK — not read from this solicitation at all. Untrusted; the UI
--              flags it red and it must never be treated as a compliance constraint.
--
-- CHANGE LOG: this column holds CURRENT state. Every transition is separately auditable —
-- the curator path already writes an episodic 'curator' memory (verify | correct |
-- manual_entry, lib/tools/curation-memory.ts, fixed by mig 186 so it actually persists) plus a
-- triage_actions row and a system_events entry. So "what is it now" reads off this column and
-- "how did it get that way" reads off the memory/event ledger, keyed by solicitation + variable.
--
-- Existing rows get '{}' — unknown provenance, which the UI treats as unverified
-- (correct: every row written before this migration may hold silent defaults).

ALTER TABLE solicitation_compliance
  ADD COLUMN IF NOT EXISTS field_provenance jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN solicitation_compliance.field_provenance IS
  'Per-field provenance: {"<column>": {"source":"default|ai|override|verified","by":uuid,"at":iso}}. '
  '"default" means a SYSTEM FALLBACK, not a rule read from this solicitation — the curation UI must '
  'flag it as unverified and it must never be treated as a compliance constraint. Empty {} = unknown '
  '(pre-migration rows), treated as unverified. See migration 187.';

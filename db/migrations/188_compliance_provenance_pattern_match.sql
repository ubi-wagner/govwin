-- 188_compliance_provenance_pattern_match.sql
--
-- Correct the `solicitation_compliance.field_provenance` column comment for the two things
-- migration 187 could not yet name: the `pattern_match` tier, and DEFERRAL entries.
--
-- 187 added the column and, correctly for the time, documented a four-value vocabulary
-- (default | ai | override | verified) plus `hitl` in its own header. Since then Ingest Assist
-- gained a deterministic layer — lib/ingest/pattern-extract.ts — that reads rules directly off
-- the solicitation text and CITES them, and the entries it writes carry more than a source. A
-- stale comment on a live column is its own trap, so this restates the contract in full. No
-- data change: comment only.
--
-- ── The vocabulary (strongest → weakest) ───────────────────────────────────────
--   'hitl'          a curator HIGHLIGHTED it in the source (carries a SourceAnchor)
--   'verified'      a curator confirmed/corrected it against the document, unanchored
--   'override'      supplied wholesale by an admin-reviewed parse
--   'pattern_match' READ DETERMINISTICALLY off this solicitation's text, with the exact
--                   sentence + page cited. Reproducible, checkable, and no model involved —
--                   which is why it outranks 'ai': the value is cited, not merely asserted.
--   'ai'            extracted from this solicitation's text by the model parse, unanchored
--   'default'       a SYSTEM FALLBACK — not read from this solicitation at all. Untrusted;
--                   the UI flags it red and it is never a compliance constraint.
--
-- ── Entry shapes ───────────────────────────────────────────────────────────────
-- Minimal (any tier):
--   {"font_family": {"source": "default"}}
--
-- Cited (pattern_match):
--   {"min_font_size": {"source":"pattern_match","rule":"min_font.no_smaller_than",
--                      "page":19,"excerpt":"no type smaller than 10-point",
--                      "charOffset":64491,"docSegment":1}}
--   `page` is 1-based WITHIN its document and is null when the extracted text carried no page
--   markers. `docSegment` names WHICH document: a solicitation's full_text is every shredded
--   solicitation_documents row concatenated, so numbering restarts at each file boundary and
--   "p.19" is meaningless without it. `charOffset` indexes into full_text.
--
-- DEFERRAL — the column is NULL and that is the ANSWER, not a gap:
--   {"page_limit_technical": {"source":"pattern_match","deferred":true,
--     "reason":"The solicitation defers the technical-volume page limit to the
--               Service/Component-specific topic instructions.",
--     "rule":"deferred","page":32,"excerpt":"refer to Service/Component-specific topic
--     instructions for the page limit","charOffset":104815,"docSegment":1}}
--   A `deferred` entry means the document explicitly puts this rule elsewhere, so an empty cell
--   is CORRECT and a filled one would be wrong. This is the live state of the DoW 2026 SBIR BAA,
--   which sets NO technical-volume page limit — the case that produced a confident, fabricated
--   "10 pages" before the deterministic layer existed. The curation workspace renders it as
--   "Set elsewhere" with the reason and page, so the blank explains itself.

COMMENT ON COLUMN solicitation_compliance.field_provenance IS
  'Per-field provenance, keyed by column. Values: hitl > verified > override > pattern_match > ai > default '
  '(strongest first). "pattern_match" entries were read deterministically off this solicitation''s text and '
  'carry their citation (rule, page, excerpt, charOffset, docSegment); "default" means a SYSTEM FALLBACK, not '
  'a rule read from this solicitation — the curation UI flags it as unverified and it must never be treated as '
  'a compliance constraint. An entry with "deferred": true means the document states the rule lives ELSEWHERE '
  '(e.g. Component-specific instructions), so the NULL column is the correct answer, not a gap. Empty {} = '
  'unknown (pre-187 rows), treated as unverified. See migrations 187 and 188, and lib/ingest/pattern-extract.ts.';

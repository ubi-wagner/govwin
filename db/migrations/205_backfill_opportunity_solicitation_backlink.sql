-- =============================================================================
-- Migration 205: backfill opportunities.solicitation_id from the forward link
-- Depends on: 204
--
-- Bug log B46. An opportunity and its curated solicitation point at each other:
--
--   curated_solicitations.opportunity_id → opportunities.id        the FORWARD link
--   opportunities.solicitation_id        → curated_solicitations.id  the BACK link
--
-- The forward link is written by every path. The back link was written by seven
-- of ten writers — every topic path stamped it, three umbrella paths did not —
-- so the column was populated for some rows and not others for no reason a
-- reader can infer. That is worse than a column nobody fills: a reader who
-- checks a few rows concludes it is reliable.
--
-- Two proven consequences, one in the product and one in verification:
--
--   • lib/compliance-resolver.ts carries an explicit umbrella fallback, added
--     because without it "an umbrella purchase resolves to a NON-degraded empty
--     result and the buyer is provisioned a default skeleton while the fully-
--     authored master sits unread".
--   • drive-baa-forward.mjs resolved solely through the back link and printed
--     "✗ nothing reached a tenant card" against a push that had just created
--     seventeen. It had been reporting failure on success for as long as pushes
--     left the back link NULL.
--
-- The three writers are fixed in this same change (lib/intake.ts,
-- pipeline create_drafts_from_scout.py, pipeline ingest/base.py). This migration
-- repairs the rows they already wrote.
--
-- SAFE TO STAMP ON AN UMBRELLA — checked, not assumed. Every topic-only query
-- also filters on topic_number (extract-topics, ingest-topic-files,
-- opportunity-add-topic, opportunity-bulk-add-topics), so an umbrella cannot
-- start matching one; and the two queries that want both arms already union them
-- explicitly (solicitation-push, curation/republish), where this makes the
-- `OR id = <umbrella>` arm redundant rather than wrong. No query changes its
-- result set.
--
-- Idempotent: only touches rows where the two links disagree.
-- =============================================================================

UPDATE opportunities o
   SET solicitation_id = cs.id,
       updated_at      = now()
  FROM curated_solicitations cs
 WHERE cs.opportunity_id = o.id
   AND o.solicitation_id IS DISTINCT FROM cs.id;

-- Report what is left. A remaining NULL is legitimate: an opportunity that has
-- no curated solicitation at all (nothing to point at) rather than one whose
-- link was dropped. Kept as a NOTICE so a deploy log records the shape of the
-- table after the repair instead of leaving it to be re-derived later.
DO $$
DECLARE total int; linked int; orphan int;
BEGIN
  SELECT count(*), count(solicitation_id) INTO total, linked FROM opportunities;
  SELECT count(*) INTO orphan
    FROM opportunities o
   WHERE o.solicitation_id IS NULL
     AND NOT EXISTS (SELECT 1 FROM curated_solicitations cs WHERE cs.opportunity_id = o.id);
  RAISE NOTICE 'mig 205: % opportunities, % back-linked, % with no curated solicitation to link to',
    total, linked, orphan;
  IF total - linked <> orphan THEN
    RAISE WARNING 'mig 205: % rows still unlinked despite having a curated solicitation — investigate',
      (total - linked) - orphan;
  END IF;
END $$;

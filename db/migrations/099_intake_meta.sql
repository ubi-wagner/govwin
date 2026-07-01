-- Migration 099: Scout-shaped intake metadata on curated_solicitations.
--
-- The RFP river starts here: a found/uploaded notice is STAGED (status 'new',
-- opportunity is_active=false = not yet in the live master list) with its POC +
-- source + whether the docs were downloadable, so the RFP admin can triage it. Scout
-- (future) writes the same shape; today the admin stages it. Release (push) flips
-- is_active + publishes the card to the bridge.

ALTER TABLE curated_solicitations
    ADD COLUMN IF NOT EXISTS intake_meta JSONB NOT NULL DEFAULT '{}'::jsonb;
-- intake_meta: { poc, pocEmail, sourceUrl, foundBy, docsDownloadable, noticeType, raw }

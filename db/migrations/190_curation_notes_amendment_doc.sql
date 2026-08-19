-- ============================================================================
-- 190: Mid-window master-OPP flexibility — curation notes + amendment↔document
--      (docs/MASTER_MIRROR_OPP_DESIGN.md §1-2; the post-push, pre-portal window)
--
-- 1) curation_notes — an append-only ADMIN note thread on the master
--    solicitation. Until now the only note fields were transition-coupled
--    (triage_actions.notes — unreachable once pushed_to_pipeline is terminal)
--    or single-overwrite (opportunities.expert_notes). This is the internal
--    curation channel: platform-scope (master-side, no tenant_id), never
--    customer-visible, never deleted — the ledger ethos of system_events
--    applied to human margin notes.
--
-- 2) solicitation_amendments.document_id — an amendment can now carry the
--    document that announced it. solicitation_documents already accepts
--    document_type='amendment' (mig 012) but nothing linked the two lanes:
--    a tenant was told "Amendment 0002 changed the page limit" and could not
--    open Amendment 0002. ON DELETE SET NULL: losing the file never deletes
--    the amendment record (the flag/ack ledger must survive).
--
-- 3) document_templates.template_type gains 'collaboration' — molds for
--    collaboration products (letters of collaboration/support, teaming
--    agreements) get a first-class category instead of hiding in 'custom'.
-- ============================================================================

CREATE TABLE IF NOT EXISTS curation_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  solicitation_id UUID NOT NULL REFERENCES curated_solicitations(id) ON DELETE CASCADE,
  author_id UUID REFERENCES users(id),
  author_email TEXT,
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_curation_notes_sol
  ON curation_notes (solicitation_id, created_at DESC);

-- Append-only at the grant layer, like opportunity_bridge (mig 094): the app
-- role may read + add notes, never rewrite or remove them.
REVOKE UPDATE, DELETE ON curation_notes FROM govtech_app;

ALTER TABLE solicitation_amendments
  ADD COLUMN IF NOT EXISTS document_id UUID REFERENCES solicitation_documents(id) ON DELETE SET NULL;

ALTER TABLE document_templates DROP CONSTRAINT IF EXISTS document_templates_template_type_check;
ALTER TABLE document_templates ADD CONSTRAINT document_templates_template_type_check
  CHECK (template_type = ANY (ARRAY[
    'technical_volume','cost_volume','slide_deck','past_performance','key_personnel',
    'commercialization','abstract','cover_sheet','supporting_docs','collaboration','custom'
  ]));

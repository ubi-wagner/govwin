-- 035: Fix purchases table + proposal cascade deletes + user FK delete rules
-- Resolves: Stripe webhook crash (missing metadata column, expert_consulting type)
--           Proposal deletion blocked by FK constraints
--           User deletion blocked by FK constraints

-- ═══════════════════════════════════════════════════════════════════
-- 1. PURCHASES: add metadata column, widen product_type CHECK
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE purchases ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;

ALTER TABLE purchases DROP CONSTRAINT IF EXISTS purchases_product_type_check;
ALTER TABLE purchases ADD CONSTRAINT purchases_product_type_check
  CHECK (product_type IN (
    'finder_subscription','proposal_phase1','proposal_phase2','expert_consulting'
  ));

-- ═══════════════════════════════════════════════════════════════════
-- 2. PROPOSAL CHILD TABLES: add ON DELETE CASCADE
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE proposal_sections DROP CONSTRAINT IF EXISTS proposal_sections_proposal_id_fkey;
ALTER TABLE proposal_sections ADD CONSTRAINT proposal_sections_proposal_id_fkey
  FOREIGN KEY (proposal_id) REFERENCES proposals(id) ON DELETE CASCADE;

ALTER TABLE proposal_collaborators DROP CONSTRAINT IF EXISTS proposal_collaborators_proposal_id_fkey;
ALTER TABLE proposal_collaborators ADD CONSTRAINT proposal_collaborators_proposal_id_fkey
  FOREIGN KEY (proposal_id) REFERENCES proposals(id) ON DELETE CASCADE;

ALTER TABLE collaborator_stage_access DROP CONSTRAINT IF EXISTS collaborator_stage_access_proposal_id_fkey;
ALTER TABLE collaborator_stage_access ADD CONSTRAINT collaborator_stage_access_proposal_id_fkey
  FOREIGN KEY (proposal_id) REFERENCES proposals(id) ON DELETE CASCADE;

ALTER TABLE proposal_compliance_matrix DROP CONSTRAINT IF EXISTS proposal_compliance_matrix_proposal_id_fkey;
ALTER TABLE proposal_compliance_matrix ADD CONSTRAINT proposal_compliance_matrix_proposal_id_fkey
  FOREIGN KEY (proposal_id) REFERENCES proposals(id) ON DELETE CASCADE;

ALTER TABLE proposal_stage_history DROP CONSTRAINT IF EXISTS proposal_stage_history_proposal_id_fkey;
ALTER TABLE proposal_stage_history ADD CONSTRAINT proposal_stage_history_proposal_id_fkey
  FOREIGN KEY (proposal_id) REFERENCES proposals(id) ON DELETE CASCADE;

ALTER TABLE proposal_reviews DROP CONSTRAINT IF EXISTS proposal_reviews_proposal_id_fkey;
ALTER TABLE proposal_reviews ADD CONSTRAINT proposal_reviews_proposal_id_fkey
  FOREIGN KEY (proposal_id) REFERENCES proposals(id) ON DELETE CASCADE;

ALTER TABLE proposal_comments DROP CONSTRAINT IF EXISTS proposal_comments_proposal_id_fkey;
ALTER TABLE proposal_comments ADD CONSTRAINT proposal_comments_proposal_id_fkey
  FOREIGN KEY (proposal_id) REFERENCES proposals(id) ON DELETE CASCADE;

-- ═══════════════════════════════════════════════════════════════════
-- 3. USER FK COLUMNS: add ON DELETE SET NULL for audit/optional columns
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE curated_solicitations DROP CONSTRAINT IF EXISTS curated_solicitations_claimed_by_fkey;
ALTER TABLE curated_solicitations ADD CONSTRAINT curated_solicitations_claimed_by_fkey
  FOREIGN KEY (claimed_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE curated_solicitations DROP CONSTRAINT IF EXISTS curated_solicitations_curated_by_fkey;
ALTER TABLE curated_solicitations ADD CONSTRAINT curated_solicitations_curated_by_fkey
  FOREIGN KEY (curated_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE curated_solicitations DROP CONSTRAINT IF EXISTS curated_solicitations_approved_by_fkey;
ALTER TABLE curated_solicitations ADD CONSTRAINT curated_solicitations_approved_by_fkey
  FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE solicitation_compliance DROP CONSTRAINT IF EXISTS solicitation_compliance_verified_by_fkey;
ALTER TABLE solicitation_compliance ADD CONSTRAINT solicitation_compliance_verified_by_fkey
  FOREIGN KEY (verified_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE solicitation_templates DROP CONSTRAINT IF EXISTS solicitation_templates_uploaded_by_fkey;
ALTER TABLE solicitation_templates ADD CONSTRAINT solicitation_templates_uploaded_by_fkey
  FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE proposal_sections DROP CONSTRAINT IF EXISTS proposal_sections_assigned_to_fkey;
ALTER TABLE proposal_sections ADD CONSTRAINT proposal_sections_assigned_to_fkey
  FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE proposal_stage_history DROP CONSTRAINT IF EXISTS proposal_stage_history_changed_by_fkey;
ALTER TABLE proposal_stage_history ADD CONSTRAINT proposal_stage_history_changed_by_fkey
  FOREIGN KEY (changed_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE proposal_comments DROP CONSTRAINT IF EXISTS proposal_comments_user_id_fkey;
ALTER TABLE proposal_comments ADD CONSTRAINT proposal_comments_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE proposal_reviews DROP CONSTRAINT IF EXISTS proposal_reviews_reviewer_id_fkey;
ALTER TABLE proposal_reviews ADD CONSTRAINT proposal_reviews_reviewer_id_fkey
  FOREIGN KEY (reviewer_id) REFERENCES users(id) ON DELETE SET NULL;

-- ═══════════════════════════════════════════════════════════════════
-- 4. MISSING FK INDEXES (performance)
-- ═══════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_accounts_user_id ON accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_tenant_pipeline_items_opportunity
  ON tenant_pipeline_items(opportunity_id);
CREATE INDEX IF NOT EXISTS idx_tenant_actions_tenant
  ON tenant_actions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_proposals_opportunity
  ON proposals(opportunity_id);
CREATE INDEX IF NOT EXISTS idx_proposal_sections_proposal
  ON proposal_sections(proposal_id);
CREATE INDEX IF NOT EXISTS idx_proposal_collaborators_proposal
  ON proposal_collaborators(proposal_id);

-- ═══════════════════════════════════════════════════════════════════
-- 5. DROP UNUSED TABLE
-- ═══════════════════════════════════════════════════════════════════

DROP TABLE IF EXISTS solicitation_topics;

-- Migration 077: AI-agent recommendations as section comments (Phase 3, C3 increment 2)
--
-- Agent review output (grammar/flow/compliance) lands in proposal_comments so it
-- surfaces in the section's existing "context box" thread — distinguished from
-- human comments by recommendation_type, and grouped by category.

ALTER TABLE proposal_comments
    ADD COLUMN IF NOT EXISTS recommendation_type TEXT NOT NULL DEFAULT 'human'
        CHECK (recommendation_type IN ('human', 'ai_review', 'ai_suggestion')),
    ADD COLUMN IF NOT EXISTS category TEXT;

-- Hot path: fetch a section's thread + tell AI recommendations apart.
CREATE INDEX IF NOT EXISTS idx_proposal_comments_section_rec
    ON proposal_comments (section_id, recommendation_type);

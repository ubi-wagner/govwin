-- Migration 083: proposal_artifacts container (E1 keystone).
--
-- A proposal owns N artifacts (Tech Volume DOCX, Cost Volume XLSX, 5-page PPT…).
-- Each artifact is the lockable/downloadable unit that groups proposal_sections.
-- Today sections are grouped only by the denormalized volume_name/volume_number
-- strings; this reifies the artifact so advance/lock gates + package export can
-- operate at artifact scope, a per-artifact format_spec/compliance_spec can be
-- frozen at purchase (E2), and access can be controlled per document (E13).

CREATE TABLE IF NOT EXISTS proposal_artifacts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    proposal_id     UUID NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
    volume_id       UUID,                                  -- optional link to a shared solicitation_volumes row
    volume_number   INT,
    volume_name     TEXT,
    artifact_type   TEXT NOT NULL DEFAULT 'narrative'
        CHECK (artifact_type IN ('narrative','cost','form','matrix','other')),
    -- CanvasRules snapshot (frozen at purchase; populated by E2). '{}' until then.
    format_spec     JSONB NOT NULL DEFAULT '{}'::jsonb,
    -- ComplianceSpec (page/slide/min_font/images/required_sections; populated by E2).
    compliance_spec JSONB NOT NULL DEFAULT '{}'::jsonb,
    -- Optional artifacts (required=false) do not block proposal advance (E1.3).
    is_required     BOOLEAN NOT NULL DEFAULT true,
    status          TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft','in_progress','locked')),
    is_locked       BOOLEAN NOT NULL DEFAULT false,
    locked_at       TIMESTAMPTZ,
    locked_by       UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
DROP TRIGGER IF EXISTS proposal_artifacts_updated ON proposal_artifacts;
CREATE TRIGGER proposal_artifacts_updated BEFORE UPDATE ON proposal_artifacts
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX IF NOT EXISTS idx_proposal_artifacts_proposal
    ON proposal_artifacts(proposal_id, volume_number);

-- Sections belong to exactly one artifact. Nullable so the column can be added
-- to existing rows and backfilled below; the create-route + backfill always set
-- it. ON DELETE SET NULL (not CASCADE) so removing an artifact never destroys
-- accepted section content — sections are owned by the proposal, grouped by the
-- artifact.
ALTER TABLE proposal_sections
    ADD COLUMN IF NOT EXISTS artifact_id UUID REFERENCES proposal_artifacts(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_proposal_sections_artifact
    ON proposal_sections(artifact_id) WHERE artifact_id IS NOT NULL;

-- ── Backfill (E1.4): group existing proposals' sections into one artifact per
--    (volume_number, volume_name). Idempotent — only touches unassigned sections,
--    so re-running (or running after new proposals exist) is a no-op for them.
DO $$
DECLARE
    grp RECORD;
    new_artifact_id UUID;
BEGIN
    FOR grp IN
        SELECT proposal_id,
               volume_number,
               COALESCE(volume_name, 'Volume') AS volume_name
        FROM proposal_sections
        WHERE artifact_id IS NULL
        GROUP BY proposal_id, volume_number, COALESCE(volume_name, 'Volume')
    LOOP
        INSERT INTO proposal_artifacts (proposal_id, volume_number, volume_name, artifact_type)
        VALUES (
            grp.proposal_id,
            grp.volume_number,
            grp.volume_name,
            CASE WHEN grp.volume_name ~* '(cost|budget|price)' THEN 'cost' ELSE 'narrative' END
        )
        RETURNING id INTO new_artifact_id;

        UPDATE proposal_sections
        SET artifact_id = new_artifact_id
        WHERE proposal_id = grp.proposal_id
          AND volume_number IS NOT DISTINCT FROM grp.volume_number
          AND COALESCE(volume_name, 'Volume') = grp.volume_name
          AND artifact_id IS NULL;
    END LOOP;
END $$;

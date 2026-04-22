-- 011_applications.sql
--
-- Founding-cohort application pipeline. Applications come in via the
-- public /apply form, Eric reviews, status transitions through
-- accepted/rejected/onboarded. Rich profile data drives his
-- accept/reject decision + informs onboarding.
--
-- Purely ADDITIVE. Idempotent via IF NOT EXISTS guards.

CREATE TABLE IF NOT EXISTS applications (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Contact
    contact_email           TEXT NOT NULL,
    contact_name            TEXT NOT NULL,
    contact_title           TEXT,
    contact_phone           TEXT,

    -- Company
    company_name            TEXT NOT NULL,
    company_website         TEXT,
    company_size            TEXT,
    company_state           TEXT,

    -- Federal readiness
    sam_registered          BOOLEAN,
    sam_cage_code           TEXT,
    duns_uei                TEXT,
    previous_submissions    INTEGER,
    previous_awards         INTEGER,
    previous_award_programs TEXT[],

    -- Technology + pursuit
    tech_summary            TEXT NOT NULL,
    tech_areas              TEXT[] NOT NULL DEFAULT '{}',
    target_programs         TEXT[] NOT NULL DEFAULT '{}',
    target_agencies         TEXT[] NOT NULL DEFAULT '{}',
    desired_outcomes        TEXT[] NOT NULL DEFAULT '{}',

    -- Why
    motivation              TEXT,
    referral_source         TEXT,

    -- Workflow
    status                  TEXT NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending','under_review','accepted','rejected','onboarded','withdrawn')),
    reviewed_by             UUID REFERENCES users(id),
    reviewed_at             TIMESTAMPTZ,
    review_notes            TEXT,
    accepted_cohort         TEXT,

    -- Legal
    terms_accepted_at       TIMESTAMPTZ NOT NULL,
    terms_version           TEXT NOT NULL DEFAULT 'v1',

    -- Audit
    metadata                JSONB NOT NULL DEFAULT '{}'::jsonb,
    ip_hash                 TEXT,
    user_agent              TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_applications_email_unique
  ON applications (LOWER(contact_email));

CREATE INDEX IF NOT EXISTS idx_applications_status
  ON applications (status, created_at DESC)
  WHERE status IN ('pending','under_review');

CREATE INDEX IF NOT EXISTS idx_applications_accepted
  ON applications (created_at DESC)
  WHERE status = 'accepted';

-- Migration 075: section-standards taxonomy + proposal_sections meta (Phase 3, C1)
--
-- Discrete, hierarchical list of the standard section / sub-section headers found
-- across common DOD / NSF / SBIR / STTR proposals (e.g. Team → Bio,
-- Technical → Technology Overview). RFP admins add/remove entries; new proposals
-- tag their sections against these, and library atoms inherit the classification.
--
-- `category` is the C2 classification bucket the section/atom belongs to (the
-- "shred" type: technical_highlight, readiness, team, commercialization, …),
-- which will later carry vector data alongside the JSON `meta`.

CREATE TABLE IF NOT EXISTS section_standards (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key           TEXT NOT NULL UNIQUE,                       -- stable slug: 'team', 'team.bio', 'technical.overview'
    label         TEXT NOT NULL,                              -- display: 'Bio'
    parent_key    TEXT REFERENCES section_standards(key) ON DELETE CASCADE,  -- hierarchy (sub-headers)
    category      TEXT,                                       -- C2 classification bucket
    program_types TEXT[] NOT NULL DEFAULT '{}',               -- DOD/NSF/SBIR/STTR/… ; empty = applies to all
    description   TEXT,
    sort_order    INT NOT NULL DEFAULT 0,
    is_active     BOOLEAN NOT NULL DEFAULT true,
    created_by    UUID REFERENCES users(id),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_section_standards_parent   ON section_standards(parent_key);
CREATE INDEX IF NOT EXISTS idx_section_standards_category ON section_standards(category);

-- proposal_sections: tag against a standard + carry JSON (vector-ready) meta.
-- `section_type` is a soft reference to section_standards.key (no hard FK so a
-- proposal keeps its tag even if a standard is later deactivated/renamed).
ALTER TABLE proposal_sections
    ADD COLUMN IF NOT EXISTS section_type TEXT,
    ADD COLUMN IF NOT EXISTS tags         TEXT[] NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS meta         JSONB  NOT NULL DEFAULT '{}'::jsonb;
CREATE INDEX IF NOT EXISTS idx_proposal_sections_section_type ON proposal_sections(section_type);

-- ── Seed the common standards (discrete + hierarchical) ──────────────────────
INSERT INTO section_standards (key, label, parent_key, category, sort_order) VALUES
    ('cover',                    'Cover / Title Page',           NULL,          'admin',            10),
    ('abstract',                 'Abstract / Project Summary',   NULL,          'overview',         20),
    ('technical',                'Technical Volume',             NULL,          'technical',        30),
    ('technical.overview',       'Technology Overview',          'technical',   'tech_overview',    31),
    ('technical.innovation',     'Innovation / Technical Highlights', 'technical', 'tech_highlight', 32),
    ('technical.objectives',     'Objectives',                   'technical',   'technical',        33),
    ('technical.approach',       'Technical Approach',           'technical',   'technical',        34),
    ('technical.work_plan',      'Work Plan / Tasks',            'technical',   'technical',        35),
    ('technical.deliverables',   'Deliverables / Milestones',    'technical',   'technical',        36),
    ('readiness',                'Technology Readiness (TRL)',   NULL,          'readiness',        40),
    ('team',                     'Team / Key Personnel',         NULL,          'team',             50),
    ('team.bio',                 'Bio',                          'team',        'team',             51),
    ('team.org',                 'Organization & Roles',         'team',        'team',             52),
    ('past_performance',         'Past Performance',             NULL,          'past_performance', 60),
    ('commercialization',        'Commercialization Plan',       NULL,          'commercialization',70),
    ('commercialization.market', 'Market / Customer',            'commercialization', 'commercialization', 71),
    ('facilities',               'Facilities & Equipment',       NULL,          'facilities',       80),
    ('management',               'Management Plan',              NULL,          'management',       90),
    ('funding_history',          'Prior / Related Funding',      NULL,          'funding',          100),
    ('cost',                     'Cost Volume',                  NULL,          'cost',             110),
    ('cost.budget',              'Budget Justification',         'cost',        'cost',             111)
ON CONFLICT (key) DO NOTHING;

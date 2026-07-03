-- Migration 101: unified library taxonomy + atoms + lineage + cocoons (greenfield).
--
-- ONE tag scheme (dimension:value) for atoms/sections/volumes, a program-aware curated
-- vocabulary (SBIR/STTR/OTA/CSO/BAA) with an `other` escape in every dimension, atoms
-- that range primitive→group, a parent→child lineage DAG (foundational atoms uploaded
-- anytime; derivative atoms returned at proposal download and reusable as new parents),
-- and "digital cocoons" (the document/section skeletons an atom lived in — themselves
-- reusable template skeletons). Design: docs/UNIFIED_TAXONOMY.md + docs/SECTION_SPINE_DESIGN.md.
--
-- Additive/greenfield: does not touch legacy library_units. A crosswalk backfill is a
-- follow-on migration.

CREATE EXTENSION IF NOT EXISTS vector;

-- ── 1. taxonomy_terms — the ONE curated vocabulary, program-aware ──
CREATE TABLE IF NOT EXISTS taxonomy_terms (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dimension     TEXT NOT NULL,   -- vol | kind | grain | fmt | dept | agency | program | phase | party_role | access
    value         TEXT NOT NULL,   -- slug (open dims tech/party/sol/topic are free values, not seeded)
    label         TEXT NOT NULL,
    program_types TEXT[] NOT NULL DEFAULT '{}',  -- which programs a `vol:` applies to ({} = all)
    sort_order    INT  NOT NULL DEFAULT 0,
    is_active     BOOLEAN NOT NULL DEFAULT true,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (dimension, value)
);
CREATE INDEX IF NOT EXISTS idx_taxonomy_terms_dim ON taxonomy_terms (dimension, is_active);
GRANT SELECT ON taxonomy_terms TO govtech_app;

-- ── 2. document_cocoons — the "digital cocoon" = a section/document skeleton (template) ──
CREATE TABLE IF NOT EXISTS document_cocoons (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id          UUID REFERENCES tenants(id),   -- NULL = system skeleton
    name               TEXT NOT NULL,
    program_type       TEXT,
    scope              TEXT NOT NULL DEFAULT 'section' CHECK (scope IN ('section','document')),
    structure          JSONB NOT NULL DEFAULT '{}'::jsonb,  -- the skeleton (section molds / canvas rules)
    origin_proposal_id UUID,                            -- set when captured at download
    source             TEXT NOT NULL DEFAULT 'system' CHECK (source IN ('upload','download','system','harvest')),
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cocoons_tenant ON document_cocoons (tenant_id);
GRANT SELECT, INSERT, UPDATE ON document_cocoons TO govtech_app;

-- ── 3. library_atoms — greenfield atom store (primitive | group | reference) ──
CREATE TABLE IF NOT EXISTS library_atoms (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id          UUID NOT NULL REFERENCES tenants(id),
    grain              TEXT NOT NULL DEFAULT 'primitive' CHECK (grain IN ('primitive','group','reference')),
    title              TEXT,
    content            TEXT,                                  -- plain text
    canvas_nodes       JSONB,                                 -- structured CanvasNode[] body
    summary            TEXT,                                  -- one-line abstract for matching
    word_count         INT  NOT NULL DEFAULT 0,
    char_count         INT  NOT NULL DEFAULT 0,
    member_summary     JSONB NOT NULL DEFAULT '{}'::jsonb,    -- {"bio":4} count-by-type for groups
    status             TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','archived')),
    confidence         REAL NOT NULL DEFAULT 0.5,
    outcome            TEXT NOT NULL DEFAULT 'pending' CHECK (outcome IN ('pending','awarded','rejected','withdrawn')),
    outcome_score      REAL NOT NULL DEFAULT 0.5,
    usage_count        INT  NOT NULL DEFAULT 0,
    source             TEXT NOT NULL DEFAULT 'upload' CHECK (source IN ('upload','harvest','download_derivative','manual')),
    cocoon_id          UUID REFERENCES document_cocoons(id),  -- the skeleton this atom lived in
    origin_proposal_id UUID,                                  -- proposal a derivative was born in
    origin_section_id  UUID,
    embedding          vector(1536),                          -- NULL until we vectorize (later)
    owner_user_id      UUID REFERENCES users(id),
    visibility         TEXT NOT NULL DEFAULT 'tenant' CHECK (visibility IN ('tenant','owner_only','shared_for_proposal','admin_only')),
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_atoms_tenant        ON library_atoms (tenant_id);
CREATE INDEX IF NOT EXISTS idx_atoms_tenant_status ON library_atoms (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_atoms_grain         ON library_atoms (tenant_id, grain);
DROP TRIGGER IF EXISTS library_atoms_updated ON library_atoms;
CREATE TRIGGER library_atoms_updated BEFORE UPDATE ON library_atoms
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE library_atoms ENABLE ROW LEVEL SECURITY;
ALTER TABLE library_atoms FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON library_atoms;
CREATE POLICY tenant_isolation ON library_atoms
    USING      (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON library_atoms TO govtech_app;

-- ── 4. atom_tags — the unified taxonomy on atoms, with confirmation provenance ──
-- Every tag is either auto-populated (from card/doc) or admin-entered, and CONFIRMED.
CREATE TABLE IF NOT EXISTS atom_tags (
    atom_id      UUID NOT NULL REFERENCES library_atoms(id) ON DELETE CASCADE,
    dimension    TEXT NOT NULL,
    value        TEXT NOT NULL,
    is_other     BOOLEAN NOT NULL DEFAULT false,
    tag_source   TEXT NOT NULL DEFAULT 'admin' CHECK (tag_source IN ('auto','admin')),
    confirmed    BOOLEAN NOT NULL DEFAULT false,
    confirmed_by UUID REFERENCES users(id),
    confirmed_at TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (atom_id, dimension, value)
);
CREATE INDEX IF NOT EXISTS idx_atom_tags_dimval ON atom_tags (dimension, value);  -- the selector's overlap query
GRANT SELECT, INSERT, UPDATE, DELETE ON atom_tags TO govtech_app;

-- ── 5. atom_lineage — parent→child DAG (child ← many parents; parent → many children) ──
CREATE TABLE IF NOT EXISTS atom_lineage (
    parent_atom_id UUID NOT NULL REFERENCES library_atoms(id) ON DELETE CASCADE,
    child_atom_id  UUID NOT NULL REFERENCES library_atoms(id) ON DELETE CASCADE,
    relation       TEXT NOT NULL DEFAULT 'derived_from' CHECK (relation IN ('derived_from','reused_from')),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (parent_atom_id, child_atom_id),
    CHECK (parent_atom_id <> child_atom_id)
);
CREATE INDEX IF NOT EXISTS idx_lineage_child  ON atom_lineage (child_atom_id);   -- ancestry
CREATE INDEX IF NOT EXISTS idx_lineage_parent ON atom_lineage (parent_atom_id);  -- "history of many children"
GRANT SELECT, INSERT, DELETE ON atom_lineage TO govtech_app;

-- ── 6. atom_members — a group atom aggregates member atoms (Team → 4 bios), ordered ──
CREATE TABLE IF NOT EXISTS atom_members (
    group_atom_id  UUID NOT NULL REFERENCES library_atoms(id) ON DELETE CASCADE,
    member_atom_id UUID NOT NULL REFERENCES library_atoms(id) ON DELETE CASCADE,
    ordinal        INT  NOT NULL DEFAULT 0,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (group_atom_id, member_atom_id),
    CHECK (group_atom_id <> member_atom_id)
);
CREATE INDEX IF NOT EXISTS idx_members_group ON atom_members (group_atom_id, ordinal);
GRANT SELECT, INSERT, DELETE ON atom_members TO govtech_app;

-- ══════════════════════════════════════════════════════════════════════════════
-- SEED: the one curated vocabulary. `other` in every curated dimension.
-- ══════════════════════════════════════════════════════════════════════════════

-- vol: — volume / section role across SBIR / STTR / OTA / CSO / BAA (program_types {} = all)
INSERT INTO taxonomy_terms (dimension, value, label, program_types, sort_order) VALUES
 ('vol','cover','Cover Sheet','{}',10),
 ('vol','abstract','Abstract / Project Summary','{sbir,sttr,baa}',20),
 ('vol','summary','Executive Summary','{}',30),
 ('vol','white_paper','White Paper','{baa,ota,cso}',40),
 ('vol','concept_paper','Concept Paper','{ota,baa}',50),
 ('vol','solution_brief','Solution Brief','{cso,ota}',60),
 ('vol','quad_chart','Quad Chart','{baa,ota,cso}',70),
 ('vol','oral_pitch','Oral Pitch / Slides','{cso}',80),
 ('vol','technical','Technical Volume','{}',90),
 ('vol','problem_significance','Problem Significance','{sbir,sttr,baa}',100),
 ('vol','objectives','Technical Objectives','{sbir,sttr}',110),
 ('vol','work_plan','Work Plan','{sbir,sttr}',120),
 ('vol','statement_of_work','Statement of Work','{ota,baa,cso}',130),
 ('vol','milestones','Milestones & Schedule','{}',140),
 ('vol','deliverables','Deliverables','{}',150),
 ('vol','related_work','Related Work','{sbir,sttr,baa}',160),
 ('vol','phase_ii_vision','Phase II Vision / Future R&D','{sbir,sttr}',170),
 ('vol','commercialization','Commercialization Plan','{sbir,sttr,baa}',180),
 ('vol','transition_plan','Transition Plan','{}',190),
 ('vol','management','Management Plan / Volume','{baa,ota}',200),
 ('vol','key_personnel','Key Personnel / Team','{}',210),
 ('vol','principal_investigator','Principal Investigator','{sbir,sttr}',220),
 ('vol','research_institution','Research Institution (STTR)','{sttr}',230),
 ('vol','work_allocation','Work Allocation (STTR)','{sttr}',240),
 ('vol','past_performance','Past Performance','{baa,ota,cso}',250),
 ('vol','facilities','Facilities','{}',260),
 ('vol','equipment','Equipment','{sbir,sttr}',270),
 ('vol','subcontractors','Subcontractors / Consultants','{}',280),
 ('vol','prior_support','Prior / Current Support','{sbir,sttr}',290),
 ('vol','foreign_citizens','Foreign Citizens','{sbir,sttr}',300),
 ('vol','cost','Cost Volume / Budget','{}',310),
 ('vol','cost_narrative','Cost Narrative','{}',320),
 ('vol','rom','Rough Order of Magnitude','{baa,ota}',330),
 ('vol','pricing','Pricing','{cso,ota}',340),
 ('vol','certifications','Certifications','{sbir,sttr}',350),
 ('vol','sf424','SF-424 Forms','{sbir,sttr}',360),
 ('vol','data_rights','Data Rights Assertions','{}',370),
 ('vol','letters_of_support','Letters of Support','{}',380),
 ('vol','other','Other','{}',999)
ON CONFLICT (dimension, value) DO NOTHING;

-- kind: — content kind
INSERT INTO taxonomy_terms (dimension, value, label, sort_order) VALUES
 ('kind','narrative','Narrative',10),('kind','bio','Bio / Personnel',20),('kind','headshot','Headshot',30),
 ('kind','figure','Figure / Graphic',40),('kind','diagram','Diagram',50),('kind','table','Table',60),
 ('kind','chart','Chart',70),('kind','budget_data','Budget Data',80),('kind','past_perf_blurb','Past-Performance Blurb',90),
 ('kind','boilerplate','Boilerplate',100),('kind','certification','Certification',110),('kind','letter','Letter',120),
 ('kind','citation','Citation / Reference',130),('kind','resume','Resume / CV',140),('kind','quad','Quad',150),
 ('kind','other','Other',999)
ON CONFLICT (dimension, value) DO NOTHING;

-- grain: — granularity
INSERT INTO taxonomy_terms (dimension, value, label, sort_order) VALUES
 ('grain','primitive','Primitive (one object)',10),('grain','group','Group (aggregate)',20),('grain','reference','Reference (source doc)',30)
ON CONFLICT (dimension, value) DO NOTHING;

-- fmt: — format affinity
INSERT INTO taxonomy_terms (dimension, value, label, sort_order) VALUES
 ('fmt','doc','Document',10),('fmt','slide','Slide',20),('fmt','sheet','Spreadsheet',30),
 ('fmt','form','Form',40),('fmt','image','Image',50),('fmt','other','Other',999)
ON CONFLICT (dimension, value) DO NOTHING;

-- dept: — department
INSERT INTO taxonomy_terms (dimension, value, label, sort_order) VALUES
 ('dept','dod','Department of Defense',10),('dept','hhs','Health & Human Services',20),('dept','dhs','Homeland Security',30),
 ('dept','doe','Department of Energy',40),('dept','nasa','NASA',50),('dept','usda','Agriculture',60),
 ('dept','doc','Commerce',70),('dept','dot','Transportation',80),('dept','ed','Education',90),('dept','epa','EPA',100),
 ('dept','other','Other',999)
ON CONFLICT (dimension, value) DO NOTHING;

-- agency: — agency / component
INSERT INTO taxonomy_terms (dimension, value, label, sort_order) VALUES
 ('agency','army','Army',10),('agency','navy','Navy',20),('agency','air_force','Air Force',30),
 ('agency','space_force','Space Force',40),('agency','marines','Marine Corps',50),('agency','darpa','DARPA',60),
 ('agency','mda','Missile Defense Agency',70),('agency','dha','Defense Health Agency',80),('agency','socom','SOCOM',90),
 ('agency','dla','Defense Logistics Agency',100),('agency','diu','Defense Innovation Unit',110),('agency','osd','OSD',120),
 ('agency','nih','NIH',130),('agency','nsf','NSF',140),('agency','cdmrp','CDMRP',150),('agency','arpa_h','ARPA-H',160),
 ('agency','arpa_e','ARPA-E',170),('agency','other','Other',999)
ON CONFLICT (dimension, value) DO NOTHING;

-- program: — vehicle
INSERT INTO taxonomy_terms (dimension, value, label, sort_order) VALUES
 ('program','sbir','SBIR',10),('program','sttr','STTR',20),('program','baa','BAA',30),
 ('program','ota','OTA',40),('program','cso','CSO',50),('program','rif','RIF',60),('program','other','Other',999)
ON CONFLICT (dimension, value) DO NOTHING;

-- phase:
INSERT INTO taxonomy_terms (dimension, value, label, sort_order) VALUES
 ('phase','phase_1','Phase I',10),('phase','phase_2','Phase II',20),('phase','phase_3','Phase III',30),
 ('phase','direct_to_phase_2','Direct to Phase II',40),('phase','feasibility','Feasibility',50),('phase','prototype','Prototype',60),
 ('phase','other','Other',999)
ON CONFLICT (dimension, value) DO NOTHING;

-- party_role: — relationship of a named person/org
INSERT INTO taxonomy_terms (dimension, value, label, sort_order) VALUES
 ('party_role','employee','Employee',10),('party_role','principal_investigator','Principal Investigator',20),
 ('party_role','collaborator','Collaborator',30),('party_role','customer','Customer / End User',40),
 ('party_role','supplier','Supplier',50),('party_role','partner','Partner',60),('party_role','prime','Prime',70),
 ('party_role','subcontractor','Subcontractor',80),('party_role','consultant','Consultant',90),
 ('party_role','product','Product / System',100),('party_role','other','Other',999)
ON CONFLICT (dimension, value) DO NOTHING;

-- access: — visibility / role
INSERT INTO taxonomy_terms (dimension, value, label, sort_order) VALUES
 ('access','admin_only','Admin only',10),('access','tenant','Tenant',20),
 ('access','owner_only','Owner only',30),('access','shared_for_proposal','Shared for proposal',40)
ON CONFLICT (dimension, value) DO NOTHING;

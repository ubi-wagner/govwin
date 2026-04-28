-- 020_source_profiles.sql
--
-- Source profiles for opportunity monitoring sites.
-- Each profile is a bookmarked site the admin monitors for new RFPs/topics.
-- Tracks visit history, downloads, and topic imports per source.
--
-- Purely additive. Idempotent.

CREATE TABLE IF NOT EXISTS source_profiles (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL,
    site_type       TEXT NOT NULL DEFAULT 'custom'
                      CHECK (site_type IN ('dsip','sam_gov','sbir_gov','grants_gov','afwerx','xtech','nsf','custom')),
    base_url        TEXT NOT NULL,
    bookmark_url    TEXT,
    agency          TEXT,
    program_type    TEXT,
    admin_notes     TEXT,
    visit_instructions TEXT,
    topic_url_pattern TEXT,
    pdf_url_pattern TEXT,
    is_active       BOOLEAN NOT NULL DEFAULT true,
    last_visited_at TIMESTAMPTZ,
    last_visited_by UUID REFERENCES users(id),
    created_by      UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_source_profiles_active
  ON source_profiles (site_type) WHERE is_active = true;

CREATE TABLE IF NOT EXISTS source_visits (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id      UUID NOT NULL REFERENCES source_profiles(id) ON DELETE CASCADE,
    visited_by      UUID REFERENCES users(id),
    action          TEXT NOT NULL CHECK (action IN ('visit','download','upload','paste_topics','import_topics','shred','note')),
    url             TEXT,
    notes           TEXT,
    files_count     INTEGER DEFAULT 0,
    topics_count    INTEGER DEFAULT 0,
    metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_source_visits_profile
  ON source_visits (profile_id, created_at DESC);

-- Seed initial source profiles for known sites
INSERT INTO source_profiles (name, site_type, base_url, bookmark_url, agency, program_type, admin_notes, visit_instructions, topic_url_pattern, pdf_url_pattern) VALUES
  (
    'DSIP — DoD SBIR/STTR Topics',
    'dsip',
    'https://www.dodsbirsttr.mil',
    'https://www.dodsbirsttr.mil/submissions/solicitation-documents/active-solicitations',
    'Department of Defense',
    'sbir',
    'Primary source for all DoD SBIR/STTR/CSO topics. Topics are released monthly in releases. Each BAA (SBIR, STTR, CSO) has its own preface PDF and individual topic descriptions.',
    '1. Click bookmark to open active solicitations\n2. Expand each BAA to see releases\n3. Click "View Topics" for topic listing\n4. Copy the topic table and paste here\n5. Click "Download Full Release Instructions" and upload the PDF',
    'https://www.dodsbirsttr.mil/topics-app/?baa={baa_id}&release={release}',
    NULL
  ),
  (
    'Defense SBIR/STTR — Preface Downloads',
    'dsip',
    'https://defensebusiness.org',
    'https://defensesbirsttr.mil/submissions/solicitation-documents/active-solicitations',
    'Department of Defense',
    'sbir',
    'Same site as DSIP but for downloading the main BAA preface PDFs. These contain the general instructions, compliance requirements, and format rules that apply to all topics in the release.',
    '1. Find the BAA you need\n2. Download the Full Solicitation PDF\n3. Upload it here → auto-shred + compliance extraction',
    NULL,
    NULL
  ),
  (
    'AFWERX — Air Force SBIR/STTR',
    'afwerx',
    'https://afwerx.com',
    'https://afwerx.com/get-funded/',
    'Department of the Air Force',
    'sbir',
    'AFWERX manages Air Force SBIR/STTR. Open Funding Opportunities page shows upcoming solicitations with pre-release, open, and close dates. Timeline chart format.',
    '1. Click bookmark to see open funding opportunities\n2. Note solicitation names and dates\n3. Click through to DSIP for the actual topic listings\n4. Download any AFWERX-specific PDFs and upload here',
    NULL,
    NULL
  ),
  (
    'xTech — Army Innovation Competitions',
    'xtech',
    'https://xtech.army.mil',
    'https://xtech.army.mil',
    'U.S. Army',
    'ota',
    'Army xTech runs innovation competitions (PHANTUM, Adaptive Strike, Humanoid, etc.). Card-based layout with OPEN/ACTIVE badges. Different from SBIR — these are OTA-style competitions with pitch events.',
    '1. Check for new OPEN competitions\n2. Click "APPLY NOW" to see details and deadlines\n3. Download any application guides or templates\n4. Upload materials and note deadlines',
    NULL,
    NULL
  ),
  (
    'NSF SEED Fund — SBIR/STTR',
    'nsf',
    'https://seedfund.nsf.gov',
    'https://seedfund.nsf.gov/what-we-fund/',
    'National Science Foundation',
    'sbir',
    'NSF SEED Fund (formerly NSF SBIR/STTR). Topic areas are broad categories, not specific topics like DoD. Companies submit project pitches anytime (rolling). Max one pitch per month. Good fit for blue-sky R&D with PhD-level innovation.',
    '1. Review funding topic areas for customer tech fit\n2. Download the searchable PDF of topic areas\n3. Check critical-information page for submission status\n4. Note: NSF is currently paused for new pitches (as of 4/16/2026)',
    NULL,
    NULL
  ),
  (
    'SAM.gov — Federal Opportunities',
    'sam_gov',
    'https://sam.gov',
    'https://sam.gov/search/?index=opp&page=1&sort=-modifiedDate&sfm%5BsimpleSearch%5D%5BkeywordRadio%5D=ALL',
    NULL,
    NULL,
    'General federal opportunities. Already have an automated ingester for SAM.gov API. Use this bookmark for manual searches when looking for specific BAAs or broad agency announcements not yet in the automated feed.',
    '1. Search for specific solicitation numbers or keywords\n2. Download attached documents\n3. Upload to RFP Pipeline for processing',
    NULL,
    NULL
  )
ON CONFLICT DO NOTHING;

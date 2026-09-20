-- 255 · The documents a scout finding actually carries
--
-- ── WHAT IS MISSING TODAY ─────────────────────────────────────────────────────────────────────
-- A scout finding records a title, a URL and a snippet. Classification (`lib/scout/classify.ts`)
-- then decides NEW vs UPDATE by comparing source id → solicitation number → exact title → fuzzy
-- title. Nothing has ever looked at the DOCUMENTS behind the link, because nothing has ever
-- fetched them.
--
-- That is the gap this table opens. Agencies post the same solicitation to several places — a
-- programme page, a component portal, an aggregator — under different titles and different
-- numbering, while the attached PDF is byte-for-byte the same file. Title similarity cannot see
-- that; a content hash sees it immediately. And when the bytes differ (a re-wrapped PDF, a page
-- added), the FILENAME and the SIZE still agree closely enough to be worth a human's attention.
--
-- `solicitation_documents` already stores exactly those three fields — `original_filename`,
-- `file_size`, `content_hash` — for curated solicitations, with a unique index on
-- `(solicitation_id, content_hash)`. That per-solicitation scoping is deliberate and correct: the
-- SAME document legitimately appears under two opportunities, which is the very fact a
-- cross-source matcher needs to be able to represent. So this table is the pre-release mirror of
-- that shape, and matching is a join between the two rather than a new mechanism.
--
-- ── PLATFORM SCOPE, LIKE ITS PARENT ───────────────────────────────────────────────────────────
-- `scout_findings` carries no `tenant_id` — a finding is platform work on a master record before
-- any tenant mirror exists. This table follows it exactly, and deliberately does NOT carry one
-- either: a harvested document belongs to no customer, and giving it a tenant would be the
-- `contacts` mistake (mig 243) in a new place.
--
-- ── A FAILED FETCH IS A ROW, NOT A SILENCE ────────────────────────────────────────────────────
-- `http_status` and `error` exist so that "we asked and the server said 403" is distinguishable
-- from "nobody ever asked". Those are opposite operational facts and they look identical if the
-- only record of a fetch is the rows that succeeded. `storage_key` is nullable for the same
-- reason: a row can record an attempt that stored nothing.
--
-- ── AND `harvest_driver` IS PROVENANCE, NOT CONFIGURATION ─────────────────────────────────────
-- This codebase already holds one non-negotiable rule about ingest: *a value the product did not
-- read from the solicitation must never look like one it did* (docs/INGEST_PROVENANCE.md). The
-- same rule applies one layer earlier. This box cannot reach sam.gov or dodsbirsttr.mil — the
-- network policy refuses them — so the harvester has a fixture driver, exactly as the Claude
-- emulator stands in for the API. A document that arrived from a committed fixture MUST NOT be
-- indistinguishable from one fetched from the agency, or every downstream claim about "the same
-- document on two sites" is unfalsifiable.
--
-- So the driver is stamped on the ROW, NOT NULL, with no default. A caller has to say how the
-- bytes arrived.

CREATE TABLE IF NOT EXISTS scout_finding_documents (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  finding_id        uuid NOT NULL REFERENCES scout_findings(id) ON DELETE CASCADE,

  -- Where the link was found and where it pointed. Both, because a document is often linked from
  -- a landing page on a different host than the file itself, and "which page offered this" is the
  -- question a curator asks when two sources disagree.
  page_url          text NOT NULL,
  document_url      text NOT NULL,

  -- The three fields matching runs on. `original_filename` is what the server called it, never
  -- what we renamed it to.
  original_filename text NOT NULL,
  content_type      text,
  file_size         bigint,
  content_hash      text,

  storage_key       text UNIQUE,

  -- How the bytes arrived. See the note above: this is provenance and it is required.
  harvest_driver    text NOT NULL CHECK (harvest_driver IN ('live', 'fixture')),
  http_status       integer,
  error             text,

  harvested_at      timestamptz NOT NULL DEFAULT now(),
  metadata          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- ── THE NATURAL KEY IS THE URL, NOT THE HASH ─────────────────────────────────────────────────
-- Re-harvesting a finding must CONVERGE rather than accumulate, so the harvester upserts on this.
--
-- The first version keyed on `(finding_id, content_hash)` and was wrong in a way the drive caught
-- on its first run: a FAILED fetch has no hash, so it fell outside the partial index, and
-- re-harvesting the same dead link inserted a SECOND row for it. Three rows became four. The
-- failure-is-a-row rule above is worth nothing if the same failure is recorded twice.
--
-- `document_url` is the honest identity of a harvested row: it is WHERE THIS CAME FROM, it is
-- always present (successes and failures alike), and re-fetching the same URL is the same fact
-- observed again. The hash is what MATCHING runs on, and that is a query, not a constraint — two
-- links on one page to byte-identical files are two links, which is a fact about the page.
CREATE UNIQUE INDEX IF NOT EXISTS idx_scout_doc_unique_per_finding
  ON scout_finding_documents (finding_id, document_url);

-- The matching lookup: "has anything, anywhere, carried these bytes before?"
CREATE INDEX IF NOT EXISTS idx_scout_doc_hash
  ON scout_finding_documents (content_hash)
  WHERE content_hash IS NOT NULL;

-- The size half of "close enough", which is a RANGE scan and needs its own index. Filename
-- similarity is computed in the app rather than indexed: it is a comparison between two candidate
-- strings, not a lookup key.
CREATE INDEX IF NOT EXISTS idx_scout_doc_size
  ON scout_finding_documents (file_size)
  WHERE file_size IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_scout_doc_finding
  ON scout_finding_documents (finding_id, harvested_at DESC);

COMMENT ON TABLE scout_finding_documents IS
  'Documents harvested from a scout finding''s page, pre-release and platform-scope. The '
  'pre-release mirror of solicitation_documents, so cross-source matching is a join between the '
  'two. harvest_driver records whether the bytes came from the agency or from a committed '
  'fixture — a fixture document must never look like a fetched one.';

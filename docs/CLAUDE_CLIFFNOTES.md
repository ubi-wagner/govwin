# CLAUDE_CLIFFNOTES.md — Session Handoff

**Purpose:** Running handoff document. Any future Claude session reading
this should pick up cleanly from the last state.

**Last updated:** 2026-04-24 — Phase 1 curation BUILT, marketing live,
architecture documented, agent fabric design next.

**Authoritative architecture:** [`docs/ARCHITECTURE_DAY365.md`](./ARCHITECTURE_DAY365.md)
— 14 sections, 5 Mermaid diagrams, full status matrix, 6-week critical
path to June 1 launch. READ THAT FIRST.

---

## Current State

**Branch:** `claude/analyze-project-status-KbAhg` — ~25 commits ahead of main.
**Tests:** 327 total (152 pipeline + 175 frontend), all passing.
**Migrations:** 001–015, all deployed to prod, all idempotent.
**Deployment:** Railway auto-deploys frontend + pipeline on merge to main.
Migrations auto-apply via `migrate.yml` when `db/migrations/**` changes.

**Services:**
- Frontend: Next.js 15, Railway (`/frontend/**` watch)
- Pipeline: Python 3.12, Railway (`/pipeline/**` watch)
- Postgres: PG 18, Railway managed
- Bucket: `customers-prod-xvizsdjcxi` at `t3.storageapi.dev`

**Auth:** `eric@rfppipeline.com` — master_admin. Login works end-to-end.

---

## What's BUILT

**28 registered dual-use tools** — solicitation.* (11), compliance.* (4),
opportunity.* (3), volume.* (5), ingest.* (3), memory.* (2).

**Ingester framework:** sam_gov, sbir_gov, grants_gov with stub+real paths.
Dispatcher routes `kind=ingest` and `kind=shred_solicitation`.

**Shredder:** PDF→pymupdf4llm→Claude→sections+compliance→DB+S3 artifacts.
Writes text.md, shredded/{section}.md, metadata.json to bucket.

**Admin workspace:** PDF viewer (react-pdf) + compliance matrix side-by-side.
Text selection→tag popover→variable assign with SourceAnchor (page, %-rects,
excerpt). Highlights persist via solicitation_annotations. Provenance on matrix
(doc:page:excerpt, click-to-navigate). Topics panel (extract/bulk/drop).
Volumes panel (add/edit with per-item compliance). Activity feed with names.

**HITL memory:** Every verify/correct→episodic_memories with namespace key.
compliance-suggest reads prior verified values for cross-cycle pre-fill.

**S3 artifacts:** Upload→store→shred→artifacts. Portal provisioner copies
master→customer sandbox. Global SHA-256 dedup.

**Marketing:** 5 pages (Landing/About/Value/Resources/InfoSec) + Apply form
+ application pipeline. Brand from Logo V0.4.

**Source anchors:** Universal SourceAnchor type stored on annotations,
compliance values, memory. %-based bounding rects.

---

## What's STUB or PLANNED

All `/api/portal/*` routes (501). Stripe. Scoring engine. Automation engine.
10 agent archetypes (all `pass`). Workers (embedder, emailer, etc.).
Customer onboarding. Spotlight feed. Proposal workspace. Library management.
Agent provisioning. Notifications.

See `ARCHITECTURE_DAY365.md` §6 for the full 16-row status matrix.

---

## Key Decisions Made

- DoW aliases to DOD in namespace (D-Phase1-11)
- CSO uses `:Open` phase (D-Phase1-12)
- Token budget 150K (D-Phase1-13)
- Topics ARE opportunities (linked via solicitation_id FK)
- Curator writes→custom_variables JSONB (AI→named columns)
- Global file dedup via SHA-256 on solicitation_documents
- SourceAnchor schema universal across all features

---

## Next Priorities

1. Agent fabric design document (Claude agent architecture)
2. Merge current branch + verify S3/shredder end-to-end
3. Customer onboarding (accept→Stripe→library upload)
4. Spotlight feed (ranking, pin/unpin)
5. Proposal portal (purchase→provision→draft→review)

See `ARCHITECTURE_DAY365.md` §11 for the full 6-week critical path.

---

## Operational Notes

**Background agents:** Max ~100 lines output, 1-2 files, <3 min.
Break large tasks into chunks. Stream idle timeout kills long runs.

**Railway:** `AWS_DEFAULT_REGION` ≠ `AWS_REGION` — S3Client needs explicit
region param. Keep pipeline requirements.txt lean (7 deps, ~400MB image).
Query tab auto-appends LIMIT 100.

**Dev PG:** `/tmp/pgtest` port 55432. Dies between sessions — restart:
`sudo -u postgres pg_ctl -D /tmp/pgtest/data -l /tmp/pgtest/pg.log -o "-p 55432 -k /tmp/pgtest" start`

---

## New Session Onboarding

1. Read `CLAUDE.md` (5 min)
2. Read this file (5 min)
3. Read `ARCHITECTURE_DAY365.md` (20 min)
4. Run tests: `cd pipeline && python -m pytest tests/` + `cd frontend && npx vitest run`
5. Check `git log --oneline -20`
6. Update this file at next milestone

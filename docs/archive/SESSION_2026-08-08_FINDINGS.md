# Session Findings — 2026-08-08

Consolidated log of this session's work on `claude/nice-hamilton-kBqtD`. Detailed records are in the
dated docs referenced under each section.

## 1. Partner-Manager actor — verified as-built (not rebuilt)
The intermediary **partner-manager** (`partner_admin`, e.g. Paul Jackson / Entrepreneurs' Center) was
**already fully built** on the branch (PM Phase 0→6 + V1-A→E, migrations 158–162). Rather than
duplicate it, I verified it **end-to-end live**: console + owner-scoped stable rollup cards, add-company
(new→RFP-approve, existing→request-manager, company-adds-manager), scoped descend/ascend, and the full
`finder:partner.*` audit trail — all three grant paths land in the stable with correct owner/membership.
- Record: `docs/PARTNER_MANAGER_V1_VERIFICATION_2026-08-08.md`; canonical design `docs/PARTNER_MANAGER_DESIGN.md`.
- Deliverable: the Partner-Manager Operator Guide (13pp PDF).

## 2. Message rivers — Event Stream (`/admin/events`) upgraded
The rfp-admin system-events feed is now **fully sortable · watchable · wider** (commit `b62bb09`):
every column sorts on click; tenant shown by **name** not UUID; **Phase** filter + **Type** substring
search + **30-day** range + a **Duration** column; row cap 100→500 with an "X of N in window" count;
the 10s **Live** auto-refresh retained. Proven live as an rfp_admin on 456 real events across 7 namespaces.

## 3. Audit / event contract — enforced to 100% of the surface
- **The binding spec the code referenced never existed** — wrote `docs/EVENT_CONTRACT.md`: row shape,
  start/end/single semantics, the 7-namespace registry, type-format rules, and the full **219-type catalog**.
- **The moat is 4 layers**:
  0. **DB floor** — `system_events` CHECK constraints enforce `namespace` (7 registry, mig 069),
     `phase` (start/end/single, mig 007), `actor_type` (4 values) on **every** insert. *Proven*:
     `namespace='admin'` is rejected by the database.
  1. **audit-coverage.test.ts** — every mutating `app/api` route + `app/actions` server action must emit.
  2. **event-contract.test.ts** — namespace registry · type format · start↔end pairing · raw-insert allowlist.
  3. **Runtime warn** (`lib/events.ts`) — catches dynamic namespaces the static scan can't see.
- **100%-surface sweep**: 8 namespaces · 219 types · **0 violations · 0 orphan starts**. 11 raw
  `INSERT INTO system_events` sites (4 frontend, 6 pipeline, 1 CMS) inventoried + conformant.
- **Fixed by the sweep**: `auth.ts` `identity:user.logged_in`/`user.login_failed` were missing from the
  catalog (added); raw inserts had no guard (now allowlisted — a new one fails CI); the `app/api/events`
  endpoint validated namespace but not type (now enforces the `entity.action` regex).
- Records: `docs/EVENT_AUDIT_2026-08-02.md`, `docs/EVENT_AUDIT_2026-08-08.md`, `docs/EVENT_CONTRACT.md`.
- Verdict on the original question ("does everything follow start/end + namespacing, all CRUD/automation/
  workflows?"): **yes — verified across all three services and enforced at four layers.**

## 4. Route-404 sweep (earlier this session)
Two audits (bare-parent tree walk + link-vs-route cross-reference over 107 routes) found the only genuine
gap was bare `/legal`; added an index page. Every internal link resolves. (Commit `5a3c7c4`.)

## 5. Operational note — the self-reverting sandbox
The box reverted its working tree **and** the `/tmp` Postgres data to an old commit **~6×** this session
(idle container reclaim). **Nothing was lost** — every change is on origin; each time I recovered via
`git fetch + reset --hard origin/claude/nice-hamilton-kBqtD` and re-applied any uncommitted edit. A
running **manager heartbeat** (pinging the scratchpad) + sustained activity kept the box alive long
enough to complete the live screenshot drives. Lesson: commit + push after every unit of work; a fresh
session is the clean fix if it recurs.

## 6. Guides (this task)
Revised **user**, **admin**, and **collaborator** complete visual guides — see `docs/guides/` + the
delivered PDFs.

## Key commits (this session)
`5a3c7c4` /legal · partner-manager build (PM phases, pre-existing) · `7fdbee8` PM verification ·
`b62bb09` Event Stream upgrade · `556ebbb` audit-coverage guard + expert-time fix ·
`ba83013` event-contract spec + guards · `f0d7caf` 100%-surface sweep (DB floor, raw-insert guard).

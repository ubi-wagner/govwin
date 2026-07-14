# HITL Wiring Audit Runbook — end-to-end capability × backend

**Purpose.** A self-contained runbook for an autonomous session to execute an
end-to-end, RFP-admin HITL pass whose lens is *accessibility + backend wiring*:
for every capability the product claims, prove there is (a) a reachable UI entry
point and (b) a real backend route → DB query / tool behind it, and that data
round-trips. This is the "is it actually wired, or just a button?" audit.

It layers on `HITL_TEST_PLAN.md` (phases A–F) and `HITL_TEST_PLAN_V2.md`; it does
not replace them. Where those say "click X and see Y", this asks additionally
"and is X wired to a real endpoint that persists Y?"

---

## How to run this tomorrow

This runbook is the deliverable that makes the run turnkey. A cron created inside
a chat session is in-memory only and will not survive an idle web container
overnight, so start a **fresh session** one of two ways:

1. **Platform Scheduled trigger (reliable).** In the Claude Code web UI, create a
   Scheduled trigger on `ubi-wagner/govwin`, branch `claude/nice-hamilton-kBqtD`,
   for tomorrow morning, with this prompt:

   > Execute `docs/HITL_WIRING_AUDIT_RUNBOOK.md` end to end as an RFP admin.
   > Read-only audit of PRODUCT code (you MAY create a throwaway driving harness
   > and seed data, but change no product code). First stand up a running, seeded
   > instance and DRIVE it — anything you cannot drive at runtime is ⚪ UNVERIFIED,
   > never WIRED. Seed an RFP with 10 topics (10 opportunities). Produce the dated
   > report described in the runbook, report the WIRED/UNVERIFIED split honestly,
   > commit it to `claude/nice-hamilton-kBqtD`, and push. Do not open a PR.

2. **Paste-to-run.** Open a new session on the branch and paste the same prompt.

Default posture (change in the prompt if you want otherwise):
- **Read-only** — trace and report; do not modify product code.
- **Output** — a dated markdown report committed to the working branch.
- **No PR** unless explicitly requested.

---

## Method — how to judge each capability

For each capability below, follow the actual HITL path (log in as the RFP admin,
use the shadow admin account, drive the real UI/route), then record ONE verdict
with **file:line evidence** for the claim:

| Verdict | Meaning |
|---|---|
| ✅ **WIRED** | Proven by a **driven round-trip**: UI/route acted on a running instance → real DB/tool → value written was read back through the same path the UI uses. Code-reading alone can NEVER earn this. |
| 🟡 **PARTIAL** | Driven, but something is stubbed: TODO, mock data, missing persistence, ignored input, no read-back, or wired-but-wrong (see §Failure modes). |
| 🔴 **DEAD-END** | Driven and it goes nowhere: no handler, 404/500, silent no-op; OR a route exists with no UI to reach it. |
| ⚪ **UNVERIFIED** | Could NOT be driven (no running instance, blocked, or out of time). Code *looks* wired but was not proven. This is the anti-false-green slot — anything you only read must land here, never in WIRED. |
| ⬜ **NOT-BUILT** | Capability isn't present yet (fine for "if completed" items — say so plainly, don't infer). |

Evidence rules:
- **No WIRED without driving it.** The verdict WIRED requires a concrete
  round-trip: seed → act via the real UI/route → read the value back. Record the
  observed IDs/values. If you did not or could not drive it, the verdict is
  ⚪ UNVERIFIED — do not launder a code read into a green.
- Cite the UI entry (`app/portal/...` page or component), the route
  (`app/api/.../route.ts`), and the DB/tool call (query, `lib/...`, tool name).
- Note tenant-scoping on every portal capability (a portal route that queries by
  ID alone without tenant access = a finding, per `CLAUDE.md`).
- Report the WIRED / UNVERIFIED split up front: an audit that is 80% UNVERIFIED
  has not audited the product, it has read it. Say so.

---

## Preconditions

**Step 0 — stand up a DRIVEN instance (do this first; the audit is worthless without it).**
There is currently **no e2e harness** — `playwright.config.ts` points at an empty
`./e2e`, and `__tests__/integration/smoke.test.ts` runs with `sql` mocked ("no
running server or live database"). So nothing here has ever been exercised against
a real server + DB. Build the minimum to drive it:
  1. Create a Postgres DB and run the full migration chain (`db/migrations/migrate.mjs`).
  2. Seed dev accounts (`scripts/seed_dev_accounts.mjs`, `SEED_DEV_ACCOUNTS=1`) — this
     gives you the RFP-admin + a tenant to shadow.
  3. Boot the app (`next start`/`dev` on :3000) with `DATABASE_URL` set.
  4. Authenticate headlessly — the app uses a NextAuth **Credentials** provider
     (`auth.ts`), so log in with a seeded email/password via Playwright and save
     `storageState`, or hit the credentials callback to get a session cookie. Reuse
     that state for every driven check.
  5. Prove the harness works before auditing: log in → load one portal page → read
     one real row back. If you cannot get this far, STOP and report that the audit
     could not be driven (everything downstream is ⚪ UNVERIFIED) — do not fall back
     to code-reading and emit greens.

1. **Login** — RFP admin (shadow admin account). Confirm the session role gates
   admin surfaces AND can shadow into a tenant portal.
2. **Seed** — one RFP (solicitation) with **10 topics → 10 opportunities**. Drive
   the **real ingest/curation UI path** for at least the first topic (that path is
   the point of §1); a script may seed the other 9 for setup speed, but then you
   must still drive the UI that *reads* them.
3. **Env note** — record whether `ANTHROPIC_API_KEY` and `AWS_S3_BUCKET_NAME` are
   set; AI drafting and export/download degrade deterministically without them
   (`proposal.draft_section` returns an error payload; `/api/health` throws at
   s3-client load). Distinguish "not wired" from "wired but unconfigured".

---

## Capability areas (drive each, one verdict + evidence per row)

### 1. RFP + 10 topics → 10 opportunities  (ingest → curate → release)
Entry: `app/admin/rfp-curation/upload`, `.../rfp-curation/[solId]`,
`.../rfp-curation/[solId]/topic/[topicId]`, `app/admin/opportunities`,
routes `admin/opportunities/[oppId]/publish` + `.../lifecycle`.
Verify:
- Upload/ingest an RFP creates a solicitation with **10 distinct topics**.
- Each topic curates into an **opportunity** (10 opps), each with the 6-state
  `submission_stage` (nofo/pre_release/open/updated/closed/archived) settable via
  the lifecycle route (CAS on stage; `republishIfReleased` fan-out).
- Release/publish makes them visible downstream (bridge → tenant cards).
- A **solo RFP admin can self-approve** their own curation (no second-admin block).

### 2. Compliance matrix build
Entry: admin curation matrix surface; portal `proposals/[proposalId]/compliance`
+ `.../ai/compliance`.
Verify:
- The matrix is *built* from a topic/solicitation (requirements extracted or
  entered), **persisted**, and read back.
- It flows to the proposal: the proposal's compliance view reflects the built
  matrix (not an empty/mock shell).
- `ai/compliance` (if present) is wired to a real tool, not a stub.

### 3. Volume-doc tree (volume → section skeleton)
Entry: `proposals/[proposalId]/sections`, section skeleton; `volumeName` /
`volumeNumber` on sections; `admin/section-standards`, `portal/section-standards`.
Verify:
- A proposal provisions a **volume → section tree** (volumes group sections;
  sections carry page allocations / mold constraints).
- The tree is persisted and rendered in the workspace; page limits/mold fields
  reach the drafter (`computeSectionBudget`, `lib/section-budget`).

### 4. Templates (skeleton templates) — *if completed*
Entry: `app/admin/templates`, `.../templates/[templateId]`,
`admin/rfp-curation/[solId]/templates`, routes `admin/templates`,
`admin/section-standards`.
Verify (or mark ⬜ NOT-BUILT plainly if not finished):
- RFP-admin skeleton templates can be authored, persisted, and **applied** to a
  solicitation/proposal to generate the volume/section skeleton (§3).
- Template → skeleton is wired, not a design-only surface.

### 5. Spotlight buckets
Entry: portal `buckets`, `buckets/[bucketId]`, `spotlights`,
`spotlights/[spotlightId]`; routes `buckets`, `buckets/[bucketId]`,
`cards/[opportunityId]/pin`, `spotlight/pin`.
Verify:
- Shadow into a tenant → opportunities land as **cards**; cards can be sorted into
  **buckets** and **pinned**; bucket membership persists and reads back.
- Ranking/pin state survives reload and is tenant-scoped.

### 6. Customer portal pages (accessibility sweep)
Entry: every `app/portal/[tenantSlug]/*` page — dashboard, spotlights, pipeline,
library, cards, buckets, atoms, portals (builds), proposals, processes, activity,
team, documents, billing, profile.
Verify:
- Each nav link resolves to a page that **loads without error** for the tenant
  role, and its primary data query is real + tenant-scoped (not a placeholder).
- Flag any page that renders empty because its backend read is missing/broken vs.
  legitimately empty (no seeded data).

### 7. Customer upload → atomize → contextualize library atoms
Entry: portal `atoms`, `atoms/upload`, `atoms/select`, `atoms/[atomId]`,
`library/atomize`, `library/upload`, `library/review`,
`proposals/[proposalId]/sections/[sectionId]/atomize-node`.
Verify (this is the newest loop — exercise it hard):
- **Upload** a real doc → `atoms/upload` registers a `reference` atom (full
  content) and returns deconstructed blocks.
- **Atomize** selected blocks → primitives / a group with members, each anchored
  (`source_anchor`) back to the reference; tags apply against the unified taxonomy
  (auto + confirmed).
- **Contextualize** → `atoms/select` ranks atoms for a section by vol/kind + the
  opportunity's agency/program context (a null-content group returns its members'
  content assembled). Confirm the selected atoms actually feed the drafter's
  `<library_atoms>` in `components/canvas/draft-all-sections.tsx`.

### 8. Purchase → build-push × build-push × build-push → lock  (→ download)
Entry: purchase `portal/purchases`, `admin/purchases`, `proposals/create`;
build/push `sections/[sectionId]/save`, `stage`, `advance`, `ai/draft`,
`ai/review`; lock `proposals/[proposalId]/lock`, `sections/[sectionId]/lock`,
`gates`, `package`; download `sections/[sectionId]/export`, `package`.
Verify the full collaborative loop:
- **Purchase** provisions a real proposal (empty sections per the volume tree).
- **Build → push** repeats across stages (draft V0 → revise V1 → review): each
  section save persists + versions; stage advance is gated and audited; the
  cycle can run **at least three push rounds** without dead-ends.
- **Lock** freezes the proposal/section (compare-and-swap on status; lock count /
  unlock deadline honored); a locked proposal blocks further edits.
- **Download / package / export** produces the artifact (or degrades cleanly if
  `AWS_S3_BUCKET_NAME` unset — note which).

---

## Failure modes this audit must not fall into

A green scorecard is worthless if it's green for the wrong reasons. Guard against:

- **False green from code-reading.** Covered by the WIRED-requires-driving rule
  above. If in doubt, it's ⚪ UNVERIFIED.
- **Happy-path-only.** Drive breadth, not just the golden click:
  topic **#2 and #10** (not only #1); a **second push round and a third**;
  **unlock** after lock; a **closed/archived** stage transition; a
  **wrong-tenant** request (must be refused); an **edit against a locked**
  section (must be rejected). A capability that only works for the first, happy
  instance is 🟡 PARTIAL.
- **Wired-but-wrong** (looks connected, silently corrupts). For any write you
  drive, read it back and check the known bug classes from `CLAUDE.md` §Data Layer:
  jsonb written via `JSON.stringify(...)::jsonb` reads back as a *string*
  (char-iteration); `ON CONFLICT` missing a partial-index predicate throws;
  int8 counts returned as strings; a lock/stage write without compare-and-swap
  (`WHERE ... AND status=$expected`) that lets a double-submit through. Any of
  these = 🟡 PARTIAL with the corruption named, not ✅.
- **Omission laundered as ⬜ NOT-BUILT.** Judge against the **expected manifest**
  (the eight numbered areas and their sub-checks ARE the manifest). If an item
  isn't there, NOT-BUILT is a *finding to list*, not a pass to move past quietly.
- **Empty ≠ working.** A page that renders with no data may be broken read OR just
  unseeded — seed first, then decide, and say which.

## Deliverable

Commit `docs/HITL_WIRING_AUDIT_<YYYY-MM-DD>.md` to the working branch containing:

1. **Scorecard table** — one row per capability (the numbered items and their
   sub-checks): `Capability | Verdict | UI entry | Route | DB/tool | Evidence (file:line) | Note`.
2. **Findings** — every 🟡/🔴/⬜, most-blocking first, each with: what's broken,
   the failing path, and the smallest fix that would close it.
3. **Round-trip log** — for the flows actually driven (seed → act → read back),
   the concrete IDs/values observed, so the run is reproducible.
4. **Config caveats** — which verdicts were limited by unset env (`ANTHROPIC_API_KEY`,
   `AWS_S3_BUCKET_NAME`) vs. genuine wiring gaps.
5. **One-paragraph verdict** — is the RFP → 10-opp → matrix → tree → templates →
   buckets → portal → atoms → purchase → build×3 → lock → download spine
   **end-to-end wired**, and if not, the top 3 breaks to fix first.

## Guardrails
- Develop/report only on `claude/nice-hamilton-kBqtD`; never push elsewhere; **no PR** unless asked.
- Read-only by default — do not modify product code; the only write is the report (+ minimal seed data).
- Every `await sql` in try/catch; parameterize SQL; portal routes must verify tenant access.
- Push with retry/backoff; keep model identifiers out of committed artifacts.

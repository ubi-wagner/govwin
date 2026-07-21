# Controlled Capture + R&D Scout — Build Plan

**Status:** approved for build (1 → 2 → 3). One-pager; the contract, not the code.
**Prime directive:** capture happens in the *user's* trust context; only the artifact crosses
to us; everything lands **advisory + human-gated**. Same philosophy as the forward-only bridge
and the `advisory → guardrail → land-or-review` agent contract (`docs/AGENT_WORKFORCE.md`).

---

## The three surfaces (pick per use-case)

A plain **iframe cannot** read/screenshot Google Docs / social — they send `X-Frame-Options` /
CSP `frame-ancestors`, and same-origin blocks cross-origin DOM reads. So:

| # | Surface | What it is | Use |
|---|---|---|---|
| 1 | **`getDisplayMedia()` capture** | web API, in our own page; user picks a window/tab/screen, we grab a frame → crop → atomize | **MVP.** Grab anything on screen (incl. a Google Doc they have open). No extension, works today, browser-permission-gated. |
| 1b | Browser extension | reads the *active tab* the user is already authed in; highlight-to-capture + visible-tab | Better UX for #1; needs store review. **Fast-follow, not MVP.** |
| 3 | **Server-side headless browser** (Playwright, already in stack) | *our* infra is the browser → X-Frame-Options irrelevant | The "controlled frame" the R&D scout drives. |

`#2` (screenshot/crop tool) is the **same surface as #1** — one build.

---

## Scope of this effort (MVP)

- **Capture → crop → atomize** (covers #1 + #2). A captured PNG lands as a **draft image atom**
  in the tenant library, insertable into a section canvas, with provenance.
- **`research_scout`** (#3) — a new tenant-bound archetype that browses/searches, fences the
  results, meters its spend, and lands **draft research atoms** for human acceptance.

Explicitly **out** of MVP: the browser extension (#1b) and all of social (#4).

---

## 1+2 — Capture → **annotate** → atomize

Capture feeds the **box-and-tag annotation tool** (the same interaction as the existing **Atomize**
tab, `atomizer.tsx`), not a flat single-image dump. A screenshot is boxed into regions, each region is
tagged, and each becomes an atom — mirroring `atomize-package`'s **reference-cocoon + tagged primitives +
anchors (+ optional section group)** shape, just with image regions instead of text blocks.

**Flow (new `Capture` tab on the Library workbench, 4th alongside Library · Upload package · Atomize):**
1. `getDisplayMedia()` → freeze a `<video>` frame onto a `<canvas>` (the captured image).
2. **Annotate:** user drags one or more **boxes** on the frame; each box gets a title + tags in a side
   panel that reuses the Atomizer vocabulary (`CURATED_DIMS = vol · kind · fmt · party_role · access`) +
   a session-context "FROM" card. Optionally name a **section** to group the regions.
3. **Crop client-side:** each box → its own PNG blob (the browser already has the frame on a canvas — no
   server image lib). The full frame is also kept as the reference.
4. `POST /api/portal/[slug]/atoms/capture` — multipart: `full` (frame PNG), `region_i` PNG blobs,
   `regions` JSON (`[{title, tags}]`), `sourceUrl?`, `groupName?`, `context?`.

**Backend (`lib/atomize-capture.ts`, drivable core; route = thin wrapper):**
1. `verifyTenantAccess` (tenant-isolated; `hasRoleAtLeast(role,'partner_user')` — collaborators may
   contribute too, exactly like `atomize-package`).
2. Store each PNG via `putObject` + `customerImagePath` (same path canvas images use). Create a
   `document_cocoons` row for the capture (scope `capture`).
3. **Reference atom** for the whole frame (`grain:'reference'`, image node, provenance in node meta).
4. **One primitive image atom per region** (`grain:'primitive'`, image node = the cropped region,
   `sourceAnchor` → the reference, tags = region tags + `fmt:image` + context), `status:'draft'`.
5. Optional **group** (`grain:'group'`, `memberAtomIds`) when a section name is given — same as the
   Atomizer's "Box section."
6. Emit `library.capture_atomized` (namespace `library`, portal tenantId).

**Provenance (MVP):** `sourceUrl` + `capturedAt` + `captureKind` live in each image node's `meta` and a
human line in the atom `summary`. **Fast-follow:** migration adding `library_atoms.source='capture'`
(CHECK widen) + a `provenance jsonb` column, so captures are first-class in filters/audit. MVP rides
`source:'upload'` to avoid a migration on the first slice.

**One-way, by construction:** the endpoint only *reads* the blob and *writes into* the library. It never
holds the user's Google/social credentials, opens no persistent connection to the source, and writes
nothing back out. We receive exactly the one crop they sent.

**Verify:** drive the core via `tsx` (a real PNG → a draft image atom, asserted in `library_atoms`);
Playwright-screenshot the capture panel for the manual.

---

## 3 — `research_scout`

A new archetype in `pipeline/src/agents/archetypes/research_scout.py`, modeled on the existing
single-entity agents. **Non-negotiables (the agent invariants):**

- **Tenant-bound:** `tenant_user` authority; tool schemas expose **no** `tenant_id`. Runs with
  `SET app.tenant_id` (RLS backstop per the workforce doc).
- **Injection-fenced:** every fetched page / search result is wrapped in the untrusted-content
  delimiters **before** the model sees it — a market-research page can say "ignore previous
  instructions." Treated exactly like untrusted tenant uploads.
- **Metered runaway-bounded:** round/cost/rate/budget caps from `platform_agent_config` +
  per-tenant override; every model call + fetch emits `tool.*` start/end to the event stream
  (`/admin/agents` usage, `/admin/events`). "Monitor + regulate, one-way" is structural, not a flag.
- **Advisory → land-or-review:** output is **draft research atoms** (grain `reference`, `status:'draft'`,
  tagged `kind:research`) + an `agent_task_queue` row for a human to accept. It **never** auto-writes a
  business table and **never** dead-ends (safe-skip on cap/fence trip).

**Trigger:** proposal-scoped — "find market research for this proposal." Wired as an `AI_INVOKE` step
(single-entity; `TOOL_ACTION_TO_ARCHETYPE` maps it) or a tenant-triggered tool. Sandbox has no live
`ANTHROPIC_API_KEY`, so the LLM/browse legs run **emulated** (like `section_drafter` without a key) —
the *harness, guardrails, fence, and landing are real*; only the model output is stubbed. Honest in the
manual.

**"One-way" — stated precisely:** captured *source content* flows only inward. The scout's model calls
and searches **are outbound** — but every one is logged + metered, and every inbound result is fenced.
The guarantee is *"all agent I/O audited + budget-capped; all findings human-gated,"* not *"no bytes ever
leave."*

---

## Reuse map (why this is mostly assembly)

| Piece | New | Reuses |
|---|---|---|
| Capture (#1/#2) | `getDisplayMedia` panel + `atomize-capture.ts` + `/atoms/capture` | `putObject`/`customerImagePath`, `createAtom`, image canvas node, draft-review queue |
| R&D scout (#3) | `research_scout.py` + AI_INVOKE wiring | AgentFabric, `platform_agent_config` caps, injection-fence, event audit, `agent_task_queue`, advisory-land pattern |
| Oversight | — | `/admin/agents`, event stream, guardrail defaults |

## Build order (cadence: build → verify by driving → screenshot → update manual → commit/push)

1. Capture backend core + endpoint → drive via tsx.
2. Capture UI (getDisplayMedia + crop) → screenshot.
3. Update Customer-Admin manual (Library → "Capture from screen"). Commit/push.
4. `research_scout` archetype + guardrail/fence wiring → drive emulated.
5. Update RFP-Admin (agents) + Customer-Admin (R&D) manuals. tsc + tests. Commit/push.

Manuals update **as we go** — which forces running each feature to screenshot it (that's the test).

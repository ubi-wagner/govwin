# Canvas — Adversarial Critique (Phase 3)

> **What this is.** Phase 1 (`docs/CANVAS_ARCHITECTURE.md`) mapped the canvas as-built and named 17 gaps
> (G1–G17). Phase 2 (`docs/CANVAS_CAPABILITY_ANALYSIS.md`) scored it against the four human jobs and drew
> up 8 table-stakes. This phase turns six adversarial actor-agents loose on *that analysis* — not to
> re-map, but to attack my thinking through the lens of the actual **human** doing the work, and to prove
> me wrong where I am. Every load-bearing or reversing claim below was then **personally re-verified against
> code** before it entered this doc (the "no fake testing" mandate). Verification is cited inline as
> `file:line`.
>
> **The bar** stays Google Docs / Sheets / Slides + M365, and the stated human principle: people live in
> those tools because they can **collaborate · track & audit · easily implement/change · insert & refine** —
> not for obscure bells and whistles. The goal is *super-sticky*: once onboarded, they never want to leave.

---

## 0. The three sentences that move the roadmap

1. **My analysis leaned the wrong way twice:** too *gloomy* about collaboration we haven't built, and too
   *kind* about features that look built but don't work. The correction is not "build more collaboration"
   — it's **route and trust what already exists, and finish the flagship paths that dead-end.**
2. **Invert the priority list.** For a section-divided, compliance-driven, deadline-bound govcon team, the
   stickiness moat is **your reuse corpus + a compliance safety net that survives the download** — *not*
   live co-editing. My Phase-2 list ranked collaboration at the top and landed reuse at #6 and
   compliance at #8. Those two belong at the top.
3. **One missing primitive unlocks a third of the plan:** a **writable content-restore path.** Restore is
   the hub; **apply-an-AI-draft is its child, not its peer**; autosave shares its version-counter discipline.
   Build that one atom and restore + apply-AI + version-trust all light up together.

---

## 1. Method — six humans, one adversarial job

Each agent played a real person under real pressure and was told: *attack the analysis, find where it
thinks like a machine instead of a human, name what it missed, and where you correct me, PROVE it with
`file:line`.* Their final message was the deliverable.

| Actor-agent | The human they played | The wall they hit |
|---|---|---|
| **Team-under-deadline** | Three people editing one proposal the night before it's due | The 409 "conflict" silently eats a teammate's save on retry |
| **Brand-new builder** | First-time customer, day one, no training | Six different "AI draft" buttons; the powerful ones dead-end |
| **One-off artifact author** | `tenant_user` writing a letter of support / a marketing one-pager | The editor silently drops to a second-class tier for non-proposals |
| **AI-assisted drafter** | Builder trying to get the agent workforce's output onto the page | The flagship draft "lands in review" into a place with no way back out |
| **RFP-admin curate+enable** | The admin whose job is to *make customers succeed* | Can curate; **cannot seed a win to a customer without impersonating them** |
| **Table-stakes challenger** | A ruthless product critic of my own scorecard | Three of my facts are stale; my ranking points at the least-sticky quadrant |

I re-verified every reversing/load-bearing claim myself. The verifications are in §2–§3.

---

## 2. Where my own analysis was WRONG — reversals (personally verified)

These are the corrections that change the plan. Each is a place where the adversarial pass proved my
Phase-1/2 analysis wrong, and I confirmed the correction by reading the code.

| # | My Phase-1/2 claim | Verified reality | Evidence (I read this) | Direction |
|---|---|---|---|---|
| R1 | **G15:** "Draft with AI" is a *records-only, near-no-op* | **Genuinely DEAD** — and it *lies.* The button POSTs `/ai/draft`, which emits `proposal.draft_requested` and tells the user *"content will update shortly."* That event has **zero consumers** — the drafter listens for `proposal.section.draft_requested`, the workflows for `proposal.full_draft_requested`. Nothing ever updates. | `ai/draft/route.ts:92` (emit) + `:117-120` (the false promise); grep: only refs are the emitter + a display label; `section_drafter.py:65` handles a *different* event | I was **too kind** |
| R2 | **G5:** "no @mentions, no notifications" (filed under *enhancements*) | **Notifications EXIST and comments already raise them.** There's a live bell (polls 60s), a per-user read watermark (mig 145), and the feed reads `system_events` where `namespace IN ('proposal','capture','library','system')`; the comments POST emits `comment.created` in `proposal`. So a comment *does* notify today. The real gap is **routing**: the feed filters by `tenant_id` only — a tenant-wide firehose, never "*your* section / *you* were mentioned / *your* review is due." | `notifications/route.ts:91`; `comments/route.ts:345`; `notification-panel.tsx` | I was **too gloomy** + mis-filed (routing *is* table-stakes for async-by-section) |
| R3 | (implied) library search is absent | **`listAtomsFaceted` exists** — escaped full-text `q` + faceted filters (kind × form × context × collection × vehicle × grain) + facet counts + pagination, visibility-enforced, open down to `partner_user`. "Find my past content fast" is *largely present* for atoms (the hole: un-atomized uploads and standalone `tenant_documents` aren't indexed). | `lib/atoms.ts` `listAtomsFaceted` via `library/atoms/route.ts` | I was **too gloomy** |
| R4 | export-compliance graded, per-section compliance under-weighted | **`section-compliance-chip.tsx` is a buried Docs-KILLER.** Per-section shall-coverage (satisfied / n/a / failed), color-coded, click-to-expand — compliance status *while you write.* This is the one thing Google Docs structurally will **never** do, and I ranked its cousin (export compliance) dead last. | `components/portal/section-compliance-chip.tsx` | I **undersold my own strength** |
| R5 | **G2:** "no restore anywhere" (equal-bad across modes) | **Documents are STRICTLY WORSE than sections.** A section at least *snapshots* to `canvas_versions` (you can look, just not roll back). A document save is a **bare `UPDATE tenant_documents SET canvas=…`** with no snapshot at all — the prior content is **unrecoverable**, not merely un-restorable. | `documents/[documentId]/save/route.ts:104-111` | I **understated** a durability hazard |

**Net of §2:** the target ("async-collaborative, real-time-ready") is *much closer* than my gloomy tone
admitted — notifications, library search, per-section compliance, comment-resolve, section status + a "my
sections" filter all already exist. What's missing is **trust, routing, and compounding value** — not raw
collaboration capability. That inverts the priorities (see §4).

---

## 3. New hazards the human lens surfaced (verified)

These weren't in G1–G17, or were mis-ranked. Each is confirmed by my own reading.

### H-A · [DATA-INTEGRITY] The 409 "conflict" is defeatable → silent last-write-wins
The optimistic lock looks safe but isn't. On a 409 the client sets `versionRef.current = json.currentVersion`
(`canvas-editor-page.tsx:154`) **before** throwing; because it throws, `setDirty(false)` is skipped so `dirty`
stays `true` (`canvas-editor.tsx:573-574`), `setSaving(false)` runs in `finally`, and the Save button
(`disabled={saving || !dirty}`, `:890`) **re-enables**. A second click now sends the *bumped* `baseVersion`,
which matches the row → the write succeeds → the teammate's just-saved work is **silently overwritten**, and
the clobbered version survives only in history that can't be restored. **The same pattern exists on documents**
(`documents/[documentId]/save/route.ts:110` CAS, `:125` returns `currentVersion`). *Verified by reading both
files.* This upgrades G1 from "annoyance" to a **data-loss bug** — and it is the team-deadline actor's #1
rage-quit.

### H-B · [TRUST] Studio "approve → complete" applies ZERO content
The Proposal Studio is labeled *"the recommended path."* Its terminal approve just sets
`studio_phase='complete'` (`studio/route.ts:139`); the intermediate approves call `requestReviewPhase`, which
fires the agent cohort — and the cohort **stages, never persists** (the workflow invariant). **No branch of
the Studio route writes `proposal_sections.content`.** Run all three loops to "complete" and the sections are
byte-for-byte unchanged. *Verified.* The path we steer users toward produces nothing applied.

### H-C · [TRUST] `land-revisions` is a write-only grave
"Apply AI-proposed revisions" writes a **proposed** `canvas_versions` row and only **advances the counter**
(`land-revisions/route.ts:155-165`); it *"never touches live `proposal_sections.content`"* (`:17`). And
**nothing reads a `canvas_versions` row back into live content** — the versions route is GET-only. So the
flagship 36-agent workforce's full draft "lands in review" into a room with no exit. *Verified.* The most
capable thing the product does is the thing the paying builder **cannot use.**

### H-D · [TRUST] The Accept / Revert node buttons are lying no-ops
`handleAcceptNode` only appends an `{action:'accepted'}` line to the node's `history`; `handleRevertNode`
appends a `{action:'reverted'}` line and **never restores `previous_content`** (`canvas-editor.tsx:393-423`)
— yet both render as live, clickable buttons in the Node tab. *Verified.* A "Revert" that changes nothing is
worse than no button: it teaches the user the tool lies, which poisons trust in everything else it claims.

### H-E · [ENABLE] The Template Studio is a black hole
An admin authors a gold-standard template in a full WYSIWYG editor; `POST /api/admin/templates` writes
`is_system=false` (hardcoded, `templates/route.ts:147`) and **no `tenant_id`**. The consumer filter is
`WHERE (tenant_id = $tenant OR is_system = true)` (`portal/templates/route.ts:75`) → the row matches
**neither** branch → invisible to every tenant *and* to the admin's own chooser. *Verified.* An hour of
authoring becomes a write-only orphan, with no error to warn them.

### H-F · [ENABLE] Seeding a curated win across tenants requires impersonating each one
`createAtom` **requires** a `tenantId` (`lib/atoms.ts:67`); there is **no shared/platform atom library** and
**no admin ingest→atom door** (the `atomize|createAtom` grep across `app/api/admin` + `app/admin` is empty).
So to put one curated win into N customers' libraries, the admin does **N shadow-descents + N uploads**, one
tenant at a time, with zero propagation. *Verified.* The admin's core sticky-making job doesn't scale past a
handful of customers.

### H-G · [SHARING] `partner_user` is locked out of one-offs by construction
`documents/[documentId]/page.tsx:52` redirects anyone below `tenant_user` out of standalone documents. The
role purpose-built for cross-company collaboration **cannot even open** a letter of support or a marketing
one-pager. *Verified.* For one-offs, cross-company sharing isn't coarse (my G9) — it's **impossible**.

---

## 4. The re-ranked table-stakes (the big reframe)

My Phase-2 list, in order: (1) apply/accept a change, (2) restore a version, (3) presence + safe concurrent
edit, (4) easy granular sharing, (5) autosave, (6) reuse your own past work, (7) one consistent canvas, (8)
images + compliance survive the download. **That order points the roadmap at the least-sticky quadrant.**

The contrarian take I'm accepting, from the table-stakes challenger:

> Govcon proposal teams don't stay in a tool because it co-edits like Docs — for real-time collaboration
> they'd rather *be* in Docs. They cannot leave **your** tool only when leaving means abandoning their
> **reuse corpus** (past performance, resumes, boilerplate, last year's wins — tagged, searchable,
> one-click into this year's bid) **and their compliance safety net** (shall-coverage while writing + a
> finish-line check that keeps them from getting disqualified). The moat is **corpus + compliance, not
> co-editing.**

### Re-ranked by "what makes leaving unthinkable"

1. **Trust your work** — autosave **+** restore **+** one-click apply-AI-draft (*one* workstream). This is
   simultaneously the trust floor and the AI magic. Nothing else matters until it ships.
2. **Reuse your own past work** — self-serve, uploads included, into a real bid. The compounding-value moat;
   the literal mechanism of "never want to leave." Cheaper than I implied because the search index already
   exists (R3) — the work is removing the admin-gate on the seed path and giving uploads origin-lineage.
3. **Don't lose the bid at the finish line** — whole-proposal compliance + images survive export, fronted by
   a single **submission-readiness** check that blocks/warns on the disqualifiers (page count, font) and
   renders uploaded images. In govcon, over the page limit or the wrong font = **automatic disqualification =
   lost contract.** This is the highest-stakes moment in the product; it was ranked last.
4. **Route the "your turn" signal** — make the *existing* notification bell personal (notify the section
   owner / assignee / @mentioned reviewer, not the tenant firehose). Cheap — the pipes are already laid (R2)
   — and it's what makes async-by-section actually flow without live cursors.

### Demoted (enhancement, or possibly anti-feature) — the defended cut

- **Live presence / cursors / CRDT.** Govcon proposals are section-divided by assignment and color-team by
  design; two people rarely co-type one section (the workspace already has per-section `assignedTo` +
  status because the job is async-by-section). Live co-editing is the **least** load-bearing collab gap. The
  cheap, correct fix for "don't eat my work" is a **soft-lock / "Jane is editing this section" banner** using
  the already-dead `editing_by` columns (mig 044) + a non-destructive save — *not* CRDT.
- **Public share-links / guest access.** In a CUI / ITAR / proposal-confidential context this is a
  **compliance liability**, not a delight. Keep self-serve *section* sharing + a permission PATCH; cut public
  links.
- **Track-changes "suggesting" mode.** Docs was sticky for a decade before it existed. Nice, not table-stakes.
- **"One consistent canvas" as a headline feature.** As a peer line-item it's system-symmetry aesthetics.

### The human-first nuance I KEEP against the challenger

"One consistent canvas" is **not** a bell/whistle when you feel it as the one-off author did — it's the
**multiplier on every other stake.** A letter author lacks autosave/restore/AI/comments *and* lacks the
section-only scaffolding that would carry them. If we fix the trust primitives on the *proposal* code path
(the natural instinct, since that's what's paid for), the two-tier gets **deeper**. If we fix them at the
**shared** layer — a polymorphic artifact key (see §5) — one-offs inherit them for free. So #7 isn't a peer
feature to rank; it's a **sequencing constraint: build the primitives once, at the capability + save +
versions layer, and every artifact type inherits them.**

### Grade from the human's felt outcome, not the machine's plumbing

Where Phase 2 graded 🟠 "hollow" / 🟡 "partial," the human grade is harsher and truer:
- A button that can **never** land its output (apply-AI, "Draft with AI") = **⛔ broken**, not 🟠.
- Version history you can **look at but not act on** = its *purpose* is absent = **⛔ broken**, not 🟡.
- "Insert from library" = **⛔** for the actual paying `tenant_user` (whole-prior-proposal reuse is
  admin-only + upload-blind), not 🟡.
- The audit trail I graded ✅ "genuinely strong" is the *machine's* ledger (`system_events`); the *human*
  still can't see who changed a sentence → grade what the human sees: **🟡**.

---

## 5. The dependency chain — what unlocks what

The linear 8-list hid that there is essentially **one prerequisite hub and a few independent roots.**

```
                     ┌─ Restore a version
   WRITABLE          ├─ Apply an AI draft        (apply = restore-to-a-proposed-version;
   CONTENT-RESTORE   │                            it is a CHILD of restore, not a peer)
   PRIMITIVE  ───────┼─ Accept / reject a node    (same primitive, ranged to one node)
   (the missing      │
    proposal_sections└─ Version *trust*           (history is worthless until you can act on it)
    SET content path,
    counter-advancing per the canvas_versions CAS invariant)

   AUTOSAVE ──── shares the version-counter discipline; ship WITH restore
                 (autosave without restore = can't undo a bad autosave;
                  restore without autosave = still lose the last hour)

   ── independent roots (parallelizable, NOT downstream of the hub) ──
   SAFE CONCURRENT EDIT   = non-destructive save + soft-lock banner (reuses the dead editing_by cols)
   NOTIFICATION ROUTING   = a targeting change; comments already emit → near-zero upstream deps
   REUSE                  = drop the admin-gate + give uploads origin-lineage → they enter the EXISTING index
   COMPLIANCE-AT-EXPORT   = unify the 3 disagreeing page-count heuristics into ONE that the section chip
                            AND the package gate share (else the chip shows green while export disqualifies)
```

Two sharpenings of the Phase-2 sequencing:
1. **Apply-AI is a child of restore, not a peer.** Three of the eight items collapse into the one
   content-restore write primitive — the single highest-unlock atom in the whole plan.
2. **Compliance has its own tiny prerequisite:** unify the page-count heuristic *first*, or a trustworthy
   section chip and a trustworthy export gate will contradict each other.

**The deep version of the hub** (from the one-off author): re-key `proposal_comments` and `canvas_versions`
off a **polymorphic `(artifact_type, artifact_id)`** instead of `section_id`, and unify the capability
resolver. The editor shell, node model, sidebar tabs, AI panel, comments component, and every exporter are
*already shared*; two things make a letter second-class — the capability mask (`capabilities.ts:112-132`) and
the `section_id`-FK on comments+versions. Fix those two tables and History, Review, and AI **light up for
documents and foundations with no new UI**, and it becomes the prerequisite for one-off agent drafting. It's
a two-table data-model refactor, not a rewrite.

---

## 6. The plane my tenant-biased list missed entirely — the ADMIN / ENABLE loop

All 8 table-stakes were graded from the paying *builder's* chair. Not one names the **RFP-admin enablement
loop** — which is what actually makes the product sticky, because a customer stays for the curated,
pre-loaded, *kept-current* library the admin team maintains for them. My Phase-2 "actor reality check" even
called the RFP admin "strong" — but it stopped at *curate* and never tested *enable*, which is where the
admin's day breaks (H-E, H-F).

Missing admin table-stakes:

- **A · Seed / publish reusable content across tenants** — a real shared library + one-click "publish to
  all / selected tenants," with re-sync for existing tenants. Today: impossible without N impersonations.
- **B · Manage & review a build from the console without impersonation** — `/admin/proposals` is a read-only
  table whose only action is a link into the portal (`admin/proposals/page.tsx:85`); every deadline-day
  package review is a shadow-descent. (Fair partial credit: the Auto-Drive **doorbell** *does* fire the build
  cohort from the console without descending — but it's fire-and-forget into the H-C dead-end.)
- **C · Author-once, propagate** — anything authored in the Studio must reach a consumer path; a WYSIWYG
  editor that writes orphans (H-E) is not a tool.
- **D · Curate → enable continuity** — attach a curated template/checklist to a mold from the curation
  screen. Today the curation UI *displays* the template join but gives no control to set it
  (`rfp-curation/[solId]/page.tsx:151-157`; the only writer, `volume_update_required_item`, is invoked
  nowhere).
- **E · Scoped, consented, revocable shadow access** — descent is unconditional god-view + a fire-once audit
  event (`verifyTenantAccess` returns `true` for rfp_admin/master, `lib/db.ts:135`). A real ops tool scopes
  it, time-boxes it, and shows the tenant it happened.

**Smallest enable win:** flip the Studio writer to publish `is_system=true` (`tenant_id=NULL`), optionally
with a `scope` / `tenant_ids[]`. The portal chooser, proposal-create, and admin chooser **already** read
`is_system=true` — so this converts a write-only orphan into a live admin-curated shared template library
with **zero new consumer code.** It's the seam every harder enable-win bolts onto.

---

## 7. Machine-enabling verdict — does the workforce reach the human's hands?

**No — the architecture traps it, and the trap is asymmetric in the cruelest way: the more powerful the AI,
the less it can land.** The single-node sidebar AI and Draft-All-Sections reach the page because they run
**client-side and go through the ordinary save door** (`draft-all-sections.tsx:174-181`;
`handleReviseNode` → Save). The **36-agent workforce** — planner / stylist / formatter / adversarial cohorts
producing full `CanvasDocument`s — is walled off behind the `persisted=False` invariant with **no door on the
far side.** `land-revisions` and Studio-`approve` are corridors that lead to a room (`canvas_versions`) with
**no exit back to the document.**

**The wire is short**, because the live-content door already exists:
- `save/route.ts` is *already* a CAS-versioned content writer.
- `land-revisions` *already* holds the staged `CanvasDocument` per `section_id`.

So the minimum viable connection is **one endpoint/button — "Accept this section's AI draft"** — that takes
the staged canvas and POSTs it to `save/route.ts` as content (CAS-guarded, provenance-tagged `ai_revision`
— and **stop stripping `__revisionMeta`** while you're there, `save/route.ts:259-264`, so history stops
mislabeling every AI edit as "Human Edit"). ~20 lines; it turns the entire staged workforce from "view-only
history" into "one click to accept," with **no workflow-engine change** — because the human, not the
pipeline, is the consumer. The **magic** version is to render the staged output as an inline, per-node
proposed diff in the editor with one-click Accept/Reject wired to that same save door.

**Scope-creep guardrail:** keep agents on the canvas-artifact family (section / document / foundation).
Expanding them to draft/refine letters & marketing is the **highest-ROI, lowest-risk** agent expansion
(a support letter has no compliance matrix, no page-count DQ — the guardrails are *easier*) — but it inherits
the H-C dead-end unless the restore/apply primitive lands first. Do **not** point agents at the platform CMS
(different DB, different audience, different output).

---

## 8. Corrections I owe the baseline docs (to apply in Phase 6)

- **`CANVAS_ARCHITECTURE.md`:** rewrite **G15** ("Draft with AI" is *dead*, not records-only — and it lies);
  rewrite **G5** (notifications *exist*; the gap is *routing*, and it's table-stakes not enhancement); add a
  **"strengths under-sold"** callout (notifications, `listAtomsFaceted` search, `section-compliance-chip`);
  upgrade **G1** to a data-integrity bug (H-A); split **G2** to note documents are *strictly worse* than
  sections (R5); add H-B/H-C/H-D/H-E/H-F/H-G as first-class entries.
- **`CANVAS_CAPABILITY_ANALYSIS.md`:** **invert** the table-stakes ranking (reuse + compliance to the top,
  collaboration-parity down, "one consistent canvas" reframed as a sequencing constraint); re-grade from the
  human's felt outcome (⛔ for never-lands-its-output, not 🟠/🟡); add the **admin/enable** plane and its five
  missing table-stakes (§6).

---

## 9. What survived the adversarial pass unchallenged (calibration)

So this critique reads as calibrated, not reflexive — the Phase-1/2 analysis was genuinely strong in these
respects, and all six agents agreed:

- **Restore is genuinely absent and load-bearing** — the versions route is GET-only; the only
  `proposal_sections SET content` writer is provisioning. G2 is correct and is the linchpin.
- **"Three canvases / three durability contracts"** is the real structural problem (SECTION / DOCUMENT /
  FOUNDATION over three storage types with three history contracts).
- **The actor-walkthrough method** is the right way to find these — every reversal came from *doing the job*,
  not reading the schema.
- **Images don't survive export** (G3) — confirmed; a visual one-pager downloads with `[Image: alt]` stubs.
- **The grades were honest** and the restore-as-linchpin insight was exactly right; the corrections are three
  stale facts (all in the *underselling* direction) and an inherited Google-Docs framing that mis-ranked the
  two items that actually make a govcon team unable to leave.

---

*Phase 3 of the Common-Canvas redesign. Sources: six adversarial actor-agents (transcripts under the session
tasks dir), each re-verified against code. Feeds Phase 4 — the sequenced, workflow-shaped TODO.*

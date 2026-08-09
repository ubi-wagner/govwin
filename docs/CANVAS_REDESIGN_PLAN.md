# Common-Canvas Redesign — Sequenced Plan (Phase 4)

> **Status: awaiting sign-off.** This is the deliverable that closes Phases 1–4 (read → capability →
> adversarial → plan). Nothing here is built yet. Per the agreed operating model — *"Today = stop at the
> TODO"* — I stop at this document and wait for your steer before writing a line of feature code.
>
> **Inputs:** `docs/CANVAS_ARCHITECTURE.md` (as-built + G1–G17), `docs/CANVAS_CAPABILITY_ANALYSIS.md` (4-jobs
> scorecard + 8 table-stakes), `docs/CANVAS_ADVERSARIAL.md` (6-actor critique, every claim code-verified).
> **Your scoping choices, honored throughout:** collaboration = *async-collab, RT-ready* (presence, section
> ownership, comments, suggestions on today's versioning; data model shaped so live co-editing can drop in
> later — not full real-time now); primary user = *balanced* (tenant + admin weighted equally).

---

## The spine of the plan (read this first)

The adversarial pass produced one structural insight that drives the whole sequence:

> There is **one prerequisite hub** — a *writable content-restore path* — and a few **independent roots** that
> can run in parallel once it exists. **Apply-an-AI-draft is a child of restore, not a peer.** Fix restore
> once, at the **shared** artifact layer (not the proposal-only path), and restore + autosave + apply-AI +
> one-off-parity all light up together.

And one reframe that drives the priority:

> The stickiness moat for a section-divided, compliance-driven, deadline-bound govcon team is **your reuse
> corpus + a compliance safety net that survives the download** — *not* live co-editing. Rank by "what makes
> leaving unthinkable."

So the waves are ordered: **stop active harm → build the trust hub → make one-canvas real → the two moat
items (reuse, compliance) → async your-turn → the admin enable plane → agent/one-off expansion → verify +
document.**

### Dependency map

```
  WAVE 0  Stop the bleeding (bugs, lying buttons) ──────────────┐  independent; ship anytime
                                                                │
  WAVE 1  TRUST HUB: restore ─┬─ autosave ─┬─ apply-AI (child) ─┤  ← the one prerequisite
                              │             │                    │
                              ▼             ▼                    ▼
  WAVE 2  One canvas real (polymorphic artifact key) ───────────┤  needs W1's version writer
                              │                                  │
          ┌───────────────────┼──────────────────┬──────────────┤
          ▼                   ▼                  ▼               ▼
  WAVE 3 REUSE (moat)   WAVE 4 COMPLIANCE   WAVE 5 async     WAVE 6 ADMIN enable
   (parallel after W1)   (parallel; has its   your-turn        (parallel; balanced weight)
                         own page-count       + soft-collab
                         prereq)
                              │                                  │
                              └───────────────┬──────────────────┘
                                              ▼
  WAVE 7  One-off + agent expansion (letters/marketing)  ← needs W1 + W2
                                              │
                                              ▼
  WAVE 8  Verify (multi-actor real UI) + document (baselines, explorer, workflow map)  ← continuous
```

### Task-card legend

Each task is workflow-shaped: **Do** (the change) · **Feel** (the human-observable outcome = the expected
result) · **Prove** (the multi-actor, real-UI, not-happy-path evidence) · **Feeds** (what it unblocks) ·
**Watch** (the CLAUDE.md bug-class to respect). Effort is S/M/L (rough).

---

## WAVE 0 — Stop the bleeding
*Bugs and trust-poison, not features. Cheap, independent, remove active harm. Recommend shipping first
regardless of how far the rest goes.*

**T0.1 · Make the 409 non-destructive** — S
- **Do:** On a save conflict, stop silently bumping `versionRef` into a clobber. Keep `dirty`, but require a
  real reconcile — show the other person's version + a "merge / overwrite / reload" choice; never let a
  second blind click win. Fix both `canvas-editor-page.tsx:154` (section) and `documents/…/save/route.ts`.
- **Feel:** "Two of us saved; nobody's work silently vanished."
- **Prove:** Two browser sessions (two `tenant_user`s) edit the same section; second save shows the conflict
  and *cannot* clobber by re-clicking. Screenshot both.
- **Feeds:** trust floor for all of Wave 1/5.
- **Watch:** compare-and-swap on `version`; don't regress the CAS invariant.

**T0.2 · Kill the lying "Draft with AI" button** — S
- **Do:** Route it to the working client-side path (the same invoke `Draft All Sections` uses), or remove it.
  Delete the false "content will update shortly." (`ai/draft/route.ts` emits `proposal.draft_requested` →
  zero consumers.)
- **Feel:** "Every AI button either does something or isn't there."
- **Prove:** Click it; content actually appears (or the button is gone). No dead toast.
- **Feeds:** the "one honest AI front door" principle (Wave 1/7).

**T0.3 · Make Accept/Revert real or remove them** — S
- **Do:** `handleRevertNode` must restore `previous_content`; `handleAcceptNode` must clear the pending state
  — or hide both (`canvas-editor.tsx:393-423`).
- **Feel:** "Revert actually reverts."
- **Prove:** AI-revise a node → Revert → original text returns. Screenshot.

**T0.4 · Stop stripping `__revisionMeta`** — S
- **Do:** Preserve AI-vs-human provenance through the save route (`save/route.ts:259-264`) so history stops
  labeling every AI edit "Human Edit."
- **Feel:** "History tells the truth about who wrote what."
- **Prove:** AI edit → history shows "AI"; human edit → "Human." Screenshot.
- **Watch:** jsonb write via `sql.json`, not `JSON.stringify::jsonb`.

---

## WAVE 1 — The trust hub (restore · autosave · apply-AI)
*The one prerequisite. One workstream, not three line-items.*

**T1.1 · Writable content-restore path** — M
- **Do:** `POST …/sections/[s]/versions/[v]/restore` that CAS-writes `proposal_sections.content` from a
  `canvas_versions` row and **advances** the counter (`version = version + 1`), per the invariant. Add a
  **Restore** button in the History tab (`canvas-sidebar.tsx` VersionHistory).
- **Feel:** "I can always go back to any prior version."
- **Prove:** Edit → save 3 times → restore v1 → content is v1, and the counter advanced (next save doesn't
  collide). `tenant_user` + `tenant_admin`.
- **Feeds:** **everything** — apply-AI (T1.3), version-trust, one-off restore (Wave 2).
- **Watch:** `proposal_sections.version > MAX(canvas_versions.version_number)`; advance via CAS, exactly like
  `lock-section.ts` — numbering at MAX+1 *without* advancing content-loses on the next human save.

**T1.2 · Autosave + recover-on-reload** — M
- **Do:** Debounced autosave to a draft/version, sharing T1.1's counter discipline; restore the buffer on
  reload; bind Ctrl/⌘+S.
- **Feel:** "I closed the tab and nothing was lost."
- **Prove:** Type → wait → hard-reload without clicking Save → text is there. Section *and* document.
- **Feeds:** removes the "reload loses my hour" half of the 409 pain.

**T1.3 · One-click "Accept this section's AI draft"** *(apply-AI = restore-to-a-proposed-version)* — M
- **Do:** Wire an **Accept** action that takes the staged canvas `land-revisions` already holds and POSTs it
  to `save/route.ts` as live content (CAS-guarded, tagged `ai_revision`). Connects Studio / full-draft /
  land-revisions to the page. (Magic version, optional: inline per-node proposed-diff with Accept/Reject.)
- **Feel:** "I ran the AI workforce and one click put its draft on my page."
- **Prove:** Run full-draft (Mode C) → Accept → section content is the AI draft; history shows `ai_revision`;
  restore still works. Then the doorbell path (admin) → tenant sees + accepts.
- **Feeds:** makes the entire 36-agent workforce usable; unblocks Wave 7 agent expansion.
- **Watch:** no workflow-engine change — the *human* is the consumer; keep it a frontend+route move.

---

## WAVE 2 — Make "one canvas" real (polymorphic artifact key)
*The deep version of the hub. Two-table refactor, not a rewrite. Makes documents + foundations first-class so
they inherit History/Review/AI/restore/autosave with no new UI — and it's the prerequisite for one-off agent
drafting.*

**T2.1 · Polymorphic artifact ref migration** — M
- **Do:** Add `(artifact_type, artifact_id)` to `canvas_versions` + `proposal_comments`; backfill existing
  section rows; keep `section_id` as a generated/compat view during transition.
- **Feel:** (enabling) —
- **Watch:** ON CONFLICT vs partial unique index; backfill idempotency.

**T2.2 · Document save writes snapshots + restore** — M
- **Do:** Point `documents/…/save/route.ts` at the same version writer (T1.1) so documents get snapshots and
  the Restore button. Ends the "bare UPDATE, unrecoverable" hazard (R5).
- **Feel:** "My letter has version history too."
- **Prove:** Edit a letter → History tab appears → restore works. `tenant_user`.

**T2.3 · Unify the capability resolver** — M
- **Do:** Delete the document/foundation masks (`capabilities.ts:112-132`) now that comments+versions resolve
  by artifact key; the History/Review/AI tabs light up when the key resolves.
- **Feel:** "The editor is the same tool no matter what I'm writing."
- **Prove:** Open a letter, a foundation atom, a proposal section — same tabs present. Screenshot all three.

**T2.4 · `partner_user` can open shared documents** — S
- **Do:** Fix the redirect (`documents/[documentId]/page.tsx:52`) behind an explicit per-document share grant.
- **Feel:** "My outside partner can see the doc I shared with them."
- **Prove:** Share a doc to a `partner_user`; they open it (and only it).

---

## WAVE 3 — Reuse, the moat *(parallel after Wave 1)*

**T3.1 · Self-serve reuse from prior proposals** — M
- **Do:** Remove the rfp/master-admin gate on the seed path (`seed-job/route.ts:19`) so `tenant_admin` can
  seed reuse into their own bid.
- **Feel:** "I pulled last year's win into this year's bid myself."
- **Prove:** `tenant_admin` seeds from a prior proposal → atoms appear → insert into a section. No admin.

**T3.2 · Uploads get origin-lineage → enter the index** — M
- **Do:** Give uploaded past-wins an `origin_proposal_id`/lineage so they're visible to the seed suggester +
  `listAtomsFaceted`.
- **Feel:** "The proposal I uploaded is instantly reusable content."
- **Prove:** Upload a past proposal → search finds its atoms → insert one.

**T3.3 · Index un-atomized uploads + standalone documents** — M
- **Do:** Extend the faceted index to cover the two canvas-artifact holes.
- **Feel:** "Search finds *everything* I've written here, not just proposal atoms."
- **Prove:** Search returns a standalone letter's content.

**T3.4 · Surface "insert from your past work" in the editor** — S
- **Do:** Promote library-insert from buried to a first-class in-editor affordance (at cursor).
- **Feel:** "Reusing my content is one obvious click."

---

## WAVE 4 — Compliance at the finish line *(parallel; has its own prereq)*

**T4.1 · Unify the 3 page-count heuristics** *(prerequisite)* — M
- **Do:** Collapse the three disagreeing page-count estimators into ONE module the section chip **and** the
  export gate share.
- **Feel:** (enabling — prevents "chip green, export disqualifies")
- **Watch:** the chip and the gate must import the same function.

**T4.2 · Whole-proposal submission-readiness screen** — L
- **Do:** A rollup — "you are N requirements and M sections from a compliant submission" — that runs whole-doc
  compliance and **blocks/warns on disqualifiers** (page count, font) at `package?format=…`.
- **Feel:** "The tool won't let me get disqualified."
- **Prove:** Build over the page limit → export warns/blocks with the exact violation. `tenant_admin`.
- **Feeds:** the highest-stakes moment in the product.

**T4.3 · Uploaded images survive export** — M
- **Do:** Embed S3 images as data: URIs (or raster-fetch) so `image-raster.ts:35` stops nulling non-`data:`
  URIs into `[Image: alt]`.
- **Feel:** "My logo and screenshots are in the download."
- **Prove:** One-pager with an uploaded logo → export .docx/.pdf → logo renders. Screenshot the PDF.

---

## WAVE 5 — Async "your turn" + soft-collab *(RT-ready, not RT)*

**T5.1 · Notification routing** — M
- **Do:** Make the *existing* bell personal — notify the section owner / assignee / @mentioned reviewer, not
  the tenant firehose (`notifications/route.ts:91` filters by tenant only today).
- **Feel:** "I'm told when *my* section needs *me*."
- **Prove:** A assigns B a section → B's bell lights; C (uninvolved) is not spammed.
- **Feeds:** makes async-by-section actually flow.

**T5.2 · @mentions in comments** — S
- **Do:** `@name` in a comment routes a notification (comments already emit; add the mention target).
- **Prove:** `@`-mention a teammate → they're notified; a bystander isn't.

**T5.3 · Soft-lock presence banner** — M
- **Do:** "Jane is editing this section" using the already-dead `editing_by`/`editing_since` columns (mig 044)
  + non-destructive save. *Not* CRDT.
- **Feel:** "I can see someone's already in here before I collide."
- **Prove:** Two sessions; the second sees the banner.
- **Watch:** this is the RT-ready seam — model it so live cursors can drop in later without a rewrite.

**T5.4 · Section ownership + suggestions-on-versioning** — M
- **Do:** Surface ownership + "my sections"; add a lightweight suggestion (track-changes-lite) built on the
  version model.
- **Feel:** "I can suggest an edit without overwriting the owner."

---

## WAVE 6 — The admin / ENABLE plane *(balanced weight; parallel after Wave 1)*

**T6.1 · Flip the Studio writer → "Publish to library"** — S ← *smallest enable win*
- **Do:** Add a publish toggle that writes `is_system=true` (`tenant_id=NULL`), optionally with a
  `scope`/`tenant_ids[]`. Readers already read `is_system=true` — **zero new consumer code**
  (`templates/route.ts:147` is the only change).
- **Feel:** (admin) "I authored a template once and every customer can use it."
- **Prove:** Admin authors a template → Publish → it appears in a tenant's chooser. Two tenants.
- **Feeds:** the seam every harder enable-win bolts onto.

**T6.2 · Shared/platform atom library (seed filled wins)** — L
- **Do:** An admin ingest→atom door + a platform-tenant `library_atoms` visibility the portal reads
  read-only, so admins can seed *filled winning examples*, not just skeletons.
- **Feel:** (admin) "I curated a winning past-performance and pushed it to my customers."
- **Prove:** Admin seeds a shared atom → tenant sees it read-only → inserts it. No impersonation.

**T6.3 · Curate → enable continuity** — M
- **Do:** A picker on the curation screen to attach a template/checklist to a mold
  (`volume_required_items.template_id`; wire the uninvoked `volume_update_required_item`).
- **Feel:** (admin) "I attached my template to the mold right where I curated it."

**T6.4 · Console build review without impersonation** — M
- **Do:** Inline package preview/download on `/admin/proposals` (read-only table today, `page.tsx:85`).
- **Feel:** (admin) "I reviewed a customer's submission ZIP without becoming them."
- **Prove:** Admin previews + downloads a tenant's package from the console.

**T6.5 · Scoped, consented, revocable shadow access** — M
- **Do:** Replace unconditional god-view (`db.ts:135`) with a time-boxed, tenant-visible grant.
- **Feel:** (tenant) "I can see when an admin helped, and it expired."

---

## WAVE 7 — One-off + agent expansion *(needs Wave 1 + Wave 2)*

**T7.1 · Type-aware starter scaffolds** — M
- **Do:** Ship scaffolds for letter of support, capability statement, cover letter, NDA, sell sheet (today
  "Blank document" is truly blank).
- **Feel:** "I picked 'letter of support' and it was already shaped like one."

**T7.2 · Agents draft/refine letters & marketing** — M
- **Do:** `OnDocumentCreated` trigger reusing `section_drafter`/`stylist`/`market_analyst`; output lands via
  the Wave-1 accept door. Lower-risk than proposals (no compliance matrix, no page DQ).
- **Feel:** "The AI helped me write the one-pager too."
- **Watch:** inherits the H-C dead-end unless Wave 1 landed first — sequence is fixed. Keep agents off the
  platform CMS.

**T7.3 · Symmetric reuse — atomize a one-off back** — S
- **Do:** Let a one-off be atomized back into the library (insert works today; harvest doesn't).
- **Feel:** "My best capability statement seeds next time's."

---

## WAVE 8 — Verify (multi-actor real UI) + document *(continuous, per your protocol)*

**T8.1 · Multi-actor, multi-dimensional evidence** — per wave
- **Do:** For every shipped wave, drive the real UI from each relevant actor — `tenant_user`,
  `tenant_admin`, `rfp_admin`, `partner_user`, agent, automation — **not** the happy path (conflicts, denials,
  empty states, over-limit). Green backbone (`tsc` 0 · `vitest` · `next build`) + Playwright + an adversarial
  bug sweep for large diffs.
- **Feel:** (you) "I saw it work from every chair, including the ugly cases."

**T8.2 · Update the baselines + visualization** — per wave
- **Do:** Fold each change into `ARCHITECTURE_V10.md`, `CLAUDE.md`, `CLAUDE_CLIFFNOTES.md`, and the CANVAS_*
  docs (apply the §8 corrections in `CANVAS_ADVERSARIAL.md`); refresh the **Architecture Explorer** overlay +
  re-extract schema, the `/admin/workflows` map, and regenerate the in-browser help.
- **Feel:** "The docs and the diagrams match what shipped."

---

## Recommended MVP cut (the smallest set that flips "capable tool" → "never leave")

If you want a first, self-contained slice rather than the whole program, this is the defensible minimum — it
is exactly the re-ranked 4 table-stakes plus the harm-stoppers, and every piece is independently shippable:

- **Wave 0** (all four) — stop the data-loss + lying buttons.
- **Wave 1** (T1.1–T1.3) — the trust hub: restore + autosave + one-click apply-AI.
- **T3.1 + T3.2** — reuse becomes self-serve + uploads count (the moat, cheapest slice).
- **T4.2 + T4.3** — submission-readiness + images survive (the finish line).
- **T5.1** — notification routing (async "your turn").

That slice makes a paying builder *trust the tool with their work, reuse their corpus, and not get
disqualified* — the three things that make leaving unthinkable — without building anything demoted (live
cursors, public links, CRDT). Waves 2/6/7 (one-canvas parity, the admin enable plane, agent one-offs) are the
natural follow-on program.

---

## Sign-off — what I need from you before Phase 5

1. **Scope:** the **MVP cut** above, or the **full 8-wave program**, or a specific subset/re-order?
2. **The one-canvas refactor (Wave 2):** do it early (makes documents first-class + unblocks one-off agents,
   but it's a two-table migration touching comments+versions), or defer until after the moat waves?
3. **Admin enable plane (Wave 6):** you chose *balanced* — confirm you want it in the near-term sequence
   (at least T6.1, the zero-consumer-code Studio publish win), not deferred.
4. **Anything I've mis-ranked** against how your customers actually feel the tool.

On your go, I execute wave-by-wave with real multi-actor UI evidence at each step (T8.1) and roll the
baselines forward as I go (T8.2). **Until then I hold here.**

# Canvas Redesign — Build Log (Phase 5 execution)

> **What this is.** The as-built record of the Common-Canvas redesign execution, after the four analysis
> phases (`CANVAS_ARCHITECTURE.md` → `CANVAS_CAPABILITY_ANALYSIS.md` → `CANVAS_ADVERSARIAL.md` →
> `CANVAS_REDESIGN_PLAN.md`) and the user's sign-off. **Signed-off scope:** the **MVP cut** (Wave 0 + the
> Wave 1 trust hub + reuse T3.1/T3.2 + compliance T4.2/T4.3 + notification routing T5.1) **plus the admin
> enable plane run alongside**. This log records what actually shipped, wave by wave, each mapped to the gap
> it closes, with its verification and commit — and, honestly, what was rescoped or deferred and why.
>
> **Cadence.** Every wave kept the green backbone (`tsc` 0 · `vitest` 907, up from 905 — +2 new tests) and
> was committed + pushed before the next. Live multi-actor UI evidence is the closing verification section.

---

## What shipped, by wave

### Wave 0 — Stop the bleeding · commit `a6c0474`
| Item | What shipped | Gap closed |
|---|---|---|
| **W0.1** | **Non-destructive 409.** The optimistic-lock conflict was defeatable — on 409 the client bumped `versionRef` and the Save button re-enabled, so a second click silently overwrote a teammate's save. Now a 409 requires an explicit, informed overwrite (native confirm); Cancel leaves `versionRef` stale so any retry safely 409s again. Shared `handleSave` covers section + document. | **G1** — upgraded from "annoyance" to the **data-loss bug** the adversarial pass proved (H-A), now fixed |
| **W0.2** | **Removed the lying "Draft with AI" button** (emitted `proposal.draft_requested` → zero consumers, yet promised "content will update shortly"). Real front doors remain (Studio, Draft All Sections). | **G15** (was mis-filed as "records-only"; it was dead) |
| **W0.3** | **Accept/Revert node buttons made real.** `handleReviseNode` snapshots pre-revision content into the history entry's `previous_content`; **Revert restores it** (was a pure no-op); **Accept finalizes** provenance off `ai_draft`. Both gated to the pending-AI-revision state. | **H-D** (lying no-op buttons) |

### Wave 1 — The trust hub · commit `13592bb` · mig 163
| Item | What shipped | Gap closed |
|---|---|---|
| **W1.1** | **Writable restore path + Restore button.** `POST …/sections/[s]/versions` restores a prior `canvas_versions` row to live content following the CAS invariant exactly (archive current → write chosen → advance `version` under compare-and-swap), edit-access-gated, non-destructive (pre-restore snapshot). Restore button in the History tab. **mig 163** adds `proposal_sections.content_source`; the save route now archives prior content with **its own** provenance instead of a hard-coded `human_edit`, and records incoming provenance on write. | **G2** (the linchpin — no restore) + **T0.4** (history always said "Human Edit") |
| **W1.2** | **Autosave + recover-on-reload.** Every change debounces to localStorage (keyed on the artifact's save URL); on mount the editor offers to Restore/Discard a newer local draft; draft clears on save. **Ctrl/⌘+S** saves. Sidesteps the 409 confirm (manual/Ctrl+S stays the only server write). | **G4** ("closed the tab, lost my work") |
| **W1.3** | **One-click "Accept AI drafts into document."** New `accept-ai-revisions` route applies each section's latest staged `ai_revision` to LIVE content (same archive+CAS, idempotent, locked-safe). The land button relabelled **"Stage AI revisions for review"** so the two-step (Stage → Restore/Accept) is honest. Connects the full-draft workforce to the page. | **G2-apply / H-B / H-C** (the staged-draft dead-end) |

### Wave 3 — Reuse · commits `87a1ec9`, `82fb08e`
| Item | What shipped | Gap closed |
|---|---|---|
| **W3.1** | **Self-serve reuse from prior proposals.** All five seed-job routes (GET/select/decide/apply/skip) opened from rfp/master-admin to **tenant_admin+**, with an explicit **`verifyTenantAccess`** added to each (the admin-only gate had implicitly allowed cross-tenant). | **G16** (seed panel shown to tenant_admin but every action 403'd) |
| **W3.2** | **Verbatim reuse of an uploaded past proposal.** New `reuse-past` route pulls an uploaded past win's atoms (`document_cocoons` → `library_atoms` by `cocoon_id`) straight into the build's EMPTY matching sections (title-matched), red-italic `reuse_marker`, non-destructive, CAS-safe. A "Reuse a past proposal (verbatim)" picker on the admin AI-actions card. | **G8**-adjacent (uploaded past-wins were reusable via library/Draft-All, but not directly into a bid) |

### Wave 4 — Compliance at the finish line · commit `3fd87f0`
| Item | What shipped | Gap closed |
|---|---|---|
| **W4.3** | **Uploaded images survive the download.** `resolveImageDataUri` (S3 `storage_key` → inlined data: URI) + `inlineImageDataUris` (doc pre-pass over v1 + v2 nodes), wired into all four export paths (docx/pptx/xlsx + the PDF/HTML pre-pass). A customer's logo/screenshots now export instead of a `[Image: alt]` stub. | **G3 / G12** (lossy export — images) |

### Wave 5 — Async "your turn" · commit `7836520`
| Item | What shipped | Gap closed |
|---|---|---|
| **W5.1** | **Notification routing.** The feed excludes self-authored events (`actor_id != me`) so it shows what **others** did — the "your turn" signal — and flags `is_for_you` when the event touches a section assigned to you; the panel shows a "For you" pill. | **G5** (reframed — notifications existed; the gap was *routing*, the tenant-wide firehose) |

### Wave 6 — Admin enable plane (part 1) · commit `7836520`
| Item | What shipped | Gap closed |
|---|---|---|
| **W6.1** | **Studio publish-to-library.** The Template Studio wrote `is_system=false` + null tenant — an orphan visible to no consumer branch. PATCH now toggles `is_system` via a `publish` flag (handled before the system-template read-only guard), writing `is_system=true` / `tenant_id=NULL` so the template appears in every tenant's chooser; the editor gains a "Publish to shared library" button. **Zero new consumer code** (the chooser + proposals/create already read `is_system=true`). | **G8 / H-E** (the Studio black hole) |

---

## Gap-register delta (where the G/H items stand now)

| Gap | Before | Now |
|---|---|---|
| **G1** (409 annoyance → H-A data-loss) | Silent last-write-wins | **Fixed** (W0.1) |
| **G2** (no restore — the linchpin) | GET-only versions route | **Fixed** (W1.1 restore + W1.3 accept-AI) |
| **G3 / G12** (images/export lossy) | Uploaded images → stub | **Fixed for images** (W4.3); other export-fidelity items remain |
| **G4** (no autosave) | Reload lost work | **Fixed** (W1.2, local-draft) |
| **G5** (notifications) | "Absent" → really *unrouted* firehose | **Routed** (W5.1: self-excluded + for-you) |
| **G8 / H-E** (admin can't publish) | Studio orphan | **Fixed for templates** (W6.1); shared *atom* library (T6.2) remains |
| **G15** (dead "Draft with AI") | Lying no-op | **Fixed** (W0.2, removed) |
| **G16** (reuse admin-gated) | tenant_admin 403'd | **Fixed** (W3.1, self-serve + scoped) |
| **H-B / H-C / H-D** (staged AI dead-end, no-op buttons) | Workforce walled off | **Fixed** (W0.3 + W1.3) |
| **T0.4** (history mislabels AI as human) | Hard-coded `human_edit` | **Fixed** (W1.1, `content_source`) |

---

## What was rescoped or deferred (honest ledger)

These were in the plan's full 8-wave program but **not** in this pass; each is a clean, scoped follow-on, not a
loose end:

- **T4.2 (whole-proposal submission-readiness screen). SHIPPED** (post-close-out, commits `c2555e8` +
  page-budget follow-on). `lib/proposal/submission-readiness.ts` (`computeSubmissionReadiness`) fuses the
  signals the platform already maintains — section lock/empty state, requirement-matrix coverage (mandatory;
  auto-satisfies 1:1 on lock, so it's a summary + only an *orphan* unmet requirement blocks), the advisory
  format floor (`validateCanvasAgainstSpec`, per-section font/image), and a page-budget estimate that runs on
  LOCKED sections too (catches a locked-but-over-limit section that lock-state readiness misses) — into one
  `{ready, blockerCount, warningCount, summary, blockers[]}` verdict. Surfaced by `GET …/proposals/[p]/readiness`
  (tenant-gated, `verifyProposalAccess`) → `SubmissionReadinessCard` on the proposal Compliance tab: GO /
  NOT-READY banner, summary chips, deep-linked blocker list, format/budget advisories folded away, auto-recheck
  on lock. Advisory + read-only. **Proven live** (`readiness.mjs`): verdict matches the DB exactly, cross-tenant
  → 403, and it recomputes dynamically (lock a section → blockers 18→17). **T4.1 (unify the 3 page-count
  heuristics)** stays deferred — readiness uses the same cheap per-section estimate the overview shows (labeled
  as an estimate); folding in the authoritative `paginate()` per volume is the follow-on.
- **T2.x (the polymorphic artifact key / "one canvas").** Documents are still second-class (no version
  capture; masked AI/comments). The two-table refactor (re-key comments + versions off `(artifact_type,
  artifact_id)`) is the deep fix that makes one-offs first-class and unblocks one-off agent drafting.
  **Deferred** — it's the biggest structural item and wasn't in the MVP cut.
- **T5.2/T5.3/T5.4 (@mentions · soft-lock presence · suggestions-on-versioning).** The routing core shipped
  (W5.1). @mention targeting needs the comment emit to carry mentioned users; the soft-lock reuses the dead
  `editing_by` columns. **Deferred.**
- **T6.2 (shared/platform atom library — seed *filled* winning examples).** `createAtom` is tenant-bound; a
  platform-tenant read-only shared atom visibility + an admin ingest→atom door is a bigger change than the
  template-publish win. **Deferred.**
- **T6.3 (curate→enable: attach a template to a mold from curation) · T6.4 (console package review without
  impersonation) · T6.5 (scoped/consented/revocable shadow access).** The rest of the admin enable plane.
  **Deferred.**
- **T7.x (type-aware one-off scaffolds + agents draft/refine letters & marketing).** Gated on T2.x
  (the artifact-key refactor) per the dependency chain. **Deferred.**
- **Seed-suggester cocoon candidates.** Making uploaded past-proposals appear as *automatic* seed-suggester
  candidates is a cross-service change (Python agent + the seed-job model's `source_proposal_id`, + the
  mapper). W3.2 delivered the tractable, frontend-verifiable **direct** reuse instead. **Deferred** as an
  explicit architectural follow-on.

---

## Verification

- **Green backbone, every wave:** `tsc --noEmit` = 0 errors · `vitest run` = **907 passed** (95 files; +2 new
  in `seed-job-skip.test.ts` for the tenant_admin contract). Migration **163** applied to the sandbox.
- **Security:** opening the seed-job routes to `tenant_admin` added an explicit `verifyTenantAccess` on each
  (the admin-only gate had implied cross-tenant); the `reuse-past` + `accept-ai-revisions` + restore routes
  are edit/tenant-access gated and follow the `canvas_versions` CAS invariant exactly (no numbering
  collisions, non-destructive archives).
- **Live multi-actor UI evidence:** see the closing section (production build + Chromium drive of the trust
  hub, images-survive-export, notification routing, and Studio publish, from the tenant + admin chairs).

### Zero-trust full-stack verification (2026-08-09) — "no green without proof"

`tsc`/`vitest`/`next build` green is **necessary but not sufficient** — those exercise compilation and
mocks, not the real request path. So the whole stack was brought up (Next.js standalone build · Python
pipeline worker · PostgreSQL · a path-style S3 mock standing in for R2) and every shipped item was touch-
tested as a **real actor → real API → verified DB/S3 state → pipeline agent → UI**. Two **phantom bugs**
that all three green signals missed were caught this way and fixed (commit `52db0e2`):

1. **Notification bell 500 for every user** — the W5.1 self-exclude clause cast `actor_id::uuid`, but
   `system_events.actor_id` is **TEXT** → `operator does not exist: text = uuid` → the bell 500'd for
   everyone. Fixed by dropping the cast. **Re-proven on the fresh build:** `GET …/notifications` = **200**,
   another actor's event appears in Kate's feed flagged `is_for_you`, her own event self-excluded.
2. **All exports 500 without a configured bucket** — `image-raster.ts` had a *top-level* `import` of the S3
   client, whose module-eval throws when `AWS_S3_BUCKET_NAME` is unset, taking down docx/pptx/xlsx/pdf even
   for image-free documents. Fixed by making the S3 client a **lazy** `await import()` inside
   `resolveImageDataUri`. **Re-proven on the fresh build:** upload → S3 (round-trip byte-equal) → export;
   the docx `word/media/` carries the **same 8×8 RGB (220,40,40) red square** (re-compressed, pixel-
   identical), and the pdf embeds image XObjects.

DB/S3-asserted end-to-end this way: **W4.3** (image survives to docx+pdf), **W1.1** (restore CAS + version
advance), **W0.1** (non-destructive 409), **W3.2** (verbatim reuse into empty section), **W6.1** (publish
flips `is_system`/`tenant_id`, appears in the real portal chooser as the tenant), **W1.3** (accept-AI lands
staged `ai_revision` from a **real `process_instance`'s `step_results`** onto live content), and the
cross-service reconciler (frontend event → `system_events` → pipeline → `process_instances`). **Honest env
limits:** `ANTHROPIC_API_KEY` is present-but-empty in the sandbox, so the drafting agents can't call the
model — W1.3 was proven by staging the agent's output shape into the real instance and driving the
land→accept path; the wiring is real, the LLM token is not.

### Close-out sweep (2026-08-09, "tested in full") — 8 more phantom bugs found + fixed

A follow-on pass drove the items proven only by *unit test or diff* to the same live standard, plus a
three-lens adversarial sweep (SQL/DB · API/auth · React/client) over the whole Canvas diff — every finding
**independently re-proven against the live stack** before it was trusted (agents included). Eight distinct
defects the green backbone never saw, all now fixed and live-verified:

| # | Severity | Bug | Proof it was real | Fix |
|---|----------|-----|-------------------|-----|
| 1 | **critical** | `reuse-past` wrote `content_source='library'`, which is **not** in the `canvas_versions.source` CHECK → the NEXT archive of that section (save/restore/accept) throws → caught non-fatal → snapshot **dropped** → content-loss. **One poisoned row already in live data** (from an earlier "passing" test that asserted the buggy value). | live: `INSERT … source='library'` throws the CHECK; a reuse→save left the reused content unrecoverable | write `'library_import'`; **migration 164** heals existing rows |
| 2 | high | `save` persisted the **unvalidated** client `body.source` into `content_source` (ignoring its own whitelisted `source`) → same downstream CHECK-fail/content-loss, client-triggerable | code path + the same CHECK proof | use the validated `source` |
| 3 | high | `seed-job/apply` archived the pre-merge content at the current version but **never advanced** `proposal_sections.version` → invariant `version > MAX(cv)` broken → the next human-save collided on the slot and dropped its snapshot | live repro: after apply `version==MAX(cv)`; the following save lost the seeded state from history | advance under CAS, like save/restore |
| 4 | high | `TemplateCanvasEditor` mounted `<CanvasEditor>` with **no autosave key** → `draftKey` collapsed to the shared constant `canvas-draft:doc` → editing template A then opening B offered to "recover" A's body into B → overwrite (template PATCH keeps no history) | code: the only keyless mount | pass `autosaveKey`; make autosave **inert** without a real key |
| 5 | medium | editor **white-screened** (`doc.canvas.format.startsWith(...)` on `undefined`) on any document missing `canvas.format` — an agent/import/legacy doc | live: two sections with the key absent threw React #419 error-boundary | `withCanvasDefaults` normalizes on ingest |
| 6 | medium | **draft-restore crashed** the editor on a partial persisted doc (`setDoc` bypassed mount-time normalization; a canvas missing `font_default`/`line_spacing` threw) | live screenshot: clicking "Restore them" → error boundary | normalize on restore + `withCanvasDefaults` now fills **every** canvas field |
| 7 | medium | the `STAGE_LOCKED` immutability contract `save` enforces was **missing** from `versions`/restore, `accept-ai-revisions`, and `seed-job/apply` → an admin could overwrite a stage-frozen (completed-but-unlocked) section those routes should refuse | live: on a `completed_stage≠stage` section, restore→423, accept-ai/seed-apply skip, content unchanged — after the fix | shared `isSectionWritable`/`sectionLockReason` helper across all four writers |
| 8 | medium | `handleUpdateNode` didn't reset `provenance.source`, so a hand-edited AI node kept `ai_draft` and **Revert** would silently discard the manual edit back to the pre-AI snapshot | code + Accept/Revert gate | set `source:'manual'` on a human content edit |

All eight are DB/live-asserted on the final rebuilt bundle (repro harnesses in the session scratchpad).
Cross-tenant security was re-proven live too: a foundation `tenant_admin` hitting another tenant's slug is
**403** on all seed-job + reuse + accept routes (IDOR closed). Deferred as known low-priority (non-functional):
the research-poll unmount cleanup, a cosmetic version-source badge tag, and wrapping the `auth()`/tenant
resolve in select/decide/skip so an unlikely throw returns the `{error,code}` shape.

---

## Corrections applied to the baseline analysis (the CANVAS_ADVERSARIAL §8 items)

The adversarial pass proved three of my Phase-1/2 facts stale; the fixes above **resolve** the underlying
gaps, so the analysis docs are now read alongside this log: **G15** ("Draft with AI") was a dead button (now
removed), **G5** (notifications) was a routing gap (now routed), and **G1** was a data-loss bug (now fixed).
`CANVAS_ARCHITECTURE.md` and `CANVAS_CAPABILITY_ANALYSIS.md` remain the as-was record; **this log is the
as-built delta.**

---

*Phase 5 (execution) + Phase 6 (documentation) of the Common-Canvas redesign. Commits on
`claude/nice-hamilton-kBqtD`: a6c0474 · 13592bb · 87a1ec9 · 82fb08e · 3fd87f0 · 7836520 · 52db0e2 (phantom-bug fixes,
zero-trust full-stack verified).*

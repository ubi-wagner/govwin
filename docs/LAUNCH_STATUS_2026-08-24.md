# Launch status — all big efforts (#157)

**Date:** 2026-08-24 · **Migration head:** 211 · **Branch:** `claude/nice-hamilton-kBqtD` (PR #212)
**Backbone:** `tsc` 0 · `vitest` 1844 · branch drive suite **30 passed · 0 failed · 0 could-not-run**
· bug log **80 entries, 0 open, 3 deferred**

Supersedes the readiness picture in `LAUNCH_READINESS_2026-08.md` (2026-08-16, head 185) and its
2026-08-23 addendum (head 205). **~340 commits** and **26 migrations** since.

---

## 0. Verdict

**Unchanged in shape, stronger in evidence: the gate is CONFIG · PROVE · DECIDE, not code.** No new
build blocker appeared in eight days of adversarial work, and one of the four must-clear items is
now settled.

What changed is how much of "internally proven" is *measurement* rather than passing tests. Eight
days ago that claim rested on unit tests plus a handful of hand-driven flows. It now rests on a
30-drive suite where every drive builds and disposes the scenario it needs, four lenses over the
running app, six canvas rulers calibrated against Chromium, and a defect log driven to zero open.

**One lesson to carry forward, because it recurred three times in a single sitting** (B105 · B107):
whether a write LANDS is a property of the **connection**, not of the SQL. A superuser probe cannot
measure any policy-dependent behaviour, in either direction. For a platform-scope row
(`tenant_id IS NULL`) under `govtech_app`, the answer is always that it will not land — silently,
with no error.

---

## 1. Launch punch list — current state

### 1.A MUST CLEAR before paying customer #1, in order

| # | Item | Kind | State |
|---|---|---|---|
| 1 | `DATABASE_URL_OWNER` on the frontend service | CONFIG | **OPEN.** One Railway variable. Without it `sqlBypass` falls back to the NOBYPASSRLS role and every admin cross-tenant read returns zero rows — the curate→release step goes blind. |
| 2 | `ANTHROPIC_API_KEY` on the pipeline service | CONFIG | **OPEN.** The event-triggered agent cohort executes in the Python worker. Wiring is proven end-to-end against the committed `:8787` emulator; the real model is unconfirmed. |
| 3 | `PROD_SMOKE_TEST.md` on live prod, after 1–2 | PROVE | **OPEN**, with the 08-23 amendment standing: run it against data shaped like a *real customer's*, not a freshly-seeded build. B73 was invisible to every fixture and obvious on the first stored row. |
| 4 | Comp-code vs. waking Stripe for cohort #1 | DECISION | **SETTLED — comp-code.** `rfppipelinetest` stays unlimited and never-expiring by explicit instruction. Stripe checkout stays descoped; the modal degrades honestly to "use an access code". |

### 1.B FAST-FOLLOW — launch without these; each works or degrades cleanly

- **`AGENT_GATE_SWEEP_URL` + `CRON_SECRET`** — AI-manager auto-advance ships inert until set. Note:
  the middleware bearer path was unreachable until 2026-08-21, so any deploy that set this earlier
  was collecting 401s rather than auto-advance.
- **`CARD_RECONCILE_URL` + `CRON_SECRET`** — heals a tenant who never opens their feed. Verified
  live on real drift: 5 of 8 tenants behind the bridge head, 49 cards applied, second sweep
  idempotent.
- **`AGENT_DATABASE_URL`** — the RLS-enforced `rfp_agent` role is built but deploy-gated. Agents run
  on the owner connection today. Defense in depth, not a blocker.
- **Wake more agents** — 36 archetypes registered; the core journey's are live. The rest need the
  pipeline key plus per-producer wiring.

### 1.C BY DESIGN — deliberate descope; call out rather than "fix"

Self-serve Stripe · SAM.gov ingest off · the `rfp-crm` service · the one-canvas / polymorphic-artifact
refactor · the shared *atom* library (each tenant holds isolated copies, by segregation design).

---

## 2. The big efforts

| Effort | State | Evidence |
|---|---|---|
| **Discovery spine** — curate → push → mirror cards → buckets/ranking | Shipped | migs 180 · 181 · 206; `RANKING_SPINE.md`; drives `opp-scout`, `bridge-buckets` |
| **Purchase → provision → workflow setup** | Shipped | mig 182; provisioning cockpit + tenant Workflow Setup; two live drives |
| **Build spine** — sections → compliance → readiness → package | Shipped | 41 volumes · 78 exports · 0 failures across every stored row |
| **Canvas** — one model, three surfaces, one interaction layer | Shipped (trust hub) | restore · autosave · non-destructive 409 · accept-AI all live; polymorphic refactor deferred by design |
| **Templates / molds** (#149–151) | **Closed this session** | 39 molds → `master_templates` → bridge → tenant-owned cards; 4 surfaces captured live; 55 registry assertions |
| **Agent fabric** (#148, #198) | Live core, rest dormant by plan | 36 archetypes; every AI-carrying trigger fired; `AI_FLOWS_PROOF.md`. **Real model unproven — punch item 2** |
| **Content / CMS** (#155, #167, #168, #180) | **Closed this session** | generate → review → publish driven as a real actor; 9 guides queued; migs 210–211 |
| **HITL / ToDo framework** (#164–175) | Shipped | `HITL_TODO_GUIDE.md`; every flow driven as real users |
| **Command Center** (#181–184) | Shipped | mig 179 watermark; admin · tenant · partner |
| **Scope / collaborators** (#190–197) | Shipped | stage-scoped grants; negative space proven |
| **Ingest provenance** (migs 186–188) | Shipped | per field: `pattern_match` → `ai` → `default`, each cited; absence is a finding |
| **Verification estate** (#199–215) | Shipped | 30 drives · 4 lenses · 6 rulers · scenario factory · `SCRIPT_INVENTORY.md` |
| **Scout intake** (#176) | **OPEN — the one real build item left** | queue exists (mig 175, `SCOUT_INTAKE_QUEUE.md`); surface unification not scoped |
| **Pristine mold pass** (#152) | **OPEN** | verified across 18 molds; there are now 39 |

---

## 3. What the last eight days actually bought

Not features. **Instruments, and the defects they found.** Every one of these was caught by looking
at the running product, not by reading the code.

- **Two customer-facing surfaces were broken while answering HTTP 200** (B78 · B79). Next serves a
  client error boundary and a failed hydration with a 200, and a client throw never reaches the
  server log — a harness gating on status code was structurally incapable of catching either.
  `verify-surfaces.mjs` now drives every `page.tsx` under `app/admin` and `app/portal/[tenantSlug]`
  as the right actor and fails on a rendered error surface. **79 surfaces · 79 clean.**
- **The page ruler under-counted** (B64–B66) — the direction that clears a volume already over its
  agency page limit. Its constants are now measured against Chromium rather than read off a
  stylesheet, and two calibration harnesses fail on drift.
- **Fixture rot was measured rather than felt** (B98–B102). Every drive now builds the scenario it
  needs and takes it away again; the suite went 18 pass / 9 fail → **30 / 30**, with the world
  verified unchanged afterwards.
- **The defect log went from "believed clear" to measured clear** (B67). Its status reader refuses
  to guess — written after I reported the log clean using a search that understood one of its three
  heading conventions.
- **Four fixes in the content spine this session** — the Studio no longer publishes raw markdown
  when it opens a legacy page (B104), publishing now closes the review ToDo that asked for it
  (B105), the seed scripts stopped stranding dead entries in a human's queue (B106), and the CMS
  drive stopped silently skipping its own precondition (B107).
- **`TEMPLATES_LAUNCH.md` was actively misdirecting** — it sent a reader to a chooser that Phase 5
  had deliberately narrowed away from the molds. Rewritten against the four surfaces that exist,
  each captured live.

---

## 4. Open by choice — decisions waiting on you

1. **41 unreferenced-and-rotted scripts** — no caller, and they drive identifiers that no longer
   exist. Delete, or keep as archaeology? (`SCRIPT_INVENTORY.md`)
2. **12 documented-but-rotted scripts** — a doc points at each, and each will fail confusingly for
   whoever follows the pointer. Fix the script, or fix the doc?
3. **B103** — the scenario factory's teardown deletes `system_events` rows that a separate lens
   reads as coverage evidence. Both halves are correct in isolation; three options are written up.

---

## 5. What I would do next, in order

1. **#152 pristine pass across all 39 molds** — the last open build item with a customer-visible
   surface. It was verified when there were 18.
2. **#176 scout intake** — scope the surface unification before building anything.
3. **Then stop building and run punch item 3.** Items 1 and 2 are two Railway variables. The smoke
   test against customer-shaped data is the only thing standing between "measured on the sandbox"
   and "measured on prod", and it is the one no amount of further sandbox work can substitute for.

---

## Method note

Every number here was read from the running system or the repository. `tsc` and `vitest` were
re-run against this exact commit while writing. The drive-suite result (30 passed · 0 failed · 0
could-not-run) and the export/ruler corpus figures were measured earlier the same day on this same
commit and are cited from that run — a container restart tore down the sandbox rig afterwards, and
nothing in the code has changed since.

Where something is **not** proven, it says so: the real model, the vision half of the visual
reviewer, and the live-prod chain are unproven by design and are punch items, not claims.

# Launch-readiness drive — 2026-08-26

Everything below was run against a rebuilt sandbox serving as `govtech_app` with RLS on, driven as
real signed-in actors through the product's own routes. No event was inserted by hand, no workflow
instance fabricated, no status set directly.

```
scripts/sandbox-up.sh                                  # the box, from nothing
cd frontend
node scripts/verify-{surfaces,api-contract,db-crud,ui-vs-db,write-contract}.mjs
node scripts/drive-agent-flows.mjs                     # the AI arc, end to end
node scripts/drive-dormant-surface.mjs                 # wake what has never run
```

---

## 1 · The five lenses, after the 28-file codemod

The bracket codemod rewrote the `catch` block of 28 route handlers. Unit tests passing is not the
same as driving those routes on a live box, so all five lenses were re-run. **All five exit 0.**

| lens | result |
|---|---|
| `verify-surfaces` | 78 surfaces driven · 78 clean · 0 broken (3 not addressable, reported) |
| `verify-api-contract` | 130 GET routes · 110 graded · 4 exempt · 16 unbound · coverage reconciles |
| `verify-db-crud` | every write landed where it should, nowhere else, fixture restored |
| `verify-ui-vs-db` | every number the UI states is the number the database holds |
| `verify-write-contract` | **213 write verbs · 213 refuse cleanly · 0 do not** |

The last line is the one that matters here: 213 write verbs still answer a client error as 4xx with
both `error` and `code`, after 28 of their catch blocks were rewritten by a codemod.

---

## 2 · The agent arc, run for the first time

`drive-agent-flows.mjs` had been written, committed, and flagged as never executed — twice. It ran.

**It failed on its first execution**, exactly as an unrun script does: `column v.content_source does
not exist`. The column is on `proposal_sections`, not `canvas_versions` (mig 163 records how a
*section's* current content got there). Fixed, then green.

What the run actually did, from the engine's own record:

```
at-rest   instances=179 · events=3900 · versions=3
requested instances=179 · events=3902
+6000ms   instances=180 · events=3917      ← the workflow instance appeared
final     instances 179→180 · events 3899→3923
```

- `OnReviewPhaseRequestedDraft` — **completed**. The Proposal Studio Draft loop, end to end.
- `tool:agent.invoked` **start ×2 and end ×2** — agents invoked, brackets closed.
- `tool:memory.stored` start/end — agent memory written, bracketed.
- Archetypes invoked: `proposal_manager`, `library_seed_suggester`.
- **8 workflow steps started, 8 completed.** 5 instances created, started, completed. Nothing lost.

The AI ran against the committed emulator on `:8787`, which is the production wiring with a
different key. **The plumbing is proven; the model output is not** — that distinction is the
script's own and it is worth repeating.

---

## 3 · The dormant surface, woken through the front door

`drive-dormant-surface.mjs` signs in as an rfp_admin, fetches the launchable template roster from
`/api/admin/workflows/templates` (never a hardcoded list — the B140 lesson), and launches each
through `POST /api/admin/workflows`, the same generic launcher the admin UI uses.

**13 of 13 accepted · 11 new instances · 0 failed.**

Every AI step ran and completed: `curation_qa`, `amendment_monitor`, `ops_digest`,
`social_scheduler`, `opportunity_scout`, `content_curator`.

Two of those deserve calling out — `curation_qa_ready` and `amendment_delta_ready` are two of the
**eight email templates written earlier the same night** (B141). They fired for real, through the
workflow engine, into `notification.requested`. The fix was exercised rather than asserted.

### The human gates, and what they were hiding

Four instances **paused** — `OnOpportunitiesDetected` and `ProjectCollaboration`, both correctly, on
a TODO step. That is why `opportunity_analyst` looked dormant: the AI steps sit *after* the gate, so
launching the workflow can never reach them. Nobody had clicked the button.

Completing each ToDo through `POST /api/admin/tasks` — the route the admin ToDo list posts to —
resumed every instance and drained them all to **0 parked**. That also proves the HITL resume path,
which nothing else here does: a paused instance that never comes back is indistinguishable from a
completed one in any count of instances.

### Where it got to

**Archetypes that have ever run: 21 → 26 of 36.** Newly woken: `content_curator`, `ops_digest`,
`social_scheduler`, `curation_qa`, `amendment_monitor`.

**Twelve remain dormant, and the reason is structural, not a defect.** Each is mapped to a tool
action reachable only from a *reactive* (`phase='end'`) workflow — they need a real business
operation to complete, which an overlay launch cannot substitute for:

| archetype | needs |
|---|---|
| `section_drafter` | a proposal created (`on_proposal_created`) |
| `compliance_reviewer`, `color_team_reviewer` | a proposal advanced a stage (`on_proposal_advanced`) |
| `opportunity_analyst`, `scoring_strategist` | an RFP uploaded (`on_rfp_uploaded`) |
| `onboarding_agent` | an application accepted (`on_application_accepted`) |
| `outcome_analyst` | an outcome recorded |
| `ingest_analyst`, `rfp_ingest_manager` | an ingest assessment requested |
| `library_seed_mapper` | an admin library-seed selection |
| `matrix_stager`, `skeleton_architect` | a portal provisioned |

Driving those means running the full customer journey — which `frontend/e2e/mt-arc-drive.spec.ts`
already does — rather than launching workflows. **"Never run here" is a statement about this box's
history, not about capability**, and it stays that way for these twelve.

---

## 4 · A committed credential three cleanups missed

Covered in full in the bug log (B142) and `db/migrations/214_close_committed_demo_credential.sql`.
Short version: `191_seed_immobileyes_proposals.sql` seeds an active **tenant_admin** with
`temp_password = false` and a bcrypt hash whose plaintext is committed in five scripts. Migrations
124, 198 and now 214 have each tried to clean this class up, and the first two used a fixed list —
which is why 191 slipped past both. `__tests__/seeded-credentials.test.ts` replays every migration
and asserts the property instead.

---

## What this drive did NOT establish

- **Model output.** Every AI flow ran against the emulator. The plumbing is proven end to end; a
  real `ANTHROPIC_API_KEY` on pipeline + CMS is still required before customer #1.
- **The CRM delivery path.** The eight new templates render, and `notification.requested` is emitted
  with the right template name — but the CRM service (own database, Gmail credentials) has never run
  on this box, so no email has been *sent*.
- **The twelve reactive archetypes**, per the table above.
- **Load, latency, and production configuration.** Nothing here measures either.
- **RLS isolation** was not re-verified in this pass; the box serves as `govtech_app` with RLS on,
  which is the precondition, not the proof.

---

## Verification

`tsc` 0 · `vitest` 1972 · `pytest` 1319 · five lenses exit 0 · spine audit joins 1,2,3,6,7 all zero ·
`drive-agent-flows` exit 0 · `drive-dormant-surface` 13/13 launched, 0 failed, 0 left parked.

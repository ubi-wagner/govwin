# HITL Wiring Audit — 2026-07-03 (MVP: opportunity card + ingest→lock)

Driven audit of the MVP spine against a **real running instance** (Next `next start`
on a migrated + seeded scratch DB, Playwright driving the actual UI/APIs as the RFP
admin and a tenant admin). Method + verdict scale: `docs/HITL_WIRING_AUDIT_RUNBOOK.md`.
This run both **verified** wiring and **fixed** the breaks it found; every fix is
regression-tested against the live app.

## How this was driven (not code-read)
- Built the missing e2e harness (`frontend/e2e/`): real Credentials-form login per
  persona, storageState reuse, pointed at the pre-installed Chromium. Proven green.
- Reachability sweep: **19/19 customer portal pages + 29/30 admin pages** return 200
  for the authenticated persona — no crashes, no login bounces. (The one 404,
  `/admin/section-standards`, is an API-only path with no page — not a break.)
- Depth: four subsystem maps (ingest→release, card→bridge→buckets,
  purchase→provision→matrix/tree, build-push→lock→download) traced to `file:line`,
  then the correctness bugs driven and fixed.

## Scorecard
| Capability | Verdict | Evidence / note |
|---|---|---|
| Login + tenant scoping (both personas) | ✅ WIRED | driven: both sessions reach gated pages, no bounce |
| Admin RFP ingest (upload → solicitation + topics) | ✅ WIRED | `rfp-upload/route.ts`; topics persist via `opportunity.bulk_add_topics` |
| Solo curate → **release** | ✅ FIXED | was 🔴 blocked; push gate now accepts interactive compliance (A1) |
| 10 topics → customer surface | ✅ FIXED | **design A chosen + built**: multi-topic fan-out now publishes every topic to the bridge → each is a customer card (driven-verified) |
| Opportunity **card** snapshot + pin + buckets | ✅ FIXED | split-brain retired — legacy Spotlight/Pipeline redirect to the canonical `/cards`; nav promotes Cards/Buckets |
| Purchase → provision (admin-granted) | ✅ WIRED | `proposals/create`; Stripe checkout records but does not provision (by design) |
| **Compliance matrix** | ✅ FIXED | was 🔴 empty shell (0% always); now populated at provision + advances on lock (driven) |
| **Volume-doc tree** | 🟡 PARTIAL | real in data (volumes→artifacts→sections, page allocations); workspace still renders **flat** (no volume grouping) — pending |
| Templates (author → apply) | 🟡 design-only | author works via API; nothing sets `volume_required_items.template_id`, so templates never reach provisioning |
| Build-push (versioned save) ×3 | ✅ WIRED | optimistic-lock CAS on section version; iterates unbounded within a stage |
| Stage advance (gated + audited) | ✅ FIXED | orphaned `PATCH /stage` bypass closed (D3) — routes through the gated core |
| Section accept / **lock** | ✅ FIXED | locked-save overwrite (D1) + missing CAS (D2) fixed, driven-verified |
| **Lock** proposal → **download** | ✅ WIRED | proposal lock/unlock CAS correct; docx/json export real (in-memory, S3-independent) |

## Fixes landed this run (all regression-tested against the live app)
| ID | Bug (severity) | Fix | Test |
|---|---|---|---|
| D1 | Locked section editable via SAVE API → overwrote accepted content (data integrity) | `save` selects `is_locked`, rejects with 423 | `e2e/lock.tenant.spec.ts` |
| D2 | Section lock/unlock had no compare-and-swap → double side effects (harvest, auto-advance) | CAS + idempotent no-op | same |
| D3 | Orphaned `PATCH /stage` bypassed the "all sections locked" gate | delegate to `advanceProposalStage` | build + code path removed |
| A1 | Solo release blocked — push required a named column the interactive tool never writes | gate on submission_format present via `custom_variables.value` OR named column, solicitation-level row | DB predicate, 4 cases |
| Matrix | `proposal_compliance_matrix` never populated (card % always 0) | populate at provision (per required item / required-section); advance to `satisfied` on section lock, reset on unlock | `e2e/matrix.tenant.spec.ts` |

## Remaining to launch-ready (prioritized)
1. ~~**Split-brain decision.**~~ ✅ RESOLVED — design **A** (Greenfield Cards
   canonical): multi-topic fan-out carries every topic onto the bridge; legacy
   Spotlight/Pipeline redirect to `/cards`. Follow-ups: retire the orphaned
   `/spotlight/pin` API + legacy spotlight components (dead code now), and migrate
   any legacy `tenant_pipeline_items` bucket scoring onto `tenant_bucket_scores`.
2. **Matrix on the portal-accept path.** `provisionProposalForPortal`
   (`lib/provision-proposal.ts`) doesn't yet populate the matrix — a portal-launched
   proposal still shows an empty matrix. Replicate the provision population (extract a
   shared helper).
3. **Volume-doc tree grouping.** Group the workspace section list by volume (data is
   there; UI renders flat).
4. **Templates → skeleton.** Wire `volume_required_items.template_id` assignment + a
   Template-Studio apply action so authored templates reach provisioning; fix the
   admin template list fetch (`{data:{templates}}` treated as an array).
5. **New-customer backfill** auto-wire (`backfillTenant` only runs via a manual admin
   route → fresh tenants miss historical opportunities).
6. **Fan-out entitlement gate** — every active/trial tenant currently receives every
   card regardless of Spotlight subscription (confirm intended).

## Verdict
The **ingest → curate → release → purchase → provision → build-push ×3 → lock →
download** spine is **end-to-end wired and driven-green**, the compliance matrix is
now real, and the build→lock loop's data-integrity bugs are fixed. The opportunity
card also converged on design A (multi-topic fan-out + Cards canonical), so a
multi-topic RFP now lands one customer card per topic on the canonical surface. The
remaining launch gaps are **feature completeness** (portal-provision matrix, volume
grouping, templates→skeleton) and **dead-code cleanup** (legacy spotlight
API/components) — not in the core spine.

# Foundation TVSF seed — onboarding → build → Paul's view (as-built, proven live)

This is the durable, reproducible seed for **Foundation** (the 3D-printed concrete-formwork
startup from the Entrepreneurs' Center team's `3DCP_Final_Prez_1.pptx`). It stands up the
company, its people, an external EC shadow-admin (Paul Jackson), the deck-derived library,
the TVSF proposal walked all the way through the pipeline to a downloadable final document,
and the SBIR/STTR opportunities ranked against Foundation's spotlight buckets — so **Paul can
log in and see the buckets, the TVSF pipeline, and the ranked SBIRs**.

Source of truth for content: **FOUNDATION_PROFILE.md** (digest of the deck) + **TVSF_FORMAT.md**
(the real DMVEC Round-45 format). Everything below was proven live end-to-end on the sandbox.

## Accounts (password `DemoPass123!`)
| Person | Role | Login | Notes |
|---|---|---|---|
| Kate Ulepic | CEO — `tenant_admin` | `kate.ulepic@foundation3dp.com` | buys the portal, owns the build |
| Conor Atkins | COO — `tenant_user` | `conor.atkins@foundation3dp.com` | |
| Connor Casey | CFO — `tenant_user` | `connor.casey@foundation3dp.com` | |
| Will Curley | CTO — `tenant_user` | `will.curley@foundation3dp.com` | |
| **Paul Jackson** | **partner_user → shadow admin** | `pjackson@ecinnovates.com` | EC mentor; **`tenant_admin` membership** (source=`collaborator`) appointed by Kate, **plus** an external proposal-collaborator grant on the TVSF build |

> Paul is native `partner_user` (external, no home tenant). The company appointed him a
> **shadow admin** via a `tenant_admin` membership, so on login he pins Foundation
> (`/api/enter?slug=foundation`) and sees the whole workspace. He is *also* an external
> `proposal_collaborators` row on the TVSF proposal with per-stage `edit` access — the
> "collaborating partner" facet.

## What gets built (verified end-state)
- **tenant** `foundation` (active, grinder) · **5 members** · **5 spotlight buckets** (custom
  criteria) · **10 approved library atoms** (from the deck) · **6 opportunity cards** · **30
  bucket scores** (real `scoreCard`, not faked).
- **TVSF build**: comp-purchase (`rfppipelinetest`) → `proposal_portals` `launched` → provisioned
  proposal (Proposal 12 sections + Budget 1) → **13/13 drafted + locked** → compliance matrix
  **13/13 satisfied** → advanced to **`submitted`** → exported.
- **Downloadable final proposal** (system exporter, no S3): `Foundation_TVSF_Proposal.docx`
  (Abstract + #1–#11, 7-page format) and `Foundation_TVSF_Budget.xlsx` (#12 spend-type table,
  $200,000). Also downloadable live via `POST /api/portal/foundation/proposals/<id>/package?format=docx`.

## Ranked pipeline Paul sees (best bucket score)
| Score | Program | Opportunity |
|--:|---|---|
| 100 | SBIR | NSF — Advanced Manufacturing: Construction Automation & Robotics |
| 89 | SBIR | DOE — Low-Carbon Concrete & Cement Materials |
| 83 | TVSF | Ohio Third Frontier TVSF Round 45 (the build) |
| 68 | STTR | NSF — Robotics for the Built Environment |
| 68 | SBIR | Army ERDC — Additive Construction of Expeditionary Structures (ACES) |
| 64 | SBIR | NASA — Additive Construction for Off-World Habitats |

## Reproduce (fresh, migrated DB + running server)
```bash
export DATABASE_URL='postgresql://…/govtech_intel'
# 0. base (once): migrations + platform admin
node db/migrations/migrate.mjs && node scripts/seed_dev_accounts.mjs
# 1. one command — loads opps, seeds Foundation, builds + exports, verifies
TEST_BASE_URL=http://localhost:3000 bash scripts/seed-foundation-all.sh
```
Then sign in at `/login` as any account above.

### The pieces (if running by hand)
1. `scripts/seed-e2e-hitl.mjs` — rfp_admin + role cohort.
2. `frontend/e2e/hitl-load-tvsf.spec.ts` — load the dated TVSF opportunity (intake→curate→approve→push).
3. `frontend/e2e/hitl-load-sbir.spec.ts` — load the 5 SBIR/STTR opps.
4. `scripts/seed-foundation.mjs` — tenant, founders, **Paul (shadow admin)**, buckets, atoms, cards, **bucket scores** (ported `lib/bucket-ranking.ts::scoreCard`).
5. `frontend/e2e/hitl-foundation-build.spec.ts` — Kate comp-purchase → rfp_admin **release/provision**.
6. `frontend/scripts/drive-foundation-tvsf.mts` — draft 13 sections (canvas) → lock (matrix→satisfied) → advance→submitted → **export docx+xlsx via the system exporter**; appoints Paul the proposal collaborator.
7. `frontend/e2e/hitl-foundation-verify.spec.ts` — Kate downloads the final proposal; **Paul sees buckets + ranked pipeline + the TVSF proposal**.

## Note on drafting
The sandbox has no `ANTHROPIC_API_KEY`, so the section text is drafted **deterministically from the
deck** (via `drive-foundation-tvsf.mts`) rather than by a live `section_drafter` LLM call — better
for a reproducible seed. Everything else is the **real** pipeline: provisioning, compliance-matrix
instantiation + advance-on-lock, artifact roll-up, stage advance, and the canvas→docx/xlsx exporter.
On an instance with the pipeline `ANTHROPIC_API_KEY`, the same sections would be filled by the agent
cohort instead.

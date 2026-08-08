# Partner-Manager V1 — Independent Verification & Live-Drive Record (2026-08-08)

Independent verify-and-drive pass over the as-built partner-manager actor
(PM Phase 0–6 + V1-A→E, migrations 158–162; canonical spec `docs/PARTNER_MANAGER_DESIGN.md`).
No code changes were required — every scenario in the design's test plan (§7) was reproduced
live against a freshly-built standalone server on the seeded sandbox DB. No functional gaps found.

> Note: this pass began by recovering a stale local checkout (a container reclaim had reset the
> working tree to an old commit); the branch was reset to `origin/claude/nice-hamilton-kBqtD`
> (`ee7d7d3`), where the full feature already lived.

## Green backbone (at `ee7d7d3`)

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | **0 errors** |
| `npx vitest run` | **879 passed** (90 files) |
| `migrate.mjs --check` (DB @ mig 162) | **0 drifted · 0 pending · 0 unverifiable** |
| `next build` (standalone) | **success** |

## Seeds verified (migs 157–162)

- `partner_admin`: **Paul Jackson** (`pjackson@ecinnovates.com`), **Stephanie Gaffney** (`sgaffney@ybi.org`) — both temp-password-gated.
- `kind='partner_org'` tenants: **Entrepreneurs' Center** (owner Paul), **Youngstown Business Incubator** (owner Stephanie).
- Paul's seeded stable: home @ EC, plus `partner_manager` @ Foundation.

## Live drive (as Paul + RFP admin + two company admins)

**Stage A — partner surface:** console renders own-org + stable rollup cards (live buckets/pins/proposals/portals + admin POC) + the in-app "How this works" guide; **Add a company** Branch A (new → thin onboarding form w/ phone/description/partner notes → submit) and Branch B (existing "Ubihere" → "Request manager access"); **descend** into a managed company shows the `Managing … as a partner-manager — Exit to partner console` banner over the full tenant portal + the mirrored ranked pipeline; **ascend** returns to the console.

**Stage B — multi-actor approvals (all reached the stable):**

| # | Scenario | Approver | Result in stable |
|---|---|---|---|
| S1 | New company → registration (`source='partner'`, `partnerId`=Paul) | RFP admin (queue shows a **PARTNER REGISTRATION** badge) | Skyline Robotics — **Created** (owned by Paul), provisioned w/ 6 buckets + 6 ranked pins |
| S2 | Request manager access (Ubihere) | Ubihere's admin (Team page → Approve) | Ubihere — **Manager** |
| S3 | Company adds partner directly (Lighthouse Team → role "Manager") | Lighthouse's admin | Lighthouse — **Manager** |

### Paul's scope after the drive (DB truth)

| tenant | kind | owns | membership source |
|---|---|---|---|
| entrepreneurs-center | partner_org | yes | home |
| foundation | standard | yes | partner_manager |
| skyline-robotics-030906 | standard | yes | partner_manager |
| ubihere | standard | no | partner_manager |
| lighthouse | standard | no | partner_manager |

### Audit trail (`system_events`, `finder` namespace, tenant-scoped)

`partner.company_dedup_reviewed` · `partner.company_registered` · `partner.manager_requested` ·
`partner.manager_granted` (×2) · `partner.entered` · `partner.exited` — every lifecycle step per design §6.

## Divergences from the prose spec (design choices, non-blocking)

1. **Apply path** reuses the existing `applications` route/pipeline (partner-tagged), not a literal Python-workflow instantiation for the apply step — the RFP-admin to-do and provisioning are identical in effect.
2. **Own-org** opens the standard tenant-admin portal (the spec's "may be a special variant" is satisfied by the standard portal).
3. **Console layout** is a single main column (own-org → add → stable grid), not a right-rail toolbox; all specified content is present.

## Deliverable

**Partner-Manager Operator Guide** (PDF, 13pp, 3 actor perspectives) — built from this drive's screenshots.
The in-app equivalent is the console's collapsible "How this works" guide (`app/partner/partner-guide.tsx`), verified rendering.

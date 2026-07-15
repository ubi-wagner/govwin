# Customer Purchase → Curation → Release → V1 (as-built, this cycle)

> **Superseded by `docs/MASTER_MIRROR_OPP_DESIGN.md`** (the full master/mirror architecture + the
> corrected two-release model + gap register) and its Monday spine `docs/HITL_IMMOBILEYES_CLICKPLAN.md`.
> Kept for the file-level "what shipped" list below; read the design doc for the model.

The founding-cohort single-operator loop, made concrete for the first real customer
(Immobileyes → Navy). Everything below shipped this merge cycle on branch
`claude/nice-hamilton-kBqtD` and is verified on a throwaway PG16 (full chain 001→106 clean).

## The flow (with the two-pass curation model)

```
RFP admin (ingestor)                 Customer (eric@immobileyes.com)         RFP admin (shadow)
────────────────────                 ──────────────────────────────         ──────────────────
1. ingest Navy opp + skeleton  ──►
   (curate #1: volumes/items/
    matrix/molds) then push
                                     2. upload artifacts → atomize → tag
                                     3. create 2–3 Spotlight buckets
   4. ingest Navy + others  ──────►  (auto-ranked vs buckets)
                                     5. pin Navy, review copied docs + notes
                                     6. Purchase modal → code `rfppipelinetest`
                                        → portal opens `curation_pending` (72h SLA)
   7. EMAIL: "purchase needs   ◄──────  (customer sees "Waiting for RFP Expert
      curation" + triage ToDo            Curation" + live countdown)
   8. Release ──────────────────►     provisions the build UNLOCKED
      (curate #2 at V0 as shadow, ────────────────────────────────────────►  edit sections in-tenant
       shadow grant preserved)
                                     9. pick atoms per section (blank mold +
                                        prompt → drafts from expert note +
                                        ALL proposal atoms fallback)
                                     10. lock all sections  OR  Force advance to V1
                                     11. download .docx (V1)
```

**RFP admin curates twice** (per Eric): once as the **ingestor** (build the skeleton + release),
then again at **V0 as the shadow admin** inside the tenant. The release keeps the T&C shadow grant
(it is not revoked), and provisions the proposal **unlocked**, so the second pass works.

## What shipped (files)

- **mig 105** `proposal_portals.curation_pending` state + `paid_at`/`curation_due_at` (72h); `promo_codes`
  (comp/percent/amount, seeded `rfppipelinetest`); `purchases.promo_code`.
- **mig 106** automation_rule `capture:purchase.completed → notify_admin` (closes the silent-purchase gap).
- **Purchase**: `POST /api/portal/[slug]/purchase` (comp-code → curation_pending + \$0 completed purchase +
  72h `rfp_admin` gate + `capture:purchase.completed`); `components/portal/purchase-modal.tsx` (code box at
  the bottom) on pinned cards.
- **Wait UI**: `proposal-portals.tsx` renders "Waiting for RFP Expert Curation" + live countdown.
- **Release**: `portals/[id]?action=release` (rfp_admin, `isExpert`-gated) → `releaseFromCuration` CAS +
  provision + unlock; `lib/portal-launch.ts`.
- **Notify surface**: `listOpenAdminTriageTasks` widened to show the tenant-scoped `proposal_setup` gate in
  `/admin/rfp-curation`.
- **Draft grounding**: `lib/atoms.ts selectForSection` falls back to ALL tenant atoms when a section has none;
  `expertNotes` plumbed to the drafter's `instruction` (the blank-mold prompt).
- **Advance**: stage labels → V0.5/V1; "Force advance to V1" button (force=true, already wired in the core).
- **Ingest hardening**: manual `content_hash` includes the oppId (no dup-title 500); S3 failure rolls back
  the orphaned opp/solicitation.

## HITL — the NEW steps to click Monday (append to `HITL_IMMOBILEYES_CLICKPLAN.md`)

| # | Click | Perform | Expect |
|---|---|---|---|
| 6a | `/portal/immobileyes/cards` (customer) | Pin Navy → **Purchase** → type `rfppipelinetest` → Complete | portal `curation_pending`; routed to portals |
| 6b | `/portal/immobileyes/portals` | View | **"Waiting for RFP Expert Curation"** + 72h countdown |
| 7a | `/admin/rfp-curation` (rfp_admin) | Check triage | a **"Purchase — needs curation"** ToDo (+ admin email if CMS configured) |
| 9a | `/portal/immobileyes/portals` (shadow) | **Release to customer** | portal `launched`; build provisioned unlocked |
| 10a | a section with no atoms | Draft | drafts from the **expert note + all proposal atoms** |
| 11a | proposal admin panel | **Force advance to V1 →** | advances to V1/submitted without locking every section |

**Config note:** the comp path needs no Stripe; real S3 is still needed for step 3 doc storage; the admin
email needs the CMS listener + `ANTHROPIC_API_KEY`/Gmail creds (graceful without — the in-app ToDo still shows).

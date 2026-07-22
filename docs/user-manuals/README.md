# User Test Manuals

Step-by-step UI test scripts for the three primary personas, grounded in the live frontend
(exact nav labels, button text, and expected results; every stub/disabled control is flagged
so it isn't mistaken for a failure). Use them to walk the system end-to-end.

| Manual | Persona | Role | Covers |
|---|---|---|---|
| [RFP_ENGINE_ADMIN_TEST_MANUAL.md](./RFP_ENGINE_ADMIN_TEST_MANUAL.md) | RFP Pipeline staff | `master_admin` / `rfp_admin` | Scouts (sources/ingest) · RFP Curation triage→push · Portal oversight (opportunities, proposals, tenants) · Applications→provisioning · Workflows/Tasks |
| [CUSTOMER_ADMIN_TEST_MANUAL.md](./CUSTOMER_ADMIN_TEST_MANUAL.md) | Small-business owner (customer) | `tenant_admin` | Profile → Opportunities (`/cards`) / Buckets / pin → **purchase** (comp code) → wait for curation (72h) → **V0→V0.5→V1** (draft / library / lock / advance) → team & partners → record the win |
| [UNIVERSITY_PARTNER_TEST_MANUAL.md](./UNIVERSITY_PARTNER_TEST_MANUAL.md) | External university collaborator | `partner_user` | Invite/accept → scoped section edit/comment/view → upload → the explicit list of what's blocked |

### How the personas connect (one end-to-end pass)
> Canonical flow + gap register: docs/MASTER_MIRROR_OPP_DESIGN.md; HITL scripts: docs/ALPHA_HITL_RUNBOOK.md + docs/HITL_IMMOBILEYES_CLICKPLAN.md.
1. **Admin** ingests a solicitation (Scouts), curates it + writes the **`spotlight_summary`**, and **pushes** it (Release 1) → mirror cards fan out to every tenant's `/cards`, auto-ranked.
2. **Customer Admin** sees it in **Opportunities** (`/cards`), ranks with **Buckets**, **pins** it (copies the docs), then **Purchases** with the comp code `rfppipelinetest` → the build waits in **"Waiting for RFP Expert Curation"** (72h SLA).
3. **Admin** resolves the **"Curate + release"** ToDo at `/admin/rfp-curation` (routed shadow-admin into the tenant), builds/reuses the **master skeleton** (Release 2), and **Releases** → provisioned **unlocked**, `draft_v0` auto-drafts → **V0**.
4. **Customer** does **library plug-and-play** (→ V0.5) and invites a **University Partner** to a section; the **Partner** accepts via `/invite/<token>` and edits/comments their granted section.
5. **Customer** locks → **advances** (or **force-advances**) to **V1** → downloads the `.docx` → **records the win** (seeds a V2 contract).

### HITL launch readiness
A dedicated sweep confirmed **every human-in-the-loop interaction has a real, mounted, wired UI** —
task queues on both dashboards (see + complete → resume the workflow), delegation (Assign a task),
force-advance on all three process ledgers, the stage/lock gates, in-app nudges + the `/go` email
landing, and the 72h `admin_review` gate (reachable in the admin queue). **No hard launch blockers.**
The two previously-open notes are now closed: the **typed completers are exercised** (the "Assign a
task" form picks Review / Upload / Form, setting `params.kind`), and ops can **launch a
`ProjectCollaboration` review gate by hand** from the admin **Launch Review Gate** form. See §HITL in
`../archive/V1_SWEEP_FINDINGS_2026-06-29.md` and the full picture in `../archive/V1_END_TO_END_AUTOMATION.md`.

### Fixed in this release (previously test-affecting)
- **Partner onboarding** — the invite email now routes a **new** collaborator to the `/invite/<token>`
  **Accept Invitation** page (activates access; no more 404) and an **existing** user straight to the
  proposal (auto-accepted at invite); the acceptance page now requires the same **12-char** minimum.
- **Master-admin task visibility** — a `master_admin` now sees & completes the `rfp_admin` pipeline
  tasks (incl. the 72h review) in the dashboard queue.

### Stubs/disabled (not failures — don't log these)
"AI Review (coming soon)", section "Export .pdf" (the whole-proposal package download is now `.docx`),
Library "Split", admin "CRM Console" + "Templates" viewer. **Live self-serve Stripe checkout is
descoped** — the founding cohort buys with the comp code `rfppipelinetest` (purchase → curation → release).

Full engineering finding list: `../archive/V1_SWEEP_FINDINGS_2026-06-29.md`.

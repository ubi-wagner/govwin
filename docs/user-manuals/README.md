# User Test Manuals

Step-by-step UI test scripts for the three primary personas, grounded in the live frontend
(exact nav labels, button text, and expected results; every stub/disabled control is flagged
so it isn't mistaken for a failure). Use them to walk the system end-to-end.

| Manual | Persona | Role | Covers |
|---|---|---|---|
| [RFP_ENGINE_ADMIN_TEST_MANUAL.md](./RFP_ENGINE_ADMIN_TEST_MANUAL.md) | RFP Pipeline staff | `master_admin` / `rfp_admin` | Scouts (sources/ingest) · RFP Curation triage→push · Portal oversight (opportunities, proposals, tenants) · Applications→provisioning · Workflows/Tasks |
| [CUSTOMER_ADMIN_TEST_MANUAL.md](./CUSTOMER_ADMIN_TEST_MANUAL.md) | Small-business owner (customer) | `tenant_admin` | Profile → Spotlight/pin → Pipeline → build proposal → AI draft / edit / compliance / lock / advance → team & partners → record the win |
| [UNIVERSITY_PARTNER_TEST_MANUAL.md](./UNIVERSITY_PARTNER_TEST_MANUAL.md) | External university collaborator | `partner_user` | Invite/accept → scoped section edit/comment/view → upload → the explicit list of what's blocked |

### How the personas connect (one end-to-end pass)
1. **Admin** ingests a solicitation (Scouts), curates it, and **pushes** it → it becomes visible to customers.
2. **Customer Admin** sees it in **Spotlight**, **pins** it, **builds a proposal**, AI-drafts, and invites a **University Partner** to a section.
3. **Partner** accepts via `/invite/<token>`, edits/comments their granted section.
4. **Admin** clears the **72h admin-review** task (Dashboard Task Queue); the customer locks → **advances** → submits → **records the win** (seeds a V2 contract).

### HITL launch readiness
A dedicated sweep confirmed **every human-in-the-loop interaction has a real, mounted, wired UI** —
task queues on both dashboards (see + complete → resume the workflow), delegation (Assign a task),
force-advance on all three process ledgers, the stage/lock gates, in-app nudges + the `/go` email
landing, and the 72h `admin_review` gate (reachable in the admin queue). **No hard launch blockers.**
Two non-blocking notes remain: the upload/form **typed completers are latent** (no current gate sets
`params.kind`, so every gate uses the review Approve/Dismiss completer), and there's **no UI to launch
a `ProjectCollaboration` gate by hand** (the bridges launch it programmatically). See §HITL in
`../V1_SWEEP_FINDINGS_2026-06-29.md`.

### Fixed in this release (previously test-affecting)
- **Partner onboarding** — the invite email now routes a **new** collaborator to the `/invite/<token>`
  **Accept Invitation** page (activates access; no more 404) and an **existing** user straight to the
  proposal (auto-accepted at invite); the acceptance page now requires the same **12-char** minimum.
- **Master-admin task visibility** — a `master_admin` now sees & completes the `rfp_admin` pipeline
  tasks (incl. the 72h review) in the dashboard queue.

### Stubs/disabled (not failures — don't log these)
"AI Review (coming soon)", section "Export .pdf" (package export is JSON), Library "Split", admin
"CRM Console" + "Templates" viewer, Stripe billing (founding-cohort bypass).

Full engineering finding list: `../V1_SWEEP_FINDINGS_2026-06-29.md`.

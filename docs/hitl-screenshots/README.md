# HITL Visual Manual — screenshots for every actor (2026-08-01)

Full-page captures of each actor's key surfaces on the live seeded box, produced by
`frontend/e2e/hitl-screenshots.spec.ts` (each shot is asserted to have rendered — no
500 / blank / auth-bounce — before capture). Pairs with **docs/E2E_HITL_RUNBOOK.md**.
Cohorts: `e2e-*` on acme-navy (`E2ETest!2026`) + Foundation/Paul (`DemoPass123!`).

| # | Actor | Surface | Runbook step |
|---|---|---|---|
| 01 | master_admin | Admin dashboard | §A |
| 02 | master_admin | **Agent Workforce roster (35 archetypes, Content Generator dormant — F6)** | §A.2 / §3.5-D |
| 03 | master_admin | Events / audit timeline | §A.3 |
| 04 | master_admin | Tenants (shadow-descend entry) | §A.4 |
| 05 | master_admin | Purchases | §B.5 |
| 06 | rfp_admin | Intake (ingest) | §B.2 |
| 07 | rfp_admin | Opportunities | §B.3 |
| 08 | rfp_admin | RFP curation | §B.4 |
| 09 | rfp_admin | Purchases / release | §B.5 |
| 10 | tenant_admin (Paul) | Foundation dashboard | §C / §3.5-A |
| 11 | tenant_admin (Paul) | Buckets (ranked scoring) | §C.1 |
| 12 | tenant_admin (Paul) | Opportunity cards | §C.1 |
| 13 | tenant_admin (Paul) | Proposals list | §C.4 |
| 14 | tenant_admin (Paul) | TVSF proposal (sections + compliance matrix) | §C.4 |
| 15 | tenant_admin (Paul) | **Section editor — REHYDRATED saved content (F2)** | §3.5-B4 |
| 16 | tenant_admin (Paul) | Atom library | §C.10 |
| 17 | tenant_admin (Paul) | Team | §C.11 |
| 18 | tenant_user | Scoped cockpit | §D |
| 19 | tenant_user | Cards (scoped) | §D |
| 20 | partner_user | Vaults only (contained) | §E |

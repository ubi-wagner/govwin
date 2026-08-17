# Production smoke test — post-deploy checklist

Run after each deploy to prod (www.rfppipeline.com). Complements the sandbox prod-parity proof below.

## Sandbox prod-parity proof (2026-08-14, this cycle)
Brought the stack up EXACTLY as prod — app served as **`govtech_app` (NOBYPASSRLS)**, `DATABASE_URL_OWNER`
= the owner (superuser) for `sqlBypass`, emulator for AI — and verified:

| Check | Result |
|---|---|
| RLS · DB layer (raw SQL as `govtech_app`) | no-context → **0** (deny-all); Foundation ctx → **4** (own); RFP-Pipeline ctx → **0** (cross-tenant invisible); owner superuser → **4** (bypass) ✅ |
| RLS · portal routes (`drive-rls-portal-fnd`) | **28/28** — every tenant surface returns its own data ✅ |
| RLS · admin cross-tenant (`drive-rls-admin-fnd`) | **11/11** — tenants/sources/rfp-curation/agent-workforce rollup all return rows via `sqlBypass` (proves `DATABASE_URL_OWNER` is required + working) ✅ |
| PDF export (`scripts/prove-pdf-export.mts`) | real PDF, 7268 bytes, `%PDF-` magic — the Chromium fix launches + renders ✅ |
| Build | `next build` green; playwright traced into `.next/standalone`; CI frontend check (Docker apk chromium) passed ✅ |

## Post-deploy checklist (run on live prod)
Prereqs first: **`DATABASE_URL_OWNER`** set on the frontend service + **`ANTHROPIC_API_KEY`** on the pipeline service.

1. **Login** — each role (master_admin, rfp_admin, tenant_admin, tenant_user) reaches its dashboard.
2. **Tenant isolation** — a tenant_user sees ONLY their tenant's cards/proposals/atoms (never another tenant's).
3. **Admin cross-tenant surfaces render rows** (validates `DATABASE_URL_OWNER`): `/admin/agents` → Agent Workforce
   rollup shows per-tenant usage (not blank); `/admin/rfp-curation/[solId]` → "Customer Interest" shows tenants;
   the admin tenants list shows all tenants. **If any of these are blank/0, `DATABASE_URL_OWNER` is missing.**
4. **Section save** — edit + save a proposal section; version advances, no 409, content persists.
5. **Package export — PDF** (the Chromium fix): a locked/submitted proposal → `…/package?format=pdf` downloads a
   real PDF (opens, styled, header/footer/page numbers). Also spot-check docx + zip. **If PDF 500s, Chromium
   isn't in the frontend image** (see frontend/Dockerfile apk step).
6. **Email** — trigger an invite or password reset; the email sends (Gmail primary), and the **link is absolute**
   (`https://…`, not a relative path) — validates the `AUTH_URL`/`NEXT_PUBLIC_APP_URL` fixes.
7. **AI drafting** (once pipeline `ANTHROPIC_API_KEY` is set) — Studio / full-draft produces real content; the
   staged revisions land via "Apply AI-proposed revisions".
8. **Semantic retrieval** — expected OFF unless `VOYAGE_API_KEY` is set (atom retrieval falls back to tag/context;
   no error).

## Notes
- Agent-side RLS (`rfp_agent`) stays deploy-gated until `AGENT_DATABASE_URL` is provisioned; today agents ride
  the pipeline connection (trusted cross-tenant engine) — isolation via the app-layer predicate + guards.
- Env-var reference: **docs/RAILWAY_ENV_VARS.md**.

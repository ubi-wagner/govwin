# CLAUDE.md — RFP Pipeline Portal Engineering Standards

## Project Overview
Multi-tenant SaaS platform for government contractors to discover, score, and build
proposals for federal opportunities (SBIR, STTR, BAA, OTA). AI agent workforce assists
at every lifecycle stage. See ARCHITECTURE_V5.md for full system design.

## Services
1. **Frontend** (Next.js 15): Portal UI + API routes → `frontend/`
2. **Pipeline** (Python 3.12): Ingestion, scoring, workers, agents → `pipeline/`
3. **CMS/CRM** (FastAPI): Dormant V1, placeholder → `services/cms/`

All services share one PostgreSQL database (govtech_intel) and one storage volume (/data).

## Roles
- `master_admin`: Full system access, migrations, Railway management
- `rfp_admin`: RFP triage/curation, customer onboarding, customer service
- `tenant_admin`: Manages their tenant, invites team, purchases proposals
- `tenant_user`: Access per admin grant (all proposals or per-proposal)
- `partner_user`: Stage-scoped access per proposal (view/comment/edit)

## SOP: Error Handling
- Server components: try-catch all DB queries, re-throw NEXT_REDIRECT, log with tagged prefix
- API routes: try-catch returning NextResponse.json with proper status codes, validate inputs first
- Client components: check res.ok, parse JSON safely, set error/loading states
- Database: validate DATABASE_URL at load, .on('error') handlers on pools
- Auth: try-catch around DB queries in authorize(), wrap non-critical updates separately

## SOP: Code Quality
- `npx tsc --noEmit` must pass — zero type errors
- No unhandled promises
- No console.log — use console.error for error logging only
- Return consistent shapes: `{ data: T }` success, `{ error: string }` failure
- Auth checks first, then input validation, then business logic
- Always verify tenant access before returning tenant-specific data
- Parameterize all SQL queries (postgres.js tagged templates)

## SOP: Security
- Never trust client input — validate and sanitize
- Never expose internal error details to client
- Row-Level Security on all tenant-scoped agent memory tables
- Agent tools enforce tenant_id — agents never construct SQL directly
- User content clearly delimited in agent prompts (prompt injection defense)

## Project Structure
See docs/IMPLEMENTATION_PLAN_V2.md for complete file tree.

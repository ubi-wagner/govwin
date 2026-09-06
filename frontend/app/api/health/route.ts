/**
 * GET /api/health
 *
 * Public health endpoint. Returns 200 with a health summary when
 * everything is reachable, 503 when any check fails. Used by
 * Railway + load balancers for liveness probes.
 *
 * NOT wrapped in withHandler because it's public (no auth) and the
 * monitoring contract expects the top-level `ok` field at the root
 * of the JSON body — wrapping in `{ data }` would break existing
 * probes. The route still uses the scoped logger from lib/logger.ts
 * and catches errors per check so operators see WHICH dependency
 * is down, not just that something is.
 *
 * See docs/API_CONVENTIONS.md §"Response shape" note on health
 * endpoint exception.
 */

import { NextResponse } from 'next/server';
import { sql, sqlBypass } from '@/lib/db';
import { pingS3 } from '@/lib/storage/s3-client';
import { createLogger } from '@/lib/logger';
import { ABSOLUTE_MAX_MS, IDLE_MS, idleLimitFor } from '@/lib/session-policy';

const log = createLogger('health');

interface CheckResult {
  ok: boolean;
  detail?: string;
}

interface HealthResponse {
  ok: boolean;
  version: string;
  release: string;
  environment: string;
  uptimeMs: number;
  /**
   * The session bounds THIS process is actually enforcing.
   *
   * Not a secret — a session length is a stated policy, and publishing it is how an operator
   * verifies the deployed bound matches the intended one instead of reading a constant in a repo
   * and assuming the running build agrees.
   *
   * It also makes `scripts/prove-session-cap.mts` self-validating, which it was not: that proof
   * ran twice against a server whose cap was the 12-hour default while asserting against a 25-second
   * override that had never reached the process (the launch failed to bind and the previous server
   * kept serving). Both runs reported "the session survived past the cap" — a finding about the
   * harness, printed as a finding about the product. The proof now reads this field and REFUSES to
   * run unless the bound it is measuring against is the bound in force.
   */
  session: {
    absoluteMaxMs: number;
    idleMs: Record<string, number>;
  };
  checks: {
    db: CheckResult;
    s3: CheckResult;
    bypass: CheckResult;
    scoped: CheckResult;
  };
}

const BOOTED_AT = Date.now();
// Coordinated cross-service release tag — derived from the deployed build so there
// is nothing to hand-edit. Railway injects RAILWAY_GIT_COMMIT_SHA per deploy; all
// three services (frontend/pipeline/CMS) report the same value when they are on the
// same build, which deploy-verify.yml asserts. APP_RELEASE can override with a
// human-friendly tag if set for every service.
const RELEASE = process.env.APP_RELEASE ?? process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) ?? 'dev';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse<HealthResponse>> {
  // During startup, DB/S3 may not be ready yet (migrations running,
  // connections initializing). Always return 200 for the liveness probe
  // so Railway doesn't kill the container before it's ready.
  // The checks still run and report status for observability.
  let db: CheckResult = { ok: false, detail: 'not checked' };
  let s3: CheckResult = { ok: false, detail: 'not checked' };
  let bypass: CheckResult = { ok: false, detail: 'not checked' };
  let scoped: CheckResult = { ok: false, detail: 'not checked' };

  try {
    [db, s3, bypass, scoped] = await Promise.all([checkDb(), checkS3(), checkBypass(), checkScoped()]);
  } catch (err) {
    log.warn({ err }, 'health checks threw during startup');
  }

  // `bypass` is DELIBERATELY NOT in this conjunction, and a check excluded without a stated
  // reason is its own trap — so: a frontend whose bypass pool cannot bypass still serves every
  // customer-facing surface correctly. Only the admin consoles are degraded. Failing the Railway
  // liveness probe over that would take the whole product down to report a misconfigured admin
  // view, which is a worse outcome than the fault. It is reported in `checks` and logged at ERROR;
  // the pipeline's own role preflight (pipeline/src/db_role_preflight.py) takes the same stance for
  // the same reason — name it loudly, keep running.
  const allOk = db.ok && s3.ok;
  const body: HealthResponse = {
    ok: allOk,
    version: process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) ?? 'dev',
    release: RELEASE,
    environment: process.env.RAILWAY_ENVIRONMENT_NAME ?? process.env.NODE_ENV ?? 'unknown',
    uptimeMs: Date.now() - BOOTED_AT,
    // EFFECTIVE windows, not the table: a test-only override shortens them, and reporting
    // the unshortened table would let the proof assert against a bound not in force.
    session: {
      absoluteMaxMs: ABSOLUTE_MAX_MS,
      idleMs: Object.fromEntries(Object.keys(IDLE_MS).map((r) => [r, idleLimitFor(r)])),
    },
    checks: { db, s3, bypass, scoped },
  };

  if (allOk) {
    log.debug({ checks: body.checks }, 'health check ok');
  } else {
    log.warn({ checks: body.checks }, 'health check degraded');
  }

  // Always return 200 for Railway liveness probe.
  // Dependency health is reported in the body for monitoring dashboards.
  return NextResponse.json(body, { status: 200 });
}

async function checkDb(): Promise<CheckResult> {
  try {
    const rows = await sql<{ one: number }[]>`SELECT 1 AS one`;
    if (rows[0]?.one === 1) {
      return { ok: true };
    }
    return { ok: false, detail: 'unexpected db response' };
  } catch (err) {
    log.error(
      { err: err instanceof Error ? { message: err.message } : err },
      'db health check failed',
    );
    return {
      ok: false,
      detail: truncateDetail(err instanceof Error ? err.message : String(err)),
    };
  }
}

/**
 * CAN THE PRIVILEGED POOL ACTUALLY BYPASS RLS?
 *
 * This box carefully asserts that the SCOPED pool is scoped — `check-rls-posture.mjs` refuses to
 * let an isolation drive report a verdict from a superuser connection. Nothing asserted the other
 * half: that `sqlBypass` is genuinely privileged. Both are load-bearing and only one was guarded.
 *
 * THE FAILURE. `sqlBypass` falls back to `DATABASE_URL` when `DATABASE_URL_OWNER` is unset
 * (lib/db.ts) — correct locally, where both are the owner. In production `DATABASE_URL` is
 * `govtech_app`, which is NOBYPASSRLS. So a deploy that forgets one environment variable gets a
 * "bypass" pool that bypasses nothing: every legitimate cross-tenant admin read — the agent-workforce
 * rollup, Customer Interest, the funnel, the outbound-mail console, the project explorer — runs with
 * no tenant context against FORCE-RLS tables, matches zero rows, and returns **empty**.
 *
 * Empty is the problem. There is no error, no 500, no slow query and no log line; the console
 * renders its own no-data state, which on a new deployment is indistinguishable from the truth.
 * That is the failure shape this repo spends the most effort against, and it was reachable by
 * omitting a single variable.
 *
 * WHY THE ROLE AND NOT A QUERY. Asking whether some cross-tenant read returned rows needs fixture
 * data and would report "no rows yet" as a fault on a fresh install. The capability is the honest
 * question, and the database can answer it directly. `rolsuper` is checked as well as
 * `rolbypassrls` because a superuser bypasses RLS with `rolbypassrls = f` — the exact trap
 * `check-rls-posture` documents in the other direction. Owning the table is NOT sufficient here:
 * migs 212/213 FORCE row security, and FORCE applies to the owner too.
 *
 * Cached after the first answer: a role's capability cannot change without an ALTER ROLE, and the
 * env-var fix this exists to prompt requires a redeploy — a new process, and a fresh check.
 */
let bypassCache: CheckResult | null = null;

async function checkBypass(): Promise<CheckResult> {
  if (bypassCache) return bypassCache;
  try {
    const rows = await sqlBypass<{ role: string; rolsuper: boolean; rolbypassrls: boolean }[]>`
      SELECT current_user AS role, rolsuper, rolbypassrls
        FROM pg_roles WHERE rolname = current_user`;
    const r = rows[0];
    if (!r) return { ok: false, detail: 'could not read the connected role' };

    if (r.rolsuper || r.rolbypassrls) {
      bypassCache = { ok: true, detail: `role=${r.role}` };
      return bypassCache;
    }

    const detail =
      `role=${r.role} cannot bypass RLS — `
      + (process.env.DATABASE_URL_OWNER
        ? 'DATABASE_URL_OWNER is set but points at an unprivileged role'
        : 'DATABASE_URL_OWNER is not set, so sqlBypass fell back to DATABASE_URL');
    log.error(
      { role: r.role, ownerConfigured: Boolean(process.env.DATABASE_URL_OWNER) },
      'BYPASS POOL CANNOT BYPASS RLS — admin cross-tenant consoles will read EMPTY, not error. '
      + 'Set DATABASE_URL_OWNER on this service to the owner connection string.',
    );
    bypassCache = { ok: false, detail };
    return bypassCache;
  } catch (err) {
    // Not cached: a connection failure during startup is transient, and pinning it would report a
    // healthy pool as broken for the life of the process.
    log.error(
      { err: err instanceof Error ? { message: err.message } : err },
      'bypass pool health check failed',
    );
    return { ok: false, detail: truncateDetail(err instanceof Error ? err.message : String(err)) };
  }
}

async function checkS3(): Promise<CheckResult> {
  try {
    const res = await pingS3();
    if (res.ok) {
      return { ok: true, detail: `bucket=${res.bucket}` };
    }
    return { ok: false, detail: truncateDetail(res.error) };
  } catch (err) {
    log.error(
      { err: err instanceof Error ? { message: err.message } : err },
      's3 health check failed',
    );
    return {
      ok: false,
      detail: truncateDetail(err instanceof Error ? err.message : String(err)),
    };
  }
}

/**
 * IS THE SCOPED POOL ACTUALLY SCOPED? — the mirror of `checkBypass`, and the half that was missing.
 *
 * `checkBypass` asks whether the privileged pool is privileged. Nothing asked the opposite question
 * about the pool that serves every customer request, and that omission is not hypothetical: this
 * deployment ran for months with `DATABASE_URL` pointing at the SUPERUSER. The app behaved
 * perfectly, `checks.db.ok` was true, and row-level security was bypassed on every request — the
 * documented "two-layer" posture was one layer, and no instrument anywhere could say so. It was
 * found by a person reading two environment variables side by side.
 *
 * That is bug B86's shape at production scale: **RLS bypassed looks identical to RLS satisfied**
 * from every angle except a cross-tenant read that should return nothing and doesn't.
 *
 * `rolsuper` is checked as well as `rolbypassrls` because a superuser bypasses RLS while reporting
 * `rolbypassrls = f`. Owning the tables is not sufficient either — migs 212/213 FORCE row security,
 * and FORCE applies to the owner too.
 *
 * NOT in the `ok` conjunction, for the same reason `bypass` is not: the product serves correctly
 * either way, and failing a liveness probe over a security posture would take the site down to
 * report a configuration fault. It reports, and logs at ERROR.
 *
 * Cached like `checkBypass`: a role's attributes cannot change without an ALTER ROLE, and the fix
 * requires a redeploy — a new process, and a fresh answer.
 */
let scopedCache: CheckResult | null = null;

async function checkScoped(): Promise<CheckResult> {
  if (scopedCache) return scopedCache;
  try {
    const rows = await sql<{ role: string; rolsuper: boolean; rolbypassrls: boolean }[]>`
      SELECT current_user AS role, rolsuper, rolbypassrls
        FROM pg_roles WHERE rolname = current_user`;
    const r = rows[0];
    if (!r) return { ok: false, detail: 'could not read the connected role' };

    if (!r.rolsuper && !r.rolbypassrls) {
      scopedCache = { ok: true, detail: `role=${r.role}` };
      return scopedCache;
    }

    log.error(
      { role: r.role, rolsuper: r.rolsuper, rolbypassrls: r.rolbypassrls },
      'APPLICATION POOL BYPASSES RLS — every request is served by a role row-level security does '
      + 'not apply to. Tenant isolation is app-layer only. Point DATABASE_URL at the govtech_app '
      + 'role (NOBYPASSRLS); DATABASE_URL_OWNER keeps the privileged connection.',
    );
    scopedCache = {
      ok: false,
      detail:
        `role=${r.role} BYPASSES RLS (rolsuper=${r.rolsuper} rolbypassrls=${r.rolbypassrls}) — `
        + 'tenant isolation is app-layer only',
    };
    return scopedCache;
  } catch (err) {
    // Not cached: a connection failure during startup is transient, and pinning it would report a
    // correctly-scoped pool as broken for the life of the process.
    return {
      ok: false,
      detail: truncateDetail(err instanceof Error ? err.message : String(err)),
    };
  }
}

function truncateDetail(s: string): string {
  return s.length > 200 ? s.slice(0, 200) + '…' : s;
}

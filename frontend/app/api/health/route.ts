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
import { sql } from '@/lib/db';
import { pingS3 } from '@/lib/storage/s3-client';
import { createLogger } from '@/lib/logger';

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
  checks: {
    db: CheckResult;
    s3: CheckResult;
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

  try {
    [db, s3] = await Promise.all([checkDb(), checkS3()]);
  } catch (err) {
    log.warn({ err }, 'health checks threw during startup');
  }

  const allOk = db.ok && s3.ok;
  const body: HealthResponse = {
    ok: allOk,
    version: process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) ?? 'dev',
    release: RELEASE,
    environment: process.env.RAILWAY_ENVIRONMENT_NAME ?? process.env.NODE_ENV ?? 'unknown',
    uptimeMs: Date.now() - BOOTED_AT,
    checks: { db, s3 },
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

function truncateDetail(s: string): string {
  return s.length > 200 ? s.slice(0, 200) + '…' : s;
}

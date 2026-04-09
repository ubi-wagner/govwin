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
  uptimeMs: number;
  checks: {
    db: CheckResult;
    s3: CheckResult;
  };
}

const BOOTED_AT = Date.now();

export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse<HealthResponse>> {
  const [db, s3] = await Promise.all([checkDb(), checkS3()]);
  const body: HealthResponse = {
    ok: db.ok && s3.ok,
    version: process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) ?? 'dev',
    uptimeMs: Date.now() - BOOTED_AT,
    checks: { db, s3 },
  };

  if (body.ok) {
    log.debug({ checks: body.checks }, 'health check ok');
  } else {
    log.warn({ checks: body.checks }, 'health check failing');
  }

  return NextResponse.json(body, { status: body.ok ? 200 : 503 });
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

import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { pingS3 } from '@/lib/storage/s3-client';

interface CheckResult {
  ok: boolean;
  detail?: string;
}

interface HealthResponse {
  ok: boolean;
  version: string;
  uptimeMs: number;
  db: CheckResult;
  s3: CheckResult;
}

const BOOTED_AT = Date.now();

export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse<HealthResponse>> {
  const [db, s3] = await Promise.all([checkDb(), checkS3()]);
  const body: HealthResponse = {
    ok: db.ok && s3.ok,
    version: process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) ?? 'dev',
    uptimeMs: Date.now() - BOOTED_AT,
    db,
    s3,
  };
  return NextResponse.json(body, { status: body.ok ? 200 : 503 });
}

async function checkDb(): Promise<CheckResult> {
  try {
    const rows = await sql<{ one: number }[]>`SELECT 1 AS one`;
    if (rows[0]?.one === 1) {
      return { ok: true };
    }
    return { ok: false, detail: 'unexpected result' };
  } catch (e) {
    return { ok: false, detail: truncateDetail(String(e)) };
  }
}

async function checkS3(): Promise<CheckResult> {
  const res = await pingS3();
  if (res.ok) {
    return { ok: true, detail: `bucket=${res.bucket}` };
  }
  return { ok: false, detail: truncateDetail(res.error) };
}

function truncateDetail(s: string): string {
  return s.length > 200 ? s.slice(0, 200) + '…' : s;
}

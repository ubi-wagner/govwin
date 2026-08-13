/**
 * POST /api/admin/scout-review/[findingId] — act on a scout candidate (#176). rfp_admin | master_admin.
 *
 * Body: { action: 'classify' | 'release_new' | 'release_update' | 'dismiss', ... }
 *   - classify        → (re)run the deterministic NEW-vs-UPDATE matcher; store the verdict.
 *   - release_new     → stage it into the RFP intake/curation queue (optional: title, agency,
 *                       solicitationNumber, programType, description overrides).
 *   - release_update  → log an amendment on the matched opportunity's solicitation
 *                       (optional: label, summary, severity).
 *   - dismiss         → mark it dismissed (optional: reason).
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import type { Role } from '@/lib/rbac';
import {
  classifyFinding,
  releaseAsNew,
  releaseAsUpdate,
  dismissCandidate,
} from '@/lib/scout/candidates';
import type { AmendmentSeverity } from '@/lib/amendments';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SEVERITIES = new Set(['critical', 'major', 'minor', 'info']);

interface Ctx {
  params: Promise<{ findingId: string }>;
}

export async function POST(request: Request, ctx: Ctx) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 });
    }
    const user = session.user as { id?: string; email?: string; role?: Role };
    if (user.role !== 'rfp_admin' && user.role !== 'master_admin') {
      return NextResponse.json({ error: 'rfp_admin or master_admin role required', code: 'FORBIDDEN' }, { status: 403 });
    }
    if (!user.id) {
      return NextResponse.json({ error: 'Missing user id', code: 'UNAUTHENTICATED' }, { status: 401 });
    }

    const { findingId } = await ctx.params;
    if (!UUID_RE.test(findingId)) {
      return NextResponse.json({ error: 'Invalid findingId', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    let body: Record<string, unknown>;
    try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON', code: 'VALIDATION_ERROR' }, { status: 400 }); }
    const action = typeof body.action === 'string' ? body.action : '';
    const actor = { actorId: user.id, actorEmail: user.email ?? null };

    const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

    if (action === 'classify') {
      const result = await classifyFinding(findingId, actor);
      if ('error' in result) return NextResponse.json({ error: result.error, code: 'NOT_FOUND' }, { status: 404 });
      return NextResponse.json({ data: result });
    }

    if (action === 'release_new') {
      const result = await releaseAsNew(findingId, actor, {
        title: str(body.title),
        agency: str(body.agency),
        solicitationNumber: str(body.solicitationNumber) ?? null,
        programType: str(body.programType) ?? null,
        description: str(body.description) ?? null,
      });
      if ('error' in result) {
        const code = result.error.includes('required') ? 'VALIDATION_ERROR' : 'CONFLICT';
        return NextResponse.json({ error: result.error, code }, { status: code === 'VALIDATION_ERROR' ? 400 : 409 });
      }
      return NextResponse.json({ data: { released: 'new', ...result } });
    }

    if (action === 'release_update') {
      const severity = str(body.severity);
      const result = await releaseAsUpdate(
        findingId,
        { ...actor, role: user.role },
        {
          label: str(body.label),
          summary: str(body.summary),
          severity: severity && SEVERITIES.has(severity) ? (severity as AmendmentSeverity) : undefined,
        },
      );
      if ('error' in result) return NextResponse.json({ error: result.error, code: 'CONFLICT' }, { status: 409 });
      return NextResponse.json({ data: { released: 'update', ...result } });
    }

    if (action === 'dismiss') {
      const result = await dismissCandidate(findingId, actor, str(body.reason));
      if (!result.dismissed) return NextResponse.json({ error: 'Already resolved or not found', code: 'CONFLICT' }, { status: 409 });
      return NextResponse.json({ data: result });
    }

    return NextResponse.json({ error: 'Unknown action', code: 'VALIDATION_ERROR' }, { status: 400 });
  } catch (err) {
    console.error('[admin/scout-review/[findingId]] error', err);
    return NextResponse.json({ error: 'Action failed', code: 'DB_ERROR' }, { status: 500 });
  }
}

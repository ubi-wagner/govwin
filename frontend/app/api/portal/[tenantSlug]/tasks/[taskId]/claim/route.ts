/**
 * POST   /api/portal/[tenantSlug]/tasks/[taskId]/claim   → take it (or renew your own)
 * DELETE /api/portal/[tenantSlug]/tasks/[taskId]/claim   → put it back
 *
 * ── WHAT A CLAIM IS FOR ──────────────────────────────────────────────────────────────────────
 * `tasks.status` has allowed 'in_progress' since the table was created and nothing ever wrote it,
 * so a ToDo was binary and the queue could not tell an item somebody had begun from one nobody had
 * touched. That costs most where the session bounds now bite: a session that ends ON TIME strands
 * more in-flight work than one that never ends (P1/P2), and without a claim the person who comes
 * back cannot tell which of their open items they had already started.
 *
 * ── NOT A LOCK ───────────────────────────────────────────────────────────────────────────────
 * A claim cannot block anyone: `completeTask` is untouched and still accepts any authorised
 * assignee. It expires on a sweep rather than waiting to be released, because what is being
 * protected is attention rather than correctness.
 *
 * Authority lives in `lib/tasks/tasks.ts` and is COPIED from `completeTask` — a claim that a wider
 * set of people could take than could finish would let someone park work they cannot do.
 */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { runInTenant } from '@/lib/tenant-context';
import { isRole, type Role } from '@/lib/rbac';
import { claimTask, releaseTask } from '@/lib/tasks/tasks';

type Ctx = { params: Promise<{ tenantSlug: string; taskId: string }> };

/**
 * Auth + tenant scope, shared by both verbs.
 *
 * `runInTenant` wraps the handler rather than `enterTenant` being called on its behalf:
 * `AsyncLocalStorage.enterWith` does not survive an `await` boundary back to the caller, so a gate
 * that entered for the route would have already lost the context by the time the route resumed —
 * RLS would then match nothing and this would answer a textbook envelope over an empty result.
 * That is how twenty project handlers once ran unscoped behind perfect 404s.
 */
async function gate(ctx: Ctx) {
  const { tenantSlug, taskId } = await ctx.params;
  const session = await auth();
  const u = session?.user as { id?: string; email?: string | null; role?: unknown } | undefined;
  if (!u?.id) {
    return { err: NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 }) };
  }
  const role: Role | null = isRole(u.role) ? u.role : null;
  if (!role) {
    return { err: NextResponse.json({ error: 'Invalid session', code: 'UNAUTHENTICATED' }, { status: 401 }) };
  }
  if (!/^[0-9a-f-]{36}$/i.test(taskId)) {
    return { err: NextResponse.json({ error: 'Invalid task id', code: 'INVALID_INPUT' }, { status: 400 }) };
  }
  let tenant;
  try {
    tenant = await getTenantBySlug(tenantSlug);
  } catch {
    return { err: NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 }) };
  }
  if (!tenant) {
    return { err: NextResponse.json({ error: 'Workspace not found', code: 'NOT_FOUND' }, { status: 404 }) };
  }
  const tenantId = tenant.id as string;
  if (!(await verifyTenantAccess(u.id, role, tenantId))) {
    return { err: NextResponse.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 }) };
  }
  return { taskId, tenantId, actor: { id: u.id, email: u.email ?? null, role, tenantId } };
}

export async function POST(_req: Request, ctx: Ctx) {
  try {
    const g = await gate(ctx);
    if ('err' in g) return g.err;
    const r = await runInTenant(g.tenantId, () => claimTask({ taskId: g.taskId, actor: g.actor }));
    if (!r.ok) return NextResponse.json({ error: r.error, code: r.code }, { status: r.status });
    return NextResponse.json({ data: r.data });
  } catch (e) {
    console.error('[tasks/claim] POST failed:', e);
    return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const g = await gate(ctx);
    if ('err' in g) return g.err;
    const r = await runInTenant(g.tenantId, () => releaseTask({ taskId: g.taskId, actor: g.actor }));
    if (!r.ok) return NextResponse.json({ error: r.error, code: r.code }, { status: r.status });
    return NextResponse.json({ data: r.data });
  } catch (e) {
    console.error('[tasks/claim] DELETE failed:', e);
    return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
  }
}

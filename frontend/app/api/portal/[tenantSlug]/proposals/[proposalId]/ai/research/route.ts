/**
 * POST /api/portal/[tenantSlug]/proposals/[proposalId]/ai/research  — queue an R&D research task.
 * GET  …/ai/research?taskId=…                                        — poll the result.
 *
 * Enqueues a `research_scout` agent task (market research / prior art / competitor landscape,
 * incl. DoD sources) grounded on the opportunity context. The agent runs in the pipeline —
 * tenant-bound, web results injection-fenced, budget/rate/cost-capped, human-gated. Findings
 * come back as an advisory brief the customer reviews and can add to the library.
 */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql, getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { emitEventSingle, userActor } from '@/lib/events';
import { requestAgentTask, getAgentTaskResult } from '@/lib/agent-client';

type RouteContext = { params: Promise<{ tenantSlug: string; proposalId: string }> };

async function authTenant(tenantSlug: string) {
  const session = await auth();
  if (!session?.user) return { err: NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 }) };
  const u = session.user as { id?: string; email?: string; role?: unknown };
  const role: Role | null = isRole(u.role) ? u.role : null;
  if (!role || !u.id) return { err: NextResponse.json({ error: 'Invalid session', code: 'UNAUTHENTICATED' }, { status: 401 }) };
  if (!hasRoleAtLeast(role, 'tenant_user')) return { err: NextResponse.json({ error: 'Insufficient permissions', code: 'FORBIDDEN' }, { status: 403 }) };
  const tenant = await getTenantBySlug(tenantSlug);
  if (!tenant) return { err: NextResponse.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, { status: 404 }) };
  const tenantId = tenant.id as string;
  if (!(await verifyTenantAccess(u.id, role, tenantId))) return { err: NextResponse.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 }) };
  return { u, role, tenantId };
}

export async function POST(request: Request, ctx: RouteContext) {
  try {
    const { tenantSlug, proposalId } = await ctx.params;
    const a = await authTenant(tenantSlug);
    if (a.err) return a.err;
    const { u, tenantId } = a;

    let body: { question?: string; sectionId?: string };
    try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON body', code: 'VALIDATION_ERROR' }, { status: 400 }); }
    const question = (body.question ?? '').toString().trim().slice(0, 2000);
    if (!question) return NextResponse.json({ error: 'A research question is required', code: 'VALIDATION_ERROR' }, { status: 422 });

    // Opportunity context (trusted) — agency/program for grounding.
    const [proposal] = await sql<{ id: string; title: string; agency: string | null; program: string | null }[]>`
      SELECT p.id, p.title, o.agency, o.program_type AS program
      FROM proposals p LEFT JOIN opportunities o ON o.id = p.opportunity_id
      WHERE p.id = ${proposalId} AND p.tenant_id = ${tenantId}::uuid`;
    if (!proposal) return NextResponse.json({ error: 'Proposal not found', code: 'NOT_FOUND' }, { status: 404 });

    const taskId = await requestAgentTask({
      tenantId, agentRole: 'research_scout', taskType: 'research',
      input: { proposal_id: proposalId, question, agency: proposal.agency ?? '', program: proposal.program ?? '' },
      proposalId, sectionId: body.sectionId,
    });
    if (!taskId) return NextResponse.json({ error: 'Could not queue the research task', code: 'DB_ERROR' }, { status: 500 });

    await emitEventSingle({
      namespace: 'proposal', type: 'proposal.research_requested',
      actor: userActor(u!.id!, u!.email ?? undefined), tenantId,
      payload: { proposalId, taskId, question },
    });

    return NextResponse.json({ data: { taskId, status: 'queued', note: 'Research queued — the scout browses the web (incl. DoD sources), fences the results, and returns a cited brief for your review.' } });
  } catch (err) {
    console.error('[ai/research] POST error', err);
    return NextResponse.json({ error: 'Research request failed', code: 'DB_ERROR' }, { status: 500 });
  }
}

export async function GET(request: Request, ctx: RouteContext) {
  try {
    const { tenantSlug } = await ctx.params;
    const a = await authTenant(tenantSlug);
    if (a.err) return a.err;
    const taskId = new URL(request.url).searchParams.get('taskId');
    if (!taskId) return NextResponse.json({ error: 'taskId is required', code: 'VALIDATION_ERROR' }, { status: 400 });

    // agent_task_results carries the agent output in `output` (jsonb); a row existing = done.
    const row = await getAgentTaskResult(taskId) as { output?: unknown } | null;
    if (!row) return NextResponse.json({ data: { taskId, status: 'running' } });
    // Unwrap the fabric result wrapper ({status,text,…}) to the brief the agent produced.
    let brief: unknown = row.output;
    const o = row.output as Record<string, unknown> | null;
    if (o && typeof o === 'object') {
      const t = o.text ?? o.result ?? o.output;
      if (typeof t === 'string') { try { brief = JSON.parse(t); } catch { brief = { summary: t }; } }
      else if (t && typeof t === 'object') brief = t;
    }
    return NextResponse.json({ data: { taskId, status: 'complete', result: brief } });
  } catch (err) {
    console.error('[ai/research] GET error', err);
    return NextResponse.json({ error: 'Could not read the research result', code: 'DB_ERROR' }, { status: 500 });
  }
}

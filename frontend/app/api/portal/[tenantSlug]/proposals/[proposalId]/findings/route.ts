/**
 * GET /api/portal/[t]/proposals/[p]/findings?level=&nodeId=&groupId=&sectionId=&pages=a-b
 *
 * THE GATE'S LIVE CHECKLIST — what colour-team review is still outstanding, and about what.
 *
 * Every gate in the product is pass/fail. This is the read that lets one say "four of six findings
 * are resolved, and the two that are not are about Figure 2 and pages 3–5" — which is the whole
 * difference between a boolean and a checklist a team can work down.
 *
 * No new storage: a finding IS a `proposal_comments` row with `recommendation_type='ai_review'`,
 * carrying `resolved` from the start and, since mig 207, the scope the reviewer was aimed at.
 * Resolving one is the EXISTING route (`…/comments/[id]/resolve`), which already enforces
 * section-level access — so a collaborator can only resolve inside what they can reach, and that
 * gate needed no change here.
 *
 * ADVISORY. This route reports; it never advances a stage, locks, or submits. `severity` is
 * hard-coded 'warning' in the checklist for the same reason.
 *
 * Auth: any tenant member with visibility of the proposal. Findings are filtered to the sections
 * the actor can actually reach — a scoped partner asking for the document scope gets THEIR document,
 * not the tenant's.
 *
 * Returns: { data: { checklist, findings } } | { error, code }
 */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql, getTenantBySlug, verifyTenantAccess, enterTenant } from '@/lib/db';
import { isRole, type Role } from '@/lib/rbac';
import { isValidUUID } from '@/lib/validation';
import { resolveUserAccess, hasProposalVisibility } from '@/lib/proposal-access';
import { readFindings, findingsInScope, checklistFor, type ScopeQuery } from '@/lib/proposal/scoped-findings';
import type { ScopeLevel } from '@/lib/canvas/scope';

interface Ctx { params: Promise<{ tenantSlug: string; proposalId: string }> }

const LEVELS: ReadonlyArray<ScopeLevel> = ['node', 'group', 'section', 'pages', 'document'];

const cleanId = (v: string | null): string | undefined =>
  v && v.trim() && v.length <= 200 ? v.trim() : undefined;

export async function GET(request: Request, ctx: Ctx) {
  try {
    const { tenantSlug, proposalId } = await ctx.params;
    if (!isValidUUID(proposalId)) {
      return NextResponse.json({ error: 'Invalid proposal ID', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 });
    }
    const u = session.user as { id?: string; role?: unknown };
    const role: Role | null = isRole(u.role) ? u.role : null;
    if (!role || !u.id) {
      return NextResponse.json({ error: 'Invalid session', code: 'UNAUTHENTICATED' }, { status: 401 });
    }

    const tenant = await getTenantBySlug(tenantSlug);
    if (!tenant) return NextResponse.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, { status: 404 });
    const tenantId = tenant.id as string;
    if (!(await verifyTenantAccess(u.id, role, tenantId))) {
      return NextResponse.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 });
    }
    enterTenant(tenantId);

    // Never trust the id alone.
    let exists: { id: string }[];
    try {
      exists = await sql`SELECT id FROM proposals WHERE id = ${proposalId}::uuid AND tenant_id = ${tenantId}::uuid LIMIT 1`;
    } catch (e) {
      console.error('[findings] proposal check failed', e);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }
    if (!exists.length) {
      return NextResponse.json({ error: 'Proposal not found', code: 'NOT_FOUND' }, { status: 404 });
    }
    // Resolved ONCE and reused: `hasProposalVisibility` takes the resolved access object, and the
    // section belt below needs the same object. Calling `resolveUserAccess` twice would be two
    // reads that could disagree under a concurrent grant change.
    const access = await resolveUserAccess(u.id, proposalId, tenantId);
    if (!hasProposalVisibility(access)) {
      return NextResponse.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 });
    }

    const url = new URL(request.url);
    const rawLevel = url.searchParams.get('level');
    const level: ScopeLevel = (LEVELS as readonly string[]).includes(String(rawLevel))
      ? (rawLevel as ScopeLevel) : 'document';

    const q: ScopeQuery = { level };
    const nodeId = cleanId(url.searchParams.get('nodeId'));
    const groupId = cleanId(url.searchParams.get('groupId'));
    const sectionId = cleanId(url.searchParams.get('sectionId'));
    if (nodeId) q.nodeIds = [nodeId];
    if (groupId) q.groupIds = [groupId];
    if (sectionId) q.sectionIds = [sectionId];

    const pages = url.searchParams.get('pages');
    if (pages) {
      const m = /^(\d{1,4})-(\d{1,4})$/.exec(pages.trim());
      if (!m) {
        return NextResponse.json({ error: 'pages must look like 3-5', code: 'VALIDATION_ERROR' }, { status: 400 });
      }
      const start = Number(m[1]); const end = Number(m[2]);
      if (start < 1 || end < start) {
        return NextResponse.json({ error: 'Invalid page range', code: 'VALIDATION_ERROR' }, { status: 400 });
      }
      q.pages = { start, end };
    }

    let findings = await readFindings(proposalId);

    // ── THE ACCESS BELT ─────────────────────────────────────────────────────────────────────────
    // RLS scopes this to the tenant; it does NOT scope it to the sections a partner_user was
    // granted. A scoped collaborator asking for `level=document` would otherwise read every finding
    // on the proposal — including the ones on sections they cannot open. Same belt the comments
    // route wears, and load-bearing for the same reason: RLS will not catch it.
    // `role === 'external'` is the scoped collaborator; admin/contributor see the whole proposal by
    // design (that is what `hasProposalVisibility` just decided). Keyed on the RESOLVED role, not on
    // the session role, so a tenant_user who is only a per-proposal contributor is not narrowed by
    // accident and a partner_user cannot widen by holding a high session role elsewhere.
    if (access.role === 'external') {
      const reachable = new Set([
        ...access.viewableSections, ...access.commentableSections, ...access.editableSections,
      ]);
      findings = findings.filter((f) => !!f.sectionId && reachable.has(f.sectionId));
    }

    const inScope = findingsInScope(findings, q);
    return NextResponse.json({
      data: {
        scope: { level, ...(nodeId ? { nodeId } : {}), ...(groupId ? { groupId } : {}),
                 ...(sectionId ? { sectionId } : {}), ...(q.pages ? { pages: q.pages } : {}) },
        checklist: checklistFor(findings, q),
        findings: inScope.map((f) => ({
          id: f.id, sectionId: f.sectionId, sectionTitle: f.sectionTitle,
          resolved: f.resolved, createdAt: f.createdAt,
          scopeLevel: f.scopeLevel, scopeLabel: f.scopeLabel, excerpt: f.excerpt,
        })),
      },
    });
  } catch (e) {
    console.error('[findings] error', e);
    return NextResponse.json({ error: 'Could not read findings', code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}

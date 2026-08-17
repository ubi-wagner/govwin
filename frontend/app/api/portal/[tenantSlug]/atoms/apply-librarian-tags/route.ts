/**
 * POST /api/portal/[tenantSlug]/atoms/apply-librarian-tags
 *
 * Apply the pipeline librarian's PROPOSED taxonomy for one atom (#5 — the librarian half).
 * The librarian emits a `vol`, `kind`, and `suggested_tags` per atom, but until now the
 * frontend parser dropped them, so a `retag` recommendation could be read but never acted on.
 * This reads the latest persisted librarian catalog, finds the assessment for `atomId`, and
 * writes its vol/kind/suggested tags as UNCONFIRMED atom_tags (a human still confirms in the
 * Library). Advisory → never auto-approves; the tag write is idempotent (ON CONFLICT upsert).
 *
 * Body: { atomId: string }.  Auth: tenant_user+ WITH tenant access (library curation).
 */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql, getTenantBySlug, verifyTenantAccess, enterTenant } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { isValidUUID } from '@/lib/validation';
import { parseLibrarianCatalog } from '@/lib/atom-review';
import { confirmTags, type AtomTagInput } from '@/lib/atoms';
import { emitEventSingle, userActor } from '@/lib/events';

export async function POST(request: Request, { params }: { params: Promise<{ tenantSlug: string }> }) {
  try {
    const { tenantSlug } = await params;
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 });
    }
    const u = session.user as { id?: string; email?: string; role?: unknown };
    const role: Role | null = isRole(u.role) ? u.role : null;
    if (!role || !u.id) {
      return NextResponse.json({ error: 'Invalid session', code: 'UNAUTHENTICATED' }, { status: 401 });
    }
    if (!hasRoleAtLeast(role, 'tenant_user')) {
      return NextResponse.json({ error: 'Insufficient permissions', code: 'FORBIDDEN' }, { status: 403 });
    }

    let body: { atomId?: unknown };
    try { body = await request.json(); } catch {
      return NextResponse.json({ error: 'Invalid JSON body', code: 'VALIDATION_ERROR' }, { status: 400 });
    }
    const atomId = typeof body.atomId === 'string' ? body.atomId : '';
    if (!isValidUUID(atomId)) {
      return NextResponse.json({ error: 'atomId is required', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    const tenant = await getTenantBySlug(tenantSlug);
    if (!tenant) {
      return NextResponse.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, { status: 404 });
    }
    const tenantId = tenant.id as string;
    if (!(await verifyTenantAccess(u.id, role, tenantId))) {
      return NextResponse.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 });
    }
    enterTenant(tenantId);

    // Load the latest persisted librarian catalog + the tenant's real atoms (for validation).
    let rawText: string | null = null;
    let generatedAt = '';
    const validAtoms = new Map<string, string | null>();
    try {
      const atomRows = await sql<Array<{ id: string; title: string | null }>>`
        SELECT id, title FROM library_atoms
        WHERE tenant_id = ${tenantId}::uuid AND archived_at IS NULL AND vault_id IS NULL`;
      for (const r of atomRows) validAtoms.set(r.id, r.title);

      const lrRows = await sql<Array<{ output: unknown; createdAt: Date | string | null }>>`
        SELECT r.output, r.created_at
        FROM agent_task_results r
        JOIN agent_task_queue q ON q.id = r.task_id
        WHERE q.tenant_id = ${tenantId}::uuid
          AND q.agent_role = 'librarian' AND q.task_type = 'catalog' AND q.status = 'completed'
        ORDER BY r.created_at DESC
        LIMIT 1`;
      const lr = lrRows[0];
      if (lr?.output) {
        const out = lr.output as { result?: { text?: unknown } };
        rawText = typeof out?.result?.text === 'string' ? out.result.text : null;
        const d = lr.createdAt instanceof Date ? lr.createdAt : new Date(lr.createdAt ?? NaN);
        generatedAt = Number.isNaN(d.getTime()) ? '' : d.toISOString();
      }
    } catch (e) {
      console.error('[apply-librarian-tags] catalog load failed', e);
      return NextResponse.json({ error: 'Failed to load the librarian catalog', code: 'DB_ERROR' }, { status: 500 });
    }

    if (!validAtoms.has(atomId)) {
      return NextResponse.json({ error: 'Atom not found', code: 'NOT_FOUND' }, { status: 404 });
    }

    const catalog = parseLibrarianCatalog(rawText, validAtoms, generatedAt);
    const assessment = catalog?.assessments.find((a) => a.atomId === atomId) ?? null;
    if (!assessment) {
      return NextResponse.json({ data: { applied: 0, atomId, reason: 'no_suggestion' } });
    }

    // Build the proposed tags — vol, kind, and the librarian's dimension:value suggestions — all
    // UNCONFIRMED machine guesses (a human confirms in the Library). Deduped by dimension:value.
    const seen = new Set<string>();
    const tags: AtomTagInput[] = [];
    const push = (dimension: string, value: string) => {
      const key = `${dimension}:${value}`;
      if (!dimension || !value || seen.has(key)) return;
      seen.add(key);
      tags.push({ dimension, value, source: 'auto', confirmed: false });
    };
    if (assessment.vol) push('vol', assessment.vol);
    if (assessment.kind) push('kind', assessment.kind);
    for (const t of assessment.suggestedTags) push(t.dimension, t.value);

    if (tags.length === 0) {
      return NextResponse.json({ data: { applied: 0, atomId, reason: 'no_tags' } });
    }

    let applied = 0;
    try {
      ({ updated: applied } = await confirmTags(tenantId, atomId, tags, u.id));
    } catch (e) {
      console.error('[apply-librarian-tags] tag write failed', e);
      return NextResponse.json({ error: 'Failed to apply tags', code: 'DB_ERROR' }, { status: 500 });
    }

    if (applied > 0) {
      try {
        await emitEventSingle({
          namespace: 'library',
          type: 'atom.retagged',
          actor: userActor(u.id, u.email ?? undefined),
          tenantId,
          payload: { atomId, applied, source: 'librarian', tags: tags.map((t) => `${t.dimension}:${t.value}`) },
        });
      } catch (e) {
        console.error('[apply-librarian-tags] event emit failed (non-fatal)', e);
      }
    }

    return NextResponse.json({ data: { applied, atomId } });
  } catch (err) {
    console.error('[apply-librarian-tags] error', err);
    return NextResponse.json({ error: 'Failed to apply librarian tags', code: 'DB_ERROR' }, { status: 500 });
  }
}

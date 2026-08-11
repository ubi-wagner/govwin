/**
 * POST /api/portal/[tenantSlug]/atoms/atomize-package  (multipart: files[], context?, packageName?)
 *
 * The value-prop intake: upload a COMPLETED proposal package (a set of docs) and
 * AUTO-atomize the whole thing into the canonical library (`library_atoms`), so its
 * content is immediately reusable — and context-ranked — for the next proposal.
 * Thin wrapper over `lib/atomize-package` (the drivable core); tenant-isolated via
 * verifyTenantAccess + RLS (withTenant) on every write.
 */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { atomizeDocumentIntoLibrary, planDocumentAtomization, contextTags, MAX_FILES, MAX_FILE_BYTES } from '@/lib/atomize-package';
import type { CreatorKind } from '@/lib/atoms';
import { emitEventSingle, userActor } from '@/lib/events';
import { requestAgentTask } from '@/lib/agent-client';

export async function POST(request: Request, { params }: { params: Promise<{ tenantSlug: string }> }) {
  try {
    const { tenantSlug } = await params;
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 });
    const u = session.user as { id?: string; email?: string; role?: unknown };
    const role: Role | null = isRole(u.role) ? u.role : null;
    if (!role || !u.id) return NextResponse.json({ error: 'Invalid session', code: 'UNAUTHENTICATED' }, { status: 401 });
    // Collaborators (partner_user) may atomize too — this is how they OFFER content
    // UP to the company (atoms are 'collaborator'-sourced + draft for the company to
    // review). verifyTenantAccess below still requires a real membership at THIS
    // company, so a collaborator can only offer into a company they belong to.
    if (!hasRoleAtLeast(role, 'partner_user')) return NextResponse.json({ error: 'Insufficient permissions', code: 'FORBIDDEN' }, { status: 403 });
    const tenant = await getTenantBySlug(tenantSlug);
    if (!tenant) return NextResponse.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, { status: 404 });
    const tenantId = tenant.id as string;
    if (!(await verifyTenantAccess(u.id, role, tenantId))) return NextResponse.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 });
    const actorKind: CreatorKind = hasRoleAtLeast(role, 'tenant_admin') || role === 'rfp_admin' || role === 'master_admin' ? 'admin' : 'collaborator';

    let form: FormData;
    try { form = await request.formData(); } catch { return NextResponse.json({ error: 'Expected multipart form-data', code: 'VALIDATION_ERROR' }, { status: 400 }); }
    const files = form.getAll('files').filter((f): f is File => f instanceof File);
    if (files.length === 0) return NextResponse.json({ error: 'at least one file is required', code: 'VALIDATION_ERROR' }, { status: 400 });
    if (files.length > MAX_FILES) return NextResponse.json({ error: `too many files (max ${MAX_FILES})`, code: 'VALIDATION_ERROR' }, { status: 400 });

    let ctx: Record<string, string | undefined> = {};
    const rawCtx = form.get('context');
    if (typeof rawCtx === 'string' && rawCtx.trim()) {
      try { ctx = JSON.parse(rawCtx); } catch { /* ignore malformed context */ }
    }
    const packageName = (typeof form.get('packageName') === 'string' ? String(form.get('packageName')) : '').trim();
    const ctxTags = contextTags(ctx);
    const actor = { id: u.id, kind: actorKind };

    // Dry-run preview: parse + segment and return EXACTLY what a real run would create,
    // WITHOUT writing anything (no atoms, no cocoon, no events, no librarian enqueue). The
    // "Add content" card shows this so the user confirms before the library is written.
    if (form.get('preview') === '1' || form.get('preview') === 'true') {
      const previewed = [];
      let totalPlanned = 0;
      for (const file of files) {
        if (file.size > MAX_FILE_BYTES) { previewed.push({ file: file.name, format: '', planned: [], skipped: 0, error: 'file too large (25MB max)' }); continue; }
        const buffer = Buffer.from(await file.arrayBuffer());
        const plan = await planDocumentAtomization({ buffer, filename: file.name, ctxTags });
        totalPlanned += plan.planned.length;
        previewed.push({ file: plan.file, format: plan.format, planned: plan.planned.map((p) => ({ title: p.title, wordCount: p.wordCount })), skipped: plan.skipped, error: plan.error });
      }
      return NextResponse.json({ data: { preview: true, filesProcessed: previewed.length, totalPlanned, context: ctxTags.map((t) => `${t.dimension}:${t.value}`), docs: previewed } });
    }

    const docs = [];
    let totalAtoms = 0;
    for (const file of files) {
      if (file.size > MAX_FILE_BYTES) { docs.push({ file: file.name, format: '', atoms: 0, cocoonId: null, error: 'file too large (25MB max)' }); continue; }
      const buffer = Buffer.from(await file.arrayBuffer());
      const r = await atomizeDocumentIntoLibrary(tenantId, { buffer, filename: file.name, packageName, ctxTags, actor });
      totalAtoms += r.atoms;
      docs.push(r);
    }

    await emitEventSingle({
      namespace: 'library',
      type: 'package.atomized',
      actor: userActor(u.id, u.email ?? undefined),
      tenantId,
      payload: { filesProcessed: docs.length, totalAtoms },
    });

    // Producer (#117): hand each atomized package to the librarian agent to catalog —
    // confirm tags, score quality/relevance, flag duplicates, assess freshness. The
    // pipeline's process_task_queue picks it up (runs live with the deploy key).
    // Best-effort — never fail the upload on an enqueue error.
    for (const r of docs) {
      if (!r.cocoonId || r.atoms === 0) continue;
      try {
        await requestAgentTask({
          tenantId,
          agentRole: 'librarian',
          taskType: 'catalog',
          input: { cocoonId: r.cocoonId, packageName: packageName || r.file, atomCount: r.atoms },
        });
      } catch (e) { console.error('[atomize-package] librarian enqueue failed (non-fatal)', e); }
    }

    return NextResponse.json({
      data: {
        packageName: packageName || null,
        filesProcessed: docs.length,
        totalAtoms,
        context: ctxTags.map((t) => `${t.dimension}:${t.value}`),
        docs,
      },
    });
  } catch (err) {
    console.error('[atomize-package] error', err);
    return NextResponse.json({ error: 'Package atomization failed', code: 'DB_ERROR' }, { status: 500 });
  }
}

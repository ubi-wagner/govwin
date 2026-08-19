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
import { getTenantBySlug, verifyTenantAccess, enterTenant, sql } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { atomizeDocumentIntoLibrary, planDocumentAtomization, contextTags, MAX_FILES, MAX_FILE_BYTES } from '@/lib/atomize-package';
import { classifyDsipSidecar } from '@/lib/library/dsip-deconstruct';
import type { CreatorKind } from '@/lib/atoms';
import { emitEventStart, emitEventEnd, emitEventSingle, userActor } from '@/lib/events';
import { requestAgentTask } from '@/lib/agent-client';

export async function POST(request: Request, { params }: { params: Promise<{ tenantSlug: string }> }) {
  // Hoisted so the outer catch can close the process bracket (never a dangling start).
  let startId: string | null = null;
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
    // RLS choke point: pin tenant context in THIS handler's own frame. verifyTenantAccess enters
    // the context in ITS frame, and context does not flow child→parent — so without this line the
    // handler's own reads run with no `app.tenant_id`. Under the govtech_app (NOBYPASSRLS) role
    // that is not a no-op: proven live, the `document_cocoons` bind below returned 0 rows for a
    // cocoon the tenant genuinely owns → 404 "attachToCocoonId is not one of your past proposals"
    // on every DSIP sidecar attach, and the `requestAgentTask` librarian enqueue further down
    // raised 42501 (RLS policy violation) which its own try/catch swallowed as `null` — so the
    // librarian was NEVER queued from this route.
    enterTenant(tenantId);
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
    // 'past_proposal' declares a complete DSIP proposal download → the plan segments it into
    // Volume 1..5 foundation documents under one cocoon (the shared past-proposal UUID).
    const docType = typeof ctx.docType === 'string' ? ctx.docType : null;
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
        const plan = await planDocumentAtomization({ buffer, filename: file.name, ctxTags, docType });
        totalPlanned += plan.planned.length;
        previewed.push({
          file: plan.file, format: plan.format,
          planned: plan.planned.map((p) => ({ title: p.title, wordCount: p.wordCount, volumeNumber: p.volumeNumber })),
          skipped: plan.skipped, error: plan.error, unextractable: plan.unextractable,
          // The running header/footer removed from every page before atomizing. Shown so the
          // curator confirms what left the text, rather than lines disappearing invisibly — and
          // so a mis-detection is visible BEFORE the library is written.
          strippedFurniture: plan.strippedFurniture,
          dsip: plan.dsip ? { volumes: plan.dsip.volumes.map((v) => ({ volume: v.volumeNumber, name: v.volumeName, words: v.wordCount, blocks: v.blockCount })) } : undefined,
        });
      }
      return NextResponse.json({ data: { preview: true, filesProcessed: previewed.length, totalPlanned, context: ctxTags.map((t) => `${t.dimension}:${t.value}`), docs: previewed } });
    }

    // Full start/end pattern (docs/EVENT_CONTRACT.md): the package atomization is a
    // multi-step PROCESS — bracket it; per-file deconstructs audit as intrastep singles;
    // the librarian hop rides agent_task_queue (terminal-phase consumers are unaffected).
    startId = await emitEventStart({
      namespace: 'library', type: 'package.atomized',
      actor: userActor(u.id, u.email ?? undefined), tenantId,
      payload: { files: files.length, packageName: packageName || null, docType: docType ?? null },
    });

    // DSIP package ordering: the merged Full_Proposal goes FIRST so its cocoon becomes the
    // shared past-proposal UUID; every filename-classified sidecar then JOINS that cocoon
    // with its deterministic volume tag (SBC→V1, Budget/Addt_Cost→V3, CCR→V4, certs→V5,
    // FWA→V6) instead of minting its own package.
    const isDsipPackage = (docType ?? '').toLowerCase() === 'past_proposal';
    const ordered = isDsipPackage
      ? [...files].sort((a, b) => Number(/full_proposal/i.test(b.name)) - Number(/full_proposal/i.test(a.name)))
      : files;
    // Sidecars for an ALREADY-ingested proposal (no Full_Proposal in this batch): the
    // uploader names the existing package cocoon and every file JOINS it volume-tagged.
    let packageCocoonId: string | null = null;
    const attachTo = typeof ctx.attachToCocoonId === 'string' && /^[0-9a-f-]{36}$/i.test(ctx.attachToCocoonId) ? ctx.attachToCocoonId : null;
    if (isDsipPackage && attachTo) {
      const [own] = await sql<{ id: string }[]>`
        SELECT id FROM document_cocoons WHERE id = ${attachTo}::uuid AND tenant_id = ${tenantId}::uuid LIMIT 1`;
      if (!own) return NextResponse.json({ error: 'attachToCocoonId is not one of your past proposals', code: 'NOT_FOUND' }, { status: 404 });
      packageCocoonId = own.id;
    }

    const docs = [];
    let totalAtoms = 0;
    for (const file of ordered) {
      if (file.size > MAX_FILE_BYTES) { docs.push({ file: file.name, format: '', atoms: 0, cocoonId: null, error: 'file too large (25MB max)' }); continue; }
      const buffer = Buffer.from(await file.arrayBuffer());
      const volHint = isDsipPackage ? classifyDsipSidecar(file.name) : null;
      const r = await atomizeDocumentIntoLibrary(tenantId, {
        buffer, filename: file.name, packageName, ctxTags, actor, docType,
        sharedCocoonId: isDsipPackage ? packageCocoonId : null,
        volHint,
      });
      if (isDsipPackage && !packageCocoonId && r.cocoonId) packageCocoonId = r.cocoonId;
      totalAtoms += r.atoms;
      docs.push(r);
    }

    // Audit the deconstruct distinctly — a full past proposal entering the library as
    // per-volume foundation docs is a different act than a plain package upload.
    for (const r of docs) {
      if (!r.volumes || !r.cocoonId) continue;
      try {
        await emitEventSingle({
          namespace: 'library',
          type: 'past_proposal.deconstructed',
          actor: userActor(u.id, u.email ?? undefined),
          tenantId,
          payload: { cocoonId: r.cocoonId, file: r.file, volumes: r.volumes, atoms: r.atoms },
        });
      } catch (e) { console.error('[atomize-package] deconstruct event failed (non-fatal)', e); }
    }

    await emitEventEnd(startId, {
      result: {
        filesProcessed: docs.length, totalAtoms,
        cocoonIds: docs.map((d) => d.cocoonId).filter(Boolean),
        volumes: docs.reduce((n, d) => n + (d.volumes ?? 0), 0),
      },
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
    if (startId) {
      try { await emitEventEnd(startId, { error: { message: 'package atomization failed', code: 'DB_ERROR' } }); } catch { /* never dangle */ }
    }
    return NextResponse.json({ error: 'Package atomization failed', code: 'DB_ERROR' }, { status: 500 });
  }
}

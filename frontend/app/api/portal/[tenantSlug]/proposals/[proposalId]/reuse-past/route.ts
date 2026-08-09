/**
 * POST /api/portal/[tenantSlug]/proposals/[proposalId]/reuse-past
 *
 * DIRECT, verbatim reuse of an uploaded past proposal into this build. Distinct from the AI
 * draft (which rewrites) and from the AI-mapper seed-job (which needs a BUILT source proposal):
 * this pulls an uploaded past proposal's atoms (`document_cocoons` source='upload' → `library_atoms`
 * by cocoon_id) straight into the build's matching EMPTY sections, verbatim, marked as reuse
 * (red-italic reuse_marker). For "use my winning boilerplate as-is."
 *
 * Section matching is by normalized title. Only EMPTY sections are written (never clobbers work);
 * matched-but-non-empty sections and unmatched sections are reported back. The write follows the
 * canvas_versions CAS invariant like the save/restore routes (archive the current empty content,
 * write the reused content, advance the version under compare-and-swap). Idempotent + locked-safe.
 *
 * Auth: tenant_admin+ (own tenant, verified). Body: { cocoonId: string }.
 * Returns: { data: { applied, sections, skippedNonEmpty, unmatched, scanned } } | { error, code }.
 */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql, getTenantBySlug, verifyProposalAccess, enterTenant } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { isValidUUID } from '@/lib/validation';
import { coerceJsonb } from '@/lib/jsonb';
import { emitEventSingle, userActor } from '@/lib/events';
import { randomUUID } from 'crypto';
import { createEmptyCanvas, CANVAS_PRESETS, type CanvasNode } from '@/lib/types/canvas-document';

const norm = (s: string | null | undefined) => (s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function isEmptyContent(content: string | null): boolean {
  if (!content) return true;
  try {
    const parsed = JSON.parse(content);
    const nodes: unknown[] = parsed.nodes ?? (Array.isArray(parsed) ? parsed : []);
    return nodes.length === 0;
  } catch {
    return content.trim().length === 0;
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ tenantSlug: string; proposalId: string }> },
) {
  try {
    const { tenantSlug, proposalId } = await params;
    if (!isValidUUID(proposalId)) {
      return NextResponse.json({ error: 'Invalid proposal id', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 });
    }
    const u = session.user as { id?: string; email?: string; role?: unknown; tenantId?: string | null };
    const role: Role | null = isRole(u.role) ? u.role : null;
    if (!role || !u.id || !hasRoleAtLeast(role, 'tenant_admin')) {
      return NextResponse.json({ error: 'Admin access required', code: 'FORBIDDEN' }, { status: 403 });
    }

    let body: { cocoonId?: unknown };
    try { body = await request.json(); }
    catch { return NextResponse.json({ error: 'Invalid JSON body', code: 'VALIDATION_ERROR' }, { status: 400 }); }
    const cocoonId = typeof body.cocoonId === 'string' ? body.cocoonId : '';
    if (!isValidUUID(cocoonId)) {
      return NextResponse.json({ error: 'cocoonId required', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    const tenant = await getTenantBySlug(tenantSlug);
    if (!tenant) {
      return NextResponse.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, { status: 404 });
    }
    const tenantId = tenant.id as string;
    if (!(await verifyProposalAccess(u.id, role, u.tenantId, tenantId, proposalId))) {
      return NextResponse.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 });
    }
    enterTenant(tenantId);

    // The cocoon (uploaded past proposal) must belong to this tenant.
    let cocoon: { id: string } | undefined;
    try { [cocoon] = await sql<{ id: string }[]>`SELECT id FROM document_cocoons WHERE id = ${cocoonId}::uuid AND tenant_id = ${tenantId}::uuid LIMIT 1`; }
    catch (e) { console.error('[reuse-past] cocoon query failed:', e); return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 }); }
    if (!cocoon) {
      return NextResponse.json({ error: 'Past proposal not found', code: 'NOT_FOUND' }, { status: 404 });
    }

    // Target sections + the cocoon's atoms.
    let sections: { id: string; title: string | null; version: number; content: string | null; isLocked: boolean; contentSource: string | null }[];
    let atoms: { title: string | null; content: string | null; canvasNodes: unknown }[];
    try {
      sections = await sql`
        SELECT id, title, version, content, is_locked AS "isLocked", content_source AS "contentSource"
        FROM proposal_sections WHERE proposal_id = ${proposalId}::uuid ORDER BY section_number ASC`;
      atoms = await sql`
        SELECT title, content, canvas_nodes AS "canvasNodes"
        FROM library_atoms
        WHERE cocoon_id = ${cocoonId}::uuid AND tenant_id = ${tenantId}::uuid
          AND grain = 'primitive' AND status <> 'archived'`;
    } catch (e) {
      console.error('[reuse-past] load failed:', e);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }

    // Normalized title → the first atom with content.
    const byTitle = new Map<string, { title: string | null; content: string | null; canvasNodes: unknown }>();
    for (const a of atoms) {
      const key = norm(a.title);
      if (key && !byTitle.has(key)) byTitle.set(key, a);
    }

    const applied: string[] = [];
    const skippedNonEmpty: string[] = [];
    const unmatched: string[] = [];
    const now = new Date().toISOString();

    for (const s of sections) {
      if (s.isLocked) { continue; }
      if (!isEmptyContent(s.content)) { skippedNonEmpty.push(s.title ?? s.id); continue; }
      const atom = byTitle.get(norm(s.title));
      if (!atom) { unmatched.push(s.title ?? s.id); continue; }

      // Assemble reuse nodes: prefer the atom's canvas nodes, else a text block from content.
      const savedNodes = coerceJsonb<CanvasNode[]>(atom.canvasNodes, []);
      let nodes: CanvasNode[] = Array.isArray(savedNodes) && savedNodes.length > 0 ? savedNodes : [];
      if (nodes.length === 0 && atom.content && atom.content.trim()) {
        nodes = atom.content.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean).map((text) => ({
          id: randomUUID(), type: 'text_block' as const, content: { text }, style: {},
          provenance: { source: 'library' as const }, history: [], library_eligible: true,
        }));
      }
      if (nodes.length === 0) { unmatched.push(s.title ?? s.id); continue; }
      // Mark every reused node red-italic so the builder sees it is imported verbatim.
      nodes = nodes.map((n) => ({ ...n, style: { ...n.style, reuse_marker: true } }));

      try {
        const doc = createEmptyCanvas({
          documentId: s.id,
          canvas: CANVAS_PRESETS.letter_sbir_phase1,
          metadata: {
            title: s.title ?? 'Section', volume_id: '', required_item_id: '', proposal_id: proposalId,
            solicitation_id: '', created_at: now, last_modified_at: now, last_modified_by: u.id!,
            version_number: 1, status: 'ai_drafted',
          },
        });
        doc.nodes = nodes;

        // Archive the current (empty) content, then write the reused content advancing the counter (CAS).
        let archiveJson: Parameters<typeof sql.json>[0];
        try { archiveJson = JSON.parse(s.content ?? '{}'); } catch { archiveJson = s.content ?? '{}'; }
        await sql`
          INSERT INTO canvas_versions (section_id, version_number, content, snapshot_reason, source, created_by, char_count, word_count)
          VALUES (${s.id}::uuid, ${s.version}, ${sql.json(archiveJson)}, 'pre_reuse', ${s.contentSource ?? 'human_edit'}, ${u.id}::uuid, 0, 0)
          ON CONFLICT (section_id, version_number) DO NOTHING`;

        const nextVersion = s.version + 1;
        const upd = await sql`
          UPDATE proposal_sections
          SET content = ${JSON.stringify(doc)}, version = ${nextVersion}, content_source = 'library_import',
              status = 'ai_drafted', last_modified_by = ${u.id}::uuid, editing_by = NULL, editing_since = NULL, updated_at = now()
          WHERE id = ${s.id}::uuid AND version = ${s.version}`;
        if (upd.count === 0) { continue; } // raced — skip

        applied.push(s.id);
        try {
          await emitEventSingle({
            namespace: 'proposal', type: 'section.saved', actor: userActor(u.id, u.email), tenantId,
            payload: { correlationId: randomUUID(), tenantId, tenantSlug, proposalId, sectionId: s.id, sectionTitle: s.title, version: nextVersion, reusedFromCocoon: cocoonId },
          });
        } catch (evtErr) { console.error('[reuse-past] event failed (non-fatal):', evtErr); }
      } catch (e) {
        console.error('[reuse-past] applying section failed (skipped):', s.id, e);
      }
    }

    return NextResponse.json({ data: { applied: applied.length, sections: applied, skippedNonEmpty, unmatched, scanned: true } });
  } catch (err) {
    console.error('[reuse-past] error:', err);
    return NextResponse.json({ error: 'Reuse failed', code: 'DB_ERROR' }, { status: 500 });
  }
}

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql, getTenantBySlug, enterTenant, verifyTenantAccess } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { emitEventSingle, userActor } from '@/lib/events';
import { coerceJsonb } from '@/lib/jsonb';
import { CANVAS_PRESETS } from '@/lib/types/canvas-document';
import type { CanvasDocument, CanvasNode } from '@/lib/types/canvas-document';

export const dynamic = 'force-dynamic';

interface Params { params: Promise<{ tenantSlug: string; proposalId: string }> }

interface AtomEntry {
  atom_id: string;
  content?: string;
  similarity?: number;
  action: 'reuse' | 'regen' | 'skip';
}

interface SectionMappingEntry {
  source_section_id?: string;
  source_section_title?: string;
  match_score?: number;
  atoms: AtomEntry[];
}

/**
 * POST — apply the admin-approved seed mapping to proposal sections.
 * Body: { seedJobId: string }
 *
 * For each target section with reuse/regen atoms:
 *   - reuse:  builds CanvasNode[] from atom text, marks reuse_marker:true (red italic)
 *   - regen:  inserts a placeholder node tagged for regeneration
 *   - skip:   section is left as-is
 * Updates proposal_sections.content for each affected section.
 */
export async function POST(req: Request, { params }: Params) {
  const { tenantSlug, proposalId } = await params;

  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized', code: 'AUTH_REQUIRED' }, { status: 401 });

  const sessionUser = session.user as { id?: string; role?: unknown };
  const role: Role | null = isRole(sessionUser.role) ? sessionUser.role : null;
  // Reuse is now self-serve: tenant_admin+ (own tenant, verified below) — was rfp/master only.
  if (!role || !sessionUser.id || !hasRoleAtLeast(role, 'tenant_admin')) {
    return NextResponse.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 });
  }

  let body: { seedJobId?: string };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON', code: 'BAD_REQUEST' }, { status: 400 });
  }
  const { seedJobId } = body;
  if (!seedJobId) return NextResponse.json({ error: 'seedJobId required', code: 'BAD_REQUEST' }, { status: 400 });

  const tenant = await getTenantBySlug(tenantSlug).catch(() => null);
  if (!tenant) return NextResponse.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, { status: 404 });
  const tenantId = tenant.id as string;

  if (!(await verifyTenantAccess(sessionUser.id, role, tenantId))) {
    return NextResponse.json({ error: 'Tenant access denied', code: 'FORBIDDEN' }, { status: 403 });
  }

  enterTenant(tenantId);

  try {
    // Load the seed job (must be awaiting_review)
    const [job] = await sql<{
      id: string;
      sectionMapping: Record<string, SectionMappingEntry>;
      sectionDecisions: Record<string, Record<string, string>>;
    }[]>`
      SELECT lsj.id,
             lsj.section_mapping   AS "sectionMapping",
             lsj.section_decisions AS "sectionDecisions"
      FROM library_seed_jobs lsj
      JOIN proposals p ON p.id = lsj.proposal_id
      WHERE lsj.id          = ${seedJobId}::uuid
        AND lsj.proposal_id = ${proposalId}::uuid
        AND lsj.tenant_id   = ${tenantId}::uuid
        AND p.tenant_id     = ${tenantId}::uuid
        AND lsj.status      = 'awaiting_review'
      LIMIT 1
    `;
    if (!job) {
      return NextResponse.json({ error: 'Job not found or not ready for apply', code: 'NOT_FOUND' }, { status: 404 });
    }

    const mapping: Record<string, SectionMappingEntry> = (job.sectionMapping as Record<string, SectionMappingEntry>) ?? {};
    const decisions: Record<string, Record<string, string>> = (job.sectionDecisions as Record<string, Record<string, string>>) ?? {};

    let sectionsSeeded = 0;
    let atomsReused = 0;
    let atomsRegenMarked = 0;

    // Apply per-section
    for (const [targetSectionId, mappingEntry] of Object.entries(mapping)) {
      const sectionDecision = decisions[targetSectionId] ?? {};
      const atoms = (mappingEntry.atoms ?? []) as AtomEntry[];

      const reuseAtoms = atoms.filter((a) => {
        const override = sectionDecision[a.atom_id];
        return override ? override === 'reuse' : a.action === 'reuse';
      });
      const regenAtoms = atoms.filter((a) => {
        const override = sectionDecision[a.atom_id];
        return override ? override === 'regen' : a.action === 'regen';
      });

      if (reuseAtoms.length === 0 && regenAtoms.length === 0) continue;

      // Load current section content (+ version, for the pre-merge archive)
      const [section] = await sql<{ id: string; content: unknown; title: string; version: number }[]>`
        SELECT id, content, title, version
        FROM proposal_sections
        WHERE id = ${targetSectionId}::uuid
          AND proposal_id = ${proposalId}::uuid
        LIMIT 1
      `;
      if (!section) continue;

      // Build canvas nodes from reuse atoms (red italic — reuse_marker)
      const newNodes: CanvasNode[] = [];

      if (reuseAtoms.length > 0) {
        newNodes.push({
          id: crypto.randomUUID(),
          type: 'heading',
          content: { level: 3, text: `Seeded from prior proposal` } as CanvasNode['content'],
          style: { size: 10, style: 'italic', color: '#dc2626' },
          history: [{ actor_id: 'system', actor_name: 'Library Seed', action: 'edited', timestamp: new Date().toISOString() }],
          provenance: { source: 'library' as const, drafted_at: new Date().toISOString() },
          library_eligible: true,
          library_tags: [],
        });
        for (const atom of reuseAtoms) {
          const paras = (atom.content ?? '')
            .split(/\n\s*\n/)
            .map((s) => s.trim())
            .filter(Boolean);
          for (const para of paras.length > 0 ? paras : ['']) {
            newNodes.push({
              id: crypto.randomUUID(),
              type: 'text_block',
              content: { text: para } as CanvasNode['content'],
              style: { reuse_marker: true },
              history: [{ actor_id: 'system', actor_name: 'Library Seed', action: 'edited', timestamp: new Date().toISOString() }],
              provenance: {
                source: 'library' as const,
                library_unit_id: atom.atom_id,
                drafted_at: new Date().toISOString(),
              },
              library_eligible: true,
              library_tags: [],
            });
          }
          atomsReused++;
        }
      }

      if (regenAtoms.length > 0) {
        newNodes.push({
          id: crypto.randomUUID(),
          type: 'text_block',
          content: { text: `[REGEN — ${regenAtoms.length} comparable atom${regenAtoms.length !== 1 ? 's' : ''} found from prior proposal. Review and regenerate this section.]` } as CanvasNode['content'],
          style: { style: 'italic', color: '#d97706' },
          history: [{ actor_id: 'system', actor_name: 'Library Seed', action: 'edited', timestamp: new Date().toISOString() }],
          provenance: { source: 'library' as const, drafted_at: new Date().toISOString() },
          library_eligible: true,
          library_tags: ['seed:regen', ...regenAtoms.map((a) => `atom:${a.atom_id}`)],
        });
        atomsRegenMarked += regenAtoms.length;
      }

      if (newNodes.length === 0) continue;

      // Merge into existing canvas document.
      // proposal_sections.content is TEXT (mig 071) → postgres.js returns a STRING, so the old
      // `typeof content === 'object'` guard was ALWAYS false → existingDoc null → the section's
      // real content was silently REPLACED instead of merged. Parse via coerceJsonb (handles the
      // string-encoded TEXT and any legacy jsonb rows) before deciding.
      const parsedContent = coerceJsonb<CanvasDocument | null>(section.content, null);
      const existingDoc = (parsedContent &&
        typeof parsedContent === 'object' &&
        'version' in parsedContent
          ? parsedContent
          : null);

      const doc: CanvasDocument = existingDoc ?? {
        version: 2,
        document_id: targetSectionId,
        canvas: CANVAS_PRESETS.letter_standard,
        metadata: {
          title: section.title ?? 'Section',
          volume_id: '',
          required_item_id: '',
          proposal_id: proposalId,
          solicitation_id: '',
          created_at: new Date().toISOString(),
          last_modified_at: new Date().toISOString(),
          last_modified_by: 'system',
          version_number: 1,
          status: 'ai_drafted',
        },
        nodes: [],
      };

      const updatedDoc: CanvasDocument = {
        ...doc,
        nodes: [...(doc.nodes ?? []), ...newNodes],
        metadata: {
          ...doc.metadata,
          status: 'ai_drafted',
          last_modified_at: new Date().toISOString(),
          last_modified_by: 'system',
          version_number: (doc.metadata.version_number ?? 0) + 1,
        },
      };

      // ── Archive the pre-merge content to canvas_versions (restore point) ──
      // Defense-in-depth: even though we now merge (not replace), snapshot what was there so a
      // seed apply is always reversible from Version History — matching the section-save discipline.
      if (existingDoc) {
        try {
          const existingText = (existingDoc.nodes ?? [])
            .map((n) => {
              const c = n.content as unknown as { text?: unknown };
              return typeof c?.text === 'string' ? c.text : '';
            })
            .filter(Boolean)
            .join(' ');
          await sql`
            INSERT INTO canvas_versions
              (section_id, version_number, content, snapshot_reason, source, created_by,
               char_count, word_count, ai_instruction, ai_model, edit_summary)
            VALUES (
              ${targetSectionId}::uuid,
              ${section.version},
              ${sql.json(existingDoc as unknown as Parameters<typeof sql.json>[0])},
              'seed_apply',
              'human_edit',
              ${sessionUser.id ?? null},
              ${existingText.length},
              ${existingText.split(/\s+/).filter(Boolean).length},
              ${null},
              ${null},
              ${'Library seed applied (pre-merge snapshot)'}
            )
            ON CONFLICT (section_id, version_number) DO NOTHING
          `;
        } catch (e) {
          console.error('[seed-apply] canvas_versions archive failed:', e);
          // Non-fatal — the merge still preserves the prior nodes.
        }
      }

      await sql`
        UPDATE proposal_sections
        SET content    = ${JSON.stringify(updatedDoc)},
            status     = 'ai_drafted',
            updated_at = now()
        WHERE id = ${targetSectionId}::uuid
      `;
      sectionsSeeded++;
    }

    // Mark job as applied
    await sql`
      UPDATE library_seed_jobs
      SET status     = 'applied',
          updated_at = now()
      WHERE id = ${seedJobId}::uuid
    `;

    // Audit which prior proposal was cloned into this build — the reuse chain's sole
    // state-transition was previously off-ledger. Best-effort; never fails the apply.
    try {
      await emitEventSingle({
        namespace: 'proposal', type: 'section.seeded_from_prior', actor: userActor(sessionUser.id ?? 'system'), tenantId,
        payload: { proposalId, seedJobId, sectionsSeeded, atomsReused, atomsRegenMarked },
      });
    } catch (ev) { console.error('[seed-job/apply] audit emit failed', ev); }

    return NextResponse.json({
      data: { applied: true, sectionsSeeded, atomsReused, atomsRegenMarked },
    });
  } catch (e) {
    console.error('[seed-job/apply/POST]', e);
    return NextResponse.json({ error: 'Server error', code: 'DB_ERROR' }, { status: 500 });
  }
}

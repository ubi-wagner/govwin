/**
 * POST /api/portal/[t]/proposals/[p]/sections/[s]/assemble
 *
 * ASSEMBLE THIS SECTION FROM THE TENANT'S LIBRARY — the caller `assembleSectionFromAtoms` never had.
 *
 * The assembly spine had both ends and no middle. `selectForSection` (lib/atoms.ts) ranks a
 * tenant's library atoms for a section and returns each with its real `canvasNodes`, so a
 * structured atom — an image, a table, a chart — travels intact. `assembleProposalDocument`
 * concatenates finished sections into one document. Between them, nothing turned ranked atoms into
 * the `CanvasGroup[]` a section is made of, so the group layer the model has always had was unused,
 * and with it `atom_ref` provenance, `keep_together` cohesion, and page-budget fitting.
 *
 * This route is that middle, exposed:
 *
 *     selectForSection  →  assembleSectionFromAtoms  →  a PROPOSED canvas_versions row
 *
 * PROPOSED, not applied. The section's live content is never touched. The assembled canvas lands
 * as an `ai_revision` version the builder reviews and restores from the section's history — the
 * same read-on-review landing every other agent-derived canvas goes through, and the same reason:
 * nothing writes a business table on an agent's say-so.
 *
 * The version numbering follows `land-revisions` exactly rather than being re-derived. A new row
 * numbers at the section's CURRENT `version` and then ADVANCES the counter, so a later human save
 * (which archives at `proposal_sections.version`) cannot collide into this slot and be silently
 * dropped by `ON CONFLICT DO NOTHING`. That is a live content-loss class, not a style preference.
 *
 * `skipped` is returned, never swallowed: an atom that did not fit the page budget is a fact the
 * builder needs — a section assembled from three of eleven atoms looks identical to one assembled
 * from three, and only one of those is worth investigating.
 *
 * Auth: tenant_user+ with access to THIS proposal. Assembling from a library is ordinary authoring.
 * Returns: { data: { versionNumber, groups, pagesUsed, charactersUsed, skipped, atoms } }
 *        | { error, code }
 */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql, getTenantBySlug, verifyProposalAccess, enterTenant } from '@/lib/db';
import { isRole, type Role } from '@/lib/rbac';
import { isValidUUID } from '@/lib/validation';
import { coerceJsonb } from '@/lib/jsonb';
import { emitEventSingle, userActor } from '@/lib/events';
import { selectForSection, viewerFromRole } from '@/lib/atoms';
import { assembleSectionFromAtoms } from '@/lib/canvas/assemble-from-atoms';
import { CANVAS_PRESETS, type CanvasDocument, type CanvasRules } from '@/lib/types/canvas-document';

interface Ctx { params: Promise<{ tenantSlug: string; proposalId: string; sectionId: string }> }

const clean = (v: unknown, max = 200): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined;

const cleanList = (v: unknown, max = 12): string[] =>
  Array.isArray(v) ? v.map((x) => clean(x)).filter((x): x is string => !!x).slice(0, max) : [];

export async function POST(request: Request, { params }: Ctx) {
  try {
    const { tenantSlug, proposalId, sectionId } = await params;
    if (!isValidUUID(proposalId) || !isValidUUID(sectionId)) {
      return NextResponse.json({ error: 'Invalid id', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 });
    }
    const u = session.user as { id?: string; email?: string; role?: unknown; tenantId?: string | null };
    const role: Role | null = isRole(u.role) ? u.role : null;
    if (!role || !u.id) {
      return NextResponse.json({ error: 'Invalid session', code: 'UNAUTHENTICATED' }, { status: 401 });
    }

    const tenant = await getTenantBySlug(tenantSlug);
    if (!tenant) return NextResponse.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, { status: 404 });
    const tenantId = tenant.id as string;

    // Never query by proposal id alone — the section must belong to a proposal this actor can reach
    // in THIS tenant. Two independent checks, because RLS scoping and app-layer authorisation
    // answer different questions and a route that relies on only one is a route with one lock.
    if (!(await verifyProposalAccess(u.id, role, u.tenantId, tenantId, proposalId))) {
      return NextResponse.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 });
    }
    enterTenant(tenantId);

    let body: Record<string, unknown> = {};
    try { body = (await request.json()) as Record<string, unknown>; } catch { /* defaults below */ }

    // ── The section, and whether it can receive anything ────────────────────────────────────────
    let section: {
      id: string; title: string | null; content: string | null; version: number;
      isLocked: boolean; sectionType: string | null; pageAllocation: number | null;
    } | undefined;
    try {
      [section] = await sql<Array<NonNullable<typeof section>>>`
        SELECT id, title, content, version, is_locked, section_type, page_allocation
        FROM proposal_sections
        WHERE id = ${sectionId}::uuid AND proposal_id = ${proposalId}::uuid
        LIMIT 1`;
    } catch (e) {
      console.error('[assemble] section read failed', e);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }
    if (!section) {
      return NextResponse.json({ error: 'Section not found', code: 'NOT_FOUND' }, { status: 404 });
    }
    // A locked section refuses even a PROPOSED version. The proposal is a lie otherwise: a builder
    // looking at a locked section would find a new revision waiting in its history.
    if (section.isLocked) {
      return NextResponse.json({ error: 'This section is locked.', code: 'SECTION_LOCKED' }, { status: 423 });
    }

    // ── Retrieval ───────────────────────────────────────────────────────────────────────────────
    // The section's own words are the query. Falling back to its title alone would retrieve by a
    // handful of generic proposal nouns ("Technical Approach") that every atom in a federal library
    // shares — which separates nothing.
    const existing = coerceJsonb<CanvasDocument | null>(section.content, null);
    const canvas: CanvasRules = (existing?.canvas as CanvasRules | undefined) ?? CANVAS_PRESETS.letter_standard;
    const queryText = clean(body.text, 4000)
      ?? [section.title, section.sectionType].filter(Boolean).join(' ');

    let atoms;
    try {
      atoms = await selectForSection(tenantId, {
        vol: clean(body.vol) ?? null,
        kinds: cleanList(body.kinds),
        context: cleanList(body.context),
        text: queryText,
        limit: Math.min(24, Number(body.limit) || 12),
      }, viewerFromRole(u.id, role));
    } catch (e) {
      console.error('[assemble] retrieval failed', e);
      return NextResponse.json({ error: 'Library retrieval failed', code: 'DB_ERROR' }, { status: 500 });
    }
    if (!atoms.length) {
      // Not an error — an honest answer about the library. A thin library yields a thin section,
      // and saying so beats returning an empty canvas that looks like a failed assembly.
      return NextResponse.json({
        error: 'Nothing in the library matched this section.', code: 'NO_ATOMS',
      }, { status: 409 });
    }

    // ── Assembly, fitted to the section's budget by the SAME ruler the export gate enforces ──────
    const result = assembleSectionFromAtoms(atoms, {
      title: section.title ?? 'Section',
      section_type: section.sectionType ?? undefined,
      canvas,
      layout: section.pageAllocation ? { page_budget: section.pageAllocation } : undefined,
    });
    if (!result.section.groups.length) {
      return NextResponse.json({
        error: 'Every matching atom was empty or over the page budget.',
        code: 'NOTHING_FIT',
      }, { status: 409 });
    }

    // The assembled canvas keeps the SECTION layer — groups and all. That is the whole point: the
    // provenance (`atom_ref`) and the cohesion (`keep_together`) live on the group, and flattening
    // to bare nodes here would throw both away at the last step.
    const assembled = {
      version: 2,
      document_id: `assembled-${sectionId}`,
      canvas,
      sections: [result.section],
      metadata: {
        ...(existing?.metadata ?? {}),
        title: section.title ?? 'Section',
        status: 'draft',
      },
    };

    // ── Land it as PROPOSED (never applied) ─────────────────────────────────────────────────────
    // Numbering copied from land-revisions, not re-derived: number at the section's CURRENT
    // version, then advance the counter, so the next human save archives into a free slot.
    //
    // `source = 'library_import'`, NOT `'ai_revision'`. Both are valid CHECK literals, and the
    // ai_revision lane would have bought free integration with the existing "Apply AI-proposed
    // revisions" button. But this assembly is DETERMINISTIC — ranked retrieval, then a greedy fit
    // measured by the ruler. No model is called. Labelling it AI would put a false provenance on
    // the builder's screen to save a wiring step, and provenance that lies is precisely what the
    // atom_ref / content_source spine exists to prevent. The review gate is the section's version
    // history, which restores from any source.
    const v = section.version;
    const text = JSON.stringify(assembled);
    let versionNumber: number | null = null;
    try {
      const ins = await sql<Array<{ versionNumber: number }>>`
        INSERT INTO canvas_versions
          (section_id, version_number, content, snapshot_reason, source, created_by,
           char_count, word_count, edit_summary)
        VALUES (${sectionId}::uuid, ${v}, ${sql.json(assembled as never)}, 'library_assemble', 'library_import',
                ${u.id}::uuid, ${result.charactersUsed}, ${text.split(/\s+/).filter(Boolean).length},
                ${`Assembled from ${(result.section.source_atom_ids ?? []).length} library atom(s)`})
        ON CONFLICT (section_id, version_number) DO NOTHING
        RETURNING version_number`;
      if (ins.length === 0) {
        // Someone else took the slot between the read and the write. Refusing is correct: numbering
        // over it is exactly the collision this scheme exists to prevent.
        return NextResponse.json({
          error: 'The section changed while assembling. Try again.', code: 'VERSION_CONFLICT',
        }, { status: 409 });
      }
      versionNumber = ins[0].versionNumber;
      await sql`UPDATE proposal_sections SET version = version + 1
                WHERE id = ${sectionId}::uuid AND version = ${v}`;
    } catch (e) {
      console.error('[assemble] version write failed', e);
      return NextResponse.json({ error: 'Could not save the assembled draft', code: 'DB_ERROR' }, { status: 500 });
    }

    try {
      await emitEventSingle({
        namespace: 'library',
        type: 'section.assembled',
        actor: userActor(u.id, u.email ?? undefined),
        tenantId,
        payload: {
          proposalId, sectionId, versionNumber,
          atoms: (result.section.source_atom_ids ?? []).length,
          groups: result.section.groups.length,
          pagesUsed: result.pagesUsed,
          skipped: result.skipped.length,
        },
      });
    } catch (e) {
      console.error('[assemble] event emit failed (non-fatal)', e);
    }

    return NextResponse.json({
      data: {
        versionNumber,
        groups: result.section.groups.length,
        atoms: result.section.source_atom_ids ?? [],
        pagesUsed: result.pagesUsed,
        charactersUsed: result.charactersUsed,
        pageBudget: section.pageAllocation ?? null,
        // Surfaced, never swallowed — a section built from 3 of 11 atoms and one built from 3
        // look identical, and only one of them is worth a second look.
        skipped: result.skipped,
        considered: atoms.length,
      },
    });
  } catch (e) {
    console.error('[assemble] error', e);
    return NextResponse.json({ error: 'Assembly failed', code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}

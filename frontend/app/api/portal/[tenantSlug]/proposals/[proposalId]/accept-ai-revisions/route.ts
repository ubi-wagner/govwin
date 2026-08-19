/**
 * POST /api/portal/[tenantSlug]/proposals/[proposalId]/accept-ai-revisions
 *
 * The ONE-CLICK apply of the staged AI full draft. `land-revisions` stages each section's
 * AI canvas as a PROPOSED `ai_revision` version in history (review-first); this route takes the
 * LATEST proposed `ai_revision` per section and APPLIES it to live content — for the builder who
 * has reviewed and wants the whole draft on the page in one click.
 *
 * The write follows the canvas_versions CAS invariant EXACTLY like the save + restore routes:
 * archive the current live content at the live version (so accepting is itself undoable), then
 * write the AI content and ADVANCE proposal_sections.version under a compare-and-swap. Idempotent
 * (a section already matching its latest ai_revision is skipped), locked sections are skipped, and
 * every applied section posts a proposal:section.saved event + activity-log row.
 *
 * Auth: tenant_admin+ (the admin who ran + reviewed the full draft accepts it).
 * Returns: { data: { applied, sections, skipped, scanned } } | { error, code }.
 */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql, getTenantBySlug, verifyProposalAccess, enterTenant } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { isValidUUID } from '@/lib/validation';
import { coerceJsonb } from '@/lib/jsonb';
import { emitEventSingle, userActor } from '@/lib/events';
import { isSectionWritable } from '@/lib/proposal/section-writable';
import { randomUUID } from 'crypto';

// Char/word counts from a section's JSON content string (mirrors the save + versions routes).
function extractCounts(content: string | null): { chars: number; words: number } {
  if (!content) return { chars: 0, words: 0 };
  try {
    const parsed = JSON.parse(content);
    const nodes: Array<{ content?: Record<string, unknown> }> = parsed.nodes ?? (Array.isArray(parsed) ? parsed : []);
    const parts: string[] = [];
    for (const node of nodes) {
      if (!node.content) continue;
      const t = (node.content as Record<string, unknown>).text;
      if (typeof t === 'string') parts.push(t);
      const items = (node.content as Record<string, unknown>).items;
      if (Array.isArray(items)) {
        for (const item of items) {
          if (typeof item === 'string') parts.push(item);
          else if (item && typeof (item as { text?: unknown }).text === 'string') parts.push((item as { text: string }).text);
        }
      }
    }
    const text = parts.join(' ');
    return { chars: text.length, words: text.split(/\s+/).filter(Boolean).length };
  } catch {
    return { chars: content.length, words: content.split(/\s+/).filter(Boolean).length };
  }
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ tenantSlug: string; proposalId: string }> },
) {
  try {
    const { tenantSlug, proposalId } = await params;
    if (!isValidUUID(proposalId)) {
      return NextResponse.json({ error: 'Invalid proposal id', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    // ── Auth: tenant_admin+ ──────────────────────────────────────────
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 });
    }
    const u = session.user as { id?: string; email?: string; role?: unknown; tenantId?: string | null };
    const role: Role | null = isRole(u.role) ? u.role : null;
    if (!role || !u.id) {
      return NextResponse.json({ error: 'Invalid session', code: 'UNAUTHENTICATED' }, { status: 401 });
    }
    if (!hasRoleAtLeast(role, 'tenant_admin')) {
      return NextResponse.json({ error: 'Admin access required', code: 'FORBIDDEN' }, { status: 403 });
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

    // ── Latest proposed ai_revision per section, with the section's live state ──
    type Row = {
      sectionId: string; title: string | null; aiVersion: number; aiContent: unknown;
      liveVersion: number; liveContent: string | null; isLocked: boolean; contentSource: string | null;
      completedStage: string | null; proposalStage: string | null;
    };
    let rows: Row[];
    try {
      rows = await sql<Row[]>`
        SELECT DISTINCT ON (cv.section_id)
               cv.section_id AS "sectionId", ps.title, cv.version_number AS "aiVersion", cv.content AS "aiContent",
               ps.version AS "liveVersion", ps.content AS "liveContent", ps.is_locked AS "isLocked",
               ps.content_source AS "contentSource",
               ps.completed_stage AS "completedStage", p.stage AS "proposalStage"
        FROM canvas_versions cv
        JOIN proposal_sections ps ON ps.id = cv.section_id
        JOIN proposals p ON p.id = ps.proposal_id
        WHERE ps.proposal_id = ${proposalId}::uuid AND cv.source = 'ai_revision'
          AND cv.snapshot_reason = 'full_draft'
        ORDER BY cv.section_id, cv.version_number DESC
      `;
    } catch (e) {
      console.error('[accept-ai-revisions] scan failed:', e);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }
    if (!rows || rows.length === 0) {
      return NextResponse.json({ data: { applied: 0, sections: [], skipped: 0, scanned: true, reason: 'no_ai_revisions' } });
    }

    const applied: string[] = [];
    let skipped = 0;
    for (const r of rows) {
      // Same immutability contract as PUT …/save — skip locked or prior-stage-frozen sections.
      if (!isSectionWritable(r, r.proposalStage)) { skipped++; continue; }
      try {
        const aiObj = coerceJsonb<unknown>(r.aiContent, {});
        const aiJson = JSON.stringify(aiObj);
        // Idempotency: if live already equals the AI content, there is nothing to apply.
        let liveNorm: string | null = null;
        try { liveNorm = JSON.stringify(JSON.parse(r.liveContent ?? 'null')); } catch { liveNorm = r.liveContent; }
        if (liveNorm === aiJson) { skipped++; continue; }

        // 1) Archive the current live content at the live version (so accepting is undoable),
        //    tagged with its own provenance. jsonb: parse then sql.json (CLIFFNOTES §4b).
        let archiveJson: Parameters<typeof sql.json>[0];
        try { archiveJson = JSON.parse(r.liveContent ?? '{}'); } catch { archiveJson = r.liveContent ?? '{}'; }
        const counts = extractCounts(r.liveContent);
        await sql`
          INSERT INTO canvas_versions
            (section_id, version_number, content, snapshot_reason, source, created_by, char_count, word_count)
          VALUES (${r.sectionId}::uuid, ${r.liveVersion}, ${sql.json(archiveJson)}, 'pre_accept_ai',
                  ${r.contentSource ?? 'human_edit'}, ${u.id}::uuid, ${counts.chars}, ${counts.words})
          ON CONFLICT (section_id, version_number) DO NOTHING`;

        // 2) Write the AI content as the new live content, advancing the counter under a CAS.
        const nextVersion = r.liveVersion + 1;
        const upd = await sql`
          UPDATE proposal_sections
          SET content = ${aiJson}, version = ${nextVersion}, content_source = 'ai_revision',
              last_modified_by = ${u.id}::uuid, editing_by = NULL, editing_since = NULL, updated_at = now()
          WHERE id = ${r.sectionId}::uuid AND version = ${r.liveVersion}`;
        if (upd.count === 0) { skipped++; continue; } // raced with another write — skip

        applied.push(r.sectionId);

        try {
          await emitEventSingle({
            namespace: 'proposal',
            type: 'section.saved',
            actor: userActor(u.id, u.email),
            tenantId,
            payload: { correlationId: randomUUID(), tenantId, tenantSlug, proposalId, sectionId: r.sectionId, sectionTitle: r.title, version: nextVersion, acceptedAiFromVersion: r.aiVersion },
          });
        } catch (evtErr) { console.error('[accept-ai-revisions] event failed (non-fatal):', evtErr); }

        try {
          await sql`
            INSERT INTO proposal_activity_log
              (proposal_id, tenant_id, actor_id, actor_email, actor_role, activity_type, section_id, section_title, entity_version, details)
            VALUES (${proposalId}::uuid, ${tenantId}::uuid, ${u.id}::uuid, ${u.email ?? null}, ${role},
                    'section_saved', ${r.sectionId}::uuid, ${r.title}, ${nextVersion},
                    ${sql.json({ accepted_ai_from: r.aiVersion, previous_version: r.liveVersion })})`;
        } catch (logErr) { console.error('[accept-ai-revisions] activity log failed:', logErr); }
      } catch (e) {
        console.error('[accept-ai-revisions] applying section failed (skipped):', r.sectionId, e);
        skipped++;
      }
    }

    return NextResponse.json({ data: { applied: applied.length, sections: applied, skipped, scanned: true } });
  } catch (err) {
    console.error('[accept-ai-revisions] error:', err);
    return NextResponse.json({ error: 'Accept failed', code: 'DB_ERROR' }, { status: 500 });
  }
}

/**
 * POST /api/admin/rfp-curation/[solId]/ingest-assist
 *
 * The RFP-admin "Ingest Assist" — one action that runs the whole ingest SOP for a
 * claimed solicitation: PARSE its text (deterministic pattern reads, then AI, over the
 * DoW SBIR/STTR CSO default) → MATERIALIZE the compliance matrix + volumes + section
 * molds → upsert topic opportunities → PUBLISH the card(s) (a suite for a multi-topic
 * solicitation). The Scouts feed the same materializer later.
 *
 * SOURCE TEXT IS REQUIRED. Assist used to run happily against an empty `full_text` and
 * write the default skeleton as though it had read the document — the shred and the assist
 * are separate steps (upload emits `finder:rfp.uploaded`, the OnRfpUploaded workflow shreds
 * asynchronously), so an admin who clicked Assist promptly got a full, confident, entirely
 * fabricated matrix. Proven live on the DoW 2026 SBIR BAA. Now an unshredded solicitation is
 * refused with 409 SOURCE_TEXT_NOT_READY; an admin who genuinely wants the blank starting
 * skeleton must ask for it explicitly with `allowDefaultSkeleton: true`.
 *
 * Body: { parsed?: ParsedSolicitation, publish?: boolean, allowDefaultSkeleton?: boolean }
 *   - parsed: an admin-reviewed structure (skip the parse; commit as-is).
 *   - publish: default false; true fans the card(s) out to tenants.
 *   - allowDefaultSkeleton: proceed with the DEFAULT skeleton even though nothing was
 *     shredded. Deliberate, audited, and every field still lands stamped `default`.
 * Returns: { data: { source, volumes, items, topics, cards, notes } }
 *
 * Auth: rfp_admin / master_admin.
 */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql } from '@/lib/db';
import { isRole, hasRoleAtLeast } from '@/lib/rbac';
import { isValidUUID } from '@/lib/validation';
import { emitEventSingle, userActor } from '@/lib/events';
import { parseSolicitation } from '@/lib/ingest/parse-solicitation';
import { hasUsableSourceText, MIN_USABLE_TEXT_CHARS } from '@/lib/ingest/pattern-extract';
import { landSkeleton, LandBlockedError, setIngestPhase, stageSkeleton } from '@/lib/ingest/stage-skeleton';
import { type ParsedSolicitation } from '@/lib/ingest/skeleton';

interface RouteContext { params: Promise<{ solId: string }> }

/** rfp_admin+ gate shared by both handlers. Returns the session user, or the 401/403 response. */
async function requireAdmin(): Promise<{ id: string; email?: string } | NextResponse> {
  const session = await auth();
  const su = (session as { user?: { id?: string; email?: string; role?: unknown } } | null)?.user;
  const role = isRole(su?.role) ? su!.role : null;
  if (!su?.id || !role || !hasRoleAtLeast(role, 'rfp_admin')) {
    return NextResponse.json({ error: 'rfp_admin role required', code: 'FORBIDDEN' }, { status: 403 });
  }
  return { id: su.id, email: su.email ?? undefined };
}

/**
 * GET — "can Ingest Assist run yet?"
 *
 * The shred is asynchronous (upload emits `finder:rfp.uploaded`; OnRfpUploaded shreds), so the
 * moment right after upload is exactly when the source text is NOT there. This lets a caller
 * wait for the text instead of racing it into a default skeleton — the upload form polls here
 * before firing the POST. Cheap by design: lengths and counts computed in SQL, no blobs.
 */
export async function GET(_request: Request, ctx: RouteContext) {
  try {
    const admin = await requireAdmin();
    if (admin instanceof NextResponse) return admin;

    const { solId } = await ctx.params;
    if (!isValidUUID(solId)) {
      return NextResponse.json({ error: 'Invalid solicitation id', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    let row: { chars: number; documents: number; status: string | null } | undefined;
    try {
      [row] = await sql<typeof row[]>`
        SELECT coalesce(length(cs.full_text), 0)::int AS chars, cs.status,
               (SELECT count(*)::int FROM solicitation_documents sd WHERE sd.solicitation_id = cs.id) AS documents
        FROM curated_solicitations cs WHERE cs.id = ${solId}::uuid LIMIT 1`;
    } catch (e) {
      console.error('[ingest-assist] readiness load failed', e);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }
    if (!row) {
      return NextResponse.json({ error: 'Solicitation not found', code: 'NOT_FOUND' }, { status: 404 });
    }

    const ready = row.chars >= MIN_USABLE_TEXT_CHARS;
    return NextResponse.json({ data: {
      ready,
      chars: row.chars,
      minChars: MIN_USABLE_TEXT_CHARS,
      documents: row.documents,
      // 'shredder_failed' is terminal — polling will never turn it ready.
      state: ready ? 'ready'
        : row.status === 'shredder_failed' ? 'shred_failed'
        : row.documents === 0 ? 'no_document'
        : 'shredding',
    } });
  } catch (e) {
    console.error('[ingest-assist] readiness error', e);
    return NextResponse.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}

export async function POST(request: Request, ctx: RouteContext) {
  try {
    const session = await auth();
    const su = (session as { user?: { id?: string; email?: string; role?: unknown } } | null)?.user;
    const role = isRole(su?.role) ? su!.role : null;
    if (!su?.id || !role || !hasRoleAtLeast(role, 'rfp_admin')) {
      return NextResponse.json({ error: 'rfp_admin role required', code: 'FORBIDDEN' }, { status: 403 });
    }

    const { solId } = await ctx.params;
    if (!isValidUUID(solId)) {
      return NextResponse.json({ error: 'Invalid solicitation id', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    let body: { parsed?: ParsedSolicitation; publish?: boolean; allowDefaultSkeleton?: boolean } = {};
    try { body = await request.json(); } catch { /* empty body ok */ }

    // Load the solicitation + its umbrella opportunity (for parse hints + full_text).
    let sol: { id: string; fullText: string | null; namespace: string | null; title: string | null; agency: string | null; topicNumber: string | null; docCount: number } | undefined;
    try {
      [sol] = await sql<typeof sol[]>`
        SELECT cs.id, cs.full_text AS "fullText", cs.namespace,
               o.title, o.agency, o.topic_number AS "topicNumber",
               (SELECT count(*)::int FROM solicitation_documents sd WHERE sd.solicitation_id = cs.id) AS "docCount"
        FROM curated_solicitations cs
        LEFT JOIN opportunities o ON o.id = cs.opportunity_id
        WHERE cs.id = ${solId}::uuid LIMIT 1`;
    } catch (e) {
      console.error('[ingest-assist] load failed', e);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }
    if (!sol) {
      return NextResponse.json({ error: 'Solicitation not found', code: 'NOT_FOUND' }, { status: 404 });
    }

    // ── The shred gate ──
    // Nothing to read means nothing was read: proceeding here writes DEFAULT_SBIR_CSO_SKELETON
    // into the compliance matrix, and the curator has no way to tell that from a real extraction.
    // Refuse, and say which state we are actually in (waiting on a shred vs no document at all)
    // so the admin knows whether to wait or to upload. An override parse carries its own values
    // and does not read the text, so it is exempt.
    const hasOverride = !!(body.parsed && Array.isArray(body.parsed.volumes));
    if (!hasOverride && !hasUsableSourceText(sol.fullText) && !body.allowDefaultSkeleton) {
      const chars = sol.fullText?.trim().length ?? 0;
      return NextResponse.json({
        error: sol.docCount > 0
          ? `Source text not ready — ${sol.docCount} document(s) uploaded but only ${chars} characters extracted so far. The shred runs asynchronously after upload; wait for it to finish, or re-upload if it failed.`
          : 'No source document — upload the solicitation PDF before running Ingest Assist.',
        code: 'SOURCE_TEXT_NOT_READY',
        detail: { chars, minChars: MIN_USABLE_TEXT_CHARS, documents: sol.docCount, canForceDefaultSkeleton: true },
      }, { status: 409 });
    }

    // Parse (or take the admin-reviewed override).
    let parsed: ParsedSolicitation;
    if (hasOverride) {
      parsed = { ...body.parsed!, source: 'override' };
    } else {
      parsed = await parseSolicitation(sol.fullText ?? '', {
        agency: sol.agency, namespace: sol.namespace, topicNumber: sol.topicNumber, title: sol.title,
      });
    }

    // ── STAGE, then land only if the staged matrix is sound (Ingest Studio, mig 189) ──
    //
    // The matrix is proposed into solicitation_compliance_drafts first, always. Whether it then
    // LANDS in the same click depends on the deterministic provenance audit:
    //
    //   clean  → land now. One click still produces a working matrix, and the values that were
    //            not read from the document still arrive wearing their red "Default — unverified"
    //            badge. Nothing has been hidden, and the downstream review_requested → approved →
    //            push gate is still between this and any customer.
    //   blocker→ STAY STAGED and say why. A blocker means we already know something is unfounded —
    //            an unresolved deferral pointing at a document nobody attached, or a matrix where
    //            nothing at all was read. Landing that silently is the exact failure this whole
    //            subsystem exists to stop, so it waits for a person (or the Ingest Studio gates).
    let draft;
    try {
      draft = await stageSkeleton(solId, parsed, { phase: 'matrix', userId: su.id });
    } catch (e) {
      console.error('[ingest-assist] stage failed', e);
      return NextResponse.json({ error: 'Failed to stage the skeleton', code: 'DB_ERROR' }, { status: 500 });
    }

    const stagedAudit = draft.audit as { findings?: Array<{ severity: string; issue: string }> };
    const blockers = (stagedAudit?.findings ?? []).filter((f) => f.severity === 'blocker');

    let result: Awaited<ReturnType<typeof landSkeleton>> | null = null;
    if (blockers.length === 0) {
      try {
        result = await landSkeleton(solId, {
          userId: su.id, auto: true, publish: body.publish ?? false, nowIso: new Date().toISOString(),
        });
        await setIngestPhase(solId, 'landed');
      } catch (e) {
        if (e instanceof LandBlockedError) {
          // Belt and braces: landSkeleton re-checks, so a race that introduced a blocker between
          // staging and landing still parks rather than publishing.
          console.error('[ingest-assist] land refused', e.message);
        } else {
          console.error('[ingest-assist] land failed', e);
          return NextResponse.json({ error: 'Failed to land the skeleton', code: 'DB_ERROR' }, { status: 500 });
        }
      }
    } else {
      await setIngestPhase(solId, 'matrix');
    }

    try {
      await emitEventSingle({
        namespace: 'finder', type: 'solicitation.ingest_assisted',
        actor: userActor(su.id, su.email ?? undefined), tenantId: null,
        payload: {
          solicitationId: solId, source: parsed.source, ...(result ?? {}),
          draftId: draft.id, landed: !!result, blockers: blockers.length,
          // Per-field provenance on the event too — "which of these values did we actually
          // READ?" must be answerable from the audit trail, not only from the current row.
          fieldSources: parsed.fieldSources ?? null,
          sourceChars: sol.fullText?.length ?? 0,
          forcedDefaultSkeleton: !hasOverride && !hasUsableSourceText(sol.fullText),
        },
      });
    } catch (e) { console.error('[ingest-assist] event emit failed (non-fatal)', e); }

    return NextResponse.json({ data: {
      source: parsed.source,
      // A staged-but-not-landed run reports zeroes for the landed counts, and says so explicitly
      // rather than letting the caller read "0 volumes" as a failed build.
      volumes: result?.volumes ?? 0, items: result?.items ?? 0,
      topics: result?.topics ?? 0, cards: result?.cards ?? 0,
      landed: !!result,
      draftId: draft.id,
      blockers: blockers.map((b) => b.issue),
      fieldSources: parsed.fieldSources ?? {},
      notes: parsed.notes ?? [],
    } });
  } catch (e) {
    console.error('[ingest-assist] error', e);
    return NextResponse.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}

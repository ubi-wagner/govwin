/**
 * POST /api/admin/rfp-curation/[solId]/ingest-assist
 *
 * The RFP-admin "Ingest Assist" — one action that runs the whole ingest SOP for a
 * claimed solicitation: PARSE its text (AI, with the DoW SBIR/STTR CSO default as
 * fallback) → MATERIALIZE the compliance matrix + volumes + section molds →
 * upsert topic opportunities → PUBLISH the card(s) (a suite for a multi-topic
 * solicitation). The Scouts feed the same materializer later.
 *
 * Body: { parsed?: ParsedSolicitation, publish?: boolean }
 *   - parsed: an admin-reviewed structure (skip the AI parse; commit as-is).
 *   - publish: default true; false builds the skeleton without fanning cards.
 * Returns: { data: { source, volumes, items, topics, cards } }
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
import { materializeSkeleton } from '@/lib/ingest/materialize';
import { type ParsedSolicitation } from '@/lib/ingest/skeleton';

interface RouteContext { params: Promise<{ solId: string }> }

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

    let body: { parsed?: ParsedSolicitation; publish?: boolean } = {};
    try { body = await request.json(); } catch { /* empty body ok */ }

    // Load the solicitation + its umbrella opportunity (for parse hints + full_text).
    let sol: { id: string; fullText: string | null; namespace: string | null; title: string | null; agency: string | null; topicNumber: string | null } | undefined;
    try {
      [sol] = await sql<typeof sol[]>`
        SELECT cs.id, cs.full_text AS "fullText", cs.namespace,
               o.title, o.agency, o.topic_number AS "topicNumber"
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

    // Parse (or take the admin-reviewed override).
    let parsed: ParsedSolicitation;
    if (body.parsed && Array.isArray(body.parsed.volumes)) {
      parsed = { ...body.parsed, source: 'override' };
    } else {
      parsed = await parseSolicitation(sol.fullText ?? '', {
        agency: sol.agency, namespace: sol.namespace, topicNumber: sol.topicNumber, title: sol.title,
      });
    }

    // Materialize the whole skeleton + publish the card(s).
    let result;
    try {
      result = await materializeSkeleton(solId, parsed, { publish: body.publish ?? true, nowIso: new Date().toISOString() });
    } catch (e) {
      console.error('[ingest-assist] materialize failed', e);
      return NextResponse.json({ error: 'Failed to build the skeleton', code: 'DB_ERROR' }, { status: 500 });
    }

    try {
      await emitEventSingle({
        namespace: 'finder', type: 'solicitation.ingest_assisted',
        actor: userActor(su.id, su.email ?? undefined), tenantId: null,
        payload: { solicitationId: solId, source: parsed.source, ...result },
      });
    } catch (e) { console.error('[ingest-assist] event emit failed (non-fatal)', e); }

    return NextResponse.json({ data: { source: parsed.source, ...result } });
  } catch (e) {
    console.error('[ingest-assist] error', e);
    return NextResponse.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}

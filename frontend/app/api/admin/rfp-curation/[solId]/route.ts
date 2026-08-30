/**
 * GET /api/admin/rfp-curation/[solId]
 *
 * Returns full solicitation detail for the curation workspace: the
 * curated_solicitations row joined with its opportunity, plus related
 * topics, documents, volumes, and compliance variables.
 *
 * Returns: { data: { solicitation: {...}, topics, documents, volumes, compliance } }
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql } from '@/lib/db';
import type { Role } from '@/lib/rbac';
import { emitEventSingle, userActor } from '@/lib/events';
import { republishSolicitationCards } from '@/lib/curation/republish';

interface RouteContext {
  params: Promise<{ solId: string }>;
}

export async function GET(
  _request: Request,
  routeCtx: RouteContext,
) {
  try {
    // ── Auth check ──────────────────────────────────────────────────
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json(
        { error: 'Authentication required', code: 'UNAUTHENTICATED' },
        { status: 401 },
      );
    }
    const role = (session.user as { role?: Role }).role;
    if (role !== 'master_admin' && role !== 'rfp_admin') {
      return NextResponse.json(
        { error: 'rfp_admin or master_admin role required', code: 'FORBIDDEN' },
        { status: 403 },
      );
    }

    const { solId } = await routeCtx.params;

    // ── Validate UUID format ────────────────────────────────────────
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID_RE.test(solId)) {
      return NextResponse.json(
        { error: 'Invalid solicitation ID format', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

    // ── Main solicitation + opportunity join ─────────────────────────
    let rows;
    try {
      rows = await sql`
        SELECT cs.*, o.*,
               cs.id AS solicitation_id,
               o.id AS opportunity_id
        FROM curated_solicitations cs
        JOIN opportunities o ON o.id = cs.opportunity_id
        WHERE cs.id = ${solId}::uuid
      `;
    } catch (e) {
      console.error('[rfp-curation/detail] solicitation query failed:', e);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }

    if (rows.length === 0) {
      return NextResponse.json(
        { error: 'Solicitation not found', code: 'NOT_FOUND' },
        { status: 404 },
      );
    }

    const solicitation = rows[0];

    // ── Fetch related data in parallel ──────────────────────────────
    let topics, documents, volumes, compliance;
    try {
      [topics, documents, volumes, compliance] = await Promise.all([
        sql`
          SELECT id, topic_number, title, topic_branch, topic_status,
                 tech_focus_areas, close_date, is_active, created_at
          FROM opportunities
          WHERE solicitation_id = ${solId}::uuid
          ORDER BY topic_number ASC NULLS LAST, created_at ASC
        `,
        sql`
          SELECT id, document_type, original_filename, storage_key,
                 file_size, content_type, extracted_at, is_primary, created_at
          FROM solicitation_documents
          WHERE solicitation_id = ${solId}::uuid
          ORDER BY is_primary DESC, created_at ASC
        `,
        sql`
          SELECT v.id, v.volume_number, v.volume_name, v.volume_format,
                 v.description, v.special_requirements,
                 -- dsipOnly: this volume is completed inside the agency's submission portal, so
                 -- provision stands up no authoring artifact for it. The workspace has to SHOW it
                 -- or a curator cannot tell a tracked-only volume from one nobody has built yet.
                 coalesce((v.metadata->>'dsipOnly')::boolean, false) AS dsip_only,
                 json_agg(
                   json_build_object(
                     'id', ri.id,
                     'itemName', ri.item_name,
                     'itemNumber', ri.item_number,
                     'itemType', ri.item_type,
                     'required', ri.required,
                     'pageLimit', ri.page_limit,
                     'slideLimit', ri.slide_limit,
                     -- The character cap and the per-item DSIP-only flag are as load-bearing as
                     -- the page limit — they decide whether an item is authored at all and what
                     -- the compliance floor measures it against — so they belong in the read model.
                     'characterLimit', ri.character_limit,
                     'dsipOnly', coalesce((ri.metadata->>'dsipOnly')::boolean, false),
                     'templateId', ri.template_id,
                     'expertNotes', ri.expert_notes
                   ) ORDER BY ri.item_number ASC
                 ) FILTER (WHERE ri.id IS NOT NULL) AS required_items
          FROM solicitation_volumes v
          LEFT JOIN volume_required_items ri ON ri.volume_id = v.id
          WHERE v.solicitation_id = ${solId}::uuid
          GROUP BY v.id
          ORDER BY v.volume_number ASC
        `,
        sql`
          SELECT * FROM solicitation_compliance
          WHERE solicitation_id = ${solId}::uuid
        `,
      ]);
    } catch (e) {
      console.error('[rfp-curation/detail] related data query failed:', e);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }

    return NextResponse.json({
      data: {
        solicitation,
        topics,
        documents,
        volumes,
        compliance: compliance[0] ?? null,
      },
    });
  } catch (error) {
    console.error('[rfp-curation] GET detail failed:', error);
    return NextResponse.json(
      { error: 'Failed to fetch solicitation detail', code: 'INTERNAL_ERROR' },
      { status: 500 },
    );
  }
}

/**
 * PATCH /api/admin/rfp-curation/[solId]
 *
 * Update solicitation-level curation fields:
 *   - spotlightSummary (mig 107) — the matching context that the push gate requires
 *     and that fan-out folds into the card for ranking.
 *   - expertNotes — the landing opportunity's customer-visible expert note
 *     (rides the card snapshot; previously had no edit surface at all).
 *
 * Both are card-snapshot inputs, so a save on a PUSHED solicitation re-publishes
 * every released opp to the bridge (republishSolicitationCards — no-op pre-push).
 * Without that, tenants keep ranking against a summary the admin already replaced.
 * Body: { spotlightSummary?: string, expertNotes?: string }
 */
export async function PATCH(request: Request, routeCtx: RouteContext) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 });
    }
    const u = session.user as { id?: string; email?: string; role?: Role };
    const role = u.role;
    if (role !== 'master_admin' && role !== 'rfp_admin') {
      return NextResponse.json({ error: 'rfp_admin or master_admin role required', code: 'FORBIDDEN' }, { status: 403 });
    }
    const { solId } = await routeCtx.params;
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID_RE.test(solId)) {
      return NextResponse.json({ error: 'Invalid solicitation ID format', code: 'VALIDATION_ERROR' }, { status: 400 });
    }
    let body: {
      spotlightSummary?: unknown; expertNotes?: unknown; awardAmount?: unknown; awardBasis?: unknown;
      fieldBasis?: unknown;
    };
    try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON', code: 'VALIDATION_ERROR' }, { status: 400 }); }
    const hasSummary = typeof body.spotlightSummary === 'string';
    const hasExpertNotes = typeof body.expertNotes === 'string';
    /*
     * AWARD SIZE — the field a small business asks about first, and the one that had no way in
     * (mig 241). `award_amount` had zero writers in the tree; `estimated_value_min/max` was written
     * only by the SAM-feed ingest. So it measured 0 of 22 on the box while the bridge dutifully
     * carried it onto every card.
     *
     * The BASIS is the point, not the number. Requiring a figure outright would leave an admin
     * facing a silent BAA two options — block the release, or invent one — and inventing it is what
     * INGEST_PROVENANCE forbids. So: stated (read from the document) · estimated (the admin's own
     * judgement, badged as such to the customer) · not_stated (the document is silent, which is a
     * finding and renders as one).
     */
    const AWARD_BASES = ['stated', 'estimated', 'not_stated'] as const;
    const hasAwardBasis = typeof body.awardBasis === 'string';
    if (hasAwardBasis && !(AWARD_BASES as readonly string[]).includes(body.awardBasis as string)) {
      return NextResponse.json(
        { error: `awardBasis must be one of ${AWARD_BASES.join(', ')}`, code: 'VALIDATION_ERROR' }, { status: 400 });
    }
    const awardBasis = hasAwardBasis ? (body.awardBasis as string) : null;
    // A figure is REQUIRED for stated/estimated and REFUSED for not_stated — otherwise the two
    // could disagree on the card ("Award size not stated · $250,000"), which is worse than either.
    const rawAmount = body.awardAmount;
    const awardAmount = typeof rawAmount === 'number' && Number.isFinite(rawAmount) && rawAmount >= 0
      ? Math.round(rawAmount) : null;
    if (hasAwardBasis && awardBasis !== 'not_stated' && awardAmount === null) {
      return NextResponse.json(
        { error: 'awardAmount (a non-negative number) is required unless awardBasis is not_stated', code: 'VALIDATION_ERROR' },
        { status: 400 });
    }
    /*
     * THE OTHER TWO DECISIONS THE RELEASE GATE ASKS FOR (mig 241).
     *
     * ⚠️ This is the gap the end-to-end drive found. `solicitation.push` refuses to release until
     * `source_documents` and `highlights` are decided — and until now NOTHING COULD RECORD THEM.
     * A gate with a condition that has no way in is not a gate, it is an outage: the canonical
     * happy-path drive stopped at 422 with no route to satisfy it, which is exactly the
     * "carried but unreachable" shape the award-size work existed to fix, reintroduced two commits
     * later by the same hand.
     *
     * Each vocabulary is closed, and each value is a FINDING rather than a blank: "the organization
     * published none" and "no passages need marking" are things a curator concluded.
     */
    const BASIS_VOCAB: Record<string, readonly string[]> = {
      source_documents: ['attached', 'none_published'],
      highlights: ['marked', 'none_needed'],
      naics_codes: ['stated', 'not_stated'],
      set_aside_type: ['stated', 'not_stated'],
    };
    const rawBasis = body.fieldBasis;
    const hasFieldBasis = !!rawBasis && typeof rawBasis === 'object' && !Array.isArray(rawBasis);
    const fieldBasis: Record<string, string> = {};
    if (hasFieldBasis) {
      for (const [k, v] of Object.entries(rawBasis as Record<string, unknown>)) {
        const allowed = BASIS_VOCAB[k];
        if (!allowed) {
          return NextResponse.json(
            { error: `fieldBasis key must be one of ${Object.keys(BASIS_VOCAB).join(', ')}`, code: 'VALIDATION_ERROR' }, { status: 400 });
        }
        if (typeof v !== 'string' || !allowed.includes(v)) {
          return NextResponse.json(
            { error: `fieldBasis.${k} must be one of ${allowed.join(', ')}`, code: 'VALIDATION_ERROR' }, { status: 400 });
        }
        fieldBasis[k] = v;
      }
      if (Object.keys(fieldBasis).length === 0) {
        return NextResponse.json({ error: 'fieldBasis must name at least one field', code: 'VALIDATION_ERROR' }, { status: 400 });
      }
    }
    if (!hasSummary && !hasExpertNotes && !hasAwardBasis && !hasFieldBasis) {
      return NextResponse.json({ error: 'spotlightSummary, expertNotes, awardBasis or fieldBasis is required', code: 'VALIDATION_ERROR' }, { status: 400 });
    }
    const summary = hasSummary ? (body.spotlightSummary as string).slice(0, 5000) : null;
    const expertNotes = hasExpertNotes ? (body.expertNotes as string).slice(0, 5000) : null;
    // Pre-flight BEFORE any write: an umbrella can legally exist without a landing opp
    // (mig 013), and the expert note lives ON the landing opp. Checking after the summary
    // UPDATE committed a partial, unaudited write and mislabelled it 404.
    if (hasExpertNotes || hasAwardBasis || hasFieldBasis) {
      try {
        const [pre] = await sql<{ opportunityId: string | null }[]>`
          SELECT opportunity_id AS "opportunityId" FROM curated_solicitations WHERE id = ${solId}::uuid`;
        if (!pre) return NextResponse.json({ error: 'Solicitation not found', code: 'NOT_FOUND' }, { status: 404 });
        if (!pre.opportunityId) {
          return NextResponse.json({
            error: 'This solicitation has no landing opportunity — the expert note and the award size live on the opportunity card.',
            code: 'NO_LANDING_OPPORTUNITY',
          }, { status: 409 });
        }
      } catch (err) {
        console.error('[rfp-curation] PATCH preflight failed:', err);
        return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
      }
    }
    try {
      if (hasSummary) {
        const rows = await sql<{ id: string }[]>`
          UPDATE curated_solicitations SET spotlight_summary = ${summary}, updated_at = now()
          WHERE id = ${solId}::uuid RETURNING id`;
        if (rows.length === 0) {
          return NextResponse.json({ error: 'Solicitation not found', code: 'NOT_FOUND' }, { status: 404 });
        }
      }
      if (hasExpertNotes) {
        const rows = await sql<{ id: string }[]>`
          UPDATE opportunities SET expert_notes = ${expertNotes}, updated_at = now()
          WHERE id = (SELECT opportunity_id FROM curated_solicitations WHERE id = ${solId}::uuid)
          RETURNING id`;
        if (rows.length === 0) {
          return NextResponse.json({ error: 'Solicitation not found', code: 'NOT_FOUND' }, { status: 404 });
        }
      }
      if (hasFieldBasis) {
        // On the UMBRELLA only: source_documents and highlights are facts about the solicitation,
        // and the push gate reads them from exactly that row.
        const rows = await sql<{ id: string }[]>`
          UPDATE opportunities
             SET field_basis = field_basis || ${sql.json(fieldBasis as Parameters<typeof sql.json>[0])},
                 updated_at = now()
           WHERE id = (SELECT opportunity_id FROM curated_solicitations WHERE id = ${solId}::uuid)
          RETURNING id`;
        if (rows.length === 0) {
          return NextResponse.json({ error: 'Solicitation not found', code: 'NOT_FOUND' }, { status: 404 });
        }
      }
      if (hasAwardBasis) {
        // Applied to the umbrella AND every topic: the release gate reads each activated
        // opportunity, and a 66-topic BAA states one award size for all of them. `||` merges rather
        // than replaces, so a basis recorded for another field is not silently dropped.
        const rows = await sql<{ id: string }[]>`
          UPDATE opportunities
             SET award_amount = ${awardBasis === 'not_stated' ? null : awardAmount},
                 field_basis = field_basis || ${sql.json({ award_amount: awardBasis } as Parameters<typeof sql.json>[0])},
                 updated_at = now()
           WHERE solicitation_id = ${solId}::uuid
              OR id = (SELECT opportunity_id FROM curated_solicitations WHERE id = ${solId}::uuid)
          RETURNING id`;
        if (rows.length === 0) {
          return NextResponse.json({ error: 'Solicitation not found', code: 'NOT_FOUND' }, { status: 404 });
        }
      }
    } catch (err) {
      console.error('[rfp-curation] PATCH curation fields failed:', err);
      return NextResponse.json({ error: 'Failed to update solicitation', code: 'DB_ERROR' }, { status: 500 });
    }
    await emitEventSingle({
      namespace: 'finder',
      type: hasSummary ? 'solicitation.summary_updated'
        : hasExpertNotes ? 'solicitation.expert_notes_updated'
        : hasAwardBasis ? 'solicitation.award_basis_set'
        : 'solicitation.field_basis_set',
      actor: userActor(u.id ?? '', u.email ?? undefined),
      tenantId: null,
      payload: { solicitationId: solId, fields: [hasSummary && 'spotlightSummary', hasExpertNotes && 'expertNotes'].filter(Boolean) },
    });
    const propagation = await republishSolicitationCards({ solicitationId: solId, actorId: u.id ?? null });
    return NextResponse.json({ data: {
      ...(hasSummary ? { spotlightSummary: summary } : {}),
      ...(hasExpertNotes ? { expertNotes } : {}),
      propagation,
    } });
  } catch (error) {
    console.error('[rfp-curation] PATCH failed:', error);
    return NextResponse.json({ error: 'Failed to update solicitation', code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}

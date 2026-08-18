/**
 * Ingest Studio — the phase gate.  /api/admin/rfp-curation/[solId]/ingest-phase
 *
 * GET   the current phase, the open staged draft, its provenance audit and any adversarial
 *       verdict — everything the 4-gate panel renders.
 * POST  { action }:
 *   start     — run the phase's cohort (Extract → Matrix → Review), staging as it goes
 *   regenerate— re-run the current phase with the admin's comment threaded in as `guidance`
 *   approve   — advance to the next phase (the human gate)
 *   land      — promote the staged matrix into solicitation_compliance (the ONLY writer)
 *   auto      — chain every remaining phase; each still records its verdict, nothing is skipped
 *
 * The matrix is STAGED, never written directly: docs/INGEST_STUDIO_DESIGN.md explains why (it is
 * the one business table where we had broken our own advisory→guardrail→land-or-review rule).
 * Auto-landing is refused while the provenance audit reports a blocker — an automation policy may
 * decide how much review a sound matrix needs, it may not publish one already known to be unfounded.
 *
 * Auth: rfp_admin / master_admin (platform-scope).
 */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql } from '@/lib/db';
import { isRole, hasRoleAtLeast } from '@/lib/rbac';
import { isValidUUID } from '@/lib/validation';
import { emitEventEnd, emitEventSingle, emitEventStart, userActor } from '@/lib/events';
import { parseSolicitation } from '@/lib/ingest/parse-solicitation';
import { hasUsableSourceText, MIN_USABLE_TEXT_CHARS } from '@/lib/ingest/pattern-extract';
import {
  getIngestPhase, getOpenDraft, landSkeleton, LandBlockedError, nextPhase,
  setIngestPhase, stageSkeleton, type IngestPhase,
} from '@/lib/ingest/stage-skeleton';

interface RouteContext { params: Promise<{ solId: string }> }

const ACTIONS = ['start', 'regenerate', 'approve', 'land', 'auto'] as const;
type Action = (typeof ACTIONS)[number];

async function requireAdmin() {
  const session = await auth();
  const su = (session as { user?: { id?: string; email?: string; role?: unknown } } | null)?.user;
  const role = isRole(su?.role) ? su!.role : null;
  if (!su?.id || !role || !hasRoleAtLeast(role, 'rfp_admin')) return null;
  return { id: su.id, email: su.email ?? undefined };
}

/** Human labels for the gate panel — the phase machine's vocabulary in one place. */
const PHASE_LABEL: Record<IngestPhase, string> = {
  not_started: 'Not started',
  extract: 'Extract',
  matrix: 'Stage matrix',
  review: 'Adversarial review',
  landed: 'Landed',
  molds: 'Build molds',
  complete: 'Complete',
};

export async function GET(_req: Request, ctx: RouteContext) {
  try {
    const admin = await requireAdmin();
    if (!admin) return NextResponse.json({ error: 'rfp_admin role required', code: 'FORBIDDEN' }, { status: 403 });
    const { solId } = await ctx.params;
    if (!isValidUUID(solId)) {
      return NextResponse.json({ error: 'Invalid solicitation id', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    let phase: IngestPhase;
    let draft: Awaited<ReturnType<typeof getOpenDraft>>;
    let chars = 0;
    try {
      [phase, draft] = await Promise.all([getIngestPhase(solId), getOpenDraft(solId)]);
      const [row] = await sql<Array<{ chars: number }>>`
        SELECT coalesce(length(full_text), 0)::int AS chars
        FROM curated_solicitations WHERE id = ${solId}::uuid`;
      chars = row?.chars ?? 0;
    } catch (e) {
      console.error('[ingest-phase] load failed', e);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }

    return NextResponse.json({ data: {
      phase,
      phaseLabel: PHASE_LABEL[phase],
      nextPhase: nextPhase(phase),
      sourceReady: chars >= MIN_USABLE_TEXT_CHARS,
      sourceChars: chars,
      draft,
    } });
  } catch (e) {
    console.error('[ingest-phase] error', e);
    return NextResponse.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}

export async function POST(request: Request, ctx: RouteContext) {
  try {
    const admin = await requireAdmin();
    if (!admin) return NextResponse.json({ error: 'rfp_admin role required', code: 'FORBIDDEN' }, { status: 403 });

    const { solId } = await ctx.params;
    if (!isValidUUID(solId)) {
      return NextResponse.json({ error: 'Invalid solicitation id', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    let body: { action?: string; guidance?: string; publish?: boolean } = {};
    try { body = await request.json(); } catch { /* empty body ok */ }
    const action = (body.action ?? 'start') as Action;
    if (!ACTIONS.includes(action)) {
      return NextResponse.json(
        { error: `action must be one of ${ACTIONS.join(', ')}`, code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    let sol: { fullText: string | null; namespace: string | null; title: string | null; agency: string | null; topicNumber: string | null } | undefined;
    try {
      [sol] = await sql<typeof sol[]>`
        SELECT cs.full_text AS "fullText", cs.namespace, o.title, o.agency, o.topic_number AS "topicNumber"
        FROM curated_solicitations cs
        LEFT JOIN opportunities o ON o.id = cs.opportunity_id
        WHERE cs.id = ${solId}::uuid LIMIT 1`;
    } catch (e) {
      console.error('[ingest-phase] solicitation load failed', e);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }
    if (!sol) return NextResponse.json({ error: 'Solicitation not found', code: 'NOT_FOUND' }, { status: 404 });

    const phase = await getIngestPhase(solId);

    // ── approve: the human gate. Nothing runs; the phase simply advances. ──
    if (action === 'approve') {
      // The review gate has exactly two exits: LAND (promote the reviewed draft) or REGENERATE.
      // "Approve" here would advance the phase to 'landed' while landing nothing — a state that
      // claims a write that never happened. Refuse and name the real action.
      if (phase === 'review') {
        return NextResponse.json({
          error: 'The review gate is exited by landing the matrix (or regenerating) — approve has nothing to approve past it.',
          code: 'GATE_REQUIRES_LAND',
        }, { status: 409 });
      }
      const to = nextPhase(phase);
      const ok = await setIngestPhase(solId, to, phase);
      if (!ok) {
        return NextResponse.json({
          error: 'The phase moved while you were reviewing — reload and try again.',
          code: 'PHASE_CONFLICT',
        }, { status: 409 });
      }
      await emitPhaseEvent(solId, admin, 'approved', { from: phase, to });
      // Approving INTO the molds phase dispatches its cohort (skeleton_architect) through the
      // workflow engine — the mold job is a separate manager process, gated on a LANDED matrix
      // (docs/INGEST_STUDIO_DESIGN.md invariant 5: molds never read a staged draft).
      if (to === 'molds') {
        await emitTrigger(admin, {
          solicitationId: solId, solicitation_id: solId, phase: 'molds', auto: false,
        });
      }
      return NextResponse.json({ data: { phase: to, phaseLabel: PHASE_LABEL[to] } });
    }

    // ── land: promote the staged matrix. The only writer of solicitation_compliance. ──
    if (action === 'land') {
      try {
        const result = await landSkeleton(solId, {
          userId: admin.id, auto: false, publish: body.publish ?? false, nowIso: new Date().toISOString(),
        });
        await setIngestPhase(solId, 'landed');
        await emitPhaseEvent(solId, admin, 'landed', { ...result, auto: false });
        return NextResponse.json({ data: { phase: 'landed', phaseLabel: PHASE_LABEL.landed, ...result } });
      } catch (e) {
        if (e instanceof LandBlockedError) {
          return NextResponse.json({ error: e.message, code: 'LAND_BLOCKED', detail: { blockers: e.blockers } }, { status: 409 });
        }
        console.error('[ingest-phase] land failed', e);
        return NextResponse.json({ error: 'Failed to land the matrix', code: 'DB_ERROR' }, { status: 500 });
      }
    }

    // ── start / regenerate / auto: these need source text. Refuse rather than invent. ──
    if (!hasUsableSourceText(sol.fullText)) {
      return NextResponse.json({
        error: 'Source text not ready — the shred has not produced usable text for this solicitation yet.',
        code: 'SOURCE_TEXT_NOT_READY',
        detail: { chars: sol.fullText?.trim().length ?? 0, minChars: MIN_USABLE_TEXT_CHARS },
      }, { status: 409 });
    }

    // The extraction itself (deterministic patterns + AI over what they could not prove). This is
    // the EXTRACT and MATRIX work; it STAGES a draft and lands nothing.
    const parsed = await parseSolicitation(sol.fullText ?? '', {
      agency: sol.agency, namespace: sol.namespace, topicNumber: sol.topicNumber, title: sol.title,
    });
    const draft = await stageSkeleton(solId, parsed, {
      phase: 'matrix', guidance: body.guidance ?? null, userId: admin.id,
    });

    // Ask the agent cohort to review this draft. The pipeline picks the event up and runs the
    // adversarial fan-out; it is advisory and never lands anything, so we do not wait on it.
    // MANUAL start/regenerate dispatches the MATRIX phase (the deterministic extract + stage
    // just ran inline above; matrix_stager adds its advisory read). AUTO dispatches EXTRACT with
    // auto=true so the full chain runs through the worker — extract → matrix → review, each hop
    // made by advance_ingest_phase — and stops at the land gate. Starting auto mid-chain would
    // leave the earlier phases' agents and the chain hops themselves permanently unexercised.
    await emitTrigger(admin, {
      solicitationId: solId, solicitation_id: solId, draftId: draft.id, draft_id: draft.id,
      phase: action === 'auto' ? 'extract' : 'matrix',
      auto: action === 'auto',
      guidance: body.guidance ?? null,
      // Perspective-diverse lenses for the adversarial fan-out (docs/INGEST_STUDIO_DESIGN.md).
      lens_0: 'citation', lens_1: 'completeness', lens_2: 'consistency',
      resolution: 'majority',
    });

    const to: IngestPhase = action === 'auto' ? 'extract' : 'matrix';
    await setIngestPhase(solId, to);
    await emitPhaseEvent(solId, admin, action === 'regenerate' ? 'regenerated' : 'staged', {
      draftId: draft.id, auto: action === 'auto',
      read: (draft.audit as { read?: number })?.read ?? null,
      guidance: body.guidance ? true : false,
    });

    return NextResponse.json({ data: { phase: to, phaseLabel: PHASE_LABEL[to], draft } });
  } catch (e) {
    console.error('[ingest-phase] error', e);
    return NextResponse.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}

/**
 * Emit ingest.phase_requested as a START/END pair. The workflow processor's triggers match
 * phase='end' (the EVENT_CONTRACT start/end convention every other trigger emitter uses) — a
 * 'single' emission is recorded but NEVER fires a workflow, which is exactly the silent
 * wrong-phase failure this helper exists to make impossible to reintroduce.
 */
async function emitTrigger(
  admin: { id: string; email?: string }, payload: Record<string, unknown>,
) {
  try {
    const startId = await emitEventStart({
      namespace: 'finder', type: 'ingest.phase_requested',
      actor: userActor(admin.id, admin.email), tenantId: null, payload,
    });
    // The END row's payload IS `result` (lib/events.ts) — and the END row is what the workflow
    // trigger matches on, so the full trigger payload must ride here, not a status stub.
    await emitEventEnd(startId, { result: payload });
  } catch (e) { console.error('[ingest-phase] trigger emit failed (non-fatal)', e); }
}

/** Every gate action is auditable — the SOP is that no actor/automation step goes unrecorded. */
async function emitPhaseEvent(
  solId: string, admin: { id: string; email?: string }, what: string, payload: Record<string, unknown>,
) {
  try {
    await emitEventSingle({
      namespace: 'finder', type: `ingest.phase_${what}`,
      actor: userActor(admin.id, admin.email), tenantId: null,
      payload: { solicitationId: solId, ...payload },
    });
  } catch (e) { console.error('[ingest-phase] event emit failed (non-fatal)', e); }
}

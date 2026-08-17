/**
 * POST /api/portal/[tenantSlug]/proposals/[proposalId]/full-draft
 *
 * Proposal Draft Manager — the admin-run "Run full draft" trigger (P3 spine).
 * This is the SOLE producer of `proposal.full_draft_requested` (namespace
 * `proposal`), the event the already-built (inert) pipeline workflows
 * OnFullDraftRequested{ModeA,ModeB,ModeC} trigger on
 * (proposal:proposal.full_draft_requested:end). The workflow branches on `mode`,
 * threads the Voice-of-Proposal register, and lands every output in
 * review-staged canvas_versions — it NEVER auto-advances a gate.
 *
 * Body: { mode: 'a' | 'b' | 'c', voice?: VoiceToken[],
 *         adversarial?: boolean, adversarialPolicy?: 'hitl' | 'auto' }
 *   - mode a → V0.1 (HITL + AI enablement); b → V0.2 (controlled restyle);
 *     c → V0.5 (full auto-draft).
 *   - voice (optional) → a register over {passive, persuasive, technical,
 *     commercial, research, development}, persisted to proposals.voice and
 *     threaded into the drafting/regen prompts by the pipeline.
 *   - adversarial (optional, mode c only) → run the ADVERSARIAL GATE (P4-D): Mode C's
 *     request_overlay step emits proposal.advisory_overlay_requested to elevate the gate
 *     cohort to the reusable AdvisoryOverlay (1:n fan-out → reconcile → land). Ignored for
 *     modes a/b (no gate cohort). Default false.
 *   - adversarialPolicy (optional) → 'hitl' (default, safe) lands the overlay in a human
 *     review; 'auto' records the reconciled verdict as an advisory audit event (no human
 *     review TODO). Either way the overlay is advisory and never advances a gate. The admin
 *     chooses this explicitly at run time (like mode/voice) — the #190 gate-notification
 *     policy still governs the resulting human review's cadence.
 *
 * Auth: tenant_admin or above WITH tenant access to this proposal. RFP/master
 * admins pass via their derived shadow membership (verifyTenantAccess returns
 * true for them), so the shadow-admin "release V0.5" path is the same gate.
 *
 * IMPORTANT (event contract): the workflow trigger matches phase='end', and the
 * pipeline resolves the workflow's step inputs from the END event's payload.
 * emitEventEnd writes the END-row payload from its `result`, so the
 * workflow-facing fields — snake_case, matching the workflow input_map's
 * payload.* paths (proposal_id, tenant_id, mode, voice, opportunity_id) — are
 * carried in the emitEventEnd result. camelCase `proposalId` is added for the
 * frontend event-labels / timeline consumers.
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql, getTenantBySlug, verifyTenantAccess, enterTenant } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
// Shared with the admin "doorbell" route via the single canonical emission helper — the mode /
// voice / adversarial-policy token sets AND the emit+persist+log all live in one place so every
// full-draft request (portal or admin) audits identically. docs/ADMIN_AGENT_DESIGN.md.
import {
  requestFullDraft,
  DRAFT_MODES,
  VOICE_TOKENS,
  ADVERSARIAL_POLICIES,
  type DraftMode,
  type VoiceToken,
  type AdversarialPolicy,
} from '@/lib/proposal-full-draft';

interface RouteContext {
  params: Promise<{ tenantSlug: string; proposalId: string }>;
}

/**
 * GET /api/portal/[tenantSlug]/proposals/[proposalId]/full-draft
 *
 * Poll target for the one-click "draft & stage" orchestration (#8). Reports the LATEST
 * OnFullDraftRequested* workflow instance for this proposal so the client knows when the
 * cohort has finished producing (and can then auto-chain land-revisions). `done` is true
 * once the run is terminal-for-staging (paused = HITL landing, or completed); `failed` when
 * the run errored/cancelled; otherwise it is still running. `state:'none'` = no run yet.
 *
 * Auth mirrors POST: tenant_admin+ WITH tenant access (shadow admins pass verifyTenantAccess).
 */
export async function GET(_request: Request, ctx: RouteContext) {
  try {
    const { tenantSlug, proposalId } = await ctx.params;
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 });
    }
    const u = session.user as { id?: string; role?: unknown };
    const role: Role | null = isRole(u.role) ? u.role : null;
    if (!role || !u.id) {
      return NextResponse.json({ error: 'Invalid session', code: 'UNAUTHENTICATED' }, { status: 401 });
    }
    if (!hasRoleAtLeast(role, 'tenant_admin')) {
      return NextResponse.json({ error: 'Insufficient permissions', code: 'FORBIDDEN' }, { status: 403 });
    }
    const tenant = await getTenantBySlug(tenantSlug);
    if (!tenant) {
      return NextResponse.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, { status: 404 });
    }
    const tenantId = tenant.id as string;
    if (!(await verifyTenantAccess(u.id, role, tenantId))) {
      return NextResponse.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 });
    }
    enterTenant(tenantId);

    let latest: { status: string; startedAt: string | null } | undefined;
    try {
      [latest] = await sql<{ status: string; startedAt: string | null }[]>`
        SELECT status, started_at AS "startedAt"
        FROM process_instances
        WHERE tenant_id = ${tenantId}::uuid
          AND workflow_name LIKE 'OnFullDraftRequested%'
          AND payload->>'proposal_id' = ${proposalId}
        ORDER BY started_at DESC NULLS LAST
        LIMIT 1
      `;
    } catch (dbErr) {
      console.error('[portal/proposals/full-draft] status query failed:', dbErr);
      return NextResponse.json({ error: 'Status check failed', code: 'DB_ERROR' }, { status: 500 });
    }

    if (!latest) {
      return NextResponse.json({ data: { state: 'none', status: null, done: false, failed: false } });
    }
    // Terminal-for-staging: the cohort's output is in step_results once the run pauses (HITL landing)
    // or completes; failed/cancelled are terminal errors; anything else is still producing.
    const done = latest.status === 'paused' || latest.status === 'completed';
    const failed = latest.status === 'failed' || latest.status === 'cancelled';
    return NextResponse.json({ data: { state: 'run', status: latest.status, startedAt: latest.startedAt, done, failed } });
  } catch (err) {
    console.error('[portal/proposals/full-draft] GET error:', err);
    return NextResponse.json({ error: 'Status check failed', code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}

export async function POST(request: Request, ctx: RouteContext) {
  try {
    const { tenantSlug, proposalId } = await ctx.params;

    // ── Auth ──────────────────────────────────────────────────────
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json(
        { error: 'Authentication required', code: 'UNAUTHENTICATED' },
        { status: 401 },
      );
    }

    const sessionUser = session.user as {
      id?: string;
      email?: string;
      role?: unknown;
      tenantId?: string | null;
    };
    const role: Role | null = isRole(sessionUser.role) ? sessionUser.role : null;
    if (!role || !sessionUser.id) {
      return NextResponse.json(
        { error: 'Invalid session', code: 'UNAUTHENTICATED' },
        { status: 401 },
      );
    }

    // Role gate: tenant_admin+ (rfp_admin / master_admin clear the rank and hold
    // the derived shadow membership → the shadow-admin release path is covered).
    if (!hasRoleAtLeast(role, 'tenant_admin')) {
      return NextResponse.json(
        { error: 'Insufficient permissions', code: 'FORBIDDEN' },
        { status: 403 },
      );
    }

    // ── Tenant lookup + access ───────────────────────────────────
    const tenant = await getTenantBySlug(tenantSlug);
    if (!tenant) {
      return NextResponse.json(
        { error: 'Tenant not found', code: 'NOT_FOUND' },
        { status: 404 },
      );
    }
    const tenantId = tenant.id as string;

    const hasAccess = await verifyTenantAccess(sessionUser.id, role, tenantId);
    if (!hasAccess) {
      return NextResponse.json(
        { error: 'Forbidden', code: 'FORBIDDEN' },
        { status: 403 },
      );
    }
    enterTenant(tenantId);

    // ── Input validation ─────────────────────────────────────────
    let body: {
      mode?: unknown;
      voice?: unknown;
      adversarial?: unknown;
      adversarialPolicy?: unknown;
    };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: 'Invalid JSON body', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

    // mode ∈ {a,b,c}
    const mode = body.mode;
    if (typeof mode !== 'string' || !DRAFT_MODES.includes(mode as DraftMode)) {
      return NextResponse.json(
        { error: 'mode must be one of: a, b, c', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

    // voice (optional) — a subset of the 6 register tokens, deduped in order. An
    // empty/absent array is "no register" (null) → a byte-identical no-op in the
    // pipeline's _normalize_voice.
    let voice: VoiceToken[] | null = null;
    if (body.voice !== undefined && body.voice !== null) {
      if (!Array.isArray(body.voice)) {
        return NextResponse.json(
          { error: 'voice must be an array of register tokens', code: 'VALIDATION_ERROR' },
          { status: 400 },
        );
      }
      const seen = new Set<string>();
      const tokens: VoiceToken[] = [];
      for (const t of body.voice) {
        if (typeof t !== 'string' || !VOICE_TOKENS.includes(t as VoiceToken)) {
          return NextResponse.json(
            {
              error: `voice tokens must each be one of: ${VOICE_TOKENS.join(', ')}`,
              code: 'VALIDATION_ERROR',
            },
            { status: 400 },
          );
        }
        if (!seen.has(t)) {
          seen.add(t);
          tokens.push(t as VoiceToken);
        }
      }
      voice = tokens.length > 0 ? tokens : null;
    }

    // adversarial (optional) — the adversarial gate applies only to Mode C (the only mode
    // with a gate cohort). Coerce to a strict boolean; anything non-true is false.
    const adversarial = mode === 'c' && body.adversarial === true;

    // adversarialPolicy (optional) — validated to the exact set; defaults to the safe
    // 'hitl'. Only meaningful when adversarial is on.
    let adversarialPolicy: AdversarialPolicy = 'hitl';
    if (body.adversarialPolicy !== undefined && body.adversarialPolicy !== null) {
      if (
        typeof body.adversarialPolicy !== 'string' ||
        !ADVERSARIAL_POLICIES.includes(body.adversarialPolicy as AdversarialPolicy)
      ) {
        return NextResponse.json(
          {
            error: `adversarialPolicy must be one of: ${ADVERSARIAL_POLICIES.join(', ')}`,
            code: 'VALIDATION_ERROR',
          },
          { status: 400 },
        );
      }
      adversarialPolicy = body.adversarialPolicy as AdversarialPolicy;
    }

    // ── Business logic ───────────────────────────────────────────
    try {
      // Verify the proposal belongs to this tenant (never query by id alone) and
      // carry opportunity_id onto the event — Mode C's continuity gate reads
      // payload.opportunity_id for RFP context.
      const [proposal] = await sql<{ id: string; opportunityId: string | null }[]>`
        SELECT id, opportunity_id
        FROM proposals
        WHERE id = ${proposalId} AND tenant_id = ${tenantId}::uuid
        LIMIT 1
      `;

      if (!proposal) {
        return NextResponse.json(
          { error: 'Proposal not found', code: 'NOT_FOUND' },
          { status: 404 },
        );
      }
      const opportunityId = proposal.opportunityId ?? null;

      // Single canonical emission path — persist voice + emit
      // proposal:proposal.full_draft_requested (start/end, the workflow trigger) + log the
      // activity. Identical to the admin doorbell; `source: 'portal'` attributes it.
      await requestFullDraft({
        proposalId,
        tenantId,
        opportunityId,
        mode: mode as DraftMode,
        voice,
        adversarial,
        adversarialPolicy,
        actorId: sessionUser.id,
        actorEmail: sessionUser.email ?? null,
        role,
        source: 'portal',
      });

      return NextResponse.json({
        data: {
          requested: true,
          mode,
          adversarial,
          ...(adversarial ? { adversarialPolicy } : {}),
        },
      });
    } catch (dbErr) {
      console.error('[portal/proposals/full-draft] DB error:', dbErr);
      return NextResponse.json(
        { error: 'Full draft request failed', code: 'DB_ERROR' },
        { status: 500 },
      );
    }
  } catch (err) {
    console.error('[portal/proposals/full-draft] error:', err);
    return NextResponse.json(
      { error: 'Full draft request failed', code: 'INTERNAL_ERROR' },
      { status: 500 },
    );
  }
}

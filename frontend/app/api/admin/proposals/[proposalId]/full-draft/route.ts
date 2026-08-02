/**
 * POST /api/admin/proposals/[proposalId]/full-draft  — the Proposal Auto-Drive "Doorbell".
 *
 * The admin-plane trigger for the (already-built) tenant proposal build manager: rings
 * OnFullDraftRequested{ModeA,B,C} on a chosen tenant's proposal WITHOUT hand-descending into the
 * tenant portal. Emits the SAME `proposal:proposal.full_draft_requested` event the portal control
 * emits — via the one canonical `requestFullDraft` helper — so it's one auditable, attributable
 * record (source='admin_doorbell', actor=the admin, tenant_id=the target). The engine is unchanged;
 * this is just the admin doorbell on it. docs/ADMIN_AGENT_DESIGN.md.
 *
 * Auth: rfp_admin / master_admin (platform op). Drafts land in review-staged canvas_versions and
 * never advance a gate — advisory, exactly like the portal path.
 *
 * Body: { mode: 'a'|'b'|'c', voice?: VoiceToken[], adversarial?: boolean, adversarialPolicy?: 'hitl'|'auto' }
 */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sqlBypass, enterTenant } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
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
  params: Promise<{ proposalId: string }>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request, ctx: RouteContext) {
  try {
    const { proposalId } = await ctx.params;

    // ── Auth: rfp_admin / master_admin only (admin-plane doorbell) ──
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json(
        { error: 'Authentication required', code: 'UNAUTHENTICATED' },
        { status: 401 },
      );
    }
    const user = session.user as { id?: string; email?: string; role?: unknown };
    const role: Role | null = isRole(user.role) ? user.role : null;
    if (!role || !user.id || !hasRoleAtLeast(role, 'rfp_admin')) {
      return NextResponse.json(
        { error: 'rfp_admin or master_admin role required', code: 'FORBIDDEN' },
        { status: 403 },
      );
    }

    if (!UUID_RE.test(proposalId)) {
      return NextResponse.json(
        { error: 'Invalid proposal ID format', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

    // ── Input validation (mirrors the portal control) ──────────────
    let body: { mode?: unknown; voice?: unknown; adversarial?: unknown; adversarialPolicy?: unknown };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: 'Invalid JSON body', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

    const mode = body.mode;
    if (typeof mode !== 'string' || !DRAFT_MODES.includes(mode as DraftMode)) {
      return NextResponse.json(
        { error: 'mode must be one of: a, b, c', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

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
            { error: `voice tokens must each be one of: ${VOICE_TOKENS.join(', ')}`, code: 'VALIDATION_ERROR' },
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

    const adversarial = mode === 'c' && body.adversarial === true;
    let adversarialPolicy: AdversarialPolicy = 'hitl';
    if (body.adversarialPolicy !== undefined && body.adversarialPolicy !== null) {
      if (
        typeof body.adversarialPolicy !== 'string' ||
        !ADVERSARIAL_POLICIES.includes(body.adversarialPolicy as AdversarialPolicy)
      ) {
        return NextResponse.json(
          { error: `adversarialPolicy must be one of: ${ADVERSARIAL_POLICIES.join(', ')}`, code: 'VALIDATION_ERROR' },
          { status: 400 },
        );
      }
      adversarialPolicy = body.adversarialPolicy as AdversarialPolicy;
    }

    // ── Resolve the proposal → its tenant (cross-tenant admin read via bypass) ──
    let proposal: { id: string; tenantId: string; opportunityId: string | null } | undefined;
    try {
      [proposal] = await sqlBypass<{ id: string; tenantId: string; opportunityId: string | null }[]>`
        SELECT id, tenant_id AS "tenantId", opportunity_id AS "opportunityId"
        FROM proposals WHERE id = ${proposalId}::uuid LIMIT 1
      `;
    } catch (dbErr) {
      console.error('[admin/proposals/full-draft] proposal lookup failed:', dbErr);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }
    if (!proposal) {
      return NextResponse.json({ error: 'Proposal not found', code: 'NOT_FOUND' }, { status: 404 });
    }

    // ── Ring the doorbell through the one canonical emission path ──
    enterTenant(proposal.tenantId);
    try {
      await requestFullDraft({
        proposalId: proposal.id,
        tenantId: proposal.tenantId,
        opportunityId: proposal.opportunityId,
        mode: mode as DraftMode,
        voice,
        adversarial,
        adversarialPolicy,
        actorId: user.id,
        actorEmail: user.email ?? null,
        role,
        source: 'admin_doorbell',
      });
    } catch (emitErr) {
      console.error('[admin/proposals/full-draft] emission failed:', emitErr);
      return NextResponse.json({ error: 'Full draft request failed', code: 'DB_ERROR' }, { status: 500 });
    }

    return NextResponse.json({
      data: {
        requested: true,
        proposalId: proposal.id,
        tenantId: proposal.tenantId,
        mode,
        adversarial,
        ...(adversarial ? { adversarialPolicy } : {}),
      },
    });
  } catch (err) {
    console.error('[admin/proposals/full-draft] error:', err);
    return NextResponse.json(
      { error: 'Full draft request failed', code: 'INTERNAL_ERROR' },
      { status: 500 },
    );
  }
}

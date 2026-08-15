import { sql } from '@/lib/db';
import { withTenant } from '@/lib/rls';
import { coerceJsonb } from '@/lib/jsonb';
import { resolveGatePolicy } from '@/lib/automation/policy';
import { randomUUID } from 'crypto';
import { emitEventStart, emitEventEnd, emitEventSingle, userActor } from '@/lib/events';
import { requestAgentTask } from '@/lib/agent-client';
import { getNodeText, docNodes, type CanvasDocument } from '@/lib/types/canvas-document';
import { computeSubmissionReadiness } from '@/lib/proposal/submission-readiness';

/**
 * Shared proposal stage-advance core.
 *
 * Both the manual advance route (POST .../advance) and the lock route's
 * auto-advance path call this so the two never drift: identical gate checks,
 * snapshots, stage-history writes, optimistic-locking, events, activity log,
 * and AI-review-on-advance enqueue. Callers do their own auth/RBAC and pass
 * already-resolved, trusted inputs; this function performs no auth.
 */

/** Extract plain prose from a section's canvas JSON for AI review (not raw JSON). */
export function extractCanvasText(content: string | null): string {
  if (!content) return '';
  try {
    // Flatten either shape — a v2 section-layer doc keeps content under `sections`.
    const doc = JSON.parse(content) as CanvasDocument;
    return docNodes(doc)
      .map((n) => getNodeText(n))
      .filter(Boolean)
      .join('\n\n')
      .trim();
  } catch {
    return '';
  }
}

export interface AdvanceParams {
  tenantId: string;
  tenantSlug: string;
  proposalId: string;
  actorId: string;
  actorEmail: string | null;
  actorRole: string;
  /** Override the lock-state + legacy gate checks (admin force-advance). */
  force?: boolean;
  notes?: string | null;
  /** Explicit target gate; defaults to the next gate in gate_config. */
  targetStage?: string;
  /** Tag the activity log / advance event as an automated advance. */
  trigger?: 'manual' | 'auto';
  /** The whole-proposal readiness gate blocks submission (→final) on hard blockers; set true to
   *  submit anyway (the UI "Submit anyway" confirm). The override is recorded on the advance event. */
  acknowledgeBlockers?: boolean;
}

export interface AdvanceSuccess {
  ok: true;
  data: {
    stage: string;
    previousStage: string;
    locked: boolean;
    lockCount: number;
    lockedAt?: string;
  };
}

export interface AdvanceFailure {
  ok: false;
  status: number;
  code: string;
  error: string;
  details?: unknown;
}

export type AdvanceResult = AdvanceSuccess | AdvanceFailure;

export async function advanceProposalStage(params: AdvanceParams): Promise<AdvanceResult> {
  const {
    tenantId, tenantSlug, proposalId,
    actorId, actorEmail, actorRole,
    force = false, notes = null, trigger = 'manual',
    acknowledgeBlockers = false,
  } = params;

  // ── Load current proposal ────────────────────────────────────────
  let proposal: {
    id: string;
    stage: string;
    title: string;
    gateConfig: string[];
    lockCount: number;
    isLocked: boolean;
    version: number;
  } | undefined;
  try {
    [proposal] = await sql<{
      id: string;
      stage: string;
      title: string;
      gateConfig: string[];
      lockCount: number;
      isLocked: boolean;
      version: number;
    }[]>`
      SELECT id, stage, title, gate_config, lock_count, is_locked, version FROM proposals
      WHERE id = ${proposalId}::uuid
        AND tenant_id = ${tenantId}::uuid
      LIMIT 1
    `;
  } catch (e) {
    console.error('[proposal-advance] proposal query failed:', e);
    return { ok: false, status: 500, code: 'DB_ERROR', error: 'Internal error' };
  }

  if (!proposal) {
    return { ok: false, status: 404, code: 'NOT_FOUND', error: 'Proposal not found' };
  }

  if (proposal.isLocked) {
    return { ok: false, status: 409, code: 'LOCKED', error: 'Proposal is locked' };
  }

  // ── Determine next stage from gate_config ────────────────────────
  // gate_config can read back as a JSON STRING (postgres.js + JSON.stringify::jsonb
  // write) — coerce or .indexOf/.length/[i] silently operate on characters.
  const gates = coerceJsonb<string[]>(proposal.gateConfig, ['draft', 'final']);
  const currentIndex = gates.indexOf(proposal.stage);

  if (currentIndex === -1) {
    return { ok: false, status: 422, code: 'VALIDATION_ERROR', error: `Current stage '${proposal.stage}' is not in gate config` };
  }

  if (currentIndex >= gates.length - 1) {
    return { ok: false, status: 422, code: 'VALIDATION_ERROR', error: 'Already at the final gate, cannot advance further' };
  }

  const targetStage = typeof params.targetStage === 'string'
    ? params.targetStage
    : gates[currentIndex + 1];

  // Validate the target is the next gate
  const expectedNext = gates[currentIndex + 1];
  if (targetStage !== expectedNext) {
    return {
      ok: false, status: 422, code: 'VALIDATION_ERROR',
      error: `Cannot advance from '${proposal.stage}' to '${targetStage}'. Next gate is '${expectedNext}'.`,
    };
  }

  // ── Verify proposal has at least one section ─────────────────────
  let sectionCountCheck: { count: string }[];
  try {
    sectionCountCheck = await sql<{ count: string }[]>`
      SELECT count(*)::text FROM proposal_sections
      WHERE proposal_id = ${proposalId}::uuid
    `;
  } catch (e) {
    console.error('[proposal-advance] section count query failed:', e);
    return { ok: false, status: 500, code: 'DB_ERROR', error: 'Internal error' };
  }
  if (parseInt(sectionCountCheck[0]?.count ?? '0', 10) === 0) {
    return { ok: false, status: 422, code: 'VALIDATION_ERROR', error: 'Cannot advance a proposal with no sections' };
  }

  const previousStage = proposal.stage;
  const shouldLock = targetStage === 'final';
  // When advancing to 'final' AND auto-locking, also advance to 'submitted'
  const finalStageValue = shouldLock ? 'submitted' : targetStage;

  // ── Submission-readiness gate (the single "ready to submit" gate) ────────────
  // Advancing to 'final' LOCKS + auto-advances to 'submitted' — it IS the submission moment. Roll up
  // the whole-proposal readiness verdict (empty/unlocked sections, unmet mandatory requirements,
  // missing required forms, over-budget volumes, a closed solicitation) and HARD-BLOCK on any blocker
  // unless the caller explicitly acknowledges them (the UI's "Submit anyway" confirm). Warnings never
  // block. An admin force-advance (force=true) bypasses this, exactly as it bypasses the lock/gate
  // checks. FAIL-OPEN: a readiness-computation error must never strand a submission, so it logs and
  // allows the advance — the gate guards against known-incomplete, not against its own failure.
  let readinessOverride: { blockerCount: number; categories: string[] } | null = null;
  if (shouldLock && !force) {
    let readiness: Awaited<ReturnType<typeof computeSubmissionReadiness>> = null;
    try {
      readiness = await computeSubmissionReadiness(proposalId, tenantId);
    } catch (e) {
      console.error('[proposal-advance] readiness gate check failed (non-fatal, allowing advance):', e);
    }
    if (readiness && readiness.blockerCount > 0) {
      const hardBlockers = readiness.blockers.filter((b) => b.severity === 'blocker');
      if (!acknowledgeBlockers) {
        return {
          ok: false, status: 422, code: 'NOT_READY',
          error: `Not ready to submit — ${readiness.blockerCount} blocker(s) must be resolved (or explicitly acknowledged to submit anyway).`,
          details: { blockers: hardBlockers, summary: readiness.summary },
        };
      }
      // Acknowledged → proceed, but AUDIT what was overridden (folded into the advance event below).
      readinessOverride = {
        blockerCount: readiness.blockerCount,
        categories: [...new Set(hardBlockers.map((b) => b.category))],
      };
    }
  }

  // ── Start event for stage advancement ────────────────────────────
  const startId = await emitEventStart({
    namespace: 'proposal',
    type: 'proposal.advanced',
    actor: userActor(actorId, actorEmail ?? undefined),
    tenantId,
    payload: {
      proposalId,
      proposalTitle: proposal.title,
      previousStage,
      targetStage,
    },
  });

  // ── Update proposal stage + record history (transactional) ──────
  // Gate check is inside the transaction to prevent TOCTOU races.
  let sectionsSnapshot: { section_id: string; title: string; version: number; status: string; char_count: number; locked: boolean }[] = [];
  let completeSections = 0;
  let approvedSections = 0;
  let lockedSections = 0;
  let forcedOpenSections: { sectionId: string; title: string; volumeName: string | null }[] = [];
  try {
    await withTenant(tenantId, async (tx: any) => {
      // RLS cutover: withTenant (not sql.begin) so this transaction runs with SET LOCAL
      // app.tenant_id under govtech_app — the Proxy does not route `.begin` through context,
      // so a bare sql.begin would DENY-ALL its proposal_sections/proposals writes. (RLS_CUTOVER)
      // ── Gate: every section must be accepted + locked (all documents
      //    closed) before the proposal advances as one unit. force=true
      //    overrides but records the still-open sections as the audit trail
      //    ("forced to advance and marking open sections").
      // Gate operates at artifact scope (E1.3): sections in an OPTIONAL artifact
      // (is_required = false) do not block advance. Sections with no artifact
      // (legacy / pre-backfill) are treated as required (COALESCE true).
      const openSections = await tx<{ id: string; title: string; volumeName: string | null }[]>`
        SELECT s.id, s.title, s.volume_name
        FROM proposal_sections s
        LEFT JOIN proposal_artifacts a ON a.id = s.artifact_id
        WHERE s.proposal_id = ${proposalId}::uuid
          AND s.is_locked = false
          AND COALESCE(a.is_required, true) = true
        ORDER BY s.volume_number NULLS LAST, s.sort_index NULLS LAST, s.section_number
      `;
      if (openSections.length > 0 && !force) {
        throw new Error('SECTIONS_NOT_LOCKED:' + JSON.stringify(
          openSections.map((s: { id: string; title: string; volumeName: string | null }) =>
            ({ sectionId: s.id, title: s.title, volumeName: s.volumeName })),
        ));
      }
      forcedOpenSections = openSections.map((s: { id: string; title: string; volumeName: string | null }) =>
        ({ sectionId: s.id, title: s.title, volumeName: s.volumeName }));

      // ── Check legacy manual gate requirements inside transaction ──
      try {
        const unmetGates = await tx`
          SELECT label FROM stage_gate_requirements
          WHERE proposal_id = ${proposalId}::uuid AND stage = ${previousStage} AND is_met = false
        `;
        if (unmetGates.length > 0 && !force) {
          throw new Error('GATE_REQUIREMENTS_NOT_MET:' + JSON.stringify(unmetGates.map((g: Record<string, unknown>) => g.label)));
        }
      } catch (gateErr) {
        if (gateErr instanceof Error && gateErr.message.startsWith('GATE_REQUIREMENTS_NOT_MET:')) {
          throw gateErr;
        }
        // Check for "relation does not exist" (PostgreSQL error code 42P01)
        const pgErr = gateErr as { code?: string };
        if (pgErr.code === '42P01') {
          // Table doesn't exist yet — gate system not deployed, proceed
        } else {
          // Real DB error — do NOT silently skip
          throw gateErr;
        }
      }

      // ── 1. Snapshot all sections at their current state ────────
      const sections = await tx<{
        id: string;
        title: string;
        version: number;
        status: string;
        content: string | null;
        isLocked: boolean;
      }[]>`
        SELECT id, title, version, status, content, is_locked
        FROM proposal_sections WHERE proposal_id = ${proposalId}::uuid
        ORDER BY volume_number NULLS LAST, sort_index NULLS LAST, section_number
      `;

      sectionsSnapshot = sections.map((s: { id: string; title: string; version: number; status: string; content: string | null; isLocked: boolean }) => ({
        section_id: s.id,
        title: s.title,
        version: s.version,
        status: s.status,
        char_count: s.content ? s.content.length : 0,
        locked: s.isLocked,
      }));

      completeSections = sections.filter((s: { status: string }) => s.status === 'complete' || s.status === 'approved').length;
      approvedSections = sections.filter((s: { status: string }) => s.status === 'approved').length;
      lockedSections = sections.filter((s: { isLocked: boolean }) => s.isLocked).length;

      // ── 2. Insert stage completion snapshot ────────────────────
      await tx`
        INSERT INTO stage_completion_snapshots
          (proposal_id, stage, completed_by, sections_snapshot, total_sections,
           sections_complete, sections_approved, notes)
        VALUES (
          ${proposalId}::uuid, ${previousStage}, ${actorId}::uuid,
          ${sql.json(sectionsSnapshot)},
          ${sections.length},
          ${completeSections},
          ${approvedSections},
          ${notes}
        )
      `;

      // ── 3. Mark all sections as having passed through this stage ──────
      // Only stamp completed_stage/completed_at here. accepted_by/accepted_at
      // are owned exclusively by the section lock route — a force-advanced
      // (still-unlocked) section must NOT be recorded as "accepted", and a
      // genuinely locked section keeps the accepter from its lock, not the
      // advancing admin. Open sections are captured in forcedOpenSections.
      await tx`
        UPDATE proposal_sections
        SET completed_stage = ${previousStage},
            completed_at = now()
        WHERE proposal_id = ${proposalId}::uuid
          AND (completed_stage IS NULL OR completed_stage = ${previousStage})
      `;

      // ── 4. Create canvas version snapshots for each section ───
      for (const s of sections) {
        if (s.content) {
          // s.content is TEXT (a JSON-serialized canvas doc); canvas_versions.content is jsonb.
          // Write the PARSED object via sql.json so it round-trips as an object — NOT ${string}::jsonb,
          // which double-encodes to a jsonb STRING scalar and makes Version History render raw JSON
          // (matches the correct sibling writers in sections/.../save + admin/.../section).
          let contentJson: Parameters<typeof sql.json>[0];
          try { contentJson = JSON.parse(s.content); } catch { contentJson = s.content; }
          await tx`
            INSERT INTO canvas_versions (section_id, version_number, content, snapshot_reason, source, created_by)
            VALUES (${s.id}::uuid, ${s.version}, ${sql.json(contentJson)}, ${'stage_completed:' + previousStage}, 'system', ${actorId}::uuid)
            ON CONFLICT (section_id, version_number) DO NOTHING
          `;
        }
      }

      if (shouldLock) {
        // Advance to 'submitted' (not just 'final') and auto-lock
        const advanceResult = await tx`
          UPDATE proposals
          SET stage = 'submitted',
              is_locked = true,
              lock_count = lock_count + 1,
              last_locked_at = now(),
              version = version + 1,
              last_modified_by = ${actorId}::uuid
          WHERE id = ${proposalId}::uuid
            AND stage = ${previousStage}
            AND version = ${proposal!.version}
        `;
        if (advanceResult.count === 0) {
          throw new Error('CONFLICT');
        }
      } else {
        const advanceResult = await tx`
          UPDATE proposals
          SET stage = ${targetStage},
              version = version + 1,
              last_modified_by = ${actorId}::uuid
          WHERE id = ${proposalId}::uuid
            AND stage = ${previousStage}
            AND version = ${proposal!.version}
        `;
        if (advanceResult.count === 0) {
          throw new Error('CONFLICT');
        }
      }

      // Record the advance to the target gate
      await tx`
        INSERT INTO proposal_stage_history (proposal_id, from_stage, to_stage, changed_by, notes)
        VALUES (${proposalId}::uuid, ${previousStage}, ${targetStage}, ${actorId}::uuid, ${notes})
      `;

      // If auto-locked at final, also record the auto-advance to 'submitted'
      if (shouldLock) {
        await tx`
          INSERT INTO proposal_stage_history (proposal_id, from_stage, to_stage, changed_by, notes)
          VALUES (${proposalId}::uuid, ${targetStage}, 'submitted', ${actorId}::uuid, 'Auto-advanced on lock')
        `;
      }
    });
  } catch (e) {
    if (e instanceof Error && e.message === 'CONFLICT') {
      await emitEventEnd(startId, { error: { message: 'Stage already changed', code: 'CONFLICT' } });
      return { ok: false, status: 409, code: 'CONFLICT', error: 'Stage already changed' };
    }
    if (e instanceof Error && e.message.startsWith('GATE_REQUIREMENTS_NOT_MET:')) {
      const unmetLabels = JSON.parse(e.message.replace('GATE_REQUIREMENTS_NOT_MET:', ''));
      await emitEventEnd(startId, { error: { message: 'Unmet gate requirements', code: 'GATE_REQUIREMENTS_NOT_MET' } });
      return { ok: false, status: 422, code: 'GATE_REQUIREMENTS_NOT_MET', error: 'Unmet gate requirements', details: { unmet: unmetLabels } };
    }
    if (e instanceof Error && e.message.startsWith('SECTIONS_NOT_LOCKED:')) {
      const openSections = JSON.parse(e.message.replace('SECTIONS_NOT_LOCKED:', ''));
      await emitEventEnd(startId, { error: { message: 'Sections not locked', code: 'SECTIONS_NOT_LOCKED' } });
      return {
        ok: false, status: 422, code: 'SECTIONS_NOT_LOCKED',
        error: 'Every section must be accepted & locked before advancing (use force to override)',
        details: { openSections },
      };
    }
    console.error('[proposal-advance] stage update failed:', e);
    await emitEventEnd(startId, { error: { message: String(e), code: 'DB_ERROR' } });
    return { ok: false, status: 500, code: 'DB_ERROR', error: 'Internal error' };
  }

  // ── End event ────────────────────────────────────────────────────
  await emitEventEnd(startId, {
    result: {
      correlationId: randomUUID(),
      tenantId,
      tenantSlug,
      proposalId,
      proposalTitle: proposal.title,
      previousStage,
      targetStage,
      forced: force,
      ...(readinessOverride ? { readinessOverride } : {}),
      forcedOpenSections,
      sectionsLocked: lockedSections,
      trigger,
      ...(shouldLock ? { effectiveStage: 'submitted' } : {}),
      locked: shouldLock,
      lockCount: shouldLock ? proposal.lockCount + 1 : proposal.lockCount,
      notes: notes ?? undefined,
    },
  });

  // ── SPINE-T5: sync the portal WORKFLOW machine to the proposal BUILD machine ──────
  // When a proposal reaches 'submitted' (its build is done), move its portal to 'closeout' so the two
  // stage machines don't drift (a portal left in 'executing' behind a submitted proposal). One-way,
  // status-only (no gate skip), best-effort — it never blocks the advance.
  if (shouldLock) {
    try {
      const moved = await withTenant(tenantId, async (tx: any) => {
        const r = await tx`
          UPDATE proposal_portals SET status = 'closeout'
          WHERE tenant_id = ${tenantId}::uuid AND proposal_id = ${proposalId}::uuid
            AND status IN ('launched', 'executing')
          RETURNING id`;
        return r as Array<{ id: string }>;
      });
      if (moved.length > 0) {
        await emitEventSingle({
          namespace: 'capture', type: 'portal.stage_advanced',
          actor: userActor(actorId), tenantId,
          payload: { portalId: moved[0].id, proposalId, status: 'closeout', synced: 'proposal_submitted' },
        });
      }
    } catch (e) {
      console.error('[proposal-advance] portal closeout sync failed (non-fatal):', e);
    }
  }

  // ── Activity log ────────────────────────────────────────────────
  try {
    await sql`
      INSERT INTO proposal_activity_log
        (proposal_id, tenant_id, actor_id, actor_email, actor_role,
         activity_type, entity_version, details)
      VALUES (${proposalId}::uuid, ${tenantId}::uuid, ${actorId}::uuid,
              ${actorEmail ?? null}, ${actorRole},
              'stage_advanced', ${proposal.version + 1},
              ${sql.json({
                from_stage: previousStage,
                to_stage: finalStageValue,
                notes: notes ?? undefined,
                sections_accepted: sectionsSnapshot.length,
                sections_complete: completeSections,
                sections_approved: approvedSections,
                sections_locked: lockedSections,
                forced: force,
                forced_open: forcedOpenSections.length,
                trigger,
              })})
    `;
  } catch (logErr) {
    console.error('[proposal-advance] activity log failed', logErr);
  }

  // ── AI review on advance (customer opt-in) ───────────────────────
  // If the tenant enabled ai_review_on_advance, enqueue a per-section review
  // of the accepted (locked) content. The agent workforce reviews grammar /
  // flow / compliance and posts recommendations into each section's context
  // box (proposal_comments, recommendation_type='ai_review'). Best-effort +
  // cost-guarded downstream — never blocks the advance.
  try {
    // AI review on advance is governed by the live 'Stage advanced' automation gate — the
    // agent-capable catalog trigger 'proposal:proposal.advanced'. resolveGatePolicy defaults
    // enabled=true (regression-safe: AI review stays on unless a tenant disables the gate) and
    // honors a tenant policy row when configured. (Previously read tenant_automation_preferences,
    // which nothing writes since mig 127 introduced tenant_automation_policies.)
    const advancedGate = await resolveGatePolicy({
      tenantId,
      scope: 'build',
      triggerKey: 'proposal:proposal.advanced',
      gateDefaults: { assigneeRole: 'tenant_admin', nudgeDays: [], dueInMinutes: 0 },
    });
    if (advancedGate.enabled) {
      const reviewSections = await sql<{ id: string; title: string | null; content: string | null; sectionType: string | null }[]>`
        SELECT id, title, content, section_type
        FROM proposal_sections
        WHERE proposal_id = ${proposalId}::uuid AND is_locked = true AND content IS NOT NULL
      `;
      for (const s of reviewSections) {
        const sectionText = extractCanvasText(s.content);
        if (!sectionText) continue;
        await requestAgentTask({
          tenantId,
          agentRole: 'color_team_reviewer',
          taskType: 'review_section',
          proposalId,
          sectionId: s.id,
          input: {
            // snake_case is what color_team_reviewer.build_messages reads — camelCase alone left the
            // reviewer with empty section_text. Both cases sent for parity with the manual path.
            requested_by: actorId,
            requestedBy: actorId,
            section_title: s.title ?? '',
            sectionTitle: s.title ?? '',
            section_text: sectionText.slice(0, 20000),
            sectionText: sectionText.slice(0, 20000),
            review_type: 'red_team',
            reviewType: 'red_team',
            category: s.sectionType ?? 'review',
          },
        });
      }
    }
  } catch (reviewErr) {
    console.error('[proposal-advance] AI review enqueue failed (non-fatal):', reviewErr);
  }

  return {
    ok: true,
    data: {
      stage: finalStageValue,
      previousStage,
      locked: shouldLock,
      lockCount: shouldLock ? proposal.lockCount + 1 : proposal.lockCount,
      ...(shouldLock ? { lockedAt: new Date().toISOString() } : {}),
    },
  };
}

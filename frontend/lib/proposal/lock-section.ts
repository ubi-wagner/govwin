/**
 * The per-section accept/lock STRICTURE — the single audited unit of work.
 *
 * Extracted verbatim from the sections/[sectionId]/lock POST handler so that
 * BOTH the per-section route AND the hierarchical `lock-scope` push run the
 * identical, fully-audited side effects for every canvas they lock:
 *   1. CAS lock (only flips an UNLOCKED section; 0 rows ⇒ already locked)
 *   2. proposal:section.locked event
 *   3. compliance matrix → satisfied
 *   4. canvas_versions snapshot of the accepted version
 *   5. harvest to the legacy + unified atom libraries
 *   6. artifact roll-up (all sections locked ⇒ proposal_artifacts.is_locked)
 *   7. volume (document.locked) + proposal (advance_ready) close signals +
 *      optional auto-advance
 *
 * A hierarchical push (lock an artifact / volume / whole proposal) simply loops
 * this core over the target sections — so "simple hierarchical pushes still lock
 * and audit per canvas." The roll-ups fire naturally as the last section in each
 * scope locks.
 */
import { sql } from '@/lib/db';
import { emitEventSingle, userActor } from '@/lib/events';
import { harvestSectionToAtomLibrary } from '@/lib/proposal-atom-harvest';
import { advanceProposalStage } from '@/lib/proposal-advance';
import type { Role } from '@/lib/rbac';
import { resolveAutomationPolicy } from '@/lib/automation/policy';

export interface LockSectionCtx {
  tenantId: string;
  tenantSlug: string;
  role: Role;
  proposalId: string;
  userId: string;
  email: string | undefined;
  proposalStage: string;
  section: {
    id: string;
    title: string | null;
    volumeName: string | null;
    volumeNumber: number | null;
    artifactId: string | null;
    content: string | null;
    version: number;
  };
}

export interface LockSectionResult {
  locked: boolean;
  alreadyLocked: boolean;
  autoAdvancedTo: string | null;
}

export async function lockSectionCore(g: LockSectionCtx): Promise<LockSectionResult> {
  const { tenantId, tenantSlug, role, proposalId, userId, email, proposalStage, section } = g;

  // 1. Compare-and-swap: only flip an UNLOCKED section. Without the is_locked
  //    guard a double-submit re-runs the one-time side effects below. 0 rows ⇒
  //    already locked (caller returns the idempotent success). A DB error here
  //    propagates so the caller returns 500.
  const lockedRows = await sql<{ id: string }[]>`
    UPDATE proposal_sections
    SET status = 'approved',
        accepted_by = ${userId}::uuid,
        accepted_at = now(),
        completed_stage = ${proposalStage},
        completed_at = now(),
        is_locked = true,
        locked_at = now(),
        locked_by = ${userId}::uuid,
        editing_by = NULL,
        editing_since = NULL
    WHERE id = ${section.id}::uuid AND is_locked = false
    RETURNING id
  `;
  if (lockedRows.length === 0) {
    return { locked: false, alreadyLocked: true, autoAdvancedTo: null };
  }

  // 2. section.locked event
  try {
    await emitEventSingle({
      namespace: 'proposal',
      type: 'section.locked',
      actor: userActor(userId, email),
      tenantId,
      payload: { proposalId, sectionId: section.id, stage: proposalStage, volumeName: section.volumeName, title: section.title },
    });
  } catch (e) {
    console.error('[lockSectionCore] event emission failed:', e);
  }

  // 3. Compliance matrix: locking a section satisfies the requirements it addresses.
  try {
    await sql`
      UPDATE proposal_compliance_matrix
      SET status = 'satisfied', updated_at = now()
      WHERE section_id = ${section.id}::uuid AND status <> 'not_applicable'
    `;
  } catch (e) {
    console.error('[lockSectionCore] compliance matrix update failed (non-fatal):', e);
  }

  // 4. Snapshot the accepted canvas version.
  if (section.content) {
    try {
      await sql`
        INSERT INTO canvas_versions (section_id, version_number, content, snapshot_reason, source, created_by)
        VALUES (${section.id}::uuid, ${section.version}, ${section.content}::jsonb,
                ${'section_accepted:' + proposalStage}, 'system', ${userId}::uuid)
        ON CONFLICT (section_id, version_number) DO NOTHING
      `;
    } catch (e) {
      console.error('[lockSectionCore] canvas snapshot failed:', e);
    }
  }

  // 5. Harvest the accepted section into the CANONICAL atom library (library_atoms).
  //    The legacy library_units harvest (harvestSectionToLibrary) was removed — the
  //    unified atom spine is the single source of truth (P0-1 library cutover; the
  //    dual-write that fed the retired library_units on every accept is gone).
  try {
    await harvestSectionToAtomLibrary(tenantId, proposalId, section.id, userId);
  } catch (e) {
    console.error('[lockSectionCore] atom return failed (non-fatal):', e);
  }

  // 6. Artifact roll-up: when every section of this section's artifact is locked,
  //    atomically mark the artifact locked + emit artifact.locked.
  if (section.artifactId) {
    try {
      const locked = await sql<{ id: string; sectionCount: number }[]>`
        UPDATE proposal_artifacts a
        SET is_locked = true, status = 'locked', locked_at = now(), locked_by = ${userId}::uuid
        WHERE a.id = ${section.artifactId}::uuid
          AND a.is_locked = false
          AND EXISTS (SELECT 1 FROM proposal_sections s WHERE s.artifact_id = a.id)
          AND NOT EXISTS (
            SELECT 1 FROM proposal_sections s WHERE s.artifact_id = a.id AND s.is_locked = false
          )
        RETURNING a.id,
          (SELECT count(*)::int FROM proposal_sections s WHERE s.artifact_id = a.id) AS section_count
      `;
      if (locked.length > 0) {
        await emitEventSingle({
          namespace: 'proposal',
          type: 'artifact.locked',
          actor: userActor(userId, email),
          tenantId,
          payload: { proposalId, artifactId: section.artifactId, stage: proposalStage, sectionCount: locked[0].sectionCount },
        });
      }
    } catch (e) {
      console.error('[lockSectionCore] artifact roll-up failed (non-fatal):', e);
    }
  }

  // 7. Volume (document.locked) + proposal (advance_ready) close signals + auto-advance.
  let autoAdvancedTo: string | null = null;
  try {
    const [doc] = await sql<{ total: number; locked: number }[]>`
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE is_locked)::int AS locked
      FROM proposal_sections
      WHERE proposal_id = ${proposalId}::uuid
        AND volume_number IS NOT DISTINCT FROM ${section.volumeNumber}
    `;
    if (doc && doc.total > 0 && doc.total === doc.locked) {
      await emitEventSingle({
        namespace: 'proposal',
        type: 'document.locked',
        actor: userActor(userId, email),
        tenantId,
        payload: { proposalId, volumeName: section.volumeName, volumeNumber: section.volumeNumber, sectionCount: doc.total, stage: proposalStage },
      });
    }

    const [all] = await sql<{ total: number; locked: number }[]>`
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE is_locked)::int AS locked
      FROM proposal_sections
      WHERE proposal_id = ${proposalId}::uuid
    `;
    if (all && all.total > 0 && all.total === all.locked) {
      await emitEventSingle({
        namespace: 'proposal',
        type: 'proposal.advance_ready',
        actor: userActor(userId, email),
        tenantId,
        payload: { proposalId, stage: proposalStage, sectionCount: all.total },
      });

      try {
        const autoPolicy = await resolveAutomationPolicy(tenantId, 'proposal:sections.all_locked#auto_advance').catch(() => null);
        const autoAdvanceEnabled = autoPolicy !== null ? autoPolicy.enabled : false; // default off
        if (autoAdvanceEnabled) {
          const result = await advanceProposalStage({
            tenantId, tenantSlug, proposalId, actorId: userId, actorEmail: email ?? null,
            actorRole: role, force: false, notes: 'Auto-advanced: all sections locked', trigger: 'auto',
          });
          if (result.ok) autoAdvancedTo = result.data.stage;
          else console.error('[lockSectionCore] auto-advance skipped:', result.code);
        }
      } catch (autoErr) {
        console.error('[lockSectionCore] auto-advance failed (non-fatal):', autoErr);
      }
    }
  } catch (e) {
    console.error('[lockSectionCore] close-state signals failed:', e);
  }

  return { locked: true, alreadyLocked: false, autoAdvancedTo };
}

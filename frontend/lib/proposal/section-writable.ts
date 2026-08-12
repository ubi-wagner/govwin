/**
 * The single source of truth for "may this section be written right now?" — the immutability
 * contract the PUT …/save route enforces (SECTION_LOCKED + STAGE_LOCKED, both 423). Sibling
 * canvas-writer routes (versions/restore, accept-ai-revisions, seed-job/apply) MUST consult the
 * same rule, or they let an admin overwrite content that `save` refuses to touch:
 *
 *   1. `is_locked = true`  → the section was explicitly locked (accepted). Read-only regardless of stage.
 *   2. `completed_stage`   → set on EVERY section when the proposal advances a stage
 *      (lib/proposal-advance.ts). A section completed in a PRIOR stage is frozen even though its
 *      per-section `is_locked` may still be false — so `completed_stage !== currentStage` is read-only.
 */
export interface WritableSection {
  isLocked?: boolean | null;
  completedStage?: string | null;
}

export function isSectionWritable(
  section: WritableSection,
  proposalStage: string | null | undefined,
): boolean {
  if (section.isLocked) return false;
  if (section.completedStage && section.completedStage !== proposalStage) return false;
  return true;
}

/** Why a section is not writable — for routes that return a typed 423 (like save). */
export function sectionLockReason(
  section: WritableSection,
  proposalStage: string | null | undefined,
): { code: 'SECTION_LOCKED' | 'STAGE_LOCKED'; message: string } | null {
  if (section.isLocked) {
    return { code: 'SECTION_LOCKED', message: 'This section is locked and cannot be edited. Unlock it first.' };
  }
  if (section.completedStage && section.completedStage !== proposalStage) {
    return {
      code: 'STAGE_LOCKED',
      message: `This section was completed in the "${section.completedStage}" stage and is now read-only`,
    };
  }
  return null;
}

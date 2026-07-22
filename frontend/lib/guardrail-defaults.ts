/**
 * Recommended default portal build-workflow (pure — safe to import from client components;
 * no DB/server deps, unlike lib/portal-workflow.ts). The GuardrailEditor pre-fills this and
 * the admin edits it before launch.
 *
 * Spans purchase → close → close+30 (the closeout tail is the post-submit window). Three
 * selectable phases, each with HITL ToDos; deadlines anchor to the opportunity's close date
 * when known. Nudge cadence [5d, 2d, 1d before due] — three reminders; the 3rd (1d) is the
 * final notice (also pinged to the portal's delegated managers). Values must be positive
 * days-before-due: createTask drops non-positive entries, so an "at-due" 0 would be lost —
 * matching the platform's existing [7,3,1] date-anchored convention. Managers start empty —
 * the admin designates as many as they want per portal (a teammate or one of our experts).
 */

export interface RecommendedTodo { type: string; assigneeRole: string; title: string; dueDays: number }
export interface RecommendedStage { key: string; label: string; todos: RecommendedTodo[] }
export interface RecommendedGuardrails {
  nudgeDays: number[];
  collaborators: { email: string; role: string }[];
  stages: RecommendedStage[];
}

export function recommendedGuardrails(opts?: { closeDate?: string | Date | null; nowMs?: number }): RecommendedGuardrails {
  const close = opts?.closeDate ? new Date(opts.closeDate) : null;
  const now = opts?.nowMs ?? Date.now();
  const daysUntilClose = close && !Number.isNaN(close.getTime())
    ? Math.max(1, Math.ceil((close.getTime() - now) / 86_400_000))
    : null;
  const draftDue = daysUntilClose ? Math.max(5, daysUntilClose - 7) : 14; // ~1 week before close
  const submitDue = daysUntilClose ?? 25;                                  // submit by close

  return {
    nudgeDays: [5, 2, 1],
    collaborators: [],
    stages: [
      { key: 'kickoff', label: 'Kickoff & Compliance', todos: [
        { type: 'acknowledge', assigneeRole: 'tenant_admin', title: 'Review the compliance matrix & confirm the outline', dueDays: 5 },
        { type: 'acknowledge', assigneeRole: 'tenant_user', title: 'Acknowledge kickoff & assigned sections', dueDays: 5 },
      ] },
      { key: 'draft', label: 'Draft (V0.5)', todos: [
        { type: 'complete_sections', assigneeRole: 'tenant_user', title: 'Draft every section (V0.5)', dueDays: draftDue },
        { type: 'upload_documents', assigneeRole: 'tenant_user', title: 'Upload supporting documents', dueDays: draftDue },
      ] },
      { key: 'review', label: 'Review, Lock & Submit', todos: [
        { type: 'acknowledge', assigneeRole: 'tenant_admin', title: 'Red-team review & finalize cost', dueDays: submitDue },
        { type: 'upload_documents', assigneeRole: 'tenant_admin', title: 'Lock, export & submit the package', dueDays: submitDue },
      ] },
    ],
  };
}

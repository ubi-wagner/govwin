/**
 * ToDo catalog drift guard (HITL P1).
 *
 * INVARIANT: every task_type PRODUCED anywhere (pipeline `_create_task` StepType.TODO steps +
 * frontend `createTask`/direct `INSERT INTO tasks`) MUST have an explicit `TASK_WORKFLOWS` entry —
 * so it renders in the queue with its real workflow name/steps/completer, never collapsing to the
 * generic "broadcast note" floor. This test is the guard: when a new producer is added, add its
 * task_type both to the producer AND here (with a catalog entry), or this fails.
 *
 * Source of the producer list: docs/HITL_FRAMEWORK_MAP.md §1 (verified against source, file:line).
 */
import { describe, it, expect } from 'vitest';
import { TASK_WORKFLOWS, resolveTaskWorkflow } from '@/lib/tasks/workflows';

// Every task_type a producer actually writes into the `tasks` ledger. Keep in sync with the map.
const PRODUCED_TASK_TYPES: { type: string; producer: string }[] = [
  // ── pipeline parked TODOs (process_instance_id set) ──
  { type: 'content_publish', producer: 'pipeline on_cms_content_requested.py' },
  { type: 'triage_new_opportunities', producer: 'pipeline on_opportunities_detected.py' },
  { type: 'source_review', producer: 'pipeline on_source_change_detected.py' },
  { type: 'proposal_review', producer: 'pipeline on_proposal_advanced.py' },
  { type: 'proposal_draft_stage_review', producer: 'pipeline on_full_draft_requested.py (Mode A)' },
  { type: 'proposal_style_lock_review', producer: 'pipeline on_full_draft_requested.py (Mode B)' },
  { type: 'proposal_full_draft_review', producer: 'pipeline on_full_draft_requested.py (Mode C)' },
  { type: 'advisory_overlay_review', producer: 'pipeline advisory_overlay.py' },
  { type: 'proposal_setup', producer: 'ProjectCollaboration via purchase/stripe' },
  { type: 'contract_kickoff', producer: 'ProjectCollaboration via outcome route' },
  { type: 'admin_review', producer: 'proposals/create route + automation triggers' },
  { type: 'final_due', producer: 'pipeline manager._sweep_date_anchored_tasks' },
  // ── frontend standalone (process_instance_id NULL) ──
  { type: 'delegated_task', producer: 'tasks/assign route' },
  { type: 'broadcast', producer: 'assign form + automation notify_admin' },
  { type: 'vault_artifact_review', producer: 'lib/vaults/vaults.ts' },
  { type: 'partner_registration_triage', producer: 'lib/partner/registration.ts' },
  { type: 'manager_request', producer: 'lib/partner/manager-request.ts' },
  { type: 'starter_set_offer', producer: 'lib/library/starter-offer.ts' },
  { type: 'application_triage', producer: 'app/api/applications/route.ts' },
  { type: 'review', producer: 'lib/automation/prestage-todos.ts' },
  // ── portal build stage ToDos (lib/portal-workflow.ts createStageTodos) ──
  { type: 'complete_sections', producer: 'lib/portal-workflow.ts' },
  { type: 'upload_documents', producer: 'lib/portal-workflow.ts' },
  { type: 'acknowledge', producer: 'lib/portal-workflow.ts' },
];

describe('ToDo catalog has no drift', () => {
  it('every produced task_type has an explicit catalog entry (never collapses to broadcast)', () => {
    const orphans = PRODUCED_TASK_TYPES.filter(({ type }) => {
      if (type === 'broadcast') return false; // broadcast IS the floor — legitimately itself
      // A catalog entry exists AND resolving does not fall through to the broadcast floor.
      return !(type in TASK_WORKFLOWS) || resolveTaskWorkflow(type).key === 'broadcast';
    });
    expect(orphans, `these produced task_types collapse to the broadcast floor — add a TASK_WORKFLOWS entry: ${orphans.map((o) => `${o.type} (${o.producer})`).join(', ')}`).toEqual([]);
  });

  it('every catalog entry is well-formed (key matches, has steps + a valid completer)', () => {
    for (const [key, def] of Object.entries(TASK_WORKFLOWS)) {
      expect(def.key).toBe(key);
      expect(def.steps.length).toBeGreaterThan(0);
      expect(def.actionStep).toBeGreaterThanOrEqual(0);
      expect(def.actionStep).toBeLessThan(def.steps.length);
      expect(['review', 'upload', 'form', 'acknowledge']).toContain(def.completer);
      expect(def.producedBy.length).toBeGreaterThan(0);
    }
  });
});

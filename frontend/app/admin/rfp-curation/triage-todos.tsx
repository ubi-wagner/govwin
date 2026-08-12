/**
 * Admin triage ToDos panel (Scouting Spine M2 / C2.b) — the SINGLE completable admin inbox.
 *
 * Previously a read-only list (completion lived only on /admin/dashboard). HITL G5: it now mounts
 * the same `TaskQueue` used on the dashboard (apiBase=/api/admin/tasks), so an admin working in the
 * curation workspace sees AND completes their ToDos in place — one queue component, one query, with
 * the workflow labels + step trails + the P4 "Open →" deep-links (source / opportunity / solicitation
 * / content). No divergent read-only surface.
 */
import { TaskQueue } from '@/components/tasks/task-queue';

export default function TriageTodos() {
  return (
    <div className="mb-6">
      <TaskQueue apiBase="/api/admin/tasks" />
    </div>
  );
}

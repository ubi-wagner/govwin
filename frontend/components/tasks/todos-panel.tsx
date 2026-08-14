'use client';

/**
 * TodosPanel — the tenant ToDo surface with an inline compose affordance.
 *
 * Wraps the shared <TaskQueue> with a collapsible "＋ New to-do / broadcast"
 * composer (the same <AssignTaskForm> the cockpit drawer uses), gated to admins
 * (`canCompose`). Extracted so the Command Center To-dos tab and the standalone
 * /todos page share ONE compose+queue surface — a person creates and clears
 * to-dos in the same place, wherever they land. Base members (canCompose=false)
 * see only the queue.
 */
import { useState } from 'react';
import { TaskQueue } from './task-queue';
import { AssignTaskForm } from './assign-task-form';

export function TodosPanel({
  tenantSlug,
  canCompose,
}: {
  tenantSlug: string;
  canCompose: boolean;
}) {
  const [composeOpen, setComposeOpen] = useState(false);
  return (
    <div>
      {canCompose && (
        <div className="mb-3 rounded-lg border border-gray-200 bg-white p-3">
          <button
            onClick={() => setComposeOpen((v) => !v)}
            className="text-xs font-medium text-indigo-600 hover:text-indigo-800"
          >
            {composeOpen ? '× Cancel' : '＋ New to-do / broadcast'}
          </button>
          {composeOpen && (
            <div className="mt-3 border-t border-gray-100 pt-3">
              {/* Generic (no entity) ToDo — a delegated task or a broadcast to the team.
                  The assignee completes it in their own queue below / on their landing. */}
              <AssignTaskForm tenantSlug={tenantSlug} onAssigned={() => setComposeOpen(false)} />
            </div>
          )}
        </div>
      )}
      <TaskQueue apiBase={`/api/portal/${tenantSlug}/tasks`} tenantSlug={tenantSlug} />
    </div>
  );
}

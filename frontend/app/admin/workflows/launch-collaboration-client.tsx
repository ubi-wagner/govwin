'use client';

/**
 * Launch Review Gate — a rfp_admin form that starts a ProjectCollaboration HITL
 * gate BY HAND (M3) via POST /api/admin/workflows/launch-collaboration (the
 * GUARDED helper path, so a hand-launched gate is always well-formed).
 *
 * Use it when ops needs to park a manual review/approval on an entity that no
 * code bridge covers — e.g. a one-off admin_review on a proposal. The pipeline
 * creates the parked task within ~10s; it then shows in the assignee's queue and
 * the Process Ledger.
 */
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

const SCOPES = ['project', 'opp', 'spotlight', 'contract'] as const;
const ROLES = ['rfp_admin', 'master_admin', 'tenant_admin', 'tenant_user', 'partner_user'] as const;

type LaunchSuccess = { eventId: string; workflowName: string; trigger: string };

export function LaunchCollaborationClient() {
  const router = useRouter();
  const [scope, setScope] = useState<string>('project');
  const [opportunityId, setOpportunityId] = useState('');
  const [entityType, setEntityType] = useState('proposal');
  const [entityRef, setEntityRef] = useState('');
  const [taskType, setTaskType] = useState('admin_review');
  const [taskTitle, setTaskTitle] = useState('');
  const [assigneeRole, setAssigneeRole] = useState<string>('rfp_admin');
  const [proposalId, setProposalId] = useState('');
  const [tenantId, setTenantId] = useState('');
  const [dueHours, setDueHours] = useState('72');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<LaunchSuccess | null>(null);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!opportunityId.trim() || !entityRef.trim() || !taskTitle.trim() || !entityType.trim() || !taskType.trim()) {
      setError('Scope key, entity, task type, task title and entity ref are required.');
      return;
    }

    setSubmitting(true);
    try {
      const hours = Number(dueHours);
      const body: Record<string, unknown> = {
        scope,
        opportunityId: opportunityId.trim(),
        entityType: entityType.trim(),
        entityRef: entityRef.trim(),
        taskType: taskType.trim(),
        taskTitle: taskTitle.trim(),
        assigneeRole,
      };
      if (proposalId.trim()) body.proposalId = proposalId.trim();
      if (tenantId.trim()) body.tenantId = tenantId.trim();
      if (Number.isFinite(hours) && hours > 0) body.dueMinutes = Math.round(hours * 60);

      const res = await fetch('/api/admin/workflows/launch-collaboration', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      let data: unknown = null;
      try {
        data = await res.json();
      } catch {
        // non-JSON — fall through to status-based error
      }

      if (!res.ok) {
        const d = (data ?? {}) as { error?: string; code?: string };
        setError(d.error ? `${d.error}${d.code ? ` (${d.code})` : ''}` : `Request failed (${res.status})`);
        return;
      }

      const d = (data ?? {}) as { data?: LaunchSuccess };
      setSuccess(d.data ?? null);
      setTaskTitle('');
      setEntityRef('');
      setProposalId('');
      setTimeout(() => router.refresh(), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setSubmitting(false);
    }
  }

  const inputClass =
    'w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500';
  const labelClass = 'mb-1 block text-sm font-medium text-gray-700';

  return (
    <div className="mb-6 rounded-lg border border-gray-200 bg-white p-5">
      <div className="mb-3">
        <h2 className="text-lg font-semibold">Launch Review Gate</h2>
        <p className="text-sm text-gray-500">
          Park a manual HITL review/approval (ProjectCollaboration) on an entity. The task lands
          in the assignee&rsquo;s queue and is nudged toward its due date. For one-off gates not
          covered by an automatic bridge.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <label className={labelClass}>Scope</label>
            <select value={scope} onChange={(e) => setScope(e.target.value)} className={inputClass}>
              {SCOPES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>Assign to role</label>
            <select value={assigneeRole} onChange={(e) => setAssigneeRole(e.target.value)} className={inputClass}>
              {ROLES.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>Due in (hours)</label>
            <input
              type="number"
              min={1}
              value={dueHours}
              onChange={(e) => setDueHours(e.target.value)}
              className={inputClass}
            />
          </div>
        </div>

        <div>
          <label className={labelClass}>
            Task title <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={taskTitle}
            onChange={(e) => setTaskTitle(e.target.value)}
            placeholder="Review proposal before submission"
            className={inputClass}
          />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className={labelClass}>
              Task type <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={taskType}
              onChange={(e) => setTaskType(e.target.value)}
              placeholder="admin_review"
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>
              Entity type <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={entityType}
              onChange={(e) => setEntityType(e.target.value)}
              placeholder="proposal"
              className={inputClass}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className={labelClass}>
              Opportunity ID <span className="text-red-500">*</span>{' '}
              <span className="text-gray-400">(spine key, UUID)</span>
            </label>
            <input
              type="text"
              value={opportunityId}
              onChange={(e) => setOpportunityId(e.target.value)}
              placeholder="00000000-0000-0000-0000-000000000000"
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>
              Entity ref <span className="text-red-500">*</span>{' '}
              <span className="text-gray-400">(the entity&rsquo;s UUID)</span>
            </label>
            <input
              type="text"
              value={entityRef}
              onChange={(e) => setEntityRef(e.target.value)}
              placeholder="the proposal/opportunity id"
              className={inputClass}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className={labelClass}>
              Proposal ID <span className="text-gray-400">(optional, UUID)</span>
            </label>
            <input
              type="text"
              value={proposalId}
              onChange={(e) => setProposalId(e.target.value)}
              placeholder="project-scoped gates only"
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>
              Tenant ID <span className="text-gray-400">(optional — blank = admin gate)</span>
            </label>
            <input
              type="text"
              value={tenantId}
              onChange={(e) => setTenantId(e.target.value)}
              placeholder="owning tenant UUID"
              className={inputClass}
            />
          </div>
        </div>

        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}
        {success && (
          <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
            Launched. The pipeline will park the task within ~10s — find it in the assignee&rsquo;s
            queue or the{' '}
            <a href="/admin/processes" className="underline">
              Process Ledger
            </a>
            . <span className="text-green-600">(trigger event {success.eventId.slice(0, 8)}…)</span>
          </div>
        )}

        <div>
          <button
            type="submit"
            disabled={submitting}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? 'Launching…' : 'Launch Review Gate'}
          </button>
        </div>
      </form>
    </div>
  );
}

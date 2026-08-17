'use client';

/**
 * Per-member controls: change role (promote/demote) + deactivate/reactivate.
 * A member is never deleted — deactivating revokes their company membership (access off,
 * history kept); reactivating turns it back on. Role changes promote/demote a team member
 * between Admin (tenant_admin) and Contributor (tenant_user). tenant_admin only; the row is
 * hidden for your own account. The last active admin can't be demoted (server-guarded, and
 * the Contributor option is disabled here). See docs/MULTI_MEMBERSHIP_IDENTITY_DESIGN.md.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from '@/lib/toast';

export function TeamMemberActions({
  tenantSlug,
  userId,
  active,
  role,
  canManageBuckets = false,
  isLastAdmin = false,
}: {
  tenantSlug: string;
  userId: string;
  active: boolean;
  role: string;
  canManageBuckets?: boolean;
  isLastAdmin?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [grant, setGrant] = useState(canManageBuckets);

  async function toggle() {
    const deactivating = active;
    if (deactivating && !confirm('Deactivate this member? Their access is revoked immediately; their history is kept and you can reactivate them anytime.')) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/portal/${tenantSlug}/team/${userId}`, {
        method: deactivating ? 'DELETE' : 'POST',
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        toast.error(j.error || 'Action failed');
        setBusy(false);
        return;
      }
      router.refresh();
      // router.refresh() preserves this client component's state, so re-enable the
      // control ourselves — otherwise it stays disabled until a full navigation.
      setBusy(false);
    } catch {
      toast.error('Network error');
      setBusy(false);
    }
  }

  async function changeRole(newRole: string) {
    if (newRole === role) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/portal/${tenantSlug}/team/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: newRole }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        toast.error(j.error || 'Could not change role');
        setBusy(false);
        return;
      }
      router.refresh();
      setBusy(false);
    } catch {
      toast.error('Network error');
      setBusy(false);
    }
  }

  async function toggleBucketGrant() {
    const next = !grant;
    setBusy(true);
    try {
      const res = await fetch(`/api/portal/${tenantSlug}/team/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ canManageBuckets: next }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        toast.error(j.error || 'Could not update the grant');
        setBusy(false);
        return;
      }
      setGrant(next);
      toast.success(next ? 'Bucket management granted' : 'Bucket management revoked');
      router.refresh();
      setBusy(false);
    } catch {
      toast.error('Network error');
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      {/* Designee grant — delegate spotlight-bucket authoring to a Contributor (mig 181).
          Redundant for Admins (they already author), so shown only for active tenant_users. */}
      {active && role === 'tenant_user' && (
        <button
          onClick={toggleBucketGrant}
          disabled={busy}
          title={grant ? 'Bucket manager — click to revoke' : 'Delegate spotlight-bucket authoring to this member'}
          className={`rounded px-2 py-0.5 text-xs font-medium transition-colors disabled:opacity-50 ${
            grant ? 'bg-blue-100 text-blue-700 hover:bg-blue-200' : 'text-gray-400 hover:bg-gray-100 hover:text-gray-600'
          }`}
        >
          {grant ? 'Buckets ✓' : 'Buckets'}
        </button>
      )}
      {active && (
        <select
          value={role}
          disabled={busy}
          onChange={(e) => changeRole(e.target.value)}
          aria-label="Member role"
          className="text-xs border border-gray-200 rounded px-1.5 py-1 bg-white disabled:opacity-50"
        >
          <option value="tenant_admin">Admin</option>
          {/* Can't demote the last admin — nobody left to run the company. */}
          <option value="tenant_user" disabled={isLastAdmin && role === 'tenant_admin'}>Contributor</option>
          {/* An externally-invited member shows as External; promote them via the options above. */}
          {role === 'partner_user' && <option value="partner_user" disabled>External</option>}
        </select>
      )}
      <button
        onClick={toggle}
        disabled={busy}
        className={`rounded px-2 py-0.5 text-xs font-medium transition-colors disabled:opacity-50 ${
          active
            ? 'text-red-500 hover:bg-red-50 hover:text-red-700'
            : 'text-green-600 hover:bg-green-50 hover:text-green-800'
        }`}
      >
        {busy ? '…' : active ? 'Deactivate' : 'Reactivate'}
      </button>
    </span>
  );
}

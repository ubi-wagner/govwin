'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';

interface Collaborator {
  id: string;
  userId: string | null;
  email: string;
  name: string | null;
  role: string;
  assignedSections: string[];
  dropboxEnabled: boolean;
  invitedAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
  active: boolean;
  stageAccess: {
    collaboratorId: string;
    stage: string;
    permission: string;
    artifactTypes: string[];
  }[];
}

interface SectionInfo {
  id: string;
  title: string;
  sectionNumber: string;
}

interface TeamManagerProps {
  proposalId: string;
  tenantSlug: string;
  collaborators: Collaborator[];
  sections: SectionInfo[];
  canManage: boolean;
}

const ROLE_BADGE: Record<string, { bg: string; text: string; label: string }> = {
  admin: { bg: 'bg-red-100', text: 'text-red-600', label: 'Admin' },
  contributor: { bg: 'bg-blue-100', text: 'text-blue-600', label: 'Contributor' },
  external: { bg: 'bg-purple-100', text: 'text-purple-600', label: 'External' },
};

function getInitials(name: string | null, email: string): string {
  if (name) {
    const parts = name.split(' ').filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return parts[0]?.slice(0, 2).toUpperCase() || email.slice(0, 2).toUpperCase();
  }
  return email.slice(0, 2).toUpperCase();
}

const AVATAR_COLORS = ['bg-blue-500', 'bg-emerald-500', 'bg-purple-500', 'bg-amber-500', 'bg-rose-500'];

export function TeamManager({
  proposalId,
  tenantSlug,
  collaborators: initialCollaborators,
  sections,
  canManage,
}: TeamManagerProps) {
  const router = useRouter();
  const [collaborators, setCollaborators] = useState(initialCollaborators);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [inviteRole, setInviteRole] = useState('contributor');
  const [invitePermission, setInvitePermission] = useState('view');
  const [selectedSections, setSelectedSections] = useState<string[]>([]);
  const [inviting, setInviting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleInvite = useCallback(async () => {
    if (!inviteEmail || inviting) return;
    setInviting(true);
    setError(null);

    try {
      const res = await fetch(
        `/api/portal/${tenantSlug}/proposals/${proposalId}/collaborators`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: inviteEmail,
            name: inviteName,
            role: inviteRole,
            assignedSections: selectedSections,
            permission: invitePermission,
          }),
        },
      );
      const json = await res.json();

      if (!res.ok) {
        setError(json.error || 'Invite failed');
        return;
      }

      // Add to local state. Re-inviting a previously-inactive collaborator reactivates
      // the SAME row (same id) — upsert so it doesn't appear twice.
      const added = {
        id: json.data.id,
        userId: json.data.userId,
        email: json.data.email,
        name: json.data.name,
        role: json.data.role,
        assignedSections: json.data.assignedSections || [],
        dropboxEnabled: true,
        invitedAt: new Date().toISOString(),
        acceptedAt: null,
        revokedAt: null,
        active: true,
        stageAccess: [],
      };
      setCollaborators((prev) =>
        prev.some((c) => c.id === added.id)
          ? prev.map((c) => (c.id === added.id ? { ...c, ...added } : c))
          : [...prev, added],
      );

      setInviteEmail('');
      setInviteName('');
      setInviteRole('contributor');
      setInvitePermission('view');
      setSelectedSections([]);
      setShowInvite(false);
      router.refresh();
    } catch {
      setError('Network error');
    } finally {
      setInviting(false);
    }
  }, [inviteEmail, inviteName, inviteRole, invitePermission, selectedSections, inviting, tenantSlug, proposalId, router]);

  const toggleSection = useCallback((sectionId: string) => {
    setSelectedSections((prev) =>
      prev.includes(sectionId) ? prev.filter((s) => s !== sectionId) : [...prev, sectionId],
    );
  }, []);

  const handleRemoveCollaborator = useCallback(async (collaboratorId: string, email: string) => {
    if (!confirm(`Mark ${email} inactive on this proposal? Their access is revoked immediately. Their history is kept and you can re-invite them later.`)) return;
    try {
      const res = await fetch(
        `/api/portal/${tenantSlug}/proposals/${proposalId}/collaborators/${collaboratorId}`,
        { method: 'DELETE' },
      );
      if (!res.ok) {
        const json = await res.json();
        alert(json.error || 'Failed to remove collaborator');
        return;
      }
      // Never drop them from the list — mark inactive so their history stays visible.
      setCollaborators((prev) =>
        prev.map((c) => (c.id === collaboratorId ? { ...c, active: false, revokedAt: new Date().toISOString() } : c)),
      );
    } catch {
      alert('Network error');
    }
  }, [tenantSlug, proposalId]);

  // The Team Members list shows everyone (active + inactive, for history); the Access
  // Matrix shows only ACTIVE collaborators (inactive ones hold no access).
  const activeCollaborators = collaborators.filter((c) => c.active);

  return (
    <div className="space-y-5">
      {/* Team members */}
      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-gray-900">Team Members</h3>
          {canManage && (
            <button
              onClick={() => setShowInvite(!showInvite)}
              className="px-3 py-1.5 text-xs font-semibold bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
            >
              + Invite
            </button>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          {collaborators.map((collab, idx) => {
            const badge = ROLE_BADGE[collab.role] || ROLE_BADGE.contributor;
            const avatarColor = AVATAR_COLORS[idx % AVATAR_COLORS.length];
            return (
              <div
                key={collab.id}
                className={`flex items-center gap-3 p-3 border rounded-lg ${collab.active ? 'border-gray-200' : 'border-gray-200 bg-gray-50 opacity-60'}`}
              >
                <div
                  className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-semibold text-white flex-shrink-0 ${avatarColor}`}
                >
                  {getInitials(collab.name, collab.email)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-gray-900 truncate">
                    {collab.name || collab.email}
                  </div>
                  <div className="text-xs text-gray-400 truncate">{collab.email}</div>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <span
                    className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${badge.bg} ${badge.text}`}
                  >
                    {badge.label}
                  </span>
                  {!collab.active ? (
                    <span
                      className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-gray-200 text-gray-500"
                      title={`Inactive${collab.revokedAt ? ` since ${new Date(collab.revokedAt).toLocaleDateString()}` : ''} — re-invite to restore`}
                    >
                      Inactive
                    </span>
                  ) : !collab.acceptedAt ? (
                    <span className="text-[10px] text-amber-500 font-medium">Pending</span>
                  ) : null}
                  {canManage && collab.active && (
                    <button
                      onClick={() => handleRemoveCollaborator(collab.id, collab.email)}
                      className="text-[10px] text-red-400 hover:text-red-600 font-medium px-1 py-0.5 rounded hover:bg-red-50 transition-colors"
                      title="Mark inactive (revoke access; keeps history)"
                    >
                      ✕
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Invite form */}
      {showInvite && canManage && (
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">Invite Collaborator</h3>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <input
              type="email"
              placeholder="Email address"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              className="px-3 py-2 text-sm border border-gray-200 rounded-md focus:outline-none focus:border-blue-400"
            />
            <input
              type="text"
              placeholder="Full name"
              value={inviteName}
              onChange={(e) => setInviteName(e.target.value)}
              className="px-3 py-2 text-sm border border-gray-200 rounded-md focus:outline-none focus:border-blue-400"
            />
            <select
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value)}
              className="px-3 py-2 text-sm border border-gray-200 rounded-md focus:outline-none focus:border-blue-400"
            >
              <option value="contributor">Contributor</option>
              <option value="external">External</option>
            </select>
            <select
              value={invitePermission}
              onChange={(e) => setInvitePermission(e.target.value)}
              className="px-3 py-2 text-sm border border-gray-200 rounded-md focus:outline-none focus:border-blue-400"
            >
              <option value="view">View only</option>
              <option value="comment">Comment</option>
              <option value="edit">Edit</option>
            </select>
          </div>

          {/* Section assignment */}
          <div className="mb-4">
            <p className="text-xs font-medium text-gray-500 mb-2">Assign to sections:</p>
            <div className="flex flex-wrap gap-2">
              {sections.map((section) => (
                <button
                  key={section.id}
                  onClick={() => toggleSection(section.id)}
                  className={`px-2 py-1 text-xs rounded-md border transition-colors ${
                    selectedSections.includes(section.id)
                      ? 'bg-blue-50 border-blue-300 text-blue-700'
                      : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'
                  }`}
                >
                  {section.sectionNumber}. {section.title}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleInvite}
              disabled={!inviteEmail || inviting}
              className="px-4 py-2 text-xs font-semibold bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {inviting ? 'Sending...' : 'Send Invite'}
            </button>
            <button
              onClick={() => setShowInvite(false)}
              className="px-4 py-2 text-xs font-semibold bg-white text-gray-500 border border-gray-200 rounded-md hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
          </div>

          {error && (
            <div className="mt-2 text-xs text-red-600 bg-red-50 rounded px-3 py-1.5">
              {error}
            </div>
          )}
        </div>
      )}

      {/* Access matrix */}
      {activeCollaborators.length > 0 && sections.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">Access Matrix</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr>
                  <th className="text-left p-2 bg-gray-50 border-b border-gray-200 font-semibold text-gray-500">
                    Section
                  </th>
                  {activeCollaborators.map((c) => (
                    <th
                      key={c.id}
                      className="text-left p-2 bg-gray-50 border-b border-gray-200 font-semibold text-gray-500"
                    >
                      {c.name?.split(' ')[0] || c.email.split('@')[0]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sections.map((section) => (
                  <tr key={section.id}>
                    <td className="p-2 border-b border-gray-100 text-gray-700">
                      {section.title}
                    </td>
                    {activeCollaborators.map((c) => {
                      const isAssigned = c.assignedSections?.includes(section.id);
                      const stageAccess = c.stageAccess?.[0];
                      let perm: 'edit' | 'comment' | 'view' | 'none' = 'none';

                      if (c.role === 'admin') {
                        perm = 'edit';
                      } else if (isAssigned && stageAccess) {
                        perm = stageAccess.permission as typeof perm;
                      }

                      const permStyles: Record<string, string> = {
                        edit: 'bg-blue-100 text-blue-600',
                        comment: 'bg-amber-100 text-amber-600',
                        view: 'bg-gray-100 text-gray-400',
                        none: 'bg-white border border-gray-200 text-gray-200',
                      };

                      const permLabels: Record<string, string> = {
                        edit: 'E',
                        comment: 'C',
                        view: 'V',
                        none: '—',
                      };

                      return (
                        <td key={c.id} className="p-2 border-b border-gray-100">
                          <span
                            className={`inline-block w-5 h-5 rounded text-center leading-5 text-[9px] font-bold ${permStyles[perm]}`}
                          >
                            {permLabels[perm]}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[10px] text-gray-400 mt-2">
            E = Edit &nbsp; C = Comment &nbsp; V = View only &nbsp; — = No access
          </p>
        </div>
      )}
    </div>
  );
}

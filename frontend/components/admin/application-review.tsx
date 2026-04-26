'use client';

import { useState } from 'react';

export interface ApplicationItem {
  id: string;
  contactEmail: string;
  contactName: string;
  contactTitle: string | null;
  contactPhone: string | null;
  companyName: string;
  companyWebsite: string | null;
  companySize: string | null;
  companyState: string | null;
  samRegistered: boolean | null;
  samCageCode: string | null;
  dunsUei: string | null;
  previousSubmissions: number | null;
  previousAwards: number | null;
  previousAwardPrograms: string[];
  techSummary: string;
  techAreas: string[];
  targetPrograms: string[];
  targetAgencies: string[];
  desiredOutcomes: string[];
  motivation: string | null;
  referralSource: string | null;
  status: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNotes: string | null;
  createdAt: string;
}

interface Props {
  applications: ApplicationItem[];
}

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  under_review: 'bg-blue-100 text-blue-800',
  accepted: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-800',
  onboarded: 'bg-emerald-100 text-emerald-800',
  withdrawn: 'bg-gray-100 text-gray-500',
};

function StatusBadge({ status }: { status: string }) {
  const color = STATUS_COLORS[status] ?? 'bg-gray-100 text-gray-600';
  return (
    <span className={`inline-block px-2 py-0.5 text-xs font-medium rounded-full ${color}`}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}

function ChipBadge({ label }: { label: string }) {
  return (
    <span className="inline-block px-2 py-0.5 text-xs bg-gray-100 text-gray-700 rounded mr-1 mb-1">
      {label}
    </span>
  );
}

export function ApplicationReview({ applications }: Props) {
  const [items, setItems] = useState<ApplicationItem[]>(applications);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [acceptResult, setAcceptResult] = useState<{
    tenantId: string;
    userId: string;
    tempPassword: string;
  } | null>(null);
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});

  const toggleExpand = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
    setAcceptResult(null);
    setError(null);
  };

  const handleAccept = async (id: string) => {
    setActionLoading(id);
    setError(null);
    setAcceptResult(null);

    // Optimistic update
    setItems((prev) =>
      prev.map((a) => (a.id === id ? { ...a, status: 'accepted' } : a)),
    );

    try {
      const res = await fetch(`/api/admin/applications/${id}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewNotes: reviewNotes[id] || '' }),
      });
      const json = await res.json();
      if (!res.ok) {
        // Revert optimistic update
        setItems((prev) =>
          prev.map((a) => (a.id === id ? { ...a, status: 'pending' } : a)),
        );
        setError(json.error ?? 'Failed to accept application');
        return;
      }
      setAcceptResult(json.data);
    } catch {
      // Revert optimistic update
      setItems((prev) =>
        prev.map((a) => (a.id === id ? { ...a, status: 'pending' } : a)),
      );
      setError('Network error accepting application');
    } finally {
      setActionLoading(null);
    }
  };

  const handleReject = async (id: string) => {
    const notes = (reviewNotes[id] || '').trim();
    if (notes.length < 10) return;

    setActionLoading(id);
    setError(null);

    // Optimistic update
    setItems((prev) =>
      prev.map((a) => (a.id === id ? { ...a, status: 'rejected' } : a)),
    );

    try {
      const res = await fetch(`/api/admin/applications/${id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: notes }),
      });
      const json = await res.json();
      if (!res.ok) {
        // Revert optimistic update
        setItems((prev) =>
          prev.map((a) => (a.id === id ? { ...a, status: 'pending' } : a)),
        );
        setError(json.error ?? 'Failed to reject application');
      }
    } catch {
      // Revert optimistic update
      setItems((prev) =>
        prev.map((a) => (a.id === id ? { ...a, status: 'pending' } : a)),
      );
      setError('Network error rejecting application');
    } finally {
      setActionLoading(null);
    }
  };

  const isActionable = (status: string) =>
    status === 'pending' || status === 'under_review';

  return (
    <div className="space-y-3">
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded text-sm">
          {error}
        </div>
      )}

      {items.length === 0 && (
        <p className="text-gray-500 text-sm">No applications found.</p>
      )}

      {items.map((app) => {
        const isExpanded = expandedId === app.id;
        const isLoading = actionLoading === app.id;

        return (
          <div
            key={app.id}
            className="border border-gray-200 rounded-lg bg-white"
          >
            {/* Summary row */}
            <button
              type="button"
              className="w-full text-left px-4 py-3 flex items-center gap-4 hover:bg-gray-50"
              onClick={() => toggleExpand(app.id)}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-semibold text-sm truncate">
                    {app.companyName}
                  </span>
                  <StatusBadge status={app.status} />
                </div>
                <div className="flex items-center gap-3 text-xs text-gray-500">
                  <span>{app.contactName}</span>
                  <span>{app.contactEmail}</span>
                  <span>
                    {new Date(app.createdAt).toLocaleDateString()}
                  </span>
                </div>
              </div>
              <div className="flex-shrink-0 text-xs text-gray-400 max-w-xs truncate hidden md:block">
                {app.techSummary.length > 80
                  ? app.techSummary.slice(0, 80) + '...'
                  : app.techSummary}
              </div>
              <div className="flex-shrink-0 flex items-center gap-2 text-xs text-gray-500">
                <span>SAM: {app.samRegistered ? 'Yes' : 'No'}</span>
                <span>Subs: {app.previousSubmissions ?? 0}</span>
                <span>Awards: {app.previousAwards ?? 0}</span>
              </div>
              <div className="flex-shrink-0">
                <svg
                  className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 9l-7 7-7-7"
                  />
                </svg>
              </div>
            </button>

            {/* Expanded detail */}
            {isExpanded && (
              <div className="px-4 pb-4 border-t border-gray-100 pt-3">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                  {/* Left column */}
                  <div className="space-y-3">
                    <div>
                      <h4 className="font-medium text-gray-700 mb-1">
                        Contact
                      </h4>
                      <p>
                        {app.contactName}
                        {app.contactTitle ? ` - ${app.contactTitle}` : ''}
                      </p>
                      <p className="text-gray-500">{app.contactEmail}</p>
                      {app.contactPhone && (
                        <p className="text-gray-500">{app.contactPhone}</p>
                      )}
                    </div>
                    <div>
                      <h4 className="font-medium text-gray-700 mb-1">
                        Company
                      </h4>
                      <p>{app.companyName}</p>
                      {app.companyWebsite && (
                        <p className="text-gray-500">{app.companyWebsite}</p>
                      )}
                      <p className="text-gray-500">
                        {[app.companySize, app.companyState]
                          .filter(Boolean)
                          .join(' | ')}
                      </p>
                    </div>
                    <div>
                      <h4 className="font-medium text-gray-700 mb-1">
                        Federal Readiness
                      </h4>
                      <p>
                        SAM Registered: {app.samRegistered ? 'Yes' : 'No'}
                        {app.samCageCode ? ` (CAGE: ${app.samCageCode})` : ''}
                      </p>
                      {app.dunsUei && (
                        <p className="text-gray-500">UEI: {app.dunsUei}</p>
                      )}
                      <p className="text-gray-500">
                        Submissions: {app.previousSubmissions ?? 0} | Awards:{' '}
                        {app.previousAwards ?? 0}
                      </p>
                      {app.previousAwardPrograms.length > 0 && (
                        <div className="mt-1">
                          {app.previousAwardPrograms.map((p) => (
                            <ChipBadge key={p} label={p} />
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Right column */}
                  <div className="space-y-3">
                    <div>
                      <h4 className="font-medium text-gray-700 mb-1">
                        Technology Summary
                      </h4>
                      <p className="text-gray-600 whitespace-pre-wrap">
                        {app.techSummary}
                      </p>
                    </div>
                    {app.techAreas.length > 0 && (
                      <div>
                        <h4 className="font-medium text-gray-700 mb-1">
                          Tech Areas
                        </h4>
                        <div>
                          {app.techAreas.map((a) => (
                            <ChipBadge key={a} label={a} />
                          ))}
                        </div>
                      </div>
                    )}
                    <div>
                      <h4 className="font-medium text-gray-700 mb-1">
                        Target Programs
                      </h4>
                      <div>
                        {app.targetPrograms.map((p) => (
                          <ChipBadge key={p} label={p} />
                        ))}
                      </div>
                    </div>
                    <div>
                      <h4 className="font-medium text-gray-700 mb-1">
                        Target Agencies
                      </h4>
                      <div>
                        {app.targetAgencies.map((a) => (
                          <ChipBadge key={a} label={a} />
                        ))}
                      </div>
                    </div>
                    {app.desiredOutcomes.length > 0 && (
                      <div>
                        <h4 className="font-medium text-gray-700 mb-1">
                          Desired Outcomes
                        </h4>
                        <div>
                          {app.desiredOutcomes.map((o) => (
                            <ChipBadge key={o} label={o} />
                          ))}
                        </div>
                      </div>
                    )}
                    {app.motivation && (
                      <div>
                        <h4 className="font-medium text-gray-700 mb-1">
                          Motivation
                        </h4>
                        <p className="text-gray-600">{app.motivation}</p>
                      </div>
                    )}
                    {app.referralSource && (
                      <div>
                        <h4 className="font-medium text-gray-700 mb-1">
                          Referral
                        </h4>
                        <p className="text-gray-600">{app.referralSource}</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Accept result */}
                {acceptResult && expandedId === app.id && (
                  <div className="mt-4 bg-green-50 border border-green-200 rounded p-3 text-sm">
                    <p className="font-medium text-green-800 mb-1">
                      Application accepted - tenant and user created
                    </p>
                    <p className="text-green-700">
                      Tenant ID: {acceptResult.tenantId}
                    </p>
                    <p className="text-green-700">
                      User ID: {acceptResult.userId}
                    </p>
                    <p className="text-green-700 font-mono">
                      Temp Password: {acceptResult.tempPassword}
                    </p>
                  </div>
                )}

                {/* Review notes for already-reviewed apps */}
                {app.reviewNotes && (
                  <div className="mt-4 bg-gray-50 border border-gray-200 rounded p-3 text-sm">
                    <p className="font-medium text-gray-700 mb-1">
                      Review Notes
                    </p>
                    <p className="text-gray-600">{app.reviewNotes}</p>
                  </div>
                )}

                {/* Admin review notes + action buttons */}
                {isActionable(app.status) && (
                  <div className="mt-4 space-y-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Admin Review Notes <span className="text-red-500">*</span>
                      </label>
                      <textarea
                        value={reviewNotes[app.id] || ''}
                        onChange={(e) => setReviewNotes(prev => ({ ...prev, [app.id]: e.target.value }))}
                        rows={3}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
                        placeholder="Required: summarize your assessment, reasoning for accept/reject, and any conditions or follow-up items..."
                      />
                      {(reviewNotes[app.id] || '').trim().length < 10 && (
                        <p className="text-xs text-gray-400 mt-1">Minimum 10 characters required</p>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        disabled={isLoading || (reviewNotes[app.id] || '').trim().length < 10}
                        onClick={() => handleAccept(app.id)}
                        className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-sm font-medium rounded"
                      >
                        {isLoading ? 'Processing...' : 'Accept'}
                      </button>
                      <button
                        type="button"
                        disabled={isLoading || (reviewNotes[app.id] || '').trim().length < 10}
                        onClick={() => handleReject(app.id)}
                        className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-medium rounded"
                      >
                        {isLoading ? 'Processing...' : 'Reject'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

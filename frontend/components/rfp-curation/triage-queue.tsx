'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTool } from '@/lib/hooks/use-tool';

interface TriageItem {
  solicitationId: string;
  opportunityId: string;
  status: string;
  namespace: string | null;
  claimedBy: string | null;
  claimedAt: string | null;
  curatedBy: string | null;
  approvedBy: string | null;
  createdAt: string;
  title: string;
  source: string;
  agency: string | null;
  office: string | null;
  programType: string | null;
  closeDate: string | null;
  postedDate: string | null;
}

interface Props {
  initialItems: TriageItem[];
  currentUserId: string;
}

const STATUS_COLORS: Record<string, string> = {
  new: 'bg-blue-100 text-blue-800',
  claimed: 'bg-yellow-100 text-yellow-800',
  released_for_analysis: 'bg-purple-100 text-purple-800',
  ai_analyzed: 'bg-indigo-100 text-indigo-800',
  shredder_failed: 'bg-red-100 text-red-800',
  curation_in_progress: 'bg-orange-100 text-orange-800',
  review_requested: 'bg-cyan-100 text-cyan-800',
  approved: 'bg-green-100 text-green-800',
  pushed_to_pipeline: 'bg-emerald-100 text-emerald-800',
  dismissed: 'bg-gray-100 text-gray-500',
  rejected_review: 'bg-red-100 text-red-600',
};

const SOURCE_LABELS: Record<string, string> = {
  sam_gov: 'SAM.gov',
  sbir_gov: 'SBIR.gov',
  grants_gov: 'Grants.gov',
};

function StatusBadge({ status }: { status: string }) {
  const color = STATUS_COLORS[status] ?? 'bg-gray-100 text-gray-600';
  return (
    <span className={`inline-block px-2 py-0.5 text-xs font-medium rounded-full ${color}`}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}

export function TriageQueue({ initialItems, currentUserId }: Props) {
  const [items, setItems] = useState(initialItems);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const { invoke, loading, error } = useTool();
  const router = useRouter();

  const filteredItems = statusFilter === 'all'
    ? items
    : items.filter((i) => i.status === statusFilter);

  const handleClaim = async (solId: string) => {
    try {
      await invoke('solicitation.claim', { solicitationId: solId });
      setItems((prev) =>
        prev.map((i) =>
          i.solicitationId === solId
            ? { ...i, status: 'claimed', claimedBy: currentUserId, claimedAt: new Date().toISOString() }
            : i,
        ),
      );
    } catch {
      // error displayed via useTool
    }
  };

  const handleRelease = async (solId: string) => {
    try {
      await invoke('solicitation.release', { solicitationId: solId });
      setItems((prev) =>
        prev.map((i) =>
          i.solicitationId === solId
            ? { ...i, status: 'released_for_analysis' }
            : i,
        ),
      );
    } catch {
      // error displayed via useTool
    }
  };

  const handleDismiss = async (solId: string) => {
    const notes = prompt('Reason for dismissal (optional):');
    try {
      await invoke('solicitation.dismiss', {
        solicitationId: solId,
        notes: notes || undefined,
      });
      setItems((prev) =>
        prev.map((i) =>
          i.solicitationId === solId ? { ...i, status: 'dismissed' } : i,
        ),
      );
    } catch {
      // error displayed via useTool
    }
  };

  const handleOpenWorkspace = (solId: string) => {
    router.push(`/admin/rfp-curation/${solId}`);
  };

  const uniqueStatuses = [...new Set(items.map((i) => i.status))].sort();

  return (
    <div>
      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="flex items-center gap-3 mb-4">
        <label className="text-sm text-gray-600">Filter:</label>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="text-sm border rounded px-2 py-1"
        >
          <option value="all">All statuses ({items.length})</option>
          {uniqueStatuses.map((s) => (
            <option key={s} value={s}>
              {s.replace(/_/g, ' ')} ({items.filter((i) => i.status === s).length})
            </option>
          ))}
        </select>
        <button
          onClick={() => router.refresh()}
          className="ml-auto text-sm text-blue-600 hover:text-blue-800"
        >
          Refresh
        </button>
      </div>

      <div className="overflow-x-auto border rounded-lg">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-gray-600">
            <tr>
              <th className="px-4 py-3 font-medium">Title</th>
              <th className="px-4 py-3 font-medium">Source</th>
              <th className="px-4 py-3 font-medium">Agency</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Namespace</th>
              <th className="px-4 py-3 font-medium">Ingested</th>
              <th className="px-4 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filteredItems.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-gray-400">
                  No solicitations match this filter.
                </td>
              </tr>
            )}
            {filteredItems.map((item) => (
              <tr
                key={item.solicitationId}
                className="hover:bg-gray-50 cursor-pointer"
                onClick={() => handleOpenWorkspace(item.solicitationId)}
              >
                <td className="px-4 py-3 font-medium text-gray-900 max-w-xs truncate">
                  {item.title}
                </td>
                <td className="px-4 py-3 text-gray-600">
                  {SOURCE_LABELS[item.source] ?? item.source}
                </td>
                <td className="px-4 py-3 text-gray-600 max-w-[150px] truncate">
                  {item.agency ?? '—'}
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={item.status} />
                </td>
                <td className="px-4 py-3 text-gray-500 text-xs font-mono max-w-[180px] truncate">
                  {item.namespace ?? '—'}
                </td>
                <td className="px-4 py-3 text-gray-500">
                  {new Date(item.createdAt).toLocaleDateString()}
                </td>
                <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center gap-2">
                    {item.status === 'new' && (
                      <button
                        onClick={() => handleClaim(item.solicitationId)}
                        disabled={loading}
                        className="px-3 py-1 text-xs font-medium bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                      >
                        Claim
                      </button>
                    )}
                    {item.status === 'claimed' && item.claimedBy === currentUserId && (
                      <>
                        <button
                          onClick={() => handleRelease(item.solicitationId)}
                          disabled={loading}
                          className="px-3 py-1 text-xs font-medium bg-purple-600 text-white rounded hover:bg-purple-700 disabled:opacity-50"
                        >
                          Release for AI
                        </button>
                        <button
                          onClick={() => handleDismiss(item.solicitationId)}
                          disabled={loading}
                          className="px-3 py-1 text-xs font-medium bg-gray-300 text-gray-700 rounded hover:bg-gray-400 disabled:opacity-50"
                        >
                          Dismiss
                        </button>
                      </>
                    )}
                    {['ai_analyzed', 'curation_in_progress', 'review_requested'].includes(item.status) && (
                      <button
                        onClick={() => handleOpenWorkspace(item.solicitationId)}
                        className="px-3 py-1 text-xs font-medium bg-indigo-600 text-white rounded hover:bg-indigo-700"
                      >
                        Open
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

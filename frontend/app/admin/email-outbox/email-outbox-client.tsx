'use client';

import { useState, useCallback } from 'react';

type OutboxItem = {
  id: string;
  send_id: string;
  status: string;
  priority: number;
  category: string | null;
  recipient_preview: string | null;
  subject_preview: string | null;
  claimed_by: string | null;
  claimed_by_name: string | null;
  claimed_at: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_notes: string | null;
  created_at: string;
  updated_at: string;
  send?: {
    recipient_email: string;
    recipient_name: string | null;
    subject: string;
    body_html: string | null;
    template_id: string | null;
    campaign_id: string | null;
    tenant_id: string | null;
    send_status: string;
    was_modified: boolean;
  };
};

type OutboxStats = {
  pending: number;
  claimed: number;
  approved_today: number;
  rejected_today: number;
};

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  claimed: 'bg-blue-100 text-blue-800',
  approved: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-800',
};

const STATUS_FILTERS = ['all', 'pending', 'claimed', 'approved', 'rejected'] as const;

export function EmailOutboxClient({
  initialItems,
  initialStats,
}: {
  initialItems: OutboxItem[];
  initialStats: OutboxStats;
}) {
  const [items, setItems] = useState<OutboxItem[]>(initialItems);
  const [stats, setStats] = useState<OutboxStats>(initialStats);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchItems = useCallback(async (status: string) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ stats: 'true' });
      if (status !== 'all') params.set('status', status);
      const res = await fetch(`/api/admin/email-outbox?${params.toString()}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || 'Failed to fetch outbox');
        return;
      }
      const data = await res.json();
      setItems(data.data?.items ?? []);
      if (data.data?.stats) {
        setStats(data.data.stats);
      }
    } catch {
      setError('Failed to fetch outbox');
    } finally {
      setLoading(false);
    }
  }, []);

  const handleFilterChange = useCallback(
    (status: string) => {
      setStatusFilter(status);
      fetchItems(status);
    },
    [fetchItems],
  );

  const handleAction = useCallback(
    async (outboxId: string, action: 'approve' | 'reject' | 'claim', reason?: string) => {
      setActionLoading(outboxId);
      setError(null);
      try {
        const res = await fetch(`/api/admin/email-outbox/${outboxId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, reason }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setError(data.error || `Failed to ${action}`);
          return;
        }
        // Refresh the list
        await fetchItems(statusFilter);
      } catch {
        setError(`Failed to ${action} item`);
      } finally {
        setActionLoading(null);
      }
    },
    [fetchItems, statusFilter],
  );

  return (
    <div>
      {/* Stats bar */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="text-xs text-gray-500 uppercase tracking-wider">Pending</div>
          <div className="text-2xl font-bold text-yellow-600 mt-1">{stats.pending}</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="text-xs text-gray-500 uppercase tracking-wider">Claimed</div>
          <div className="text-2xl font-bold text-blue-600 mt-1">{stats.claimed}</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="text-xs text-gray-500 uppercase tracking-wider">Approved Today</div>
          <div className="text-2xl font-bold text-green-600 mt-1">{stats.approved_today}</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="text-xs text-gray-500 uppercase tracking-wider">Rejected Today</div>
          <div className="text-2xl font-bold text-red-600 mt-1">{stats.rejected_today}</div>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 mb-4">
        {STATUS_FILTERS.map((s) => (
          <button
            key={s}
            onClick={() => handleFilterChange(s)}
            className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
              statusFilter === s
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-gray-400 py-8">Loading...</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-gray-400 py-8">No outbox items found.</p>
      ) : (
        <div className="border border-gray-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left text-xs text-gray-500 uppercase">
                <th className="px-4 py-3 font-medium">Recipient</th>
                <th className="px-4 py-3 font-medium">Subject</th>
                <th className="px-4 py-3 font-medium">Category</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Priority</th>
                <th className="px-4 py-3 font-medium">Created</th>
                <th className="px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const recipient = item.send?.recipient_email ?? item.recipient_preview ?? '-';
                const subject = item.send?.subject ?? item.subject_preview ?? '-';
                const color = STATUS_COLORS[item.status] ?? 'bg-gray-100 text-gray-700';
                const isActionable = item.status === 'pending' || item.status === 'claimed';
                const isLoadingThis = actionLoading === item.id;

                return (
                  <tr key={item.id} className="border-t border-gray-100 hover:bg-gray-50">
                    <td className="px-4 py-3 max-w-[200px] truncate" title={recipient}>
                      {recipient}
                    </td>
                    <td className="px-4 py-3 max-w-[250px] truncate" title={subject}>
                      {subject}
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      {item.category ?? '-'}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${color}`}>
                        {item.status}
                      </span>
                      {item.claimed_by_name && (
                        <span className="block text-xs text-gray-400 mt-0.5">
                          by {item.claimed_by_name}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-center">
                      {item.priority}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                      {new Date(item.created_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-3">
                      {isActionable && (
                        <div className="flex gap-1">
                          <button
                            onClick={() => handleAction(item.id, 'approve')}
                            disabled={isLoadingThis}
                            className="px-2 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
                          >
                            {isLoadingThis ? '...' : 'Approve'}
                          </button>
                          <button
                            onClick={() => {
                              const reason = window.prompt('Rejection reason:');
                              if (reason !== null) {
                                handleAction(item.id, 'reject', reason || 'Rejected by admin');
                              }
                            }}
                            disabled={isLoadingThis}
                            className="px-2 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
                          >
                            Reject
                          </button>
                          {item.status === 'pending' && (
                            <button
                              onClick={() => handleAction(item.id, 'claim')}
                              disabled={isLoadingThis}
                              className="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                            >
                              Claim
                            </button>
                          )}
                        </div>
                      )}
                      {!isActionable && (
                        <span className="text-xs text-gray-400">
                          {item.reviewed_by ? `by ${item.reviewed_by}` : '-'}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

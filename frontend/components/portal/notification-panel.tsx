'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { eventHref } from '@/lib/event-labels';

interface Notification {
  id: string;
  type: string;
  namespace: string;
  title: string;
  summary: string | null;
  payload?: Record<string, unknown> | null;
  created_at: string;
  is_read: boolean;
  is_for_you?: boolean;
}

interface NotificationPanelProps {
  tenantSlug: string;
}

export function NotificationBell({ tenantSlug }: NotificationPanelProps) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const fetchNotifications = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/portal/${tenantSlug}/notifications?limit=20`);
      if (!res.ok) {
        const json = await res.json().catch(() => ({ error: 'Failed to load' }));
        setError(json.error || 'Failed to load notifications');
        return;
      }
      const json = await res.json();
      setNotifications(json.data?.notifications ?? []);
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  }, [tenantSlug]);

  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 60_000);
    return () => clearInterval(interval);
  }, [fetchNotifications]);

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleClick);
      return () => document.removeEventListener('mousedown', handleClick);
    }
  }, [open]);

  // Read-state is server-backed (a per-user watermark — mig 145). `newThisView` keeps the "new"
  // highlight visible during the current viewing even after we optimistically flip is_read.
  const [newThisView, setNewThisView] = useState<Set<string>>(new Set());

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  const markAllRead = useCallback(async () => {
    setNewThisView(new Set(notifications.filter((n) => !n.is_read).map((n) => n.id)));
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
    try {
      await fetch(`/api/portal/${tenantSlug}/notifications`, { method: 'POST' });
    } catch {
      /* non-fatal — the next GET reconciles from the server watermark */
    }
  }, [notifications, tenantSlug]);

  return (
    <div ref={panelRef} className="relative">
      <button
        onClick={() => {
          const next = !open;
          setOpen(next);
          if (next && unreadCount > 0) markAllRead();
        }}
        className="relative p-1.5 rounded-md hover:bg-gray-700 transition-colors"
        aria-label="Notifications"
      >
        <svg className="w-5 h-5 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
          />
        </svg>
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 bg-white border border-gray-200 rounded-lg shadow-lg z-50 max-h-96 overflow-y-auto">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-900">Notifications</h3>
            {notifications.some((n) => !n.is_read) && (
              <button onClick={markAllRead} className="text-[11px] text-indigo-600 hover:underline">
                Mark all read
              </button>
            )}
          </div>

          {loading && (
            <div className="px-4 py-6 text-center text-xs text-gray-400">Loading...</div>
          )}

          {error && (
            <div className="px-4 py-4 text-center text-xs text-red-500">{error}</div>
          )}

          {!loading && !error && notifications.length === 0 && (
            <div className="px-4 py-6 text-center text-xs text-gray-400">
              No notifications yet
            </div>
          )}

          {!loading && !error && notifications.length > 0 && (
            <ul className="divide-y divide-gray-50">
              {notifications.map((n) => {
                const isUnseen = newThisView.has(n.id);
                const href = eventHref(tenantSlug, { namespace: n.namespace, type: n.type, payload: n.payload ?? undefined });
                return (
                <li
                  key={n.id}
                  className={`px-4 py-3 hover:bg-gray-50 transition-colors ${
                    isUnseen ? 'bg-blue-50/50' : ''
                  }`}
                >
                  <div className="flex items-start gap-2">
                    {isUnseen && (
                      <span className="w-2 h-2 bg-blue-500 rounded-full mt-1.5 flex-shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      {href ? (
                        <a
                          href={href}
                          className="text-xs font-medium text-gray-900 hover:text-blue-700 truncate block"
                        >
                          {n.title}
                        </a>
                      ) : (
                        <p className="text-xs font-medium text-gray-900 truncate">{n.title}</p>
                      )}
                      {n.summary && (
                        <p className="text-[10px] text-gray-500 mt-0.5 truncate">{n.summary}</p>
                      )}
                      <p className="text-[10px] text-gray-400 mt-0.5">
                        {new Date(n.created_at).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </p>
                    </div>
                    {n.is_for_you && (
                      <span className="text-[9px] px-1 py-0.5 bg-amber-100 text-amber-700 font-medium rounded flex-shrink-0">For you</span>
                    )}
                    <span className="text-[9px] px-1 py-0.5 bg-gray-100 text-gray-500 rounded flex-shrink-0">
                      {n.namespace}
                    </span>
                  </div>
                </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

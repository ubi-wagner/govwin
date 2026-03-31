'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'

interface NotificationCenterProps {
  tenantSlug: string
}

interface Notification {
  id: string
  namespace: string
  eventType: string
  entityType: string | null
  entityId: string | null
  description: string
  link: string | null
  createdAt: string
}

const POLL_INTERVAL_MS = 60_000
const STORAGE_KEY_PREFIX = 'notifications_lastRead_'

function getLastReadKey(tenantSlug: string): string {
  return `${STORAGE_KEY_PREFIX}${tenantSlug}`
}

function getLastReadAt(tenantSlug: string): string {
  if (typeof window === 'undefined') return new Date(0).toISOString()
  try {
    return localStorage.getItem(getLastReadKey(tenantSlug)) ?? new Date(0).toISOString()
  } catch {
    return new Date(0).toISOString()
  }
}

function setLastReadAt(tenantSlug: string, iso: string): void {
  try {
    localStorage.setItem(getLastReadKey(tenantSlug), iso)
  } catch {
    // localStorage unavailable — silently ignore
  }
}

function timeAgo(dateString: string): string {
  const now = Date.now()
  const then = new Date(dateString).getTime()
  const diffMs = now - then
  if (diffMs < 0) return 'just now'

  const seconds = Math.floor(diffMs / 1000)
  if (seconds < 60) return 'just now'

  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`

  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function getNamespaceIcon(namespace: string): { icon: React.ReactNode; bgColor: string } {
  const iconClass = 'h-4 w-4'

  if (namespace.startsWith('proposal')) {
    return {
      bgColor: 'bg-purple-100 text-purple-600',
      icon: (
        <svg className={iconClass} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25ZM6.75 12h.008v.008H6.75V12Zm0 3h.008v.008H6.75V15Zm0 3h.008v.008H6.75V18Z" />
        </svg>
      ),
    }
  }

  if (namespace.startsWith('library')) {
    return {
      bgColor: 'bg-indigo-100 text-indigo-600',
      icon: (
        <svg className={iconClass} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v3.75m-16.5-3.75v3.75m16.5 0v3.75C20.25 16.153 16.556 18 12 18s-8.25-1.847-8.25-4.125v-3.75m16.5 0c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125" />
        </svg>
      ),
    }
  }

  if (namespace.startsWith('account')) {
    return {
      bgColor: 'bg-blue-100 text-blue-600',
      icon: (
        <svg className={iconClass} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
        </svg>
      ),
    }
  }

  if (namespace.startsWith('spotlight')) {
    return {
      bgColor: 'bg-amber-100 text-amber-600',
      icon: (
        <svg className={iconClass} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 18v-5.25m0 0a6.01 6.01 0 0 0 1.5-.189m-1.5.189a6.01 6.01 0 0 1-1.5-.189m3.75 7.478a12.06 12.06 0 0 1-4.5 0m3.75 2.383a14.406 14.406 0 0 1-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 1 0-7.517 0c.85.493 1.509 1.333 1.509 2.316V18" />
        </svg>
      ),
    }
  }

  if (namespace.startsWith('reminder')) {
    return {
      bgColor: 'bg-rose-100 text-rose-600',
      icon: (
        <svg className={iconClass} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0" />
        </svg>
      ),
    }
  }

  // default
  return {
    bgColor: 'bg-gray-100 text-gray-500',
    icon: (
      <svg className={iconClass} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <circle cx="12" cy="12" r="4" />
      </svg>
    ),
  }
}

function getLinkForNotification(tenantSlug: string, notification: Notification): string {
  if (notification.link) return notification.link

  const base = `/portal/${tenantSlug}`
  const entityType = notification.entityType
  const entityId = notification.entityId

  if (entityType === 'proposal' && entityId) return `${base}/proposals/${entityId}`
  if (entityType === 'spotlight' && entityId) return `${base}/spotlights/${entityId}`
  if (entityType === 'library') return `${base}/library`
  if (entityType === 'document') return `${base}/documents`
  if (entityType === 'team') return `${base}/team`
  if (entityType === 'profile' || entityType === 'account') return `${base}/profile`

  return `${base}/dashboard`
}

export function NotificationCenter({ tenantSlug }: NotificationCenterProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [loading, setLoading] = useState(false)
  const [lastReadAt, setLastReadAtState] = useState<string>(() => getLastReadAt(tenantSlug))

  const containerRef = useRef<HTMLDivElement>(null)
  const hasFetchedRef = useRef(false)

  const fetchNotifications = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/portal/${tenantSlug}/notifications?limit=20&since=${encodeURIComponent(lastReadAt)}`
      )
      if (!res.ok) return
      const json = await res.json().catch(() => ({}))
      const items: Notification[] = Array.isArray(json.data) ? json.data : []
      setNotifications(items)

      const currentLastRead = getLastReadAt(tenantSlug)
      const readTs = new Date(currentLastRead).getTime()
      const unread = items.filter((n) => new Date(n.createdAt).getTime() > readTs).length
      setUnreadCount(unread)
    } catch {
      // Fetch failed — don't crash, just leave current state
    }
  }, [tenantSlug, lastReadAt])

  // Initial fetch + polling
  useEffect(() => {
    if (!hasFetchedRef.current) {
      hasFetchedRef.current = true
      fetchNotifications()
    }

    const interval = setInterval(fetchNotifications, POLL_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [fetchNotifications])

  // Fetch fresh data when dropdown opens
  useEffect(() => {
    if (open) {
      setLoading(true)
      fetchNotifications().finally(() => setLoading(false))
    }
  }, [open, fetchNotifications])

  // Close on outside click
  useEffect(() => {
    if (!open) return

    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  function handleMarkAllRead() {
    const now = new Date().toISOString()
    setLastReadAt(tenantSlug, now)
    setLastReadAtState(now)
    setUnreadCount(0)
  }

  function handleNotificationClick(notification: Notification) {
    setOpen(false)
    const href = getLinkForNotification(tenantSlug, notification)
    router.push(href)
  }

  const readTs = new Date(lastReadAt).getTime()

  return (
    <div ref={containerRef} className="relative">
      {/* Bell button */}
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="relative rounded-lg p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2"
        aria-label="Notifications"
      >
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0" />
        </svg>

        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold leading-none text-white">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown panel */}
      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-80 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg sm:w-96">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
            <h3 className="text-sm font-semibold text-gray-900">Notifications</h3>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={handleMarkAllRead}
                className="text-xs font-medium text-brand-600 transition-colors hover:text-brand-700"
              >
                Mark all read
              </button>
            )}
          </div>

          {/* Notification list */}
          <div className="max-h-[400px] overflow-y-auto">
            {loading && notifications.length === 0 ? (
              <div className="flex items-center justify-center py-10">
                <svg
                  className="h-5 w-5 animate-spin text-gray-400"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              </div>
            ) : notifications.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-gray-400">
                <svg className="mb-2 h-8 w-8" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0" />
                </svg>
                <p className="text-sm">No notifications yet</p>
              </div>
            ) : (
              <ul className="divide-y divide-gray-100">
                {notifications.map((notification) => {
                  const isUnread = new Date(notification.createdAt).getTime() > readTs
                  const { icon, bgColor } = getNamespaceIcon(notification.namespace)

                  return (
                    <li key={notification.id}>
                      <button
                        type="button"
                        onClick={() => handleNotificationClick(notification)}
                        className={`flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-gray-50 ${
                          isUnread ? 'bg-blue-50/50' : ''
                        }`}
                      >
                        {/* Icon */}
                        <div className={`mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full ${bgColor}`}>
                          {icon}
                        </div>

                        {/* Content */}
                        <div className="min-w-0 flex-1">
                          <p className="line-clamp-2 text-sm text-gray-700">
                            {notification.description}
                          </p>
                          <p className="mt-0.5 text-xs text-gray-400">
                            {timeAgo(notification.createdAt)}
                          </p>
                        </div>

                        {/* Unread dot */}
                        {isUnread && (
                          <div className="mt-2 h-2 w-2 flex-shrink-0 rounded-full bg-blue-500" />
                        )}
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

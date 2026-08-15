'use client';

/**
 * CommandTabs — the client shell that turns the Command Center's per-tab data into the shared
 * `ui/tabs.tsx` segmented control, with a count badge on every tab label (email-badge glanceability)
 * and a scroll-safe action row above each tab body. The bodies themselves are passed in as ReactNode
 * (server-rendered lane lists, or a client `<TaskQueue>`), so this stays a thin presentational wrapper.
 *
 * When a `scope` is given, it also drives the "new since you last looked" dot (mig 179): a tab shows
 * a small accent dot when `hasNew` and the user hasn't viewed it this session; viewing a tab marks it
 * seen (optimistically clears the dot + POSTs the watermark). docs/COMMAND_CENTER_DESIGN.md §1, §6.
 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Tabs, type TabDef } from '@/components/ui/tabs';
import { CountBadge } from '@/components/ui/count-badge';

export interface QuickAction {
  label: string;
  href: string;
}

export interface CommandTabInput {
  key: string;
  title: string;
  tone: 'action' | 'shadow' | 'default';
  count: number;
  /** Server-computed: this tab has items newer than the user's last look. */
  hasNew?: boolean;
  actions: QuickAction[];
  body: React.ReactNode;
}

export function CommandTabs({
  tabs,
  initialKey,
  scope,
}: {
  tabs: CommandTabInput[];
  initialKey?: string;
  /** CC instance key ('admin' | 'tenant:<uuid>' | 'partner:<uuid>'); enables the new-dot watermark. */
  scope?: string;
}) {
  // Tabs viewed this session — clears their new-dot optimistically (the server watermark persists it).
  const [seen, setSeen] = useState<Set<string>>(new Set());

  const markSeen = useCallback(
    (tab: string) => {
      if (!scope) return;
      setSeen((s) => (s.has(tab) ? s : new Set(s).add(tab)));
      fetch('/api/command/seen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope, tab }),
      }).catch(() => {});
    },
    [scope],
  );

  // Mark the tab the user lands on as seen (the default-active tab).
  const resolvedInitial = initialKey ?? tabs[0]?.key;
  useEffect(() => {
    if (scope && resolvedInitial) markSeen(resolvedInitial);
  }, [scope, resolvedInitial, markSeen]);

  const tabDefs: TabDef[] = tabs.map((t) => {
    const showDot = !!t.hasNew && !seen.has(t.key);
    return {
      key: t.key,
      label: (
        <span className="inline-flex items-center">
          {t.title}
          <CountBadge n={t.count} tone={t.tone} />
          {showDot && (
            <span
              className="ml-1 h-1.5 w-1.5 rounded-full bg-sky-500"
              aria-label="new since your last visit"
            />
          )}
        </span>
      ),
      content: (
        <div>
          {t.actions.length > 0 && (
            <div className="-mx-1 mb-4 flex gap-2 overflow-x-auto pb-1">
              {t.actions.map((a) => (
                <Link
                  key={a.href + a.label}
                  href={a.href}
                  className="shrink-0 inline-flex items-center gap-2 min-h-11 px-4 rounded-lg border border-gray-200 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 active:bg-gray-100 transition-colors"
                >
                  {a.label}
                </Link>
              ))}
            </div>
          )}
          {t.body}
        </div>
      ),
    };
  });

  return <Tabs tabs={tabDefs} initialKey={initialKey} onChange={markSeen} className="mt-1" />;
}

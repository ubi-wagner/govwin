'use client';

/**
 * CommandTabs — the client shell that turns the Command Center's per-tab data into the shared
 * `ui/tabs.tsx` segmented control, with a count badge on every tab label (email-badge glanceability)
 * and a scroll-safe action row above each tab body. The bodies themselves are passed in as ReactNode
 * (server-rendered lane lists, or a client `<TaskQueue>`), so this stays a thin presentational wrapper.
 * docs/COMMAND_CENTER_DESIGN.md §1.
 */
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
  actions: QuickAction[];
  body: React.ReactNode;
}

export function CommandTabs({ tabs, initialKey }: { tabs: CommandTabInput[]; initialKey?: string }) {
  const tabDefs: TabDef[] = tabs.map((t) => ({
    key: t.key,
    label: (
      <span className="inline-flex items-center">
        {t.title}
        <CountBadge n={t.count} tone={t.tone} />
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
  }));

  return <Tabs tabs={tabDefs} initialKey={initialKey} className="mt-1" />;
}

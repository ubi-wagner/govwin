'use client';

/**
 * Cockpit — the non-admin tenant landing.
 *
 * Center = the company's active proposals (2–4), each a launcher into the
 * proposal workspace/canvas — or the Get Started checklist when there are none.
 * Right = a permission-adaptive IndicatorRail; tapping a tile opens a right
 * <Drawer> hosting the real domain component (ToDos, Library/Add-content,
 * Opportunities, Buckets, Activity). OPPs/Buckets appear only with the grant,
 * so the same cockpit serves a base drafter, a BD-granted user, and a descended
 * shadow admin (all grants on).
 */

import { useState } from 'react';
import Link from 'next/link';
import type { Role } from '@/lib/rbac';
import { Drawer } from '@/components/ui/drawer';
import { IndicatorRail, type Indicator } from './indicator-rail';
import { TaskQueue } from '@/components/tasks/task-queue';
import { UploadAtomizeCard } from './upload-atomize-card';
import PipelineCards from './pipeline-cards';
import SpotlightBuckets from './spotlight-buckets';

export interface CockpitProposal {
  id: string;
  title: string;
  stage: string;
  isLocked: boolean;
}

interface CockpitProps {
  tenantSlug: string;
  companyName: string;
  basePath: string;
  role: Role;
  grants: { canSeeOpps: boolean; canManageBuckets: boolean };
  proposals: CockpitProposal[];
  counts: { opps: number; todos: number; buckets: number; library: number };
  activity: Array<{ id: string; label: string; at: string }>;
  getStarted: React.ReactNode;
}

const STAGE: Record<string, { label: string; cls: string }> = {
  outline: { label: 'Outline', cls: 'bg-gray-100 text-gray-600' },
  draft: { label: 'Drafting', cls: 'bg-amber-100 text-amber-800' },
  review: { label: 'In review', cls: 'bg-indigo-100 text-indigo-700' },
  final: { label: 'Final', cls: 'bg-emerald-100 text-emerald-700' },
  submitted: { label: 'Submitted', cls: 'bg-emerald-100 text-emerald-700' },
  archived: { label: 'Archived', cls: 'bg-gray-100 text-gray-500' },
};

export function Cockpit({
  tenantSlug, companyName, basePath, role, grants, proposals, counts, activity, getStarted,
}: CockpitProps) {
  const [active, setActive] = useState<string | null>(null);
  const close = () => setActive(null);

  const indicators: Indicator[] = [
    { key: 'todos', icon: '✓', label: 'To-dos', count: counts.todos },
    { key: 'library', icon: '⬆', label: 'Library', count: counts.library },
    ...(grants.canSeeOpps
      ? ([
          { key: 'opps', icon: '◎', label: 'Opportunities', count: counts.opps },
          { key: 'buckets', icon: '▦', label: 'Buckets', count: counts.buckets },
        ] as Indicator[])
      : []),
    { key: 'activity', icon: '↻', label: 'Activity', count: null },
  ];

  const summary = [
    `${proposals.length} active build${proposals.length === 1 ? '' : 's'}`,
    grants.canSeeOpps ? `${counts.opps} opportunit${counts.opps === 1 ? 'y' : 'ies'}` : null,
    `${counts.todos} to-do${counts.todos === 1 ? '' : 's'}`,
  ].filter(Boolean).join(' · ');

  return (
    <div className="flex gap-6">
      <div className="flex-1 min-w-0">
        <h1 className="text-2xl font-bold">Welcome back, {companyName}</h1>
        <p className="text-sm text-gray-500 mt-1 mb-6">{summary}</p>

        {proposals.length > 0 ? (
          <>
            <h2 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">Continue building</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {proposals.map((p) => {
                const st = STAGE[p.stage] ?? { label: p.stage, cls: 'bg-gray-100 text-gray-600' };
                return (
                  <Link
                    key={p.id}
                    href={`${basePath}/proposals/${p.id}`}
                    className="block bg-white border border-gray-200 rounded-xl p-4 hover:border-indigo-300 hover:shadow-sm transition"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className={`text-[11px] font-semibold px-2 py-0.5 rounded ${st.cls}`}>{st.label}</span>
                      {p.isLocked && <span className="text-[11px] text-gray-400">🔒 locked</span>}
                    </div>
                    <h3 className="text-sm font-semibold text-gray-900 truncate">{p.title}</h3>
                    <span className="text-xs text-indigo-600 font-medium mt-3 inline-block">Open canvas →</span>
                  </Link>
                );
              })}
            </div>
          </>
        ) : (
          <div>{getStarted}</div>
        )}
      </div>

      <IndicatorRail indicators={indicators} activeKey={active} onSelect={(k) => setActive((a) => (a === k ? null : k))} />

      {/* Drawers — pure overlays; content mounts (and self-loads) only when open. */}
      <Drawer open={active === 'todos'} onClose={close} side="right" width="w-96" ariaLabel="To-dos">
        <DrawerShell title="To-dos" onClose={close}>
          <TaskQueue apiBase={`/api/portal/${tenantSlug}/tasks`} tenantSlug={tenantSlug} />
        </DrawerShell>
      </Drawer>

      <Drawer open={active === 'library'} onClose={close} side="right" width="w-96" ariaLabel="Library and content">
        <DrawerShell title="Library & content" onClose={close}>
          {/* Launchers into the canvas surfaces — upload/atomize, screenshot
              annotation, a fresh document canvas, or browse the library. */}
          <div className="grid grid-cols-2 gap-2 mb-4">
            {[
              { href: `${basePath}/atoms?tab=atomize`, icon: '📤', label: 'Upload & atomize' },
              { href: `${basePath}/atoms?tab=capture`, icon: '✂️', label: 'Capture & annotate' },
              { href: `${basePath}/documents/new`, icon: '➕', label: 'New document' },
              { href: `${basePath}/atoms`, icon: '🗂️', label: 'Browse library' },
            ].map((l) => (
              <Link key={l.label} href={l.href} className="flex flex-col gap-1 rounded-lg border border-gray-200 p-3 text-xs font-medium text-gray-700 hover:border-indigo-300 hover:bg-indigo-50">
                <span className="text-lg leading-none" aria-hidden>{l.icon}</span>
                {l.label}
              </Link>
            ))}
          </div>
          <UploadAtomizeCard tenantSlug={tenantSlug} />
        </DrawerShell>
      </Drawer>

      {grants.canSeeOpps && (
        <>
          <Drawer open={active === 'opps'} onClose={close} side="right" width="w-[440px]" ariaLabel="Opportunities">
            <DrawerShell title="Opportunities" onClose={close}>
              <PipelineCards tenantSlug={tenantSlug} role={role} />
            </DrawerShell>
          </Drawer>
          <Drawer open={active === 'buckets'} onClose={close} side="right" width="w-[440px]" ariaLabel="Buckets">
            <DrawerShell title="Spotlight buckets" onClose={close}>
              <SpotlightBuckets tenantSlug={tenantSlug} canEdit={grants.canManageBuckets} />
            </DrawerShell>
          </Drawer>
        </>
      )}

      <Drawer open={active === 'activity'} onClose={close} side="right" width="w-96" ariaLabel="Activity">
        <DrawerShell title="Recent activity" onClose={close}>
          {activity.length === 0 ? (
            <p className="text-sm text-gray-400">No recent activity yet.</p>
          ) : (
            <ul className="divide-y divide-gray-100 border border-gray-200 rounded-lg bg-white">
              {activity.map((e) => (
                <li key={e.id} className="px-3 py-2.5 text-sm">
                  <span className="text-gray-700 block">{e.label}</span>
                  <span className="text-gray-400 text-xs">{e.at}</span>
                </li>
              ))}
            </ul>
          )}
        </DrawerShell>
      </Drawer>
    </div>
  );
}

function DrawerShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-semibold text-gray-900">{title}</h2>
        <button onClick={onClose} aria-label="Close" className="text-gray-400 hover:text-gray-700 text-xl leading-none">✕</button>
      </div>
      {children}
    </div>
  );
}

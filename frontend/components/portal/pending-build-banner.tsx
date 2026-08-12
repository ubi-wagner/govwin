'use client';

/**
 * PendingBuildBanner — surfaces an in-flight purchase on the customer's DASHBOARD.
 *
 * After a comp-code purchase a portal sits in `curation_pending` (72h RFP-expert SLA) with
 * proposal_id still null — so it never appeared in the cockpit's "active builds" grid, and the
 * dashboard silently showed the Get-Started checklist instead. A returning customer during the
 * wait saw NO sign their purchase worked (the #1 "did it go through?" support ticket). This shows
 * the pending build + a live SLA countdown, mirroring the Builds-tab card, with a deep link to track it.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';

export interface PendingBuild { id: string; label: string; opportunityId: string; status: string; curationDueAt: string | null }

/** "2d 3h 41m" until `iso`, or overdue once past (mirrors proposal-portals.tsx). */
function remainingUntil(iso: string, nowMs: number): { text: string; overdue: boolean } {
  const ms = new Date(iso).getTime() - nowMs;
  if (ms <= 0) return { text: 'overdue', overdue: true };
  const m = Math.floor(ms / 60000);
  const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), min = m % 60;
  return { text: `${d > 0 ? `${d}d ` : ''}${h}h ${min}m`, overdue: false };
}

export function PendingBuildBanner({ builds, basePath }: { builds: PendingBuild[]; basePath: string }) {
  const [now, setNow] = useState(0); // 0 until mounted — avoids SSR hydration mismatch on the clock
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  if (!builds.length) return null;
  return (
    <div className="mb-6 space-y-3">
      {builds.map((b) => {
        const curating = b.status === 'curation_pending';
        return (
          <div key={b.id} className="rounded-xl border border-amber-200 bg-amber-50 p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <span className="inline-block h-2 w-2 rounded-full bg-amber-500 animate-pulse shrink-0" />
                <span className="text-sm font-semibold text-amber-900 truncate">
                  {curating ? 'Your build is being prepared' : 'Configure your build to launch'}
                  {b.label && b.label !== 'primary' ? ` · ${b.label}` : ''}
                </span>
              </div>
              <Link href={`${basePath}/portals`} className="text-xs font-medium text-white bg-amber-600 hover:bg-amber-700 rounded px-3 py-1 shrink-0">
                Track your build →
              </Link>
            </div>
            <p className="text-xs text-amber-700 mt-1.5">
              {curating
                ? 'Purchase received. Our RFP expert is building your compliance matrix, volumes, and section molds. Your editable workspace unlocks the moment it’s released.'
                : 'Your workspace is provisioned — set your guardrails and launch it when you’re ready.'}
            </p>
            {curating && b.curationDueAt && now > 0 && (() => {
              const r = remainingUntil(b.curationDueAt, now);
              return (
                <p className={`text-xs mt-1 font-mono ${r.overdue ? 'text-rose-600' : 'text-amber-600'}`}>
                  Expert SLA: {r.overdue ? 'past 72h target' : `${r.text} remaining`}
                </p>
              );
            })()}
          </div>
        );
      })}
    </div>
  );
}

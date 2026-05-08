'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';

interface StageControlProps {
  proposalId: string;
  tenantSlug: string;
  currentStage: string;
  gateConfig: string[];
  isLocked: boolean;
  lockCount: number;
  downloadCount: number;
  unlockDeadline: string | null;
  canAdvance: boolean;
  canExport: boolean;
  closeDate?: string | null;
}

export function StageControl({
  proposalId,
  tenantSlug,
  currentStage,
  gateConfig,
  isLocked,
  lockCount,
  downloadCount,
  unlockDeadline,
  canAdvance,
  canExport,
  closeDate,
}: StageControlProps) {
  const router = useRouter();
  const [advancing, setAdvancing] = useState(false);
  const [locking, setLocking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentIndex = gateConfig.indexOf(currentStage);
  const isAtFinal = currentStage === 'final';
  const isAtLastGate = currentIndex >= gateConfig.length - 1;

  // Format deadline
  const deadlineStr = unlockDeadline
    ? new Date(unlockDeadline).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : null;

  const closeDateStr = closeDate
    ? new Date(closeDate).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : null;

  const daysUntilClose = closeDate
    ? Math.ceil((new Date(closeDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    : null;

  const handleAdvance = useCallback(async () => {
    if (!canAdvance || advancing) return;
    setAdvancing(true);
    setError(null);

    try {
      const res = await fetch(
        `/api/portal/${tenantSlug}/proposals/${proposalId}/advance`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        },
      );
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || 'Failed to advance stage');
        return;
      }
      router.refresh();
    } catch {
      setError('Network error');
    } finally {
      setAdvancing(false);
    }
  }, [canAdvance, advancing, tenantSlug, proposalId, router]);

  const handleLock = useCallback(async () => {
    if (locking) return;
    setLocking(true);
    setError(null);

    try {
      const res = await fetch(
        `/api/portal/${tenantSlug}/proposals/${proposalId}/lock`,
        { method: 'POST' },
      );
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || 'Failed to lock');
        return;
      }
      router.refresh();
    } catch {
      setError('Network error');
    } finally {
      setLocking(false);
    }
  }, [locking, tenantSlug, proposalId, router]);

  const handleUnlock = useCallback(async () => {
    if (locking) return;
    setLocking(true);
    setError(null);

    try {
      const res = await fetch(
        `/api/portal/${tenantSlug}/proposals/${proposalId}/lock`,
        { method: 'DELETE' },
      );
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || 'Failed to unlock');
        return;
      }
      router.refresh();
    } catch {
      setError('Network error');
    } finally {
      setLocking(false);
    }
  }, [locking, tenantSlug, proposalId, router]);

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 mb-5">
      <div className="flex items-center justify-between">
        {/* Stage progress dots */}
        <div className="flex items-center gap-0">
          {gateConfig.map((gate, idx) => {
            const isDone = idx < currentIndex;
            const isCurrent = idx === currentIndex;
            const label = gate.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

            return (
              <div key={gate} className="flex items-center">
                <div className="flex items-center gap-2">
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold ${
                      isDone
                        ? 'bg-emerald-500 text-white'
                        : isCurrent
                          ? 'bg-blue-600 text-white shadow-[0_0_0_4px_rgba(37,99,235,0.2)]'
                          : 'bg-gray-200 text-gray-400'
                    }`}
                  >
                    {isDone ? '✓' : idx + 1}
                  </div>
                  <span className="text-xs font-medium mr-4">{label}</span>
                </div>
                {idx < gateConfig.length - 1 && (
                  <div
                    className={`w-10 h-0.5 mx-1 ${isDone ? 'bg-emerald-500' : 'bg-gray-200'}`}
                  />
                )}
              </div>
            );
          })}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3">
          {closeDateStr && daysUntilClose !== null && (
            <span className={`text-xs font-medium ${daysUntilClose <= 7 ? 'text-red-500' : 'text-gray-500'}`}>
              Due: {closeDateStr} ({daysUntilClose > 0 ? `${daysUntilClose} days` : 'Overdue'})
            </span>
          )}

          {canAdvance && !isAtLastGate && !isLocked && (
            <button
              onClick={handleAdvance}
              disabled={advancing}
              className="px-4 py-2 text-xs font-semibold bg-emerald-500 text-white rounded-md hover:bg-emerald-600 disabled:opacity-50 transition-colors"
            >
              {advancing ? 'Advancing...' : `Advance to ${gateConfig[currentIndex + 1]?.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())} →`}
            </button>
          )}

          {canAdvance && isAtFinal && isLocked && (
            <button
              onClick={handleUnlock}
              disabled={locking}
              className="px-3 py-1.5 text-xs font-semibold bg-white text-blue-600 border border-blue-600 rounded-md hover:bg-blue-50 disabled:opacity-50 transition-colors"
            >
              {locking ? 'Unlocking...' : 'Unlock for Edit'}
            </button>
          )}

          {canAdvance && isAtFinal && !isLocked && lockCount >= 1 && (
            <button
              onClick={handleLock}
              disabled={locking}
              className="px-3 py-1.5 text-xs font-semibold bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50 transition-colors"
            >
              {locking ? 'Locking...' : 'Re-lock'}
            </button>
          )}
        </div>
      </div>

      {/* Lock status info */}
      {(lockCount > 0 || isLocked || deadlineStr) && (
        <div className="mt-3 flex items-center gap-4 text-xs">
          {isLocked && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-indigo-50 text-indigo-700 rounded-full font-medium">
              Locked (#{lockCount})
            </span>
          )}
          {canExport && (
            <span className="text-emerald-600 font-medium">
              Download available ({downloadCount} downloaded)
            </span>
          )}
          {deadlineStr && !isLocked && (
            <span className="text-amber-600 font-medium">
              Edit window expires: {deadlineStr}
            </span>
          )}
          {lockCount >= 2 && (
            <span className="text-gray-400">
              Further changes require RFP Pipeline support
            </span>
          )}
        </div>
      )}

      {error && (
        <div className="mt-2 text-xs text-red-600 bg-red-50 rounded px-3 py-1.5">
          {error}
        </div>
      )}
    </div>
  );
}

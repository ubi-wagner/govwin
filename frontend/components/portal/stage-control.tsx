'use client';

import { useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';

interface GateRequirement {
  id: string;
  stage: string;
  requirementType: string;
  label: string;
  description: string | null;
  isMet: boolean;
  metBy: string | null;
  metAt: Date | null;
}

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
  userRole?: 'admin' | 'contributor' | 'external';
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
  userRole = 'contributor',
  closeDate,
}: StageControlProps) {
  const router = useRouter();
  const [advancing, setAdvancing] = useState(false);
  const [locking, setLocking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blockedSections, setBlockedSections] = useState<{ title: string; volumeName: string | null }[] | null>(null);
  const [requirements, setRequirements] = useState<GateRequirement[]>([]);
  const [showChecklist, setShowChecklist] = useState(false);
  const [markingMet, setMarkingMet] = useState<string | null>(null);

  useEffect(() => {
    async function loadRequirements() {
      try {
        const res = await fetch(
          `/api/portal/${tenantSlug}/proposals/${proposalId}/gates?stage=${currentStage}`,
        );
        if (!res.ok) return;
        const json = await res.json();
        setRequirements(json.data?.requirements ?? []);
      } catch {
        // Non-fatal
      }
    }
    loadRequirements();
  }, [tenantSlug, proposalId, currentStage]);

  const handleMarkMet = useCallback(async (requirementId: string, currentMet: boolean) => {
    if (markingMet) return;
    setMarkingMet(requirementId);
    try {
      const res = await fetch(
        `/api/portal/${tenantSlug}/proposals/${proposalId}/gates`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ requirementId, isMet: !currentMet }),
        },
      );
      if (!res.ok) return;
      setRequirements((prev) =>
        prev.map((r) => r.id === requirementId ? { ...r, isMet: !currentMet } : r),
      );
    } catch {
      // Non-fatal
    } finally {
      setMarkingMet(null);
    }
  }, [markingMet, tenantSlug, proposalId]);

  const unmets = requirements.filter((r) => !r.isMet);
  const hasUnmetRequirements = unmets.length > 0;
  const isAdmin = userRole === 'admin';

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

  const handleAdvance = useCallback(async (force = false) => {
    if (!canAdvance || advancing) return;
    setAdvancing(true);
    setError(null);
    if (!force) setBlockedSections(null);

    try {
      const res = await fetch(
        `/api/portal/${tenantSlug}/proposals/${proposalId}/advance`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(force ? { force: true } : {}),
        },
      );
      const json = await res.json();
      if (!res.ok) {
        // The gate tells us exactly what's blocking — surface the open sections.
        if (json.code === 'SECTIONS_NOT_LOCKED' && Array.isArray(json.details?.openSections)) {
          setBlockedSections(json.details.openSections);
        }
        setError(json.error || 'Failed to advance stage');
        return;
      }
      setBlockedSections(null);
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

          {requirements.length > 0 && (
            <button
              onClick={() => setShowChecklist((v) => !v)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-colors ${
                hasUnmetRequirements
                  ? 'border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100'
                  : 'border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
              }`}
            >
              {hasUnmetRequirements ? `${unmets.length} requirement${unmets.length > 1 ? 's' : ''} pending` : 'All gates met ✓'}
            </button>
          )}

          {canAdvance && !isAtLastGate && !isLocked && (
            <button
              onClick={() => handleAdvance(false)}
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

      {/* Lock-gate: the sections blocking advancement + an admin force override */}
      {blockedSections && blockedSections.length > 0 && (
        <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
          <p className="text-xs font-medium text-amber-800">
            {blockedSections.length} section{blockedSections.length > 1 ? 's' : ''} not yet accepted &amp; locked:
          </p>
          <ul className="mt-1 text-xs text-amber-700 list-disc pl-5 space-y-0.5">
            {blockedSections.map((s, i) => (
              <li key={i}>{s.title}{s.volumeName ? ` — ${s.volumeName}` : ''}</li>
            ))}
          </ul>
          {isAdmin && (
            <button
              onClick={() => handleAdvance(true)}
              disabled={advancing}
              className="mt-2 px-3 py-1.5 text-xs font-semibold bg-amber-600 text-white rounded-md hover:bg-amber-700 disabled:opacity-50 transition-colors"
            >
              {advancing ? 'Forcing…' : 'Force advance anyway →'}
            </button>
          )}
        </div>
      )}

      {/* ─── Gate Requirements Checklist ──────────────────────────── */}
      {showChecklist && requirements.length > 0 && (
        <div className="mt-4 border-t border-gray-100 pt-4">
          <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-3">
            Stage Gate Requirements — {currentStage.replace(/_/g, ' ')}
          </p>
          <div className="space-y-2">
            {requirements.map((req) => (
              <div
                key={req.id}
                className={`flex items-start gap-3 p-3 rounded-lg border ${
                  req.isMet ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200'
                }`}
              >
                <div className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 text-xs font-bold ${
                  req.isMet ? 'bg-emerald-500 text-white' : 'bg-amber-200 text-amber-700'
                }`}>
                  {req.isMet ? '✓' : '!'}
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-medium ${req.isMet ? 'text-emerald-800' : 'text-amber-800'}`}>
                    {req.label}
                  </p>
                  {req.description && (
                    <p className="text-xs text-gray-500 mt-0.5">{req.description}</p>
                  )}
                  {req.isMet && req.metAt && (
                    <p className="text-xs text-emerald-600 mt-0.5">
                      Met {new Date(req.metAt).toLocaleDateString()}
                      {req.metBy && ` by ${req.metBy}`}
                    </p>
                  )}
                </div>
                {isAdmin && (
                  <button
                    onClick={() => handleMarkMet(req.id, req.isMet)}
                    disabled={markingMet === req.id}
                    className={`text-xs font-medium px-2 py-1 rounded border transition-colors flex-shrink-0 ${
                      req.isMet
                        ? 'border-emerald-300 text-emerald-700 hover:bg-emerald-100'
                        : 'border-amber-300 text-amber-700 hover:bg-amber-100'
                    } disabled:opacity-50`}
                  >
                    {markingMet === req.id ? '...' : req.isMet ? 'Unmark' : 'Mark Met'}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

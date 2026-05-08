'use client';

import React, { useCallback, useState } from 'react';
import CrawlSettings from '@/components/admin/crawl-settings';
import RegionAnnotationForm from '@/components/admin/region-annotation-form';
import RegionList, { type SourceRegion } from '@/components/admin/region-list';
import DiffHistory, { type SourceDiffDetail } from '@/components/admin/diff-history';

// ── Types ────────────────────────────────────────────────────────────

interface SerializedProfile {
  id: string;
  name: string;
  siteType: string;
  baseUrl: string;
  bookmarkUrl: string | null;
  agency: string | null;
  programType: string | null;
  adminNotes: string | null;
  visitInstructions: string | null;
  isActive: boolean;
  autoCrawlEnabled: boolean;
  crawlCron: string | null;
  lastCrawlAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface SourceDetailClientProps {
  profile: SerializedProfile;
  initialRegions: SourceRegion[];
  initialDiffs: SourceDiffDetail[];
}

// ── Component ────────────────────────────────────────────────────────

export default function SourceDetailClient({
  profile,
  initialRegions,
  initialDiffs,
}: SourceDetailClientProps) {
  const [regions, setRegions] = useState<SourceRegion[]>(initialRegions);
  const [diffs, setDiffs] = useState<SourceDiffDetail[]>(initialDiffs);
  const [adminNotes, setAdminNotes] = useState(profile.adminNotes ?? '');
  const [visitInstructions, setVisitInstructions] = useState(profile.visitInstructions ?? '');
  const [editingNotes, setEditingNotes] = useState(false);
  const [editingInstructions, setEditingInstructions] = useState(false);
  const [savingNotes, setSavingNotes] = useState(false);
  const [savingInstructions, setSavingInstructions] = useState(false);

  // ── Refresh helpers ────────────────────────────────────────────────

  const refreshRegions = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/sources/${profile.id}/regions`);
      if (res.ok) {
        const json = await res.json();
        setRegions(json.data.regions);
      }
    } catch {
      // Fail silently
    }
  }, [profile.id]);

  const refreshDiffs = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/sources/${profile.id}/diffs`);
      if (res.ok) {
        const json = await res.json();
        setDiffs(json.data.diffs);
      }
    } catch {
      // Fail silently
    }
  }, [profile.id]);

  // ── Save notes ─────────────────────────────────────────────────────

  const saveAdminNotes = useCallback(async () => {
    setSavingNotes(true);
    try {
      const res = await fetch(`/api/admin/sources/${profile.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adminNotes }),
      });
      if (res.ok) {
        setEditingNotes(false);
      }
    } catch {
      // Fail silently
    } finally {
      setSavingNotes(false);
    }
  }, [profile.id, adminNotes]);

  const saveVisitInstructions = useCallback(async () => {
    setSavingInstructions(true);
    try {
      const res = await fetch(`/api/admin/sources/${profile.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visitInstructions }),
      });
      if (res.ok) {
        setEditingInstructions(false);
      }
    } catch {
      // Fail silently
    } finally {
      setSavingInstructions(false);
    }
  }, [profile.id, visitInstructions]);

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      {/* Left column: crawl settings + notes */}
      <div className="lg:col-span-1 space-y-6">
        {/* Crawl Settings */}
        <CrawlSettings
          profileId={profile.id}
          autoCrawlEnabled={profile.autoCrawlEnabled}
          crawlCron={profile.crawlCron}
          lastCrawlAt={profile.lastCrawlAt}
          onUpdated={refreshDiffs}
        />

        {/* Admin Notes */}
        <div className="bg-white rounded-lg border shadow-sm p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-800">Admin Notes</h3>
            {!editingNotes ? (
              <button
                onClick={() => setEditingNotes(true)}
                className="text-xs text-indigo-600 hover:text-indigo-800"
              >
                Edit
              </button>
            ) : (
              <div className="flex gap-2">
                <button
                  onClick={saveAdminNotes}
                  disabled={savingNotes}
                  className="text-xs px-2 py-1 bg-indigo-600 text-white rounded hover:bg-indigo-500 disabled:opacity-50"
                >
                  {savingNotes ? '...' : 'Save'}
                </button>
                <button
                  onClick={() => {
                    setAdminNotes(profile.adminNotes ?? '');
                    setEditingNotes(false);
                  }}
                  className="text-xs px-2 py-1 bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
          {editingNotes ? (
            <textarea
              value={adminNotes}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setAdminNotes(e.target.value)}
              rows={4}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 resize-y"
            />
          ) : (
            <p className="text-sm text-gray-600 whitespace-pre-wrap">
              {adminNotes || 'No notes yet.'}
            </p>
          )}
        </div>

        {/* Visit Instructions */}
        <div className="bg-white rounded-lg border shadow-sm p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-800">Visit Instructions</h3>
            {!editingInstructions ? (
              <button
                onClick={() => setEditingInstructions(true)}
                className="text-xs text-indigo-600 hover:text-indigo-800"
              >
                Edit
              </button>
            ) : (
              <div className="flex gap-2">
                <button
                  onClick={saveVisitInstructions}
                  disabled={savingInstructions}
                  className="text-xs px-2 py-1 bg-indigo-600 text-white rounded hover:bg-indigo-500 disabled:opacity-50"
                >
                  {savingInstructions ? '...' : 'Save'}
                </button>
                <button
                  onClick={() => {
                    setVisitInstructions(profile.visitInstructions ?? '');
                    setEditingInstructions(false);
                  }}
                  className="text-xs px-2 py-1 bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
          {editingInstructions ? (
            <textarea
              value={visitInstructions}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setVisitInstructions(e.target.value)}
              rows={6}
              placeholder="Enter step-by-step instructions for visiting this source..."
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 resize-y"
            />
          ) : visitInstructions ? (
            <ol className="text-sm text-gray-600 pl-5 list-decimal space-y-1">
              {visitInstructions.split('\n').map((step: string, i: number) => {
                const cleaned = step.replace(/^\d+\.\s*/, '').trim();
                return cleaned ? <li key={i}>{cleaned}</li> : null;
              })}
            </ol>
          ) : (
            <p className="text-sm text-gray-500">No instructions set.</p>
          )}
        </div>
      </div>

      {/* Right column: regions + diffs */}
      <div className="lg:col-span-2 space-y-6">
        {/* Regions */}
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-gray-800">
            Monitored Regions ({regions.length})
          </h2>
          <RegionAnnotationForm profileId={profile.id} onCreated={refreshRegions} />
          <RegionList profileId={profile.id} regions={regions} onDeleted={refreshRegions} />
        </div>

        {/* Change History */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-800">
              Change History ({diffs.length})
            </h2>
            <button
              onClick={refreshDiffs}
              className="text-sm text-indigo-600 hover:text-indigo-800"
            >
              Refresh
            </button>
          </div>
          <DiffHistory profileId={profile.id} diffs={diffs} onReviewed={refreshDiffs} />
        </div>
      </div>
    </div>
  );
}

'use client';

import { useState, useCallback, useEffect } from 'react';
import AtomDetailModal, {
  type LibraryUnit,
  SourceBadge,
  formatCategory,
} from './atom-detail-modal';
import BulkUpload from './bulk-upload';

// ─── Types ───────────────────────────────────────────────────────────────────

interface CategoryCount {
  category: string;
  count: number;
}

interface LibraryStats {
  total: number;
  byCategory: CategoryCount[];
  bySourceType: Array<{ sourceType: string; count: number }>;
  winningCount: number;
  totalUsage: number;
}

interface Proposal {
  id: string;
  title: string;
}

interface LibraryDashboardProps {
  tenantSlug: string;
  initialUnits: LibraryUnit[];
  initialTotal: number;
  stats: LibraryStats;
  proposals: Proposal[];
}

type SortOption = 'outcome_score' | 'created_at' | 'usage_count';
type ViewMode = 'grid' | 'list';
type UploadMode = 'none' | 'bulk' | 'paste';

// ─── Component ───────────────────────────────────────────────────────────────

export default function LibraryDashboard({
  tenantSlug,
  initialUnits,
  initialTotal,
  stats,
  proposals,
}: LibraryDashboardProps) {
  const [units, setUnits] = useState<LibraryUnit[]>(initialUnits);
  const [total, setTotal] = useState(initialTotal);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedSource, setSelectedSource] = useState<string | null>(null);
  const [selectedOutcome, setSelectedOutcome] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortOption>('outcome_score');
  const [selectedUnit, setSelectedUnit] = useState<LibraryUnit | null>(null);
  const [uploadMode, setUploadMode] = useState<UploadMode>('none');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [pasteContent, setPasteContent] = useState('');
  const [pasteCategory, setPasteCategory] = useState('general');
  const [pasteSaving, setPasteSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());

  // ─── Fetch units with filters ─────────────────────────────────────────────

  const fetchUnits = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('limit', '200');
      if (selectedCategory) params.set('category', selectedCategory);
      if (selectedSource) params.set('source', selectedSource);
      if (selectedOutcome) params.set('outcome', selectedOutcome);
      if (searchQuery.trim()) params.set('q', searchQuery.trim());
      if (sortBy) params.set('sort', sortBy);

      const res = await fetch(
        `/api/portal/${tenantSlug}/library?${params.toString()}`,
      );
      if (!res.ok) return;
      const body = await res.json();
      setUnits(body.data?.units ?? []);
      setTotal(body.data?.total ?? 0);
    } catch {
      // Keep existing state on error
    } finally {
      setLoading(false);
    }
  }, [tenantSlug, selectedCategory, selectedSource, selectedOutcome, searchQuery, sortBy]);

  // Refetch when filters change
  useEffect(() => {
    fetchUnits();
  }, [fetchUnits]);

  // ─── Paste content handler ────────────────────────────────────────────────

  const handlePasteSubmit = useCallback(async () => {
    if (!pasteContent.trim()) return;
    setPasteSaving(true);
    try {
      // Create a text file from pasted content and upload via the existing upload route
      const formData = new FormData();
      const blob = new Blob([pasteContent], { type: 'text/plain' });
      const file = new File([blob], `pasted-${pasteCategory}.txt`, { type: 'text/plain' });
      formData.append('files', file);

      const uploadRes = await fetch(
        `/api/portal/${tenantSlug}/library/upload`,
        { method: 'POST', body: formData },
      );
      if (uploadRes.ok) {
        setPasteContent('');
        setUploadMode('none');
        fetchUnits();
      }
    } catch {
      // Non-critical
    } finally {
      setPasteSaving(false);
    }
  }, [tenantSlug, pasteContent, pasteCategory, fetchUnits]);

  // ─── Toggle card expand ───────────────────────────────────────────────────

  const toggleExpand = useCallback((id: string) => {
    setExpandedCards((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // ─── Empty state ──────────────────────────────────────────────────────────

  if (stats.total === 0 && uploadMode === 'none') {
    return (
      <div className="max-w-2xl mx-auto py-16 text-center">
        <div className="mb-8">
          <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-blue-50 flex items-center justify-center">
            <svg className="w-10 h-10 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">
            Your Content Library is empty -- let&apos;s fix that!
          </h2>
          <p className="text-gray-500 max-w-md mx-auto">
            Build a library of reusable content blocks that power your proposals with YOUR real experience.
          </p>
        </div>

        <div className="space-y-6 text-left max-w-lg mx-auto mb-10">
          <OnboardingStep
            step={1}
            title="Upload your company's foundational documents"
            description="Capability statement, resumes, past performance reports, org charts"
          />
          <OnboardingStep
            step={2}
            title="We'll atomize them into reusable building blocks"
            description="Each paragraph, bio, and project becomes a searchable atom"
          />
          <OnboardingStep
            step={3}
            title="When you build a proposal, AI drafts use YOUR content"
            description="Not generic text -- your real experience and capabilities"
          />
        </div>

        <button
          onClick={() => setUploadMode('bulk')}
          className="rounded-lg bg-blue-600 px-6 py-3 text-base font-semibold text-white hover:bg-blue-700 shadow-sm"
        >
          Upload Your First Documents
        </button>
      </div>
    );
  }

  return (
    <div>
      {/* Stats bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard label="Total Atoms" value={stats.total} icon="atoms" />
        <StatCard
          label="Categories"
          value={stats.byCategory.length}
          icon="categories"
        />
        <StatCard label="Winning Atoms" value={stats.winningCount} icon="trophy" />
        <StatCard
          label="Usage Across Proposals"
          value={stats.totalUsage}
          icon="usage"
        />
      </div>

      {/* Quick actions */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <button
          onClick={() => setUploadMode(uploadMode === 'bulk' ? 'none' : 'bulk')}
          className={`rounded-md px-4 py-2 text-sm font-semibold transition-colors ${
            uploadMode === 'bulk'
              ? 'bg-blue-700 text-white'
              : 'bg-blue-600 text-white hover:bg-blue-700'
          }`}
        >
          <span className="flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            Upload Documents
          </span>
        </button>
        <button
          onClick={() => setUploadMode(uploadMode === 'paste' ? 'none' : 'paste')}
          className={`rounded-md px-4 py-2 text-sm font-semibold border transition-colors ${
            uploadMode === 'paste'
              ? 'bg-gray-700 text-white border-gray-700'
              : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
          }`}
        >
          <span className="flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            Paste Content
          </span>
        </button>

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => setViewMode('grid')}
            className={`p-1.5 rounded ${viewMode === 'grid' ? 'bg-gray-200' : 'hover:bg-gray-100'}`}
            aria-label="Grid view"
          >
            <svg className="w-4 h-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
            </svg>
          </button>
          <button
            onClick={() => setViewMode('list')}
            className={`p-1.5 rounded ${viewMode === 'list' ? 'bg-gray-200' : 'hover:bg-gray-100'}`}
            aria-label="List view"
          >
            <svg className="w-4 h-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
        </div>
      </div>

      {/* Upload / paste areas */}
      {uploadMode === 'bulk' && (
        <div className="mb-6 border border-gray-200 rounded-xl p-5 bg-white">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-800">Bulk Upload</h3>
            <button
              onClick={() => setUploadMode('none')}
              className="text-gray-400 hover:text-gray-600 text-sm"
            >
              Close
            </button>
          </div>
          <BulkUpload tenantSlug={tenantSlug} onComplete={fetchUnits} />
        </div>
      )}

      {uploadMode === 'paste' && (
        <div className="mb-6 border border-gray-200 rounded-xl p-5 bg-white">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-800">Paste Content</h3>
            <button
              onClick={() => setUploadMode('none')}
              className="text-gray-400 hover:text-gray-600 text-sm"
            >
              Close
            </button>
          </div>
          <textarea
            value={pasteContent}
            onChange={(e) => setPasteContent(e.target.value)}
            rows={6}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            placeholder="Paste your content here... capability statements, past performance narratives, key personnel bios, etc."
          />
          <div className="flex items-center gap-3">
            <select
              value={pasteCategory}
              onChange={(e) => setPasteCategory(e.target.value)}
              className="border border-gray-300 rounded px-2 py-1.5 text-sm"
            >
              <option value="general">General</option>
              <option value="technical_approach">Technical Approach</option>
              <option value="past_performance">Past Performance</option>
              <option value="key_personnel">Key Personnel</option>
              <option value="company_overview">Company Overview</option>
              <option value="capability_statement">Capability Statement</option>
              <option value="commercialization">Commercialization</option>
              <option value="executive_summary">Executive Summary</option>
              <option value="facilities">Facilities</option>
            </select>
            <button
              onClick={handlePasteSubmit}
              disabled={!pasteContent.trim() || pasteSaving}
              className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {pasteSaving ? 'Saving...' : 'Add to Library'}
            </button>
          </div>
        </div>
      )}

      {/* Search + filters bar */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <div className="flex-1 min-w-[200px]">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search content..."
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>
        <select
          value={selectedSource ?? ''}
          onChange={(e) => setSelectedSource(e.target.value || null)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
        >
          <option value="">All Sources</option>
          <option value="upload">Upload</option>
          <option value="harvest">Harvested</option>
          <option value="ai">AI Generated</option>
          <option value="manual">Manual</option>
        </select>
        <select
          value={selectedOutcome ?? ''}
          onChange={(e) => setSelectedOutcome(e.target.value || null)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
        >
          <option value="">All Outcomes</option>
          <option value="awarded">Awarded</option>
          <option value="pending">Pending</option>
          <option value="rejected">Rejected</option>
          <option value="withdrawn">Withdrawn</option>
        </select>
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as SortOption)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
        >
          <option value="outcome_score">Quality Score</option>
          <option value="created_at">Newest First</option>
          <option value="usage_count">Most Used</option>
        </select>
      </div>

      {/* Main content: sidebar + grid */}
      <div className="flex gap-6">
        {/* Category sidebar */}
        <div className="w-56 flex-shrink-0 hidden lg:block">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
            Categories
          </h3>
          <nav className="space-y-0.5">
            <CategoryLink
              label="All"
              count={stats.total}
              active={selectedCategory === null}
              onClick={() => setSelectedCategory(null)}
            />
            {stats.byCategory.map((cat) => (
              <CategoryLink
                key={cat.category}
                label={formatCategory(cat.category)}
                count={cat.count}
                active={selectedCategory === cat.category}
                onClick={() =>
                  setSelectedCategory(
                    selectedCategory === cat.category ? null : cat.category,
                  )
                }
              />
            ))}
          </nav>
        </div>

        {/* Card grid */}
        <div className="flex-1 min-w-0">
          {loading && (
            <div className="text-center py-8 text-gray-400 text-sm">
              Loading...
            </div>
          )}

          {!loading && units.length === 0 && (
            <div className="text-center py-12 text-gray-400">
              <p className="text-lg">No atoms match your filters.</p>
              <p className="text-sm mt-2">Try broadening your search or changing category.</p>
            </div>
          )}

          {!loading && units.length > 0 && (
            <>
              <p className="text-xs text-gray-400 mb-3">
                Showing {units.length} of {total} atom{total !== 1 ? 's' : ''}
              </p>

              {viewMode === 'grid' ? (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {units.map((unit) => (
                    <AtomCard
                      key={unit.id}
                      unit={unit}
                      expanded={expandedCards.has(unit.id)}
                      onToggleExpand={() => toggleExpand(unit.id)}
                      onSelect={() => setSelectedUnit(unit)}
                      tenantSlug={tenantSlug}
                      proposals={proposals}
                      onUpdated={fetchUnits}
                    />
                  ))}
                </div>
              ) : (
                <div className="space-y-2">
                  {units.map((unit) => (
                    <AtomListRow
                      key={unit.id}
                      unit={unit}
                      onSelect={() => setSelectedUnit(unit)}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Detail modal */}
      {selectedUnit && (
        <AtomDetailModal
          unit={selectedUnit}
          tenantSlug={tenantSlug}
          proposals={proposals}
          onClose={() => setSelectedUnit(null)}
          onUpdated={() => {
            setSelectedUnit(null);
            fetchUnits();
          }}
        />
      )}
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  icon,
}: {
  label: string;
  value: number;
  icon: 'atoms' | 'categories' | 'trophy' | 'usage';
}) {
  const iconMap: Record<string, React.ReactNode> = {
    atoms: (
      <svg className="w-5 h-5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
      </svg>
    ),
    categories: (
      <svg className="w-5 h-5 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
      </svg>
    ),
    trophy: (
      <span className="text-lg">&#x1f3c6;</span>
    ),
    usage: (
      <svg className="w-5 h-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
      </svg>
    ),
  };

  return (
    <div className="bg-white border border-gray-200 rounded-xl px-4 py-4">
      <div className="flex items-center gap-3">
        <div className="flex-shrink-0">{iconMap[icon]}</div>
        <div>
          <p className="text-2xl font-bold text-gray-900">{value.toLocaleString()}</p>
          <p className="text-xs text-gray-500">{label}</p>
        </div>
      </div>
    </div>
  );
}

function CategoryLink({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center justify-between px-3 py-1.5 rounded-md text-sm transition-colors ${
        active
          ? 'bg-blue-50 text-blue-700 font-medium'
          : 'text-gray-600 hover:bg-gray-50'
      }`}
    >
      <span className="truncate">{label}</span>
      <span className={`text-xs ml-2 flex-shrink-0 ${active ? 'text-blue-500' : 'text-gray-400'}`}>
        {count}
      </span>
    </button>
  );
}

function OnboardingStep({
  step,
  title,
  description,
}: {
  step: number;
  title: string;
  description: string;
}) {
  return (
    <div className="flex items-start gap-4">
      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-100 text-blue-600 font-bold text-sm flex items-center justify-center">
        {step}
      </div>
      <div>
        <p className="font-medium text-gray-800">{title}</p>
        <p className="text-sm text-gray-500 mt-0.5">{description}</p>
      </div>
    </div>
  );
}

// ─── Atom Card ───────────────────────────────────────────────────────────────

function AtomCard({
  unit,
  expanded,
  onToggleExpand,
  onSelect,
  tenantSlug,
  proposals,
  onUpdated,
}: {
  unit: LibraryUnit;
  expanded: boolean;
  onToggleExpand: () => void;
  onSelect: () => void;
  tenantSlug: string;
  proposals: Proposal[];
  onUpdated: () => void;
}) {
  const [showAssign, setShowAssign] = useState(false);

  const isWinner = unit.outcome === 'awarded';
  const scorePercent = Math.round((unit.outcomeScore ?? 0.5) * 100);
  const scoreColor =
    (unit.outcomeScore ?? 0.5) > 0.7
      ? 'bg-green-500'
      : (unit.outcomeScore ?? 0.5) > 0.4
        ? 'bg-yellow-500'
        : 'bg-red-500';

  const contentPreview = expanded
    ? unit.content
    : unit.content.length > 150
      ? unit.content.slice(0, 150) + '...'
      : unit.content;

  const handleAssign = async (proposalId: string) => {
    try {
      const currentTags = [...(unit.tags ?? [])];
      const proposalTag = `proposal:${proposalId}`;
      if (!currentTags.includes(proposalTag)) {
        currentTags.push(proposalTag);
      }
      const res = await fetch(`/api/portal/${tenantSlug}/library/${unit.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tags: currentTags }),
      });
      if (res.ok) {
        setShowAssign(false);
        onUpdated();
      }
    } catch {
      // non-critical
    }
  };

  return (
    <div
      className={`bg-white border rounded-xl overflow-hidden transition-shadow hover:shadow-md ${
        isWinner ? 'border-yellow-300 ring-1 ring-yellow-200' : 'border-gray-200'
      }`}
    >
      {/* Card header */}
      <div className="flex items-center justify-between px-4 pt-3 pb-2">
        <div className="flex items-center gap-2 min-w-0">
          {isWinner && <span className="text-sm" title="Award-winning">&#x1f3c6;</span>}
          <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-700 truncate">
            {formatCategory(unit.category)}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          {unit.outcomeScore != null && (
            <span className="text-xs font-medium text-gray-600">
              {scorePercent}%
            </span>
          )}
          <div className="w-12 bg-gray-100 rounded-full h-1.5">
            <div
              className={`h-1.5 rounded-full ${scoreColor}`}
              style={{ width: `${scorePercent}%` }}
            />
          </div>
        </div>
      </div>

      {/* Content preview */}
      <div
        className="px-4 py-2 cursor-pointer"
        onClick={onSelect}
      >
        <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
          {contentPreview}
        </p>
        {unit.content.length > 150 && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpand();
            }}
            className="text-xs text-blue-600 hover:underline mt-1"
          >
            {expanded ? 'Show less' : 'Show more'}
          </button>
        )}
      </div>

      {/* Tags */}
      <div className="px-4 py-2">
        <div className="flex flex-wrap gap-1">
          <SourceBadge sourceType={unit.sourceType} />
          {(unit.tags ?? []).slice(0, 3).map((tag) => (
            <span
              key={tag}
              className="inline-block px-1.5 py-0.5 rounded text-xs bg-blue-50 text-blue-600"
            >
              {tag}
            </span>
          ))}
          {(unit.tags ?? []).length > 3 && (
            <span className="text-xs text-gray-400">+{unit.tags.length - 3}</span>
          )}
        </div>
      </div>

      {/* Provenance line */}
      <div className="px-4 py-1.5 text-xs text-gray-400 border-t border-gray-50">
        {unit.originalProposalId && unit.proposalTitle ? (
          <span>
            From: {unit.proposalTitle}
          </span>
        ) : unit.sourceType === 'upload' ? (
          <span>Uploaded document</span>
        ) : unit.sourceType === 'ai' ? (
          <span>AI generated</span>
        ) : (
          <span>Manual entry</span>
        )}
        {unit.usageCount > 0 && (
          <span className="ml-2">
            | Used in {unit.usageCount} proposal{unit.usageCount !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Status + actions */}
      <div className="flex items-center justify-between px-4 py-2.5 border-t border-gray-100 bg-gray-50/50">
        <StatusBadge status={unit.status} />
        <div className="flex items-center gap-1.5">
          <button
            onClick={onSelect}
            className="px-2.5 py-1 text-xs font-medium text-gray-600 border border-gray-200 rounded hover:bg-gray-100"
          >
            View
          </button>
          <button
            onClick={onSelect}
            className="px-2.5 py-1 text-xs font-medium text-gray-600 border border-gray-200 rounded hover:bg-gray-100"
          >
            Edit
          </button>
          {proposals.length > 0 && (
            <div className="relative">
              <button
                onClick={() => setShowAssign(!showAssign)}
                className="px-2.5 py-1 text-xs font-medium text-blue-600 border border-blue-200 rounded hover:bg-blue-50"
              >
                Assign
              </button>
              {showAssign && (
                <div className="absolute right-0 top-full mt-1 w-56 bg-white border border-gray-200 rounded-lg shadow-lg z-10 py-1 max-h-48 overflow-y-auto">
                  {proposals.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => handleAssign(p.id)}
                      className="w-full text-left px-3 py-1.5 text-xs text-gray-700 hover:bg-blue-50 truncate"
                    >
                      {p.title}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── List Row ────────────────────────────────────────────────────────────────

function AtomListRow({
  unit,
  onSelect,
}: {
  unit: LibraryUnit;
  onSelect: () => void;
}) {
  const isWinner = unit.outcome === 'awarded';
  const scorePercent = Math.round((unit.outcomeScore ?? 0.5) * 100);

  return (
    <div
      onClick={onSelect}
      className={`flex items-center gap-4 bg-white border rounded-lg px-4 py-3 cursor-pointer transition-shadow hover:shadow-sm ${
        isWinner ? 'border-yellow-300' : 'border-gray-200'
      }`}
    >
      {isWinner && <span className="text-sm flex-shrink-0">&#x1f3c6;</span>}
      <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-700 flex-shrink-0 w-32 truncate text-center">
        {formatCategory(unit.category)}
      </span>
      <p className="flex-1 min-w-0 text-sm text-gray-700 truncate">
        {unit.content.slice(0, 120)}
      </p>
      <SourceBadge sourceType={unit.sourceType} />
      <span className="text-xs text-gray-400 w-10 text-right flex-shrink-0">
        {scorePercent}%
      </span>
      <StatusBadge status={unit.status} />
      <span className="text-xs text-gray-400 w-20 text-right flex-shrink-0">
        {new Date(unit.createdAt).toLocaleDateString()}
      </span>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    draft: 'bg-yellow-50 text-yellow-700',
    approved: 'bg-green-50 text-green-700',
    archived: 'bg-gray-100 text-gray-500',
  };
  const cls = colors[status] ?? 'bg-gray-100 text-gray-600';
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium flex-shrink-0 ${cls}`}>
      {status}
    </span>
  );
}

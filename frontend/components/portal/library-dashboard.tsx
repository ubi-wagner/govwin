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

interface Facet {
  value: string;
  count: number;
}
interface LibraryFacets {
  agencies: Facet[];
  programs: Facet[];
  components: Facet[];
  sectionTypes: Facet[];
  authors: Facet[];
  tags: Facet[];
}

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

  // ── Advanced multi-dimensional search (Department · program · component · type ·
  // author · multi-tag any/all · lineage flags). Vocabularies come from ?facets=1. ──
  const [facets, setFacets] = useState<LibraryFacets | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [selAgency, setSelAgency] = useState('');
  const [selProgram, setSelProgram] = useState('');
  const [selComponent, setSelComponent] = useState('');
  const [selType, setSelType] = useState('');
  const [selAuthor, setSelAuthor] = useState('');
  const [tagFilters, setTagFilters] = useState<string[]>([]);
  const [tagMode, setTagMode] = useState<'any' | 'all'>('any');
  const [tagDraft, setTagDraft] = useState('');
  const [flagSeminal, setFlagSeminal] = useState(false);
  const [flagRefined, setFlagRefined] = useState(false);
  const [flagWinning, setFlagWinning] = useState(false);
  const [lineageUnit, setLineageUnit] = useState<LibraryUnit | null>(null);

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
      // Advanced dimensions
      if (selAgency) params.set('agency', selAgency);
      if (selProgram) params.set('program', selProgram);
      if (selComponent) params.set('component', selComponent);
      if (selType) params.set('sectionType', selType);
      if (selAuthor) params.set('author', selAuthor);
      if (tagFilters.length > 0) params.set(tagMode === 'all' ? 'tagsAll' : 'tags', tagFilters.join(','));
      if (flagSeminal) params.set('seminal', 'true');
      if (flagRefined) params.set('refined', 'true');
      if (flagWinning) params.set('winning', 'true');

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
  }, [
    tenantSlug, selectedCategory, selectedSource, selectedOutcome, searchQuery, sortBy,
    selAgency, selProgram, selComponent, selType, selAuthor, tagFilters, tagMode,
    flagSeminal, flagRefined, flagWinning,
  ]);

  // Refetch when filters change
  useEffect(() => {
    fetchUnits();
  }, [fetchUnits]);

  // Load the tenant's search vocabularies once (populates the advanced dropdowns).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/portal/${tenantSlug}/library?facets=1`);
        if (!res.ok) return;
        const body = await res.json();
        if (!cancelled) setFacets(body.data?.facets ?? null);
      } catch {
        // non-critical — dropdowns simply show no options
      }
    })();
    return () => { cancelled = true; };
  }, [tenantSlug]);

  // ─── Advanced filter helpers ──────────────────────────────────────────────

  const addTagFilter = useCallback((t: string) => {
    const v = t.trim();
    if (!v) return;
    setTagFilters((prev) => (prev.includes(v) ? prev : [...prev, v]));
    setTagDraft('');
  }, []);
  const removeTagFilter = useCallback((t: string) => {
    setTagFilters((prev) => prev.filter((x) => x !== t));
  }, []);
  const clearAdvanced = useCallback(() => {
    setSelAgency(''); setSelProgram(''); setSelComponent(''); setSelType(''); setSelAuthor('');
    setTagFilters([]); setFlagSeminal(false); setFlagRefined(false); setFlagWinning(false);
  }, []);
  const advancedCount =
    (selAgency ? 1 : 0) + (selProgram ? 1 : 0) + (selComponent ? 1 : 0) + (selType ? 1 : 0) +
    (selAuthor ? 1 : 0) + tagFilters.length + (flagSeminal ? 1 : 0) + (flagRefined ? 1 : 0) + (flagWinning ? 1 : 0);

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
        <button
          onClick={() => setShowAdvanced((v) => !v)}
          className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium border transition-colors ${
            showAdvanced || advancedCount > 0
              ? 'bg-blue-50 text-blue-700 border-blue-300'
              : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
          }`}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2a1 1 0 01-.293.707L14 13.414V19a1 1 0 01-.553.894l-4 2A1 1 0 018 21v-7.586L3.293 6.707A1 1 0 013 6V4z" />
          </svg>
          Advanced
          {advancedCount > 0 && (
            <span className="ml-0.5 rounded-full bg-blue-600 text-white text-[10px] px-1.5 py-0.5 leading-none">
              {advancedCount}
            </span>
          )}
        </button>
      </div>

      {/* Advanced multi-dimensional search panel */}
      {showAdvanced && (
        <div className="mb-6 border border-blue-200 rounded-xl p-5 bg-blue-50/40">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-4">
            <FacetSelect label="Department / Agency" value={selAgency} onChange={setSelAgency} options={facets?.agencies} />
            <FacetSelect label="Program" value={selProgram} onChange={setSelProgram} options={facets?.programs} />
            <FacetSelect label="Component / Office" value={selComponent} onChange={setSelComponent} options={facets?.components} />
            <FacetSelect label="Section Type" value={selType} onChange={setSelType} options={facets?.sectionTypes} />
            <FacetSelect label="Original Author" value={selAuthor} onChange={setSelAuthor} options={facets?.authors} />
          </div>

          {/* Multi-tag filter — an atom accumulates many tags across its journey */}
          <div className="mb-4">
            <div className="flex items-center gap-2 mb-1.5">
              <label className="text-xs font-semibold text-gray-600">Tags</label>
              <div className="flex rounded-md border border-gray-300 overflow-hidden text-[11px]">
                <button
                  onClick={() => setTagMode('any')}
                  className={`px-2 py-0.5 ${tagMode === 'any' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600'}`}
                >
                  Any
                </button>
                <button
                  onClick={() => setTagMode('all')}
                  className={`px-2 py-0.5 ${tagMode === 'all' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600'}`}
                >
                  All
                </button>
              </div>
              <span className="text-[11px] text-gray-400">
                {tagMode === 'all' ? 'must have every tag' : 'has any of these tags'}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {tagFilters.map((t) => (
                <span key={t} className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-blue-100 text-blue-700">
                  {t}
                  <button onClick={() => removeTagFilter(t)} className="text-blue-500 hover:text-blue-800 leading-none" aria-label={`Remove ${t}`}>×</button>
                </span>
              ))}
              <input
                list="library-tag-facets"
                value={tagDraft}
                onChange={(e) => setTagDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); addTagFilter(tagDraft); }
                }}
                placeholder="add tag + Enter"
                className="border border-gray-300 rounded px-2 py-1 text-xs min-w-[140px]"
              />
              <datalist id="library-tag-facets">
                {(facets?.tags ?? []).map((t) => (
                  <option key={t.value} value={t.value}>{`${t.value} (${t.count})`}</option>
                ))}
              </datalist>
            </div>
          </div>

          {/* Lineage / quality flags */}
          <div className="flex flex-wrap items-center gap-4">
            <FlagToggle label="Award-winning" checked={flagWinning} onChange={setFlagWinning} />
            <FlagToggle label="Seminal (original)" checked={flagSeminal} onChange={setFlagSeminal} />
            <FlagToggle label="Refined (has parent)" checked={flagRefined} onChange={setFlagRefined} />
            {advancedCount > 0 && (
              <button
                onClick={clearAdvanced}
                className="ml-auto text-xs font-medium text-gray-500 hover:text-gray-800 underline"
              >
                Clear advanced ({advancedCount})
              </button>
            )}
          </div>
        </div>
      )}

      {/* Active advanced-filter chips (visible even when the panel is collapsed) */}
      {!showAdvanced && advancedCount > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 mb-4">
          <span className="text-xs text-gray-400">Filters:</span>
          {selAgency && <FilterChip label={`Dept: ${selAgency}`} onClear={() => setSelAgency('')} />}
          {selProgram && <FilterChip label={`Program: ${selProgram}`} onClear={() => setSelProgram('')} />}
          {selComponent && <FilterChip label={`Component: ${selComponent}`} onClear={() => setSelComponent('')} />}
          {selType && <FilterChip label={`Type: ${selType}`} onClear={() => setSelType('')} />}
          {selAuthor && <FilterChip label={`Author: ${selAuthor}`} onClear={() => setSelAuthor('')} />}
          {tagFilters.map((t) => (
            <FilterChip key={t} label={`#${t}`} onClear={() => removeTagFilter(t)} />
          ))}
          {flagWinning && <FilterChip label="Award-winning" onClear={() => setFlagWinning(false)} />}
          {flagSeminal && <FilterChip label="Seminal" onClear={() => setFlagSeminal(false)} />}
          {flagRefined && <FilterChip label="Refined" onClear={() => setFlagRefined(false)} />}
          <button onClick={clearAdvanced} className="text-xs text-gray-500 hover:text-gray-800 underline">
            Clear all
          </button>
        </div>
      )}

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
                      onShowLineage={() => setLineageUnit(unit)}
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

      {/* Lineage tree modal — parent → child → grandchild progeny */}
      {lineageUnit && (
        <LineageModal
          unit={lineageUnit}
          tenantSlug={tenantSlug}
          onClose={() => setLineageUnit(null)}
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
  onShowLineage,
  tenantSlug,
  proposals,
  onUpdated,
}: {
  unit: LibraryUnit;
  expanded: boolean;
  onToggleExpand: () => void;
  onSelect: () => void;
  onShowLineage: () => void;
  tenantSlug: string;
  proposals: Proposal[];
  onUpdated: () => void;
}) {
  const [showAssign, setShowAssign] = useState(false);
  const author = unit.meta?.authorName ?? unit.ownerName ?? null;
  const generation = unit.meta?.lineage?.generation ?? null;
  const hasLineage = unit.parentUnitId != null || (generation != null && generation > 0);

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
        {author && <span className="ml-2">| by {author}</span>}
        {generation != null && generation > 0 && (
          <span className="ml-2 text-purple-500">| gen {generation}</span>
        )}
      </div>

      {/* Status + actions */}
      <div className="flex items-center justify-between px-4 py-2.5 border-t border-gray-100 bg-gray-50/50">
        <StatusBadge status={unit.status} />
        <div className="flex items-center gap-1.5">
          {hasLineage && (
            <button
              onClick={onShowLineage}
              className="px-2.5 py-1 text-xs font-medium text-purple-600 border border-purple-200 rounded hover:bg-purple-50"
              title="View parent → child → grandchild lineage"
            >
              Lineage
            </button>
          )}
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

// ─── Advanced-search sub-components ──────────────────────────────────────────

function FacetSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options?: Facet[];
}) {
  return (
    <div>
      <label className="block text-xs font-semibold text-gray-600 mb-1">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm bg-white"
      >
        <option value="">Any</option>
        {(options ?? []).map((o) => (
          <option key={o.value} value={o.value}>
            {o.value} ({o.count})
          </option>
        ))}
      </select>
    </div>
  );
}

function FlagToggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-1.5 text-xs text-gray-700 cursor-pointer select-none">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="rounded border-gray-300 text-blue-600"
      />
      {label}
    </label>
  );
}

function FilterChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-700 border border-gray-200">
      {label}
      <button onClick={onClear} className="text-gray-400 hover:text-gray-700 leading-none" aria-label={`Clear ${label}`}>
        ×
      </button>
    </span>
  );
}

// ─── Lineage tree modal ──────────────────────────────────────────────────────

interface LineageNode {
  id: string;
  parentUnitId: string | null;
  content: string;
  category: string;
  subcategory: string | null;
  tags: string[] | null;
  meta: { authorName?: string | null; lineage?: { generation?: number } | null } | null;
  status: string;
  sourceType: string | null;
  usageCount: number;
  outcome: string | null;
  outcomeScore: number | null;
  originalProposalId: string | null;
  createdAt: string;
  depth: number;
  rel: string;
}

function LineageModal({
  unit,
  tenantSlug,
  onClose,
}: {
  unit: LibraryUnit;
  tenantSlug: string;
  onClose: () => void;
}) {
  const [nodes, setNodes] = useState<LineageNode[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/portal/${tenantSlug}/library?lineageOf=${unit.id}`);
        if (!res.ok) return;
        const body = await res.json();
        if (!cancelled) setNodes(body.data?.lineage ?? []);
      } catch {
        if (!cancelled) setNodes([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantSlug, unit.id]);

  const minDepth = nodes && nodes.length > 0 ? Math.min(...nodes.map((n) => n.depth)) : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[80vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-gray-800">Atom Lineage</h3>
            <p className="text-xs text-gray-500">
              Parent → child → grandchild — how this content propagated and was re-added as progeny.
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-sm">
            Close
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-1.5">
          {loading && <p className="text-sm text-gray-400 text-center py-8">Loading lineage…</p>}
          {!loading && (!nodes || nodes.length === 0) && (
            <p className="text-sm text-gray-400 text-center py-8">No lineage found for this atom.</p>
          )}
          {!loading &&
            nodes &&
            nodes.map((n) => {
              const indent = n.depth - minDepth;
              const isSelf = n.rel === 'self';
              const gen = n.meta?.lineage?.generation;
              return (
                <div
                  key={n.id}
                  style={{ marginLeft: `${indent * 20}px` }}
                  className={`rounded-lg border px-3 py-2 ${
                    isSelf ? 'border-blue-400 bg-blue-50' : 'border-gray-200 bg-white'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                        n.rel === 'ancestor'
                          ? 'bg-gray-100 text-gray-600'
                          : n.rel === 'descendant'
                            ? 'bg-purple-100 text-purple-700'
                            : 'bg-blue-100 text-blue-700'
                      }`}
                    >
                      {isSelf ? 'this atom' : n.rel}
                    </span>
                    {gen != null && <span className="text-[10px] text-purple-500">gen {gen}</span>}
                    <span className="text-[11px] text-gray-400">{formatCategory(n.category)}</span>
                    {n.outcome === 'awarded' && <span className="text-[10px]">&#x1f3c6;</span>}
                    {n.meta?.authorName && <span className="text-[10px] text-gray-400">· {n.meta.authorName}</span>}
                    {n.usageCount > 0 && <span className="text-[10px] text-gray-400">· used {n.usageCount}×</span>}
                  </div>
                  <p className="text-xs text-gray-600 line-clamp-2">{n.content}</p>
                </div>
              );
            })}
        </div>
      </div>
    </div>
  );
}

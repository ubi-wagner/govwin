'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import {
  DndContext,
  DragOverlay,
  closestCenter,
  type DragStartEvent,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { useDraggable, useDroppable } from '@dnd-kit/core'

/* ── Types ────────────────────────────────────────── */

interface LibraryUnit {
  id: string
  content: string
  contentType: string
  category: string
  subcategory: string | null
  tags: string[]
  confidenceScore: number | null
  status: string
  sourceUploadId: string | null
  originType: string
  hasEmbedding: boolean
  createdAt: string
  updatedAt: string
  sourceFilename: string | null
}

interface ProposalSection {
  id: string
  title: string
  sectionKey: string
  sortOrder: number
  instructions: string | null
  contentDraft: string | null
  status: string
  pageLimit: number | null
}

interface AttachedUnit {
  unitId: string
  content: string
  category: string
  addedAt: string
}

export interface DissectorViewProps {
  proposalId: string
  tenantSlug: string
  sections: ProposalSection[]
}

/* ── Constants ────────────────────────────────────── */

const CATEGORY_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  bio:                 { bg: 'bg-blue-100',    text: 'text-blue-700',    label: 'Bio' },
  facility:            { bg: 'bg-slate-100',   text: 'text-slate-700',   label: 'Facility' },
  tech_approach:       { bg: 'bg-purple-100',  text: 'text-purple-700',  label: 'Tech Approach' },
  past_performance:    { bg: 'bg-green-100',   text: 'text-green-700',   label: 'Past Performance' },
  management:          { bg: 'bg-orange-100',  text: 'text-orange-700',  label: 'Management' },
  commercialization:   { bg: 'bg-cyan-100',    text: 'text-cyan-700',    label: 'Commercialization' },
  budget:              { bg: 'bg-amber-100',   text: 'text-amber-700',   label: 'Budget' },
  timeline:            { bg: 'bg-rose-100',    text: 'text-rose-700',    label: 'Timeline' },
  innovation:          { bg: 'bg-indigo-100',  text: 'text-indigo-700',  label: 'Innovation' },
  team:                { bg: 'bg-teal-100',    text: 'text-teal-700',    label: 'Team' },
  references:          { bg: 'bg-gray-100',    text: 'text-gray-700',    label: 'References' },
  appendix:            { bg: 'bg-stone-100',   text: 'text-stone-700',   label: 'Appendix' },
  cover_letter:        { bg: 'bg-sky-100',     text: 'text-sky-700',     label: 'Cover Letter' },
  executive_summary:   { bg: 'bg-violet-100',  text: 'text-violet-700',  label: 'Executive Summary' },
  other:               { bg: 'bg-neutral-100', text: 'text-neutral-700', label: 'Other' },
}

const CATEGORY_FILTER_TABS = [
  { value: '', label: 'All' },
  { value: 'bio', label: 'Bio' },
  { value: 'tech_approach', label: 'Tech Approach' },
  { value: 'past_performance', label: 'Past Perf' },
  { value: 'management', label: 'Management' },
  { value: 'innovation', label: 'Innovation' },
  { value: 'team', label: 'Team' },
  { value: 'other', label: 'Other' },
]

const SECTION_STATUS_STYLES: Record<string, string> = {
  draft:      'bg-gray-100 text-gray-600',
  populated:  'bg-yellow-100 text-yellow-700',
  in_review:  'bg-purple-100 text-purple-700',
  approved:   'bg-green-100 text-green-700',
  locked:     'bg-slate-100 text-slate-500',
}

const MIN_PANEL_WIDTH = 300
const DEFAULT_LEFT_RATIO = 0.4

/* ── Utility ──────────────────────────────────────── */

function countWords(text: string | null): number {
  if (!text) return 0
  return text.trim().split(/\s+/).filter(Boolean).length
}

function estimatePages(text: string | null): number {
  // ~250 words per page, standard estimate
  const words = countWords(text)
  return Math.ceil(words / 250) || 0
}

/* ── Main Component ───────────────────────────────── */

export default function DissectorView({ proposalId, tenantSlug, sections }: DissectorViewProps) {
  // Library units state
  const [units, setUnits] = useState<LibraryUnit[]>([])
  const [unitsLoading, setUnitsLoading] = useState(true)
  const [unitsError, setUnitsError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')

  // Sections state (local copy for updates)
  const [localSections, setLocalSections] = useState<ProposalSection[]>(sections)
  const [expandedSection, setExpandedSection] = useState<string | null>(null)
  const [sectionUnits, setSectionUnits] = useState<Record<string, AttachedUnit[]>>({})

  // DnD state
  const [activeUnit, setActiveUnit] = useState<LibraryUnit | null>(null)

  // Resizable panels
  const [leftRatio, setLeftRatio] = useState(DEFAULT_LEFT_RATIO)
  const containerRef = useRef<HTMLDivElement>(null)
  const isDraggingDivider = useRef(false)

  // Toast
  const [toast, setToast] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // dnd-kit sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    })
  )

  // Keep local sections in sync with prop changes
  useEffect(() => {
    setLocalSections(sections)
  }, [sections])

  /* ── Toast helper ─────────────────────────────── */

  function showToast(type: 'success' | 'error', text: string) {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    setToast({ type, text })
    toastTimerRef.current = setTimeout(() => setToast(null), 3000)
  }

  /* ── Search debounce ──────────────────────────── */

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(timer)
  }, [search])

  /* ── Load library units ───────────────────────── */

  const loadUnits = useCallback(async () => {
    setUnitsLoading(true)
    setUnitsError(null)
    try {
      const params = new URLSearchParams({
        status: 'approved',
        limit: '50',
      })
      if (categoryFilter) params.set('category', categoryFilter)
      if (debouncedSearch.trim()) params.set('search', debouncedSearch.trim())

      const res = await fetch(`/api/portal/${tenantSlug}/library?${params}`)
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error ?? 'Failed to load library units')
      }
      const json = await res.json().catch(() => ({}))
      setUnits(json.data ?? [])
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load library units'
      setUnitsError(message)
      console.error('[DissectorView] Failed to load library units:', err)
    } finally {
      setUnitsLoading(false)
    }
  }, [tenantSlug, categoryFilter, debouncedSearch])

  useEffect(() => { loadUnits() }, [loadUnits])

  /* ── Resizable divider ────────────────────────── */

  const handleDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    isDraggingDivider.current = true

    function onMouseMove(ev: MouseEvent) {
      if (!isDraggingDivider.current || !containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      const containerWidth = rect.width
      const offsetX = ev.clientX - rect.left
      const newRatio = Math.max(
        MIN_PANEL_WIDTH / containerWidth,
        Math.min(offsetX / containerWidth, 1 - MIN_PANEL_WIDTH / containerWidth)
      )
      setLeftRatio(newRatio)
    }

    function onMouseUp() {
      isDraggingDivider.current = false
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }, [])

  /* ── DnD handlers ─────────────────────────────── */

  function handleDragStart(event: DragStartEvent) {
    const unitId = event.active.id as string
    const unit = units.find(u => u.id === unitId) ?? null
    setActiveUnit(unit)
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    setActiveUnit(null)

    if (!over) return

    const unitId = active.id as string
    const sectionId = over.id as string
    const unit = units.find(u => u.id === unitId)
    const section = localSections.find(s => s.id === sectionId)

    if (!unit || !section) return

    // Optimistic update: append unit content to section draft
    const separator = section.contentDraft ? '\n\n' : ''
    const updatedDraft = (section.contentDraft ?? '') + separator + unit.content

    setLocalSections(prev =>
      prev.map(s => s.id === sectionId ? { ...s, contentDraft: updatedDraft } : s)
    )

    // Track attached unit locally
    const newAttached: AttachedUnit = {
      unitId: unit.id,
      content: unit.content,
      category: unit.category,
      addedAt: new Date().toISOString(),
    }
    setSectionUnits(prev => ({
      ...prev,
      [sectionId]: [...(prev[sectionId] ?? []), newAttached],
    }))

    // Persist to server
    try {
      const res = await fetch(
        `/api/portal/${tenantSlug}/proposals/${proposalId}/sections`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sectionId,
            contentDraft: updatedDraft,
            unitId: unit.id,
          }),
        }
      )
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? 'Failed to attach unit')
      }
      showToast('success', `Added "${CATEGORY_STYLES[unit.category]?.label ?? unit.category}" unit to "${section.title}"`)
    } catch (err) {
      // Roll back optimistic update
      setLocalSections(prev =>
        prev.map(s => s.id === sectionId ? { ...s, contentDraft: section.contentDraft } : s)
      )
      setSectionUnits(prev => ({
        ...prev,
        [sectionId]: (prev[sectionId] ?? []).filter(a => a !== newAttached),
      }))
      const message = err instanceof Error ? err.message : 'Failed to attach unit'
      showToast('error', message)
      console.error('[DissectorView] Failed to attach unit to section:', err)
    }
  }

  /* ── AI Populate handler ──────────────────────── */

  async function handleAiPopulate(sectionId: string) {
    const section = localSections.find(s => s.id === sectionId)
    if (!section) return

    showToast('success', `Populating "${section.title}" with AI...`)

    try {
      const res = await fetch(
        `/api/portal/${tenantSlug}/proposals/${proposalId}/sections`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sectionId,
            action: 'ai_populate',
          }),
        }
      )
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? 'AI populate failed')
      }
      const json = await res.json().catch(() => ({}))
      if (json.data?.contentDraft) {
        setLocalSections(prev =>
          prev.map(s => s.id === sectionId ? { ...s, contentDraft: json.data.contentDraft } : s)
        )
      }
      showToast('success', `"${section.title}" populated successfully`)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'AI populate failed'
      showToast('error', message)
      console.error('[DissectorView] AI populate failed:', err)
    }
  }

  /* ── Render ───────────────────────────────────── */

  const sortedSections = [...localSections].sort((a, b) => a.sortOrder - b.sortOrder)

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div ref={containerRef} className="relative flex h-[calc(100vh-8rem)] overflow-hidden rounded-xl border border-gray-200 bg-white">
        {/* ── Left Panel: Library Browser ── */}
        <div
          className="flex flex-col overflow-hidden border-r border-gray-200 bg-gray-50"
          style={{ width: `${leftRatio * 100}%`, minWidth: MIN_PANEL_WIDTH }}
        >
          {/* Header */}
          <div className="shrink-0 border-b border-gray-200 bg-white px-4 py-3">
            <h2 className="text-sm font-bold text-gray-900">Library Units</h2>
            <p className="text-[10px] text-gray-400 mt-0.5">Drag units to proposal sections</p>
          </div>

          {/* Search */}
          <div className="shrink-0 px-4 pt-3">
            <div className="relative">
              <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search library units..."
                className="w-full rounded-lg border border-gray-200 bg-white py-2 pl-9 pr-3 text-sm text-gray-900 placeholder-gray-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
            </div>
          </div>

          {/* Category filter tabs */}
          <div className="shrink-0 flex flex-wrap gap-1 px-4 py-3">
            {CATEGORY_FILTER_TABS.map(tab => (
              <button
                key={tab.value}
                onClick={() => setCategoryFilter(tab.value)}
                className={`rounded-full px-2.5 py-1 text-[10px] font-medium transition-colors ${
                  categoryFilter === tab.value
                    ? 'bg-brand-600 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Units list */}
          <div className="flex-1 overflow-y-auto px-4 pb-4">
            {unitsError && (
              <div className="rounded-lg bg-red-50 p-3 text-xs text-red-700">
                {unitsError}
                <button onClick={loadUnits} className="ml-2 underline">Retry</button>
              </div>
            )}

            {unitsLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="animate-pulse rounded-lg bg-white border border-gray-100 h-28" />
                ))}
              </div>
            ) : units.length === 0 ? (
              <div className="mt-8 text-center">
                <div className="mx-auto h-12 w-12 rounded-full bg-gray-100 flex items-center justify-center">
                  <LibraryIcon />
                </div>
                <p className="mt-3 text-sm font-medium text-gray-700">No approved library units yet.</p>
                <p className="mt-1 text-xs text-gray-400">Upload documents to build your library.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {units.map(unit => (
                  <DraggableUnitCard key={unit.id} unit={unit} />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── Resizable Divider ── */}
        <div
          onMouseDown={handleDividerMouseDown}
          className="shrink-0 w-1.5 cursor-col-resize bg-gray-200 hover:bg-brand-400 active:bg-brand-500 transition-colors"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize panels"
        />

        {/* ── Right Panel: Section Assembly ── */}
        <div
          className="flex flex-col overflow-hidden bg-white"
          style={{ width: `${(1 - leftRatio) * 100}%`, minWidth: MIN_PANEL_WIDTH }}
        >
          {/* Header */}
          <div className="shrink-0 border-b border-gray-200 px-4 py-3">
            <h2 className="text-sm font-bold text-gray-900">Proposal Sections</h2>
            <p className="text-[10px] text-gray-400 mt-0.5">
              {sortedSections.length} section{sortedSections.length !== 1 ? 's' : ''} — drop library units to assemble content
            </p>
          </div>

          {/* Sections list */}
          <div className="flex-1 overflow-y-auto px-4 py-3">
            {sortedSections.length === 0 ? (
              <div className="mt-8 text-center">
                <p className="text-sm text-gray-500">No sections defined yet.</p>
                <p className="text-xs text-gray-400 mt-1">Sections are created when an RFP template is applied.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {sortedSections.map(section => (
                  <DroppableSectionAccordion
                    key={section.id}
                    section={section}
                    isExpanded={expandedSection === section.id}
                    onToggle={() =>
                      setExpandedSection(prev => (prev === section.id ? null : section.id))
                    }
                    attachedUnits={sectionUnits[section.id] ?? []}
                    onAiPopulate={() => handleAiPopulate(section.id)}
                    isDragging={activeUnit !== null}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── Toast Notification ── */}
        {toast && (
          <div
            className={`absolute bottom-4 left-1/2 -translate-x-1/2 z-50 rounded-lg px-4 py-2.5 text-sm font-medium shadow-lg transition-all ${
              toast.type === 'success'
                ? 'bg-emerald-600 text-white'
                : 'bg-red-600 text-white'
            }`}
          >
            {toast.text}
          </div>
        )}
      </div>

      {/* ── Drag Overlay ── */}
      <DragOverlay dropAnimation={null}>
        {activeUnit ? <UnitCardOverlay unit={activeUnit} /> : null}
      </DragOverlay>
    </DndContext>
  )
}

/* ── Draggable Unit Card ──────────────────────────── */

function DraggableUnitCard({ unit }: { unit: LibraryUnit }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: unit.id,
  })

  const catStyle = CATEGORY_STYLES[unit.category] ?? CATEGORY_STYLES.other
  const preview = unit.content.length > 150
    ? unit.content.slice(0, 150) + '...'
    : unit.content
  const score = unit.confidenceScore

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`rounded-lg border bg-white p-3 cursor-grab active:cursor-grabbing transition-all ${
        isDragging
          ? 'opacity-30 border-brand-300 shadow-sm'
          : 'border-gray-100 hover:border-gray-200 hover:shadow-sm'
      }`}
    >
      {/* Category badge + confidence */}
      <div className="flex items-center justify-between gap-2">
        <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${catStyle.bg} ${catStyle.text}`}>
          {catStyle.label}
        </span>
        {score != null && (
          <span className={`text-[10px] font-mono font-medium ${
            score > 0.8 ? 'text-green-600' : score > 0.5 ? 'text-yellow-600' : 'text-red-500'
          }`}>
            {Math.round(score * 100)}%
          </span>
        )}
      </div>

      {/* Content preview */}
      <p className="mt-2 text-xs text-gray-600 leading-relaxed line-clamp-3">
        {preview}
      </p>

      {/* Tags */}
      {unit.tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {unit.tags.slice(0, 3).map(tag => (
            <span key={tag} className="inline-flex rounded-md bg-gray-100 px-1.5 py-0.5 text-[9px] font-medium text-gray-500">
              {tag}
            </span>
          ))}
          {unit.tags.length > 3 && (
            <span className="text-[9px] text-gray-400">+{unit.tags.length - 3}</span>
          )}
        </div>
      )}
    </div>
  )
}

/* ── Unit Card Overlay (shown while dragging) ─────── */

function UnitCardOverlay({ unit }: { unit: LibraryUnit }) {
  const catStyle = CATEGORY_STYLES[unit.category] ?? CATEGORY_STYLES.other
  const preview = unit.content.length > 100
    ? unit.content.slice(0, 100) + '...'
    : unit.content

  return (
    <div className="w-72 rounded-lg border border-brand-300 bg-white p-3 shadow-xl rotate-2 opacity-90">
      <div className="flex items-center gap-2">
        <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${catStyle.bg} ${catStyle.text}`}>
          {catStyle.label}
        </span>
      </div>
      <p className="mt-2 text-xs text-gray-600 leading-relaxed line-clamp-2">
        {preview}
      </p>
    </div>
  )
}

/* ── Droppable Section Accordion ──────────────────── */

function DroppableSectionAccordion({
  section,
  isExpanded,
  onToggle,
  attachedUnits,
  onAiPopulate,
  isDragging,
}: {
  section: ProposalSection
  isExpanded: boolean
  onToggle: () => void
  attachedUnits: AttachedUnit[]
  onAiPopulate: () => void
  isDragging: boolean
}) {
  const { isOver, setNodeRef } = useDroppable({
    id: section.id,
  })

  const statusStyle = SECTION_STATUS_STYLES[section.status] ?? SECTION_STATUS_STYLES.draft
  const wordCount = countWords(section.contentDraft)
  const pageEstimate = estimatePages(section.contentDraft)

  return (
    <div
      ref={setNodeRef}
      className={`rounded-lg border transition-all ${
        isOver
          ? 'border-green-400 bg-green-50 ring-2 ring-green-200'
          : isDragging
            ? 'border-brand-200 bg-brand-50/30'
            : 'border-gray-200 bg-white'
      }`}
    >
      {/* Section header */}
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-4 py-3 text-left"
      >
        <ChevronIcon expanded={isExpanded} />
        <span className="text-xs font-mono text-gray-400 w-6">
          {String(section.sortOrder + 1).padStart(2, '0')}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-900 truncate">{section.title}</p>
          <p className="text-[10px] text-gray-400">{section.sectionKey}</p>
        </div>
        <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${statusStyle}`}>
          {section.status}
        </span>
        <span className="text-[10px] text-gray-400 whitespace-nowrap">
          {wordCount} words
        </span>
        {section.pageLimit != null && (
          <span className="text-[10px] text-gray-400 whitespace-nowrap">
            ~{pageEstimate}/{section.pageLimit} pg
          </span>
        )}
      </button>

      {/* Expanded body */}
      {isExpanded && (
        <div className="border-t border-gray-100 px-4 py-3 space-y-3">
          {/* Instructions */}
          {section.instructions && (
            <div className="rounded-lg bg-blue-50 px-3 py-2">
              <p className="text-[10px] font-bold uppercase tracking-wider text-blue-500 mb-1">Instructions</p>
              <p className="text-xs text-blue-700 leading-relaxed">{section.instructions}</p>
            </div>
          )}

          {/* Current content preview */}
          {section.contentDraft ? (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1">Content Preview</p>
              <div className="rounded-lg bg-gray-50 p-3 max-h-40 overflow-y-auto">
                <p className="text-xs text-gray-600 whitespace-pre-wrap leading-relaxed">
                  {section.contentDraft.length > 500
                    ? section.contentDraft.slice(0, 500) + '...'
                    : section.contentDraft}
                </p>
              </div>
            </div>
          ) : (
            <p className="text-xs text-gray-400 italic">No content yet. Drag library units here or use AI Populate.</p>
          )}

          {/* Drop zone indicator when dragging */}
          {isDragging && (
            <div className={`rounded-lg border-2 border-dashed p-4 text-center transition-colors ${
              isOver
                ? 'border-green-400 bg-green-50'
                : 'border-gray-300 bg-gray-50'
            }`}>
              <DropIcon className={`mx-auto h-5 w-5 ${isOver ? 'text-green-500' : 'text-gray-400'}`} />
              <p className={`mt-1 text-xs font-medium ${isOver ? 'text-green-600' : 'text-gray-400'}`}>
                {isOver ? 'Release to add' : 'Drop library unit here'}
              </p>
            </div>
          )}

          {/* Attached units */}
          {attachedUnits.length > 0 && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1">
                Attached Units ({attachedUnits.length})
              </p>
              <div className="space-y-1">
                {attachedUnits.map((au, idx) => {
                  const catStyle = CATEGORY_STYLES[au.category] ?? CATEGORY_STYLES.other
                  return (
                    <div
                      key={`${au.unitId}-${idx}`}
                      className="flex items-center gap-2 rounded-lg bg-gray-50 px-3 py-2"
                    >
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-[9px] font-semibold ${catStyle.bg} ${catStyle.text}`}>
                        {catStyle.label}
                      </span>
                      <p className="flex-1 truncate text-[10px] text-gray-600">
                        {au.content.slice(0, 80)}{au.content.length > 80 ? '...' : ''}
                      </p>
                      <span className="text-[9px] text-gray-300">
                        {new Date(au.addedAt).toLocaleTimeString()}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* AI Populate button */}
          <button
            onClick={onAiPopulate}
            className="flex items-center gap-2 rounded-lg bg-purple-50 px-3 py-2 text-xs font-medium text-purple-700 hover:bg-purple-100 transition-colors"
          >
            <SparklesIcon className="h-3.5 w-3.5" />
            AI Populate
          </button>
        </div>
      )}
    </div>
  )
}

/* ── Icons ────────────────────────────────────────── */

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
    </svg>
  )
}

function LibraryIcon() {
  return (
    <svg className="h-6 w-6 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25" />
    </svg>
  )
}

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      className={`h-4 w-4 shrink-0 text-gray-400 transition-transform ${expanded ? 'rotate-90' : ''}`}
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={2}
      stroke="currentColor"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
    </svg>
  )
}

function DropIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
    </svg>
  )
}

function SparklesIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 0 0-2.456 2.456ZM16.894 20.567 16.5 21.75l-.394-1.183a2.25 2.25 0 0 0-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 0 0 1.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 0 0 1.423 1.423l1.183.394-1.183.394a2.25 2.25 0 0 0-1.423 1.423Z" />
    </svg>
  )
}

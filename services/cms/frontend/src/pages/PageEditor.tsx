import { useState, useCallback, useEffect, useRef } from 'react'
import { useParams } from 'react-router-dom'
import MetadataEditor from '../components/MetadataEditor'

// ── Types ───────────────────────────────────────────────────────────────────

interface Block {
  id: string
  slug: string
  title: string
  contentType: string
  body: string
  excerpt: string | null
  author: string | null
  tags: string[]
  published: boolean
  status: string
  publishedAt: string | null
  featuredImage: string | null
  externalUrl: string | null
  displayOrder: number
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

interface VersionSnapshot {
  version: number
  savedAt: string
  savedBy: string
  title: string
  body: string
  excerpt: string | null
  featuredImage: string | null
  displayOrder: number
  metadata: Record<string, unknown>
}

interface LocalEdit {
  title?: string
  body?: string
  excerpt?: string | null
  featuredImage?: string | null
  displayOrder?: number
  metadata?: Record<string, unknown>
}

// ── Constants ───────────────────────────────────────────────────────────────

const PAGES = [
  'homepage', 'about', 'features', 'value', 'pricing',
  'how-it-works', 'engine', 'the-expert', 'security',
  'infosec', 'apply', 'resources', 'team', 'customers',
]

const PAGE_LABELS: Record<string, string> = {
  homepage: 'Homepage',
  about: 'About',
  features: 'Features',
  value: 'Value',
  pricing: 'Pricing',
  'how-it-works': 'How It Works',
  engine: 'Engine',
  'the-expert': 'The Expert',
  security: 'Security',
  infosec: 'InfoSec',
  apply: 'Apply',
  resources: 'Resources',
  team: 'Team',
  customers: 'Customers',
}

const PAGE_TO_PATH: Record<string, string> = {
  homepage: '/',
  about: '/about',
  features: '/features',
  value: '/value',
  pricing: '/pricing',
  'how-it-works': '/how-it-works',
  engine: '/engine',
  'the-expert': '/the-expert',
  security: '/security',
  infosec: '/infosec',
  apply: '/apply',
  resources: '/resources',
  team: '/team',
  customers: '/customers',
}

const SECTION_LABELS: Record<string, string> = {
  hero: 'Hero Banner',
  stats: 'Statistics',
  stages: 'Process Steps',
  'pricing-hero': 'Pricing Header',
  pricing: 'Pricing Plans',
  'expert-gate': 'Expert Gate',
  quote: 'Pull Quote',
  cta: 'Call to Action',
  pillars: 'Core Pillars',
  founder: 'Founder',
  items: 'Feature Items',
  faqs: 'FAQs',
  spotlight: 'Spotlight',
  portals: 'Portal Links',
  curation: 'Expert Curation',
  flywheel: 'Value Flywheel',
  steps: 'Steps',
  guardrails: 'Guardrails',
  collab: 'Collaboration',
  differentiators: 'Differentiators',
  credentials: 'Credentials',
  timeline: 'Timeline',
  isolation: 'Isolation',
  promise: 'Promise',
  certifications: 'Certifications',
  bottom: 'Bottom Section',
}

function getSectionLabel(tag: string): string {
  return SECTION_LABELS[tag] ?? tag.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

const FRONTEND_URL = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_FRONTEND_URL) || ''

// ── Status badge ────────────────────────────────────────────────────────────

function StatusBadge({ status, modified }: { status: string; modified?: boolean }) {
  if (modified) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800">
        Modified
      </span>
    )
  }
  const styles: Record<string, string> = {
    published: 'bg-green-100 text-green-700',
    draft: 'bg-yellow-100 text-yellow-800',
    pending: 'bg-indigo-100 text-indigo-700',
    archived: 'bg-gray-100 text-gray-600',
  }
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${styles[status] ?? 'bg-gray-100 text-gray-600'}`}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  )
}

// ── Version history panel ───────────────────────────────────────────────────

function VersionHistoryPanel({
  metadata,
  onRevert,
  onClose,
}: {
  metadata: Record<string, unknown>
  onRevert: (version: VersionSnapshot) => void
  onClose: () => void
}) {
  const versions = (metadata._versions ?? []) as VersionSnapshot[]
  const currentVersion = (metadata._currentVersion ?? 0) as number
  const [reverting, setReverting] = useState<number | null>(null)

  return (
    <div className="border-t border-gray-200 mt-4 pt-4">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-semibold text-gray-700">Version History</h4>
        <button onClick={onClose} className="text-xs text-gray-500 hover:text-gray-700">
          Close
        </button>
      </div>
      {versions.length === 0 ? (
        <p className="text-xs text-gray-400">No version history yet. Versions are saved automatically on each draft save.</p>
      ) : (
        <div className="space-y-2 max-h-60 overflow-y-auto">
          <p className="text-xs text-gray-500 mb-2">Current: v{currentVersion}</p>
          {versions.map((v) => (
            <div
              key={v.version}
              className="flex items-center justify-between p-2 bg-gray-50 rounded border border-gray-100"
            >
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-gray-700 truncate">
                  v{v.version} -- {v.title}
                </p>
                <p className="text-xs text-gray-400">
                  {new Date(v.savedAt).toLocaleString()} by {v.savedBy}
                </p>
              </div>
              <button
                onClick={async () => {
                  setReverting(v.version)
                  onRevert(v)
                  setTimeout(() => setReverting(null), 500)
                }}
                disabled={reverting !== null}
                className="ml-2 px-2 py-1 text-xs text-blue-600 hover:bg-blue-50 rounded disabled:opacity-50 shrink-0"
              >
                {reverting === v.version ? 'Reverting...' : 'Revert'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Block editor (accordion item) ──────────────────────────────────────────

function BlockEditor({
  block,
  localEdit,
  onFieldChange,
  onSaveDraft,
  saving,
  onRefresh,
  onMoveUp,
  onMoveDown,
  isFirst,
  isLast,
}: {
  block: Block
  localEdit: LocalEdit | undefined
  onFieldChange: (blockId: string, field: string, value: unknown) => void
  onSaveDraft: (blockId: string) => void
  saving: boolean
  onRefresh: () => void
  onMoveUp: () => void
  onMoveDown: () => void
  isFirst: boolean
  isLast: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const [showVersions, setShowVersions] = useState(false)
  const [aiMode, setAiMode] = useState<'idle' | 'generate' | 'revise' | 'from_url'>('idle')
  const [aiLoading, setAiLoading] = useState(false)
  const [aiInstructions, setAiInstructions] = useState('')
  const [aiUrl, setAiUrl] = useState('')

  const isModified = localEdit !== undefined && Object.keys(localEdit).length > 0

  // Resolved values: local edit overrides block data
  const title = localEdit?.title ?? block.title
  const body = localEdit?.body ?? block.body
  const excerpt = localEdit?.excerpt !== undefined ? localEdit.excerpt : block.excerpt
  const featuredImage = localEdit?.featuredImage !== undefined ? localEdit.featuredImage : block.featuredImage
  const displayOrder = localEdit?.displayOrder ?? block.displayOrder
  const metadata = localEdit?.metadata ?? block.metadata

  // Strip version tracking fields from metadata for the editor
  const editableMetadata: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(metadata)) {
    if (k !== '_versions' && k !== '_currentVersion' && k !== '_draftedBy') {
      editableMetadata[k] = v
    }
  }

  const pageTag = block.tags[0]
  const sectionTag = block.tags.find((t) => t !== pageTag) ?? 'unknown'

  const handleAi = async () => {
    setAiLoading(true)
    try {
      let endpoint = ''
      let payload: Record<string, unknown> = {}

      if (aiMode === 'generate') {
        endpoint = '/api/page-blocks/ai/generate'
        payload = {
          page: block.tags[0] ?? 'homepage',
          section: sectionTag,
          instructions: aiInstructions || undefined,
        }
      } else if (aiMode === 'revise') {
        endpoint = '/api/page-blocks/ai/revise'
        payload = {
          title,
          body,
          excerpt: excerpt ?? '',
          instructions: aiInstructions || 'Make it more compelling and concise.',
        }
      } else if (aiMode === 'from_url') {
        endpoint = '/api/page-blocks/ai/from-url'
        payload = {
          url: aiUrl,
          page: block.tags[0] ?? 'homepage',
          section: sectionTag,
          instructions: aiInstructions || undefined,
        }
      }

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string; detail?: string }
        throw new Error(err.error || err.detail || 'AI request failed')
      }

      const json = await res.json() as { data: { title?: string; body?: string; excerpt?: string; metadata?: Record<string, unknown> } }
      const d = json.data

      if (d.title) onFieldChange(block.id, 'title', d.title)
      if (d.body) onFieldChange(block.id, 'body', d.body)
      if (d.excerpt) onFieldChange(block.id, 'excerpt', d.excerpt)
      if (d.metadata && Object.keys(d.metadata).length > 0) {
        onFieldChange(block.id, 'metadata', { ...editableMetadata, ...d.metadata })
      }

      setAiMode('idle')
      setAiInstructions('')
      setAiUrl('')
    } catch (err) {
      setAiMode('idle')
      alert(`AI error: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setAiLoading(false)
    }
  }

  return (
    <div className={`border rounded-lg transition-colors ${isModified ? 'border-amber-300 bg-amber-50/30' : 'border-gray-200 bg-white'}`}>
      {/* Header */}
      <div className="flex items-center">
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="flex-1 flex items-center justify-between px-4 py-3 text-left hover:bg-gray-50/50 rounded-lg"
        >
          <div className="flex items-center gap-3 min-w-0">
            <svg
              className={`w-4 h-4 text-gray-400 transition-transform shrink-0 ${expanded ? 'rotate-90' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-900 truncate">{title}</p>
              <p className="text-xs text-gray-400 truncate">{block.slug}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <StatusBadge status={block.status} modified={isModified} />
          </div>
        </button>
        {/* Move up/down buttons */}
        <div className="flex flex-col px-2 gap-0.5 shrink-0">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onMoveUp() }}
            disabled={isFirst}
            className="px-1.5 py-0.5 text-xs text-gray-500 hover:bg-gray-100 rounded disabled:opacity-30 disabled:cursor-not-allowed"
            title="Move up"
          >
            &#9650;
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onMoveDown() }}
            disabled={isLast}
            className="px-1.5 py-0.5 text-xs text-gray-500 hover:bg-gray-100 rounded disabled:opacity-30 disabled:cursor-not-allowed"
            title="Move down"
          >
            &#9660;
          </button>
        </div>
      </div>

      {/* Expanded editor */}
      {expanded && (
        <div className="px-4 pb-4 space-y-4 border-t border-gray-100">
          {/* Title */}
          <div className="pt-4">
            <label className="block text-xs font-medium text-gray-500 mb-1">Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => onFieldChange(block.id, 'title', e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </div>

          {/* Body */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Body</label>
            <textarea
              value={body}
              onChange={(e) => onFieldChange(block.id, 'body', e.target.value)}
              rows={4}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 font-mono"
            />
          </div>

          {/* Excerpt */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Excerpt / Subtitle</label>
            <input
              type="text"
              value={excerpt ?? ''}
              onChange={(e) => onFieldChange(block.id, 'excerpt', e.target.value || null)}
              className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </div>

          {/* Featured Image + Display Order */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Featured Image URL</label>
              <input
                type="text"
                value={featuredImage ?? ''}
                onChange={(e) => onFieldChange(block.id, 'featuredImage', e.target.value || null)}
                className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                placeholder="/images/..."
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Display Order</label>
              <input
                type="number"
                value={displayOrder}
                onChange={(e) => onFieldChange(block.id, 'displayOrder', parseInt(e.target.value, 10) || 0)}
                className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </div>

          {/* Metadata editor */}
          <div className="border-t border-gray-100 pt-4">
            <MetadataEditor
              tags={block.tags}
              metadata={editableMetadata}
              onChange={(newMeta: Record<string, unknown>) => onFieldChange(block.id, 'metadata', newMeta)}
            />
          </div>

          {/* AI Tools */}
          <div className="border-t border-gray-100 pt-3">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-medium text-indigo-600">AI Tools:</span>
              <button
                onClick={() => setAiMode(aiMode === 'generate' ? 'idle' : 'generate')}
                className={`px-2 py-1 text-xs rounded-md ${aiMode === 'generate' ? 'bg-indigo-100 text-indigo-700 font-semibold' : 'text-gray-600 hover:bg-gray-100'}`}
              >
                Generate
              </button>
              <button
                onClick={() => setAiMode(aiMode === 'revise' ? 'idle' : 'revise')}
                disabled={!title && !body}
                className={`px-2 py-1 text-xs rounded-md disabled:opacity-40 ${aiMode === 'revise' ? 'bg-indigo-100 text-indigo-700 font-semibold' : 'text-gray-600 hover:bg-gray-100'}`}
              >
                Revise
              </button>
              <button
                onClick={() => setAiMode(aiMode === 'from_url' ? 'idle' : 'from_url')}
                className={`px-2 py-1 text-xs rounded-md ${aiMode === 'from_url' ? 'bg-indigo-100 text-indigo-700 font-semibold' : 'text-gray-600 hover:bg-gray-100'}`}
              >
                From URL
              </button>
            </div>

            {aiMode !== 'idle' && (
              <div className="bg-indigo-50 rounded-lg p-3 space-y-2">
                {aiMode === 'from_url' && (
                  <input
                    type="url"
                    placeholder="https://competitor-site.com/page"
                    value={aiUrl}
                    onChange={(e) => setAiUrl(e.target.value)}
                    className="w-full rounded-md border border-indigo-200 px-3 py-1.5 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                  />
                )}
                <textarea
                  placeholder={
                    aiMode === 'generate' ? 'Optional: specific instructions for the AI...'
                    : aiMode === 'revise' ? 'How should it be revised? (e.g. "make it shorter", "more technical")'
                    : 'Optional: what to focus on from the source page...'
                  }
                  value={aiInstructions}
                  onChange={(e) => setAiInstructions(e.target.value)}
                  rows={2}
                  className="w-full rounded-md border border-indigo-200 px-3 py-1.5 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                />
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleAi}
                    disabled={aiLoading || (aiMode === 'from_url' && !aiUrl)}
                    className="px-3 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-md disabled:opacity-50"
                  >
                    {aiLoading ? 'Generating...' : aiMode === 'generate' ? 'Generate Content' : aiMode === 'revise' ? 'Revise Content' : 'Generate from URL'}
                  </button>
                  <button
                    onClick={() => { setAiMode('idle'); setAiInstructions(''); setAiUrl('') }}
                    className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700"
                  >
                    Cancel
                  </button>
                  {aiLoading && <span className="text-xs text-indigo-500 animate-pulse">Claude is writing...</span>}
                </div>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between pt-2 border-t border-gray-100">
            <div className="flex items-center gap-2">
              <button
                onClick={() => onSaveDraft(block.id)}
                disabled={!isModified || saving}
                className="px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-md disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {saving ? 'Saving...' : 'Save Draft'}
              </button>
              <button
                onClick={() => setShowVersions(!showVersions)}
                className="px-3 py-1.5 text-xs font-medium text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-md"
              >
                {showVersions ? 'Hide History' : 'Version History'}
              </button>
            </div>
            <p className="text-xs text-gray-400">
              Section: {getSectionLabel(sectionTag)}
            </p>
          </div>

          {/* Version history */}
          {showVersions && (
            <VersionHistoryPanel
              metadata={block.metadata}
              onRevert={(v) => {
                // Apply the version snapshot as local edits
                onFieldChange(block.id, 'title', v.title)
                onFieldChange(block.id, 'body', v.body)
                if (v.excerpt !== undefined) onFieldChange(block.id, 'excerpt', v.excerpt)
                if (v.metadata) onFieldChange(block.id, 'metadata', v.metadata)
                setShowVersions(false)
              }}
              onClose={() => setShowVersions(false)}
            />
          )}
        </div>
      )}
    </div>
  )
}

// ── Main Page Editor ────────────────────────────────────────────────────────

export default function PageEditor() {
  const { page: urlPage } = useParams<{ page?: string }>()
  const [selectedPage, setSelectedPage] = useState(urlPage ?? PAGES[0])
  const [blocks, setBlocks] = useState<Block[]>([])
  const [loading, setLoading] = useState(false)
  const [localEdits, setLocalEdits] = useState<Record<string, LocalEdit>>({})
  const [savingBlocks, setSavingBlocks] = useState<Set<string>>(new Set())
  const [publishing, setPublishing] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [approving, setApproving] = useState(false)
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)
  const [addingBlank, setAddingBlank] = useState<string | null>(null)
  const iframeRef = useRef<HTMLIFrameElement>(null)

  // Update selected page when URL param changes
  useEffect(() => {
    if (urlPage && PAGES.includes(urlPage)) {
      setSelectedPage(urlPage)
    }
  }, [urlPage])

  const showToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type })
    setTimeout(() => setToast(null), 3000)
  }, [])

  // Fetch blocks for the selected page
  const fetchBlocks = useCallback(async () => {
    setLoading(true)
    setLocalEdits({})
    try {
      const res = await fetch(`/api/page-blocks/?page=${encodeURIComponent(selectedPage)}`)
      if (!res.ok) throw new Error('Failed to load blocks')
      const json = await res.json()
      if (json.data?.blocks) {
        setBlocks(json.data.blocks)
      }
    } catch {
      showToast('Failed to load blocks', 'error')
    } finally {
      setLoading(false)
    }
  }, [selectedPage, showToast])

  useEffect(() => {
    fetchBlocks()
  }, [fetchBlocks])

  // Refresh the iframe preview
  const refreshPreview = useCallback(() => {
    if (iframeRef.current && FRONTEND_URL) {
      const previewPath = PAGE_TO_PATH[selectedPage] ?? '/'
      iframeRef.current.src = `${FRONTEND_URL}${previewPath}?_preview=1&_t=${Date.now()}`
    }
  }, [selectedPage])

  // Handle field changes (local only)
  const handleFieldChange = useCallback((blockId: string, field: string, value: unknown) => {
    setLocalEdits((prev) => ({
      ...prev,
      [blockId]: {
        ...(prev[blockId] ?? {}),
        [field]: value,
      },
    }))
  }, [])

  // Save a single block draft
  const handleSaveDraft = useCallback(async (blockId: string) => {
    const edit = localEdits[blockId]
    if (!edit || Object.keys(edit).length === 0) return

    setSavingBlocks((prev) => new Set([...prev, blockId]))
    try {
      const res = await fetch('/api/page-blocks/', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates: [{ id: blockId, ...edit }] }),
      })

      if (res.ok) {
        setLocalEdits((prev) => {
          const next = { ...prev }
          delete next[blockId]
          return next
        })
        await fetchBlocks()
        refreshPreview()
        showToast('Draft saved')
      } else {
        const json = await res.json().catch(() => ({})) as { error?: string; detail?: string }
        showToast(json.error || json.detail || 'Save failed', 'error')
      }
    } catch {
      showToast('Network error', 'error')
    } finally {
      setSavingBlocks((prev) => {
        const next = new Set(prev)
        next.delete(blockId)
        return next
      })
    }
  }, [localEdits, fetchBlocks, refreshPreview, showToast])

  // Save all modified blocks
  const handleSaveAll = useCallback(async () => {
    const editEntries = Object.entries(localEdits).filter(([, edit]) => Object.keys(edit).length > 0)
    if (editEntries.length === 0) return

    const allIds = editEntries.map(([id]) => id)
    setSavingBlocks(new Set(allIds))

    try {
      const res = await fetch('/api/page-blocks/', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          updates: editEntries.map(([id, edit]) => ({ id, ...edit })),
        }),
      })

      if (res.ok) {
        setLocalEdits({})
        await fetchBlocks()
        refreshPreview()
        const json = await res.json().catch(() => ({})) as { data?: { saved?: number } }
        showToast(`${json.data?.saved ?? editEntries.length} draft(s) saved`)
      } else {
        const json = await res.json().catch(() => ({})) as { error?: string; detail?: string }
        showToast(json.error || json.detail || 'Save failed', 'error')
      }
    } catch {
      showToast('Network error', 'error')
    } finally {
      setSavingBlocks(new Set())
    }
  }, [localEdits, fetchBlocks, refreshPreview, showToast])

  // Publish all drafts for this page
  const handlePublish = useCallback(async () => {
    // Save unsaved local edits first
    const editEntries = Object.entries(localEdits).filter(([, edit]) => Object.keys(edit).length > 0)
    if (editEntries.length > 0) {
      const saveRes = await fetch('/api/page-blocks/', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          updates: editEntries.map(([id, edit]) => ({ id, ...edit })),
        }),
      })
      if (!saveRes.ok) {
        showToast('Failed to save pending edits before publishing', 'error')
        return
      }
    }

    setPublishing(true)
    try {
      const res = await fetch('/api/page-blocks/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ page: selectedPage }),
      })

      if (res.ok) {
        const json = await res.json() as { data?: { published?: number } }
        setLocalEdits({})
        await fetchBlocks()
        refreshPreview()
        showToast(`${json.data?.published ?? 0} block(s) published`)

        // Trigger revalidation
        fetch('/api/page-blocks/revalidate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ page: selectedPage }),
        }).catch(() => { /* best effort */ })
      } else {
        const json = await res.json().catch(() => ({})) as { error?: string; detail?: string }
        showToast(json.error || json.detail || 'Publish failed', 'error')
      }
    } catch {
      showToast('Network error', 'error')
    } finally {
      setPublishing(false)
    }
  }, [selectedPage, localEdits, fetchBlocks, refreshPreview, showToast])

  // Submit for review
  const handleSubmitForReview = useCallback(async () => {
    const editEntries = Object.entries(localEdits).filter(([, edit]) => Object.keys(edit).length > 0)
    if (editEntries.length > 0) {
      const saveRes = await fetch('/api/page-blocks/', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates: editEntries.map(([id, edit]) => ({ id, ...edit })) }),
      })
      if (!saveRes.ok) {
        showToast('Failed to save edits before submitting', 'error')
        return
      }
    }

    setSubmitting(true)
    try {
      const res = await fetch('/api/page-blocks/submit-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ page: selectedPage }),
      })
      if (res.ok) {
        const json = await res.json() as { data?: { submitted?: number } }
        setLocalEdits({})
        await fetchBlocks()
        showToast(`${json.data?.submitted ?? 0} block(s) submitted for review`)
      } else {
        const json = await res.json().catch(() => ({})) as { error?: string; detail?: string }
        showToast(json.error || json.detail || 'Submit failed', 'error')
      }
    } catch {
      showToast('Network error', 'error')
    } finally {
      setSubmitting(false)
    }
  }, [selectedPage, localEdits, fetchBlocks, showToast])

  // Approve pending blocks
  const handleApprove = useCallback(async () => {
    setApproving(true)
    try {
      const res = await fetch('/api/page-blocks/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ page: selectedPage }),
      })
      if (res.ok) {
        const json = await res.json() as { data?: { approved?: number } }
        await fetchBlocks()
        refreshPreview()
        showToast(`${json.data?.approved ?? 0} block(s) approved and published`)

        fetch('/api/page-blocks/revalidate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ page: selectedPage }),
        }).catch(() => { /* best effort */ })
      } else {
        const json = await res.json().catch(() => ({})) as { error?: string; detail?: string }
        showToast(json.error || json.detail || 'Approve failed', 'error')
      }
    } catch {
      showToast('Network error', 'error')
    } finally {
      setApproving(false)
    }
  }, [selectedPage, fetchBlocks, refreshPreview, showToast])

  // Reject pending blocks
  const handleReject = useCallback(async () => {
    const notes = window.prompt('Rejection notes (optional):')
    if (notes === null) return

    try {
      const res = await fetch('/api/page-blocks/reject', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ page: selectedPage, notes }),
      })
      if (res.ok) {
        const json = await res.json() as { data?: { rejected?: number } }
        await fetchBlocks()
        showToast(`${json.data?.rejected ?? 0} block(s) sent back for revision`)
      }
    } catch {
      showToast('Network error', 'error')
    }
  }, [selectedPage, fetchBlocks, showToast])

  // Move block up/down
  const handleMoveBlock = useCallback(async (blockId: string, direction: 'up' | 'down') => {
    // Find block index in the flat list
    const idx = blocks.findIndex((b) => b.id === blockId)
    if (idx < 0) return
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1
    if (swapIdx < 0 || swapIdx >= blocks.length) return

    const currentBlock = blocks[idx]
    const swapBlock = blocks[swapIdx]

    // Swap display_order values
    try {
      const res = await fetch('/api/page-blocks/', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          updates: [
            { id: currentBlock.id, displayOrder: swapBlock.displayOrder },
            { id: swapBlock.id, displayOrder: currentBlock.displayOrder },
          ],
        }),
      })

      if (res.ok) {
        await fetchBlocks()
        refreshPreview()
      } else {
        showToast('Failed to reorder blocks', 'error')
      }
    } catch {
      showToast('Network error', 'error')
    }
  }, [blocks, fetchBlocks, refreshPreview, showToast])

  // Add blank block
  const handleAddBlank = useCallback(async (section: string) => {
    setAddingBlank(section)
    try {
      const res = await fetch('/api/page-blocks/add-blank', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ page: selectedPage, section }),
      })

      if (res.ok) {
        await fetchBlocks()
        showToast('Blank block added')
      } else {
        const json = await res.json().catch(() => ({})) as { error?: string; detail?: string }
        showToast(json.error || json.detail || 'Failed to add block', 'error')
      }
    } catch {
      showToast('Network error', 'error')
    } finally {
      setAddingBlank(null)
    }
  }, [selectedPage, fetchBlocks, showToast])

  // Group blocks by section tag
  const groupedBlocks: Record<string, Block[]> = {}
  for (const block of blocks) {
    const pageTag = block.tags.find((t) => t === selectedPage)
    const sectionTag = block.tags.find((t) => t !== pageTag) ?? 'unknown'
    if (!groupedBlocks[sectionTag]) groupedBlocks[sectionTag] = []
    groupedBlocks[sectionTag].push(block)
  }

  const editValues = Object.values(localEdits)
  const hasLocalEdits = editValues.some((e) => Object.keys(e).length > 0)
  const hasDraftBlocks = blocks.some((b) => b.status === 'draft')
  const hasPendingBlocks = blocks.some((b) => b.status === 'pending')
  const draftCount = blocks.filter((b) => b.status === 'draft').length
  const pendingCount = blocks.filter((b) => b.status === 'pending').length
  const modifiedCount = editValues.filter((e) => Object.keys(e).length > 0).length

  const previewPath = PAGE_TO_PATH[selectedPage] ?? '/'
  const previewUrl = FRONTEND_URL ? `${FRONTEND_URL}${previewPath}?_preview=1` : ''

  return (
    <div className="flex flex-col" style={{ height: 'calc(100vh - 4rem)' }}>
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-3 bg-white border-b border-gray-200 shrink-0">
        <div className="flex items-center gap-4">
          <h1 className="text-lg font-bold text-gray-900">Page Editor</h1>
          <select
            value={selectedPage}
            onChange={(e) => setSelectedPage(e.target.value)}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          >
            {PAGES.map((p) => (
              <option key={p} value={p}>
                {PAGE_LABELS[p] ?? p}
              </option>
            ))}
          </select>
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <span>{blocks.length} blocks</span>
            {draftCount > 0 && (
              <span className="px-1.5 py-0.5 bg-yellow-100 text-yellow-800 rounded">
                {draftCount} draft
              </span>
            )}
            {pendingCount > 0 && (
              <span className="px-1.5 py-0.5 bg-indigo-100 text-indigo-700 rounded">
                {pendingCount} pending review
              </span>
            )}
            {modifiedCount > 0 && (
              <span className="px-1.5 py-0.5 bg-amber-100 text-amber-800 rounded">
                {modifiedCount} unsaved
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {hasLocalEdits && (
            <button
              onClick={handleSaveAll}
              disabled={savingBlocks.size > 0}
              className="px-3 py-1.5 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-md border border-blue-200"
            >
              Save All Drafts
            </button>
          )}
          {(hasDraftBlocks || hasLocalEdits) && (
            <>
              <button
                onClick={handleSubmitForReview}
                disabled={submitting}
                className="px-3 py-1.5 text-xs font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded-md border border-indigo-200 disabled:opacity-50"
              >
                {submitting ? 'Submitting...' : 'Submit for Review'}
              </button>
              <button
                onClick={handlePublish}
                disabled={publishing}
                className="px-3 py-1.5 text-xs font-bold text-white bg-green-600 hover:bg-green-700 rounded-md disabled:opacity-50"
              >
                {publishing ? 'Publishing...' : 'Publish All Changes'}
              </button>
            </>
          )}
          {hasPendingBlocks && (
            <>
              <button
                onClick={handleReject}
                className="px-3 py-1.5 text-xs font-semibold text-orange-700 bg-orange-50 hover:bg-orange-100 rounded-md border border-orange-200"
              >
                Reject to Draft
              </button>
              <button
                onClick={handleApprove}
                disabled={approving}
                className="px-3 py-1.5 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-md disabled:opacity-50"
              >
                {approving ? 'Approving...' : 'Approve & Publish'}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Split pane */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left panel: block editor (40%) */}
        <div className="w-[40%] border-r border-gray-200 overflow-y-auto bg-gray-50">
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <p className="text-sm text-gray-400">Loading blocks...</p>
            </div>
          ) : blocks.length === 0 ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <p className="text-sm text-gray-500">No content blocks found for this page.</p>
                <p className="text-xs text-gray-400 mt-1">
                  Add a blank block to get started.
                </p>
                <button
                  onClick={() => handleAddBlank('hero')}
                  disabled={addingBlank !== null}
                  className="mt-3 px-3 py-1.5 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-md border border-blue-200"
                >
                  + Add Hero Block
                </button>
              </div>
            </div>
          ) : (
            <div className="p-4 space-y-6">
              {Object.entries(groupedBlocks).map(([section, sectionBlocks]) => (
                <div key={section}>
                  <div className="flex items-center justify-between mb-2 px-1">
                    <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                      {getSectionLabel(section)}
                    </h3>
                    <button
                      onClick={() => handleAddBlank(section)}
                      disabled={addingBlank !== null}
                      className="px-2 py-1 text-xs text-blue-600 hover:bg-blue-50 rounded disabled:opacity-50"
                      title={`Add blank ${getSectionLabel(section)} block`}
                    >
                      {addingBlank === section ? 'Adding...' : '+ Add Block'}
                    </button>
                  </div>
                  <div className="space-y-2">
                    {sectionBlocks.map((block, idx) => (
                      <BlockEditor
                        key={block.id}
                        block={block}
                        localEdit={localEdits[block.id]}
                        onFieldChange={handleFieldChange}
                        onSaveDraft={handleSaveDraft}
                        saving={savingBlocks.has(block.id)}
                        onRefresh={fetchBlocks}
                        onMoveUp={() => handleMoveBlock(block.id, 'up')}
                        onMoveDown={() => handleMoveBlock(block.id, 'down')}
                        isFirst={idx === 0}
                        isLast={idx === sectionBlocks.length - 1}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right panel: live preview iframe (60%) */}
        <div className="w-[60%] bg-white flex flex-col">
          {FRONTEND_URL ? (
            <>
              <div className="flex items-center justify-between px-3 py-2 bg-gray-100 border-b border-gray-200">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-red-400" />
                  <div className="w-3 h-3 rounded-full bg-yellow-400" />
                  <div className="w-3 h-3 rounded-full bg-green-400" />
                </div>
                <p className="text-xs text-gray-500 font-mono truncate flex-1 mx-4">
                  {previewUrl}
                </p>
                <button
                  onClick={refreshPreview}
                  className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1 rounded hover:bg-gray-200"
                  title="Refresh preview"
                >
                  Refresh
                </button>
              </div>
              <iframe
                ref={iframeRef}
                src={previewUrl}
                className="w-full flex-1 border-0"
                title="Page preview"
              />
            </>
          ) : (
            <div className="flex items-center justify-center h-full">
              <div className="text-center p-8">
                <p className="text-sm text-gray-500 mb-2">Live preview unavailable</p>
                <p className="text-xs text-gray-400">
                  Set <code className="bg-gray-100 px-1.5 py-0.5 rounded text-xs font-mono">VITE_FRONTEND_URL</code> environment
                  variable to enable live preview (e.g., <code className="bg-gray-100 px-1.5 py-0.5 rounded text-xs font-mono">https://govtech-frontend-production.up.railway.app</code>).
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Toast notification */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 px-4 py-3 rounded-lg shadow-lg text-sm font-medium z-50 transition-opacity ${
            toast.type === 'success'
              ? 'bg-green-600 text-white'
              : 'bg-red-600 text-white'
          }`}
        >
          {toast.message}
        </div>
      )}
    </div>
  )
}

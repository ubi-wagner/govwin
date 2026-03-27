'use client'

import { useEffect, useState, useCallback } from 'react'
import type { SiteContent, ContentEvent } from '@/types'

type ViewMode = 'list' | 'edit'

interface PageListItem {
  id: string
  pageKey: string
  displayName: string
  draftContent: Record<string, unknown>
  draftMetadata: Record<string, unknown>
  draftUpdatedAt: string
  draftUpdatedBy: string | null
  publishedContent: Record<string, unknown> | null
  publishedMetadata: Record<string, unknown> | null
  publishedAt: string | null
  publishedBy: string | null
  hasPrevious: boolean
  previousPublishedAt: string | null
  autoPublish: boolean
  contentSource: string
  createdAt: string
  updatedAt: string
}

// Section definitions for each page type
const PAGE_SECTIONS: Record<string, { key: string; label: string; description: string }[]> = {
  home: [
    { key: 'hero', label: 'Hero Section', description: 'Headline, description, and trust badge' },
    { key: 'features', label: 'Features', description: 'Platform feature cards (icon, title, description)' },
    { key: 'stats', label: 'Statistics', description: 'Key metric highlights' },
    { key: 'howItWorks', label: 'How It Works', description: 'Step-by-step process cards' },
    { key: 'partners', label: 'Partners', description: 'Trusted-by partner names' },
    { key: 'testimonial', label: 'Testimonial', description: 'Featured customer quote' },
    { key: 'pricingTeaser', label: 'Pricing Teaser', description: 'CTA to pricing page' },
    { key: 'cta', label: 'Bottom CTA', description: 'Final call-to-action section' },
  ],
  about: [
    { key: 'hero', label: 'Hero Section', description: 'Page header with eyebrow, title, description' },
    { key: 'mission', label: 'Mission Statement', description: 'Company mission paragraphs' },
    { key: 'features', label: 'Features', description: 'Platform capability cards' },
    { key: 'howItWorks', label: 'How It Works', description: 'Step-by-step process' },
  ],
  team: [
    { key: 'hero', label: 'Hero Section', description: 'Page header' },
    { key: 'members', label: 'Team Members', description: 'Bios, credentials, and links' },
    { key: 'stats', label: 'Track Record Stats', description: 'Achievement statistics' },
  ],
  tips: [
    { key: 'hero', label: 'Hero Section', description: 'Page header' },
    { key: 'tips', label: 'Tips & Articles', description: 'Expert guidance content cards' },
    { key: 'tools', label: 'Free Tools', description: 'Tool resource listings' },
  ],
  customers: [
    { key: 'hero', label: 'Hero Section', description: 'Page header' },
    { key: 'stats', label: 'Key Stats', description: 'Win rate, time saved, etc.' },
    { key: 'stories', label: 'Success Stories', description: 'Customer case studies' },
    { key: 'clientTypes', label: 'Who We Serve', description: 'Client category cards' },
  ],
  announcements: [
    { key: 'hero', label: 'Hero Section', description: 'Page header' },
    { key: 'items', label: 'Announcements', description: 'News and update entries' },
  ],
  get_started: [
    { key: 'hero', label: 'Hero Section', description: 'Page header with eyebrow badge' },
    { key: 'tiers', label: 'Pricing Tiers', description: 'Plan cards (name, price, period, features, cta, popular)' },
    { key: 'comparison', label: 'Feature Comparison', description: 'Plan comparison table rows' },
    { key: 'faqs', label: 'FAQs', description: 'Frequently asked questions (q/a pairs)' },
    { key: 'contactCta', label: 'Contact CTA', description: 'Bottom section with sales email' },
  ],
}

export default function ContentManagerPage() {
  const [pages, setPages] = useState<PageListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>('list')
  const [selectedPage, setSelectedPage] = useState<PageListItem | null>(null)
  const [editContent, setEditContent] = useState<Record<string, unknown>>({})
  const [editMetadata, setEditMetadata] = useState<Record<string, unknown>>({})
  const [saving, setSaving] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [actionMessage, setActionMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [history, setHistory] = useState<ContentEvent[]>([])
  const [showHistory, setShowHistory] = useState(false)

  const loadPages = useCallback(() => {
    setLoading(true)
    setError(null)
    fetch('/api/content')
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then(d => setPages(d.data ?? []))
      .catch(err => setError(err.message ?? 'Failed to load content'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { loadPages() }, [loadPages])

  function openEditor(page: PageListItem) {
    setSelectedPage(page)
    setEditContent(page.draftContent ?? {})
    setEditMetadata(page.draftMetadata ?? {})
    setViewMode('edit')
    setActionMessage(null)
    setShowHistory(false)
  }

  function closeEditor() {
    setViewMode('list')
    setSelectedPage(null)
    setEditContent({})
    setEditMetadata({})
    setActionMessage(null)
    loadPages()
  }

  async function saveDraft() {
    if (!selectedPage) return
    setSaving(true)
    setActionMessage(null)
    try {
      const res = await fetch('/api/content', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pageKey: selectedPage.pageKey,
          content: editContent,
          metadata: editMetadata,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data.error ?? `HTTP ${res.status}`)
      }
      setActionMessage({ type: 'success', text: 'Draft saved successfully' })
      setSelectedPage(prev => prev ? { ...prev, draftContent: editContent, draftUpdatedAt: new Date().toISOString() } : prev)
    } catch (err) {
      setActionMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to save' })
    } finally {
      setSaving(false)
    }
  }

  async function publishContent() {
    if (!selectedPage) return
    setPublishing(true)
    setActionMessage(null)
    try {
      // Save draft first, then publish
      const saveRes = await fetch('/api/content', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageKey: selectedPage.pageKey, content: editContent, metadata: editMetadata }),
      })
      if (!saveRes.ok) {
        const saveData = await saveRes.json().catch(() => ({}))
        throw new Error(saveData.error ?? `Draft save failed: HTTP ${saveRes.status}`)
      }

      const res = await fetch('/api/content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageKey: selectedPage.pageKey, action: 'publish' }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data.error ?? `HTTP ${res.status}`)
      }
      setActionMessage({ type: 'success', text: 'Content published and live!' })
      setSelectedPage(prev => prev ? {
        ...prev,
        publishedContent: editContent,
        publishedMetadata: editMetadata as Record<string, unknown>,
        publishedAt: new Date().toISOString(),
      } : prev)
    } catch (err) {
      setActionMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to publish' })
    } finally {
      setPublishing(false)
    }
  }

  async function rollback() {
    if (!selectedPage) return
    setActionMessage(null)
    try {
      const res = await fetch('/api/content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageKey: selectedPage.pageKey, action: 'rollback' }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? `HTTP ${res.status}`)
      }
      setActionMessage({ type: 'success', text: 'Rolled back to previous version' })
      loadPages()
    } catch (err) {
      setActionMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to rollback' })
    }
  }

  async function unpublish() {
    if (!selectedPage) return
    setActionMessage(null)
    try {
      const res = await fetch('/api/content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageKey: selectedPage.pageKey, action: 'unpublish' }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? `HTTP ${res.status}`)
      }
      setActionMessage({ type: 'success', text: 'Content unpublished — site will show static content' })
      setSelectedPage(prev => prev ? { ...prev, publishedContent: null, publishedAt: null } : prev)
    } catch (err) {
      setActionMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to unpublish' })
    }
  }

  async function toggleAutoPublish(pageKey: string, enabled: boolean) {
    try {
      const res = await fetch('/api/content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageKey, action: 'configure', autoPublish: enabled }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? `HTTP ${res.status}`)
      }
      loadPages()
    } catch (err) {
      setActionMessage({ type: 'error', text: `Failed to toggle auto-publish: ${err instanceof Error ? err.message : 'Unknown error'}` })
    }
  }

  async function loadHistory() {
    if (!selectedPage) return
    setShowHistory(true)
    try {
      const res = await fetch(`/api/content/history?page=${selectedPage.pageKey}&limit=20`)
      if (res.ok) {
        const d = await res.json()
        setHistory(d.data ?? [])
      }
    } catch {
      setHistory([])
    }
  }

  function updateSectionContent(sectionKey: string, value: string) {
    try {
      const parsed = JSON.parse(value)
      setEditContent(prev => ({ ...prev, [sectionKey]: parsed }))
    } catch {
      // Invalid JSON, ignore until valid
    }
  }

  // List view
  if (viewMode === 'list') {
    return (
      <div>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Content Manager</h1>
            <p className="mt-1 text-sm text-gray-500">Manage dynamic front-facing page content</p>
          </div>
          <button onClick={loadPages} disabled={loading} className="btn-secondary text-sm gap-2">
            <RefreshIcon spinning={loading} />
            Refresh
          </button>
        </div>

        {error && (
          <div className="mt-4 card border-red-200 bg-red-50">
            <div className="flex items-center gap-3">
              <ErrorIcon />
              <p className="flex-1 text-sm text-red-700">{error}</p>
              <button onClick={loadPages} className="btn-secondary text-xs">Retry</button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="mt-6 space-y-3">
            {[...Array(7)].map((_, i) => <div key={i} className="card animate-pulse h-24" />)}
          </div>
        ) : (
          <div className="mt-6 space-y-3">
            {pages.map(page => (
              <PageCard
                key={page.id}
                page={page}
                onEdit={() => openEditor(page)}
                onToggleAutoPublish={(enabled) => toggleAutoPublish(page.pageKey, enabled)}
              />
            ))}
          </div>
        )}
      </div>
    )
  }

  // Edit view
  const sections = PAGE_SECTIONS[selectedPage?.pageKey ?? ''] ?? []

  return (
    <div>
      {/* Editor Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={closeEditor} className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors">
            <BackIcon />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{selectedPage?.displayName}</h1>
            <div className="mt-1 flex items-center gap-2">
              <span className="text-xs text-gray-400">/{selectedPage?.pageKey?.replace('_', '-')}</span>
              {selectedPage?.publishedAt ? (
                <span className="badge-green">Published</span>
              ) : (
                <span className="badge-yellow">Draft Only</span>
              )}
              {selectedPage?.autoPublish && <span className="badge-blue">Auto-publish</span>}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={`/admin/content/preview/${selectedPage?.pageKey}`}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-ghost text-sm gap-2 text-amber-600 hover:text-amber-700"
          >
            <PreviewIcon />
            Preview
          </a>
          <button onClick={loadHistory} className="btn-ghost text-sm gap-2">
            <HistoryIcon />
            History
          </button>
          {selectedPage?.hasPrevious && (
            <button onClick={rollback} className="btn-ghost text-sm gap-2 text-amber-600 hover:text-amber-700">
              <RollbackIcon />
              Rollback
            </button>
          )}
          {selectedPage?.publishedContent && (
            <button onClick={unpublish} className="btn-ghost text-sm gap-2 text-red-600 hover:text-red-700">
              <UnpublishIcon />
              Unpublish
            </button>
          )}
          <button onClick={saveDraft} disabled={saving} className="btn-secondary text-sm">
            {saving ? 'Saving...' : 'Save Draft'}
          </button>
          <button onClick={publishContent} disabled={publishing} className="btn-primary text-sm gap-2">
            <PublishIcon />
            {publishing ? 'Publishing...' : 'Publish'}
          </button>
        </div>
      </div>

      {/* Action messages */}
      {actionMessage && (
        <div className={`mt-4 card ${actionMessage.type === 'success' ? 'border-emerald-200 bg-emerald-50' : 'border-red-200 bg-red-50'}`}>
          <div className="flex items-center gap-3">
            {actionMessage.type === 'success' ? <CheckCircleIcon /> : <ErrorIcon />}
            <p className={`text-sm ${actionMessage.type === 'success' ? 'text-emerald-700' : 'text-red-700'}`}>
              {actionMessage.text}
            </p>
            <button onClick={() => setActionMessage(null)} className="ml-auto text-gray-400 hover:text-gray-600">
              <CloseIcon />
            </button>
          </div>
        </div>
      )}

      {/* SEO Metadata */}
      <div className="mt-6 card">
        <h2 className="text-sm font-bold uppercase tracking-wider text-gray-400">SEO Metadata</h2>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="label">Page Title</label>
            <input
              className="input"
              value={(editMetadata.title as string) ?? ''}
              onChange={e => setEditMetadata(prev => ({ ...prev, title: e.target.value }))}
              placeholder="Page title for SEO"
            />
          </div>
          <div>
            <label className="label">Meta Description</label>
            <input
              className="input"
              value={(editMetadata.description as string) ?? ''}
              onChange={e => setEditMetadata(prev => ({ ...prev, description: e.target.value }))}
              placeholder="Meta description for search engines"
            />
          </div>
        </div>
      </div>

      {/* Content Sections */}
      <div className="mt-6 space-y-4">
        {sections.map(section => (
          <div key={section.key} className="card">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-gray-900">{section.label}</h3>
                <p className="text-xs text-gray-500">{section.description}</p>
              </div>
              <span className="badge-gray">{section.key}</span>
            </div>
            <div className="mt-4">
              <textarea
                className="input font-mono text-xs min-h-[120px] resize-y"
                value={JSON.stringify(editContent[section.key] ?? {}, null, 2)}
                onChange={e => updateSectionContent(section.key, e.target.value)}
                spellCheck={false}
              />
            </div>
          </div>
        ))}

        {sections.length === 0 && (
          <div className="card text-center py-8">
            <p className="text-sm text-gray-500">No section schema defined for this page yet</p>
            <div className="mt-4">
              <label className="label text-left">Raw JSON Content</label>
              <textarea
                className="input font-mono text-xs min-h-[300px] resize-y"
                value={JSON.stringify(editContent, null, 2)}
                onChange={e => {
                  try { setEditContent(JSON.parse(e.target.value)) } catch { /* invalid JSON */ }
                }}
                spellCheck={false}
              />
            </div>
          </div>
        )}
      </div>

      {/* Published vs Draft Info */}
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="card bg-surface-50">
          <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400">Draft State</h3>
          <p className="mt-2 text-sm text-gray-600">
            Last saved: {selectedPage?.draftUpdatedAt ? new Date(selectedPage.draftUpdatedAt).toLocaleString() : 'Never'}
          </p>
        </div>
        <div className="card bg-surface-50">
          <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400">Published State</h3>
          <p className="mt-2 text-sm text-gray-600">
            {selectedPage?.publishedAt
              ? `Published: ${new Date(selectedPage.publishedAt).toLocaleString()}`
              : 'Not yet published — site shows static content'
            }
          </p>
        </div>
      </div>

      {/* History Panel */}
      {showHistory && (
        <div className="mt-6 card">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold uppercase tracking-wider text-gray-400">Change History</h3>
            <button onClick={() => setShowHistory(false)} className="text-gray-400 hover:text-gray-600">
              <CloseIcon />
            </button>
          </div>
          {history.length === 0 ? (
            <p className="mt-4 text-sm text-gray-500">No changes recorded yet</p>
          ) : (
            <div className="mt-4 space-y-2">
              {history.map(event => (
                <div key={event.id} className="flex items-center gap-3 rounded-xl bg-surface-50 px-4 py-3">
                  <EventTypeDot type={event.eventType} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-700">{event.diffSummary ?? event.eventType}</p>
                    <p className="text-xs text-gray-400">
                      {event.source} &middot; {new Date(event.createdAt).toLocaleString()}
                    </p>
                  </div>
                  <ContentEventBadge type={event.eventType} />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/* ─── List view components ───────────────────────────────── */

function PageCard({
  page, onEdit, onToggleAutoPublish,
}: {
  page: PageListItem; onEdit: () => void; onToggleAutoPublish: (enabled: boolean) => void
}) {
  const isPublished = !!page.publishedContent
  const isDraftNewer = page.draftUpdatedAt && page.publishedAt && new Date(page.draftUpdatedAt) > new Date(page.publishedAt)

  return (
    <div className="card hover:shadow-card-hover transition-all">
      <div className="flex items-center gap-4">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
          <PageIcon />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-bold text-gray-900">{page.displayName}</h3>
            {isPublished ? (
              <span className="badge-green">Published</span>
            ) : (
              <span className="badge-yellow">Draft</span>
            )}
            {isDraftNewer && <span className="badge-blue">Unsaved changes</span>}
            {page.autoPublish && <span className="badge-purple">Auto-publish</span>}
          </div>
          <div className="mt-1 flex flex-wrap gap-3 text-xs text-gray-400">
            <span>/{page.pageKey.replace('_', '-')}</span>
            {page.publishedAt && <span>Published {new Date(page.publishedAt).toLocaleDateString()}</span>}
            <span>Draft updated {new Date(page.draftUpdatedAt).toLocaleDateString()}</span>
            {page.hasPrevious && <span className="text-amber-500">Rollback available</span>}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-medium text-gray-400 uppercase">Auto</span>
            <button
              onClick={() => onToggleAutoPublish(!page.autoPublish)}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                page.autoPublish ? 'bg-brand-600' : 'bg-gray-300'
              }`}
            >
              <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform ${
                page.autoPublish ? 'translate-x-4.5' : 'translate-x-0.5'
              }`} />
            </button>
          </div>
          <button onClick={onEdit} className="btn-primary text-xs">
            Edit Content
          </button>
        </div>
      </div>
    </div>
  )
}

function EventTypeDot({ type }: { type: string }) {
  const colors: Record<string, string> = {
    'content.draft_saved': 'bg-blue-500',
    'content.published': 'bg-emerald-500',
    'content.rolled_back': 'bg-amber-500',
    'content.auto_generated': 'bg-violet-500',
    'content.auto_published': 'bg-brand-500',
    'content.unpublished': 'bg-red-500',
  }
  return <span className={`h-2 w-2 rounded-full ${colors[type] ?? 'bg-gray-400'}`} />
}

function ContentEventBadge({ type }: { type: string }) {
  const styles: Record<string, string> = {
    'content.draft_saved': 'badge-blue',
    'content.published': 'badge-green',
    'content.rolled_back': 'badge-yellow',
    'content.auto_generated': 'badge-purple',
    'content.auto_published': 'badge-blue',
    'content.unpublished': 'badge-red',
  }
  const label = type.split('.')[1]?.replace('_', ' ') ?? type
  return <span className={styles[type] ?? 'badge-gray'}>{label}</span>
}

/* ─── SVG Icons ──────────────────────────────────────────── */

function RefreshIcon({ spinning = false }: { spinning?: boolean }) {
  return (
    <svg className={`h-4 w-4 ${spinning ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182" />
    </svg>
  )
}

function ErrorIcon() {
  return (
    <svg className="h-5 w-5 text-red-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
    </svg>
  )
}

function CheckCircleIcon() {
  return (
    <svg className="h-5 w-5 text-emerald-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
    </svg>
  )
}

function BackIcon() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
    </svg>
  )
}

function PageIcon() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
    </svg>
  )
}

function HistoryIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
    </svg>
  )
}

function RollbackIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 15 3 9m0 0 6-6M3 9h12a6 6 0 0 1 0 12h-3" />
    </svg>
  )
}

function UnpublishIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88" />
    </svg>
  )
}

function PreviewIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
    </svg>
  )
}

function PublishIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 16.5V9.75m0 0 3 3m-3-3-3 3M6.75 19.5a4.5 4.5 0 0 1-1.41-8.775 5.25 5.25 0 0 1 10.233-2.33 3 3 0 0 1 3.758 3.848A3.752 3.752 0 0 1 18 19.5H6.75Z" />
    </svg>
  )
}

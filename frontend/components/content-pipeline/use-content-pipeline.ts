'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import type { ContentPost, ContentGeneration, ContentReview, ContentCategory } from '@/types'

export type Tab = 'posts' | 'generate' | 'review'
export type DetailView = { post: ContentPost; reviews: ContentReview[] } | null

export interface EditForm {
  title: string
  slug: string
  excerpt: string
  body: string
  category: ContentCategory
  tags: string
  metaTitle: string
  metaDescription: string
}

const EMPTY_EDIT_FORM: EditForm = {
  title: '', slug: '', excerpt: '', body: '', category: 'tip', tags: '', metaTitle: '', metaDescription: '',
}

async function apiCall(body: Record<string, unknown>, method = 'POST') {
  const res = await fetch('/api/content-pipeline', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
  return data
}

/** Fetch a single post by ID */
async function fetchPost(postId: string): Promise<ContentPost | null> {
  const res = await fetch(`/api/content-pipeline?view=posts`)
  if (!res.ok) return null
  const d = await res.json().catch(() => ({}))
  const posts: ContentPost[] = d.data ?? []
  return posts.find(p => p.id === postId) ?? null
}

export function useContentPipeline() {
  const [tab, setTab] = useState<Tab>('posts')
  const [posts, setPosts] = useState<ContentPost[]>([])
  const [generations, setGenerations] = useState<ContentGeneration[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [detail, setDetail] = useState<DetailView>(null)
  const [filterStatus, setFilterStatus] = useState('')
  const [filterCategory, setFilterCategory] = useState('')
  const [actionInProgress, setActionInProgress] = useState(false)

  // Editor state
  const [editMode, setEditMode] = useState(false)
  const [editForm, setEditForm] = useState<EditForm>(EMPTY_EDIT_FORM)
  const [saving, setSaving] = useState(false)

  // Reject notes
  const [rejectNotes, setRejectNotes] = useState('')
  const [showRejectFor, setShowRejectFor] = useState<string | null>(null)

  // Generate form
  const [genPrompt, setGenPrompt] = useState('')
  const [genCategory, setGenCategory] = useState<ContentCategory>('tip')
  const [genModel, setGenModel] = useState('claude-sonnet-4-20250514')
  const [genTemp, setGenTemp] = useState(0.7)
  const [generating, setGenerating] = useState(false)

  // Auto-dismiss flash messages
  const msgTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function showMsg(type: 'success' | 'error', text: string) {
    setMsg({ type, text })
    if (msgTimer.current) clearTimeout(msgTimer.current)
    msgTimer.current = setTimeout(() => setMsg(null), type === 'success' ? 4000 : 8000)
  }

  useEffect(() => {
    return () => { if (msgTimer.current) clearTimeout(msgTimer.current) }
  }, [])

  const loadPosts = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      let url = '/api/content-pipeline?view=posts'
      if (filterStatus) url += `&status=${filterStatus}`
      if (filterCategory) url += `&category=${filterCategory}`
      const res = await fetch(url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const d = await res.json().catch(() => ({}))
      setPosts(d.data ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [filterStatus, filterCategory])

  const loadGenerations = useCallback(async () => {
    try {
      const res = await fetch('/api/content-pipeline?view=generations')
      if (!res.ok) return
      const d = await res.json().catch(() => ({}))
      setGenerations(d.data ?? [])
    } catch { /* non-critical */ }
  }, [])

  useEffect(() => { loadPosts() }, [loadPosts])
  useEffect(() => { if (tab === 'generate') loadGenerations() }, [tab, loadGenerations])

  async function loadReviews(postId: string): Promise<ContentReview[]> {
    try {
      const res = await fetch(`/api/content-pipeline?view=reviews&postId=${postId}`)
      if (!res.ok) return []
      const d = await res.json().catch(() => ({}))
      return d.data ?? []
    } catch { return [] }
  }

  async function openDetail(post: ContentPost) {
    const reviews = await loadReviews(post.id)
    setDetail({ post, reviews })
    setEditMode(false)
  }

  function startEdit(post: ContentPost) {
    setEditForm({
      title: post.title, slug: post.slug, excerpt: post.excerpt ?? '',
      body: post.body, category: post.category, tags: (post.tags ?? []).join(', '),
      metaTitle: post.metaTitle ?? '', metaDescription: post.metaDescription ?? '',
    })
    setEditMode(true)
  }

  function closeDetail() {
    setDetail(null)
    setEditMode(false)
  }

  async function doAction(action: string, postId: string, extra: Record<string, unknown> = {}) {
    setActionInProgress(true)
    try {
      await apiCall({ action, postId, ...extra }, 'PATCH')
      showMsg('success', `${action.replaceAll('_', ' ')} successful`)
      // Refresh the post list
      await loadPosts()
      // If we had a detail open for this post, re-fetch it fresh from the server
      if (detail?.post.id === postId) {
        const fresh = await fetchPost(postId)
        if (fresh) {
          await openDetail(fresh)
        } else {
          // Post may have been archived or status changed out of current filter
          setDetail(null)
        }
      }
      setShowRejectFor(null)
      setRejectNotes('')
    } catch (e) {
      showMsg('error', e instanceof Error ? e.message : 'Action failed')
    } finally {
      setActionInProgress(false)
    }
  }

  async function savePost() {
    if (!detail) return
    setSaving(true)
    try {
      await apiCall({
        action: 'update_post', postId: detail.post.id,
        title: editForm.title, body: editForm.body, excerpt: editForm.excerpt || undefined,
        category: editForm.category, tags: editForm.tags.split(',').map(t => t.trim()).filter(Boolean),
        metaTitle: editForm.metaTitle || undefined, metaDescription: editForm.metaDescription || undefined,
      }, 'PATCH')
      showMsg('success', 'Draft saved')
      setEditMode(false)
      await loadPosts()
      // Refresh detail with saved data
      const fresh = await fetchPost(detail.post.id)
      if (fresh) await openDetail(fresh)
    } catch (e) {
      showMsg('error', e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function submitGeneration() {
    if (!genPrompt.trim()) return
    setGenerating(true)
    try {
      await apiCall({ action: 'generate', prompt: genPrompt, category: genCategory, model: genModel, temperature: genTemp })
      showMsg('success', 'Generation request created')
      setGenPrompt('')
      await loadGenerations()
    } catch (e) {
      showMsg('error', e instanceof Error ? e.message : 'Generation failed')
    } finally {
      setGenerating(false)
    }
  }

  async function acceptGeneration(genId: string) {
    setActionInProgress(true)
    try {
      await apiCall({ action: 'accept_generation', generationId: genId })
      showMsg('success', 'Generation accepted — draft post created')
      await loadGenerations()
      await loadPosts()
    } catch (e) {
      showMsg('error', e instanceof Error ? e.message : 'Accept failed')
    } finally {
      setActionInProgress(false)
    }
  }

  async function rejectGeneration(genId: string) {
    setActionInProgress(true)
    try {
      await apiCall({ action: 'reject_generation', generationId: genId })
      showMsg('success', 'Generation rejected')
      await loadGenerations()
    } catch (e) {
      showMsg('error', e instanceof Error ? e.message : 'Reject failed')
    } finally {
      setActionInProgress(false)
    }
  }

  async function retryGeneration(genId: string) {
    setActionInProgress(true)
    try {
      await apiCall({ action: 'retry_generation', generationId: genId }, 'PATCH')
      showMsg('success', 'Generation retry queued')
      await loadGenerations()
    } catch (e) {
      showMsg('error', e instanceof Error ? e.message : 'Retry failed')
    } finally {
      setActionInProgress(false)
    }
  }

  async function createManualPost() {
    setActionInProgress(true)
    try {
      const result = await apiCall({ action: 'create_post', title: 'New Post', body: '', category: 'tip' })
      showMsg('success', 'Draft created')
      await loadPosts()
      if (result.data) openDetail(result.data)
    } catch (e) {
      showMsg('error', e instanceof Error ? e.message : 'Create failed')
    } finally {
      setActionInProgress(false)
    }
  }

  const reviewQueue = posts.filter(p => p.status === 'in_review')

  return {
    // Tab
    tab, setTab,
    // Data
    posts, generations, reviewQueue, loading, error, msg, setMsg,
    // Detail
    detail, openDetail, closeDetail,
    // Filters
    filterStatus, setFilterStatus, filterCategory, setFilterCategory,
    // Editor
    editMode, editForm, setEditForm, saving, startEdit, savePost, setEditMode,
    // Actions
    doAction, createManualPost, actionInProgress,
    // Generation
    genPrompt, setGenPrompt, genCategory, setGenCategory, genModel, setGenModel,
    genTemp, setGenTemp, generating, submitGeneration,
    acceptGeneration, rejectGeneration, retryGeneration,
    // Reject
    rejectNotes, setRejectNotes, showRejectFor, setShowRejectFor,
  }
}

'use client'

import { useEffect, useState, useCallback } from 'react'
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

  const loadPosts = useCallback(async () => {
    setLoading(true)
    try {
      let url = '/api/content-pipeline?view=posts'
      if (filterStatus) url += `&status=${filterStatus}`
      if (filterCategory) url += `&category=${filterCategory}`
      const res = await fetch(url)
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
      const d = await res.json().catch(() => ({}))
      setGenerations(d.data ?? [])
    } catch { /* ignore */ }
  }, [])

  useEffect(() => { loadPosts() }, [loadPosts])
  useEffect(() => { if (tab === 'generate') loadGenerations() }, [tab, loadGenerations])

  async function loadReviews(postId: string): Promise<ContentReview[]> {
    try {
      const res = await fetch(`/api/content-pipeline?view=reviews&postId=${postId}`)
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
    setMsg(null)
    try {
      await apiCall({ action, postId, ...extra }, 'PATCH')
      setMsg({ type: 'success', text: `${action.replace('_', ' ')} successful` })
      await loadPosts()
      if (detail?.post.id === postId) {
        const updated = posts.find(p => p.id === postId)
        if (updated) openDetail(updated)
      }
      setShowRejectFor(null)
      setRejectNotes('')
    } catch (e) {
      setMsg({ type: 'error', text: e instanceof Error ? e.message : 'Action failed' })
    }
  }

  async function savePost() {
    if (!detail) return
    setSaving(true)
    setMsg(null)
    try {
      await apiCall({
        action: 'update_post', postId: detail.post.id,
        title: editForm.title, body: editForm.body, excerpt: editForm.excerpt || undefined,
        category: editForm.category, tags: editForm.tags.split(',').map(t => t.trim()).filter(Boolean),
        metaTitle: editForm.metaTitle || undefined, metaDescription: editForm.metaDescription || undefined,
      }, 'PATCH')
      setMsg({ type: 'success', text: 'Draft saved' })
      setEditMode(false)
      await loadPosts()
    } catch (e) {
      setMsg({ type: 'error', text: e instanceof Error ? e.message : 'Save failed' })
    } finally {
      setSaving(false)
    }
  }

  async function submitGeneration() {
    if (!genPrompt.trim()) return
    setGenerating(true)
    setMsg(null)
    try {
      await apiCall({ action: 'generate', prompt: genPrompt, category: genCategory, model: genModel, temperature: genTemp })
      setMsg({ type: 'success', text: 'Generation request created' })
      setGenPrompt('')
      await loadGenerations()
    } catch (e) {
      setMsg({ type: 'error', text: e instanceof Error ? e.message : 'Generation failed' })
    } finally {
      setGenerating(false)
    }
  }

  async function acceptGeneration(genId: string) {
    setMsg(null)
    try {
      await apiCall({ action: 'accept_generation', generationId: genId })
      setMsg({ type: 'success', text: 'Generation accepted — draft post created' })
      await loadGenerations()
      await loadPosts()
    } catch (e) {
      setMsg({ type: 'error', text: e instanceof Error ? e.message : 'Accept failed' })
    }
  }

  async function rejectGeneration(genId: string) {
    try {
      await apiCall({ action: 'reject_generation', generationId: genId })
      await loadGenerations()
    } catch { /* ignore */ }
  }

  async function retryGeneration(genId: string) {
    try {
      await apiCall({ action: 'retry_generation', generationId: genId }, 'PATCH')
      await loadGenerations()
    } catch { /* ignore */ }
  }

  async function createManualPost() {
    setMsg(null)
    try {
      const result = await apiCall({ action: 'create_post', title: 'New Post', body: '', category: 'tip' })
      setMsg({ type: 'success', text: 'Draft created' })
      await loadPosts()
      if (result.data) openDetail(result.data)
    } catch (e) {
      setMsg({ type: 'error', text: e instanceof Error ? e.message : 'Create failed' })
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
    doAction, createManualPost,
    // Generation
    genPrompt, setGenPrompt, genCategory, setGenCategory, genModel, setGenModel,
    genTemp, setGenTemp, generating, submitGeneration,
    acceptGeneration, rejectGeneration, retryGeneration,
    // Reject
    rejectNotes, setRejectNotes, showRejectFor, setShowRejectFor,
  }
}

'use client'

import { useParams, useRouter } from 'next/navigation'
import { useEffect, useState, useCallback } from 'react'

interface Spotlight {
  id: string
  name: string
  description: string
  naics_codes: string[]
  keywords: string[]
  set_aside_types: string[]
  status: string
  matched_opp_count: number
  above_threshold_count: number
  high_priority_count: number
  upload_count: number
}

interface CreateSpotlightForm {
  name: string
  description: string
  naicsCodes: string
  keywords: string
  setAsideTypes: string[]
  companySummary: string
  technologyFocus: string
  minScoreThreshold: number
}

const SET_ASIDE_OPTIONS = [
  'HUBZone',
  '8(a)',
  'SDVOSB',
  'WOSB',
  'EDWOSB',
  'Small Business',
  'Veteran-Owned',
]

const MAX_BUCKETS = 3

const emptyForm: CreateSpotlightForm = {
  name: '',
  description: '',
  naicsCodes: '',
  keywords: '',
  setAsideTypes: [],
  companySummary: '',
  technologyFocus: '',
  minScoreThreshold: 40,
}

export default function SpotlightsPage() {
  const { tenantSlug } = useParams<{ tenantSlug: string }>()
  const router = useRouter()

  const [spotlights, setSpotlights] = useState<Spotlight[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [showCreateForm, setShowCreateForm] = useState(false)
  const [form, setForm] = useState<CreateSpotlightForm>(emptyForm)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  const fetchSpotlights = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/portal/${tenantSlug}/spotlights`)
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? `Failed to fetch spotlights (${res.status})`)
      }
      const json = await res.json()
      setSpotlights(json.data ?? [])
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to load spotlights'
      setError(message)
      console.error('[SpotlightsPage] fetch error:', e)
    } finally {
      setLoading(false)
    }
  }, [tenantSlug])

  useEffect(() => {
    if (tenantSlug) {
      fetchSpotlights()
    }
  }, [tenantSlug, fetchSpotlights])

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name.trim()) {
      setCreateError('Name is required')
      return
    }

    setCreating(true)
    setCreateError(null)

    const body = {
      name: form.name.trim(),
      description: form.description.trim(),
      naicsCodes: form.naicsCodes
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      keywords: form.keywords
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      setAsideTypes: form.setAsideTypes,
      companySummary: form.companySummary.trim(),
      technologyFocus: form.technologyFocus.trim(),
      minScoreThreshold: form.minScoreThreshold,
    }

    try {
      const res = await fetch(`/api/portal/${tenantSlug}/spotlights`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const respBody = await res.json().catch(() => ({}))
        throw new Error(respBody.error ?? `Failed to create spotlight (${res.status})`)
      }
      setForm(emptyForm)
      setShowCreateForm(false)
      await fetchSpotlights()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create spotlight'
      setCreateError(message)
      console.error('[SpotlightsPage] create error:', err)
    } finally {
      setCreating(false)
    }
  }

  const toggleSetAside = (value: string) => {
    setForm((prev) => ({
      ...prev,
      setAsideTypes: prev.setAsideTypes.includes(value)
        ? prev.setAsideTypes.filter((v) => v !== value)
        : [...prev.setAsideTypes, value],
    }))
  }

  const atLimit = spotlights.length >= MAX_BUCKETS

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-gray-500 text-lg">Loading spotlights...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
          <p className="text-red-700 mb-4">{error}</p>
          <button
            onClick={fetchSpotlights}
            className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-gray-900">SpotLights</h1>
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-sm font-medium bg-blue-100 text-blue-800">
            {spotlights.length}/{MAX_BUCKETS} buckets
          </span>
        </div>
        {!showCreateForm && (
          <button
            onClick={() => {
              if (atLimit) return
              setShowCreateForm(true)
              setCreateError(null)
            }}
            disabled={atLimit}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              atLimit
                ? 'bg-gray-200 text-gray-500 cursor-not-allowed'
                : 'bg-blue-600 text-white hover:bg-blue-700'
            }`}
          >
            Create SpotLight
          </button>
        )}
      </div>

      {/* Limit warning */}
      {atLimit && (
        <div className="mb-6 bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <p className="text-yellow-800 text-sm font-medium">
            You have reached the maximum of {MAX_BUCKETS} SpotLight buckets. Remove an existing bucket to create a new one.
          </p>
        </div>
      )}

      {/* Create form */}
      {showCreateForm && (
        <div className="mb-8 bg-white border border-gray-200 rounded-lg shadow-sm p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Create New SpotLight</h2>

          {createError && (
            <div className="mb-4 bg-red-50 border border-red-200 rounded p-3">
              <p className="text-red-700 text-sm">{createError}</p>
            </div>
          )}

          <form onSubmit={handleCreate} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                placeholder="e.g. Cybersecurity Opportunities"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
              <textarea
                value={form.description}
                onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                rows={3}
                placeholder="Describe what this spotlight tracks..."
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                NAICS Codes <span className="text-gray-400 text-xs">(comma-separated)</span>
              </label>
              <input
                type="text"
                value={form.naicsCodes}
                onChange={(e) => setForm((p) => ({ ...p, naicsCodes: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                placeholder="e.g. 541512, 541519, 518210"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Keywords <span className="text-gray-400 text-xs">(comma-separated)</span>
              </label>
              <input
                type="text"
                value={form.keywords}
                onChange={(e) => setForm((p) => ({ ...p, keywords: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                placeholder="e.g. cloud, zero trust, FedRAMP"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Set-Aside Types</label>
              <div className="flex flex-wrap gap-2">
                {SET_ASIDE_OPTIONS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => toggleSetAside(option)}
                    className={`px-3 py-1 rounded-full text-sm border transition-colors ${
                      form.setAsideTypes.includes(option)
                        ? 'bg-blue-100 border-blue-300 text-blue-800'
                        : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100'
                    }`}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Company Summary</label>
              <textarea
                value={form.companySummary}
                onChange={(e) => setForm((p) => ({ ...p, companySummary: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                rows={3}
                placeholder="Brief summary of your company's capabilities..."
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Technology Focus</label>
              <textarea
                value={form.technologyFocus}
                onChange={(e) => setForm((p) => ({ ...p, technologyFocus: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                rows={2}
                placeholder="Key technology areas..."
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Min Score Threshold
              </label>
              <input
                type="number"
                value={form.minScoreThreshold}
                onChange={(e) =>
                  setForm((p) => ({ ...p, minScoreThreshold: Number(e.target.value) || 0 }))
                }
                className="w-32 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                min={0}
                max={100}
              />
            </div>

            <div className="flex items-center gap-3 pt-2">
              <button
                type="submit"
                disabled={creating}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {creating ? 'Creating...' : 'Create SpotLight'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowCreateForm(false)
                  setForm(emptyForm)
                  setCreateError(null)
                }}
                className="px-4 py-2 text-gray-600 hover:text-gray-800 transition-colors"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Spotlight cards */}
      {spotlights.length === 0 ? (
        <div className="text-center py-16 bg-gray-50 rounded-lg border border-dashed border-gray-300">
          <p className="text-gray-500 text-lg mb-2">No SpotLights yet</p>
          <p className="text-gray-400 text-sm">Create your first SpotLight bucket to start tracking opportunities.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {spotlights.map((spotlight) => (
            <div
              key={spotlight.id}
              onClick={() => router.push(`/portal/${tenantSlug}/spotlights/${spotlight.id}`)}
              className="bg-white border border-gray-200 rounded-lg shadow-sm p-6 hover:shadow-md transition-shadow cursor-pointer"
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <h3 className="text-lg font-semibold text-gray-900">{spotlight.name}</h3>
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                      spotlight.status === 'active'
                        ? 'bg-green-100 text-green-800'
                        : 'bg-gray-100 text-gray-600'
                    }`}
                  >
                    {spotlight.status ?? 'unknown'}
                  </span>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    router.push(`/portal/${tenantSlug}/spotlights/${spotlight.id}`)
                  }}
                  className="px-3 py-1 text-sm text-blue-600 border border-blue-200 rounded-lg hover:bg-blue-50 transition-colors"
                >
                  View
                </button>
              </div>

              {spotlight.description && (
                <p className="text-gray-600 text-sm mb-4">{spotlight.description}</p>
              )}

              {/* NAICS Codes */}
              {(spotlight.naics_codes ?? []).length > 0 && (
                <div className="mb-3">
                  <span className="text-xs font-medium text-gray-500 uppercase tracking-wide mr-2">
                    NAICS
                  </span>
                  <div className="inline-flex flex-wrap gap-1">
                    {spotlight.naics_codes.map((code) => (
                      <span
                        key={code}
                        className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-purple-50 text-purple-700 border border-purple-200"
                      >
                        {code}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Keywords */}
              {(spotlight.keywords ?? []).length > 0 && (
                <div className="mb-4">
                  <span className="text-xs font-medium text-gray-500 uppercase tracking-wide mr-2">
                    Keywords
                  </span>
                  <div className="inline-flex flex-wrap gap-1">
                    {spotlight.keywords.map((kw) => (
                      <span
                        key={kw}
                        className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200"
                      >
                        {kw}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Stats */}
              <div className="flex items-center gap-6 pt-3 border-t border-gray-100">
                <div className="text-center">
                  <p className="text-xl font-bold text-gray-900">
                    {spotlight.matched_opp_count ?? 0}
                  </p>
                  <p className="text-xs text-gray-500">Matched Opps</p>
                </div>
                <div className="text-center">
                  <p className="text-xl font-bold text-orange-600">
                    {spotlight.high_priority_count ?? 0}
                  </p>
                  <p className="text-xs text-gray-500">High Priority</p>
                </div>
                <div className="text-center">
                  <p className="text-xl font-bold text-gray-700">
                    {spotlight.upload_count ?? 0}
                  </p>
                  <p className="text-xs text-gray-500">Uploads</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

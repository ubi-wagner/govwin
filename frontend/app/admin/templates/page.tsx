'use client'

import { useEffect, useState, useCallback } from 'react'

interface MasterTemplate {
  id: string
  agency: string
  programType: string
  solicitationPattern: string | null
  templateName: string
  sections: Record<string, unknown>
  pageLimits: Record<string, unknown> | null
  evalCriteria: Record<string, unknown> | null
  version: number
  isCurrent: boolean
  notes: string | null
  createdBy: string | null
  createdAt: string
  updatedAt: string
}

export default function AdminTemplatesPage() {
  const [templates, setTemplates] = useState<MasterTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [filterAgency, setFilterAgency] = useState<string>('')
  const [filterProgram, setFilterProgram] = useState<string>('')

  const [form, setForm] = useState({
    agency: '',
    programType: 'sbir',
    templateName: '',
    solicitationPattern: '',
    notes: '',
    sections: '{}',
    pageLimits: '{}',
    evalCriteria: '{}',
  })

  const fetchTemplates = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (filterAgency) params.set('agency', filterAgency)
      if (filterProgram) params.set('programType', filterProgram)
      const res = await fetch(`/api/admin/templates?${params}`)
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? `Failed to fetch templates (${res.status})`)
      }
      const json = await res.json()
      setTemplates(json.data ?? [])
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to load templates'
      setError(message)
      console.error('[AdminTemplatesPage] fetch error:', e)
    } finally {
      setLoading(false)
    }
  }, [filterAgency, filterProgram])

  useEffect(() => {
    fetchTemplates()
  }, [fetchTemplates])

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.agency.trim() || !form.templateName.trim()) {
      setCreateError('Agency and template name are required')
      return
    }

    let sections: Record<string, unknown>
    let pageLimits: Record<string, unknown>
    let evalCriteria: Record<string, unknown>
    try {
      sections = JSON.parse(form.sections)
      pageLimits = JSON.parse(form.pageLimits)
      evalCriteria = JSON.parse(form.evalCriteria)
    } catch {
      setCreateError('Invalid JSON in sections, page limits, or eval criteria')
      return
    }

    setCreating(true)
    setCreateError(null)
    try {
      const res = await fetch('/api/admin/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agency: form.agency.trim(),
          programType: form.programType,
          templateName: form.templateName.trim(),
          solicitationPattern: form.solicitationPattern.trim() || null,
          notes: form.notes.trim() || null,
          sections,
          pageLimits,
          evalCriteria,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? `Failed to create template (${res.status})`)
      }
      setShowCreate(false)
      setForm({ agency: '', programType: 'sbir', templateName: '', solicitationPattern: '', notes: '', sections: '{}', pageLimits: '{}', evalCriteria: '{}' })
      await fetchTemplates()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create template'
      setCreateError(message)
      console.error('[AdminTemplatesPage] create error:', err)
    } finally {
      setCreating(false)
    }
  }

  const agencies = ['DoD', 'NSF', 'NIH', 'DOE', 'NASA', 'DHS', 'USDA', 'EPA', 'DOT']
  const programTypes = [
    { value: 'sbir', label: 'SBIR' },
    { value: 'sttr', label: 'STTR' },
    { value: 'ota', label: 'OTA' },
    { value: 'baa', label: 'BAA' },
  ]

  return (
    <div className="max-w-6xl mx-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Master Templates</h1>
          <p className="text-sm text-gray-500 mt-1">
            Manage proposal templates by agency and program type
          </p>
        </div>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors"
        >
          {showCreate ? 'Cancel' : 'New Template'}
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-4 mb-6">
        <select
          value={filterAgency}
          onChange={(e) => setFilterAgency(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
        >
          <option value="">All Agencies</option>
          {agencies.map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>
        <select
          value={filterProgram}
          onChange={(e) => setFilterProgram(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
        >
          <option value="">All Programs</option>
          {programTypes.map((p) => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </select>
      </div>

      {/* Create Form */}
      {showCreate && (
        <div className="mb-8 bg-white border border-gray-200 rounded-lg shadow-sm p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Create Master Template</h2>
          {createError && (
            <div className="mb-4 bg-red-50 border border-red-200 rounded p-3">
              <p className="text-red-700 text-sm">{createError}</p>
            </div>
          )}
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Agency *</label>
                <select
                  value={form.agency}
                  onChange={(e) => setForm((p) => ({ ...p, agency: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  required
                >
                  <option value="">Select agency...</option>
                  {agencies.map((a) => (
                    <option key={a} value={a}>{a}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Program Type *</label>
                <select
                  value={form.programType}
                  onChange={(e) => setForm((p) => ({ ...p, programType: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                >
                  {programTypes.map((p) => (
                    <option key={p.value} value={p.value}>{p.label}</option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Template Name *</label>
              <input
                type="text"
                value={form.templateName}
                onChange={(e) => setForm((p) => ({ ...p, templateName: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                placeholder="e.g. DoD SBIR Phase I Standard"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Solicitation Pattern</label>
              <input
                type="text"
                value={form.solicitationPattern}
                onChange={(e) => setForm((p) => ({ ...p, solicitationPattern: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                placeholder="e.g. DoD SBIR 25.1"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Sections (JSON)</label>
              <textarea
                value={form.sections}
                onChange={(e) => setForm((p) => ({ ...p, sections: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono"
                rows={6}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Page Limits (JSON)</label>
                <textarea
                  value={form.pageLimits}
                  onChange={(e) => setForm((p) => ({ ...p, pageLimits: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono"
                  rows={4}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Eval Criteria (JSON)</label>
                <textarea
                  value={form.evalCriteria}
                  onChange={(e) => setForm((p) => ({ ...p, evalCriteria: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono"
                  rows={4}
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
              <textarea
                value={form.notes}
                onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                rows={2}
              />
            </div>
            <div className="flex gap-3 pt-2">
              <button
                type="submit"
                disabled={creating}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors disabled:opacity-50"
              >
                {creating ? 'Creating...' : 'Create Template'}
              </button>
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                className="px-4 py-2 text-gray-600 hover:text-gray-800 transition-colors"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Loading / Error */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <div className="text-gray-500">Loading templates...</div>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center mb-6">
          <p className="text-red-700 mb-3">{error}</p>
          <button onClick={fetchTemplates} className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700">
            Retry
          </button>
        </div>
      )}

      {/* Template List */}
      {!loading && !error && templates.length === 0 && (
        <div className="text-center py-16 bg-gray-50 rounded-lg border border-dashed border-gray-300">
          <p className="text-gray-500 text-lg mb-2">No templates found</p>
          <p className="text-gray-400 text-sm">Create your first master template to get started.</p>
        </div>
      )}

      {!loading && templates.length > 0 && (
        <div className="space-y-3">
          {templates.map((t) => (
            <div key={t.id} className="bg-white border border-gray-200 rounded-lg shadow-sm p-5">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="text-base font-semibold text-gray-900">{t.templateName}</h3>
                    {t.isCurrent && (
                      <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">Current</span>
                    )}
                    <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">v{t.version}</span>
                  </div>
                  <div className="flex items-center gap-3 text-sm text-gray-500">
                    <span className="font-medium text-gray-700">{t.agency}</span>
                    <span className="uppercase text-xs bg-gray-100 px-2 py-0.5 rounded">{t.programType}</span>
                    {t.solicitationPattern && (
                      <span className="text-gray-400">{t.solicitationPattern}</span>
                    )}
                  </div>
                </div>
                <div className="text-xs text-gray-400">
                  {new Date(t.createdAt).toLocaleDateString()}
                </div>
              </div>
              {t.notes && (
                <p className="mt-2 text-sm text-gray-600">{t.notes}</p>
              )}
              <div className="mt-3 flex items-center gap-4 text-xs text-gray-500">
                <span>{Object.keys(t.sections ?? {}).length} sections</span>
                {t.createdBy && <span>by {t.createdBy}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

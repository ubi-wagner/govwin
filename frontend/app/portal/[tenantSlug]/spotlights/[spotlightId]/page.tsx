'use client'

import { useParams, useRouter } from 'next/navigation'
import { useEffect, useState, useCallback, useRef } from 'react'
import Link from 'next/link'

interface SpotlightDetail {
  id: string
  name: string
  description: string | null
  naics_codes: string[]
  keywords: string[]
  set_aside_types: string[]
  agency_priorities: Record<string, unknown>
  keyword_domains: Record<string, unknown>
  is_small_business: boolean
  min_contract_value: number | null
  max_contract_value: number | null
  min_score_threshold: number
  opportunity_types: string[]
  company_summary: string | null
  technology_focus: string | null
  status: string
  last_scored_at: string | null
  matched_opp_count: number
  created_at: string
}

interface SpotlightStats {
  aboveThreshold: number
  highPriority: number
  totalScored: number
  topScore: number | null
  avgScore: number | null
  uploadCount: number
}

interface ScoredOpp {
  opp_id: string
  title: string
  agency: string
  solicitation_number: string | null
  close_date: string | null
  set_aside_type: string | null
  opportunity_type: string | null
  total_score: number
  naics_score: number
  keyword_score: number
  set_aside_score: number
  agency_score: number
  llm_rationale: string | null
  matched_keywords: string[]
  scored_at: string
}

interface Upload {
  id: string
  original_filename: string
  file_size_bytes: number | null
  mime_type: string | null
  upload_category: string
  description: string | null
  library_status: string
  atom_count: number
  created_at: string
  uploaded_by_name: string | null
}

const UPLOAD_CATEGORIES = [
  { value: 'general', label: 'General' },
  { value: 'capability_statement', label: 'Capability Statement' },
  { value: 'past_performance', label: 'Past Performance' },
  { value: 'personnel_resume', label: 'Personnel Resume' },
  { value: 'tech_approach', label: 'Technical Approach' },
  { value: 'company_overview', label: 'Company Overview' },
  { value: 'certification', label: 'Certification' },
  { value: 'financial', label: 'Financial' },
  { value: 'other', label: 'Other' },
]

function formatBytes(bytes: number | null): string {
  if (!bytes) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDate(d: string | null): string {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function SpotlightDetailPage() {
  const { tenantSlug, spotlightId } = useParams<{ tenantSlug: string; spotlightId: string }>()
  const router = useRouter()

  const [spotlight, setSpotlight] = useState<SpotlightDetail | null>(null)
  const [stats, setStats] = useState<SpotlightStats | null>(null)
  const [opps, setOpps] = useState<ScoredOpp[]>([])
  const [uploads, setUploads] = useState<Upload[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Upload state
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadCategory, setUploadCategory] = useState('general')
  const [uploadDescription, setUploadDescription] = useState('')
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [uploadSuccess, setUploadSuccess] = useState(false)

  // Tab state
  const [activeTab, setActiveTab] = useState<'opportunities' | 'uploads' | 'config'>('opportunities')

  const fetchDetail = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/portal/${tenantSlug}/spotlights/${spotlightId}`)
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? `Failed to load spotlight (${res.status})`)
      }
      const json = await res.json()
      setSpotlight(json.data.spotlight)
      setStats(json.data.stats)
      setOpps(json.data.opportunities ?? [])
      setUploads(json.data.uploads ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load spotlight')
    } finally {
      setLoading(false)
    }
  }, [tenantSlug, spotlightId])

  useEffect(() => {
    if (tenantSlug && spotlightId) fetchDetail()
  }, [tenantSlug, spotlightId, fetchDetail])

  const handleUpload = async () => {
    const file = fileInputRef.current?.files?.[0]
    if (!file) {
      setUploadError('Please select a file')
      return
    }

    setUploading(true)
    setUploadError(null)
    setUploadSuccess(false)

    const formData = new FormData()
    formData.append('file', file)
    formData.append('spotlightId', spotlightId)
    formData.append('category', uploadCategory)
    if (uploadDescription.trim()) {
      formData.append('description', uploadDescription.trim())
    }

    try {
      const res = await fetch(`/api/portal/${tenantSlug}/uploads`, {
        method: 'POST',
        body: formData,
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? `Upload failed (${res.status})`)
      }
      setUploadSuccess(true)
      setUploadDescription('')
      setUploadCategory('general')
      if (fileInputRef.current) fileInputRef.current.value = ''
      // Refresh uploads
      await fetchDetail()
      setTimeout(() => setUploadSuccess(false), 3000)
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  const handleDeleteUpload = async (uploadId: string) => {
    try {
      const res = await fetch(`/api/portal/${tenantSlug}/uploads/${uploadId}`, { method: 'DELETE' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? 'Failed to delete')
      }
      setUploads((prev) => prev.filter((u) => u.id !== uploadId))
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : 'Failed to delete upload')
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin h-8 w-8 border-4 border-blue-600 border-t-transparent rounded-full" />
      </div>
    )
  }

  if (error || !spotlight) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
          <p className="text-red-700 mb-4">{error ?? 'SpotLight not found'}</p>
          <button onClick={fetchDetail} className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 mr-3">
            Retry
          </button>
          <Link href={`/portal/${tenantSlug}/spotlights`} className="px-4 py-2 text-gray-600 hover:text-gray-800">
            Back to SpotLights
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-6xl mx-auto p-6">
      {/* Header */}
      <div className="mb-6">
        <Link
          href={`/portal/${tenantSlug}/spotlights`}
          className="text-sm text-gray-500 hover:text-gray-700 mb-2 inline-block"
        >
          &larr; Back to SpotLights
        </Link>
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{spotlight.name}</h1>
            {spotlight.description && (
              <p className="text-gray-600 mt-1">{spotlight.description}</p>
            )}
          </div>
          <span
            className={`px-3 py-1 rounded-full text-sm font-medium ${
              spotlight.status === 'active'
                ? 'bg-green-100 text-green-800'
                : 'bg-gray-100 text-gray-600'
            }`}
          >
            {spotlight.status}
          </span>
        </div>
      </div>

      {/* Stats Row */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-4 mb-8">
          <StatCard label="Total Scored" value={stats.totalScored} />
          <StatCard label="Above Threshold" value={stats.aboveThreshold} color="text-blue-600" />
          <StatCard label="High Priority" value={stats.highPriority} color="text-orange-600" />
          <StatCard label="Top Score" value={stats.topScore ? stats.topScore.toFixed(1) : '—'} color="text-green-600" />
          <StatCard label="Avg Score" value={stats.avgScore ? stats.avgScore.toFixed(1) : '—'} />
          <StatCard label="Uploads" value={stats.uploadCount} />
        </div>
      )}

      {/* Tags */}
      <div className="flex flex-wrap gap-4 mb-6">
        {(spotlight.naics_codes ?? []).length > 0 && (
          <div>
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wide mr-2">NAICS</span>
            <div className="inline-flex flex-wrap gap-1">
              {spotlight.naics_codes.map((c) => (
                <span key={c} className="px-2 py-0.5 rounded text-xs font-medium bg-purple-50 text-purple-700 border border-purple-200">
                  {c}
                </span>
              ))}
            </div>
          </div>
        )}
        {(spotlight.keywords ?? []).length > 0 && (
          <div>
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wide mr-2">Keywords</span>
            <div className="inline-flex flex-wrap gap-1">
              {spotlight.keywords.map((k) => (
                <span key={k} className="px-2 py-0.5 rounded text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200">
                  {k}
                </span>
              ))}
            </div>
          </div>
        )}
        {(spotlight.set_aside_types ?? []).length > 0 && (
          <div>
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wide mr-2">Set-Asides</span>
            <div className="inline-flex flex-wrap gap-1">
              {spotlight.set_aside_types.map((s) => (
                <span key={s} className="px-2 py-0.5 rounded text-xs font-medium bg-green-50 text-green-700 border border-green-200">
                  {s}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 mb-6">
        <nav className="flex gap-6">
          {(['opportunities', 'uploads', 'config'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab === 'opportunities' ? `Opportunities (${opps.length})` :
               tab === 'uploads' ? `Uploads (${uploads.length})` :
               'Configuration'}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab Content */}
      {activeTab === 'opportunities' && (
        <div>
          {opps.length === 0 ? (
            <div className="text-center py-12 bg-gray-50 rounded-lg border border-dashed border-gray-300">
              <p className="text-gray-500 mb-1">No scored opportunities yet</p>
              <p className="text-gray-400 text-sm">Opportunities will appear here after the scoring engine runs.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {opps.map((opp) => (
                <div key={opp.opp_id} className="bg-white border border-gray-200 rounded-lg p-4 hover:shadow-sm transition-shadow">
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <h4 className="text-sm font-semibold text-gray-900 truncate">{opp.title}</h4>
                      <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                        <span>{opp.agency}</span>
                        {opp.solicitation_number && <span>{opp.solicitation_number}</span>}
                        {opp.close_date && <span>Closes {formatDate(opp.close_date)}</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 ml-4">
                      <span className={`text-lg font-bold ${
                        opp.total_score >= 75 ? 'text-green-600' :
                        opp.total_score >= 50 ? 'text-yellow-600' : 'text-gray-600'
                      }`}>
                        {Number(opp.total_score).toFixed(1)}
                      </span>
                    </div>
                  </div>
                  {(opp.matched_keywords ?? []).length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {opp.matched_keywords.map((kw) => (
                        <span key={kw} className="px-1.5 py-0.5 text-xs bg-blue-50 text-blue-600 rounded">
                          {kw}
                        </span>
                      ))}
                    </div>
                  )}
                  {opp.llm_rationale && (
                    <p className="mt-2 text-xs text-gray-500 line-clamp-2">{opp.llm_rationale}</p>
                  )}
                  <div className="mt-2 flex gap-3 text-xs text-gray-400">
                    <span>NAICS: {Number(opp.naics_score).toFixed(1)}</span>
                    <span>KW: {Number(opp.keyword_score).toFixed(1)}</span>
                    <span>Set-Aside: {Number(opp.set_aside_score).toFixed(1)}</span>
                    <span>Agency: {Number(opp.agency_score).toFixed(1)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'uploads' && (
        <div>
          {/* Upload form */}
          <div className="bg-white border border-gray-200 rounded-lg p-5 mb-6">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Upload Artifact</h3>
            <p className="text-xs text-gray-500 mb-4">
              Upload capability statements, past performance, resumes, and other artifacts for better matching.
            </p>

            {uploadError && (
              <div className="mb-3 bg-red-50 border border-red-200 rounded p-2">
                <p className="text-sm text-red-700">{uploadError}</p>
              </div>
            )}
            {uploadSuccess && (
              <div className="mb-3 bg-green-50 border border-green-200 rounded p-2">
                <p className="text-sm text-green-700">File uploaded successfully!</p>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">File</label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.docx,.doc,.xlsx,.xls,.pptx,.ppt,.txt,.csv,.jpg,.jpeg,.png"
                  className="w-full text-sm text-gray-600 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border file:border-gray-300 file:text-sm file:bg-white file:text-gray-700 hover:file:bg-gray-50"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Category</label>
                <select
                  value={uploadCategory}
                  onChange={(e) => setUploadCategory(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                >
                  {UPLOAD_CATEGORIES.map((c) => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="mb-4">
              <label className="block text-xs font-medium text-gray-600 mb-1">Description (optional)</label>
              <input
                type="text"
                value={uploadDescription}
                onChange={(e) => setUploadDescription(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                placeholder="Brief description of this document..."
              />
            </div>

            <button
              onClick={handleUpload}
              disabled={uploading}
              className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {uploading ? 'Uploading...' : 'Upload'}
            </button>
          </div>

          {/* Uploads list */}
          {uploads.length === 0 ? (
            <div className="text-center py-12 bg-gray-50 rounded-lg border border-dashed border-gray-300">
              <p className="text-gray-500 mb-1">No uploads yet</p>
              <p className="text-gray-400 text-sm">Upload your company artifacts above for better opportunity matching.</p>
            </div>
          ) : (
            <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">File</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Category</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Size</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Library</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Uploaded</th>
                    <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {uploads.map((u) => (
                    <tr key={u.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <p className="font-medium text-gray-900 truncate max-w-[200px]">{u.original_filename}</p>
                        {u.description && <p className="text-xs text-gray-400 truncate">{u.description}</p>}
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-700">
                          {UPLOAD_CATEGORIES.find((c) => c.value === u.upload_category)?.label ?? u.upload_category}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-600">{formatBytes(u.file_size_bytes)}</td>
                      <td className="px-4 py-3">
                        <span className={`text-xs px-2 py-0.5 rounded font-medium ${
                          u.library_status === 'atomized' ? 'bg-green-100 text-green-700' :
                          u.library_status === 'processing' ? 'bg-yellow-100 text-yellow-700' :
                          u.library_status === 'failed' ? 'bg-red-100 text-red-700' :
                          'bg-gray-100 text-gray-600'
                        }`}>
                          {u.library_status}
                          {u.atom_count > 0 && ` (${u.atom_count})`}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs">
                        {formatDate(u.created_at)}
                        {u.uploaded_by_name && <span className="block text-gray-400">{u.uploaded_by_name}</span>}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => handleDeleteUpload(u.id)}
                          className="text-xs text-red-600 hover:text-red-800"
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {activeTab === 'config' && (
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">SpotLight Configuration</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-sm">
            <ConfigItem label="Min Score Threshold" value={spotlight.min_score_threshold} />
            <ConfigItem label="Small Business" value={spotlight.is_small_business ? 'Yes' : 'No'} />
            <ConfigItem label="Min Contract Value" value={spotlight.min_contract_value ? `$${spotlight.min_contract_value.toLocaleString()}` : 'Any'} />
            <ConfigItem label="Max Contract Value" value={spotlight.max_contract_value ? `$${spotlight.max_contract_value.toLocaleString()}` : 'Any'} />
            {spotlight.company_summary && (
              <div className="md:col-span-2">
                <p className="text-xs font-medium text-gray-500 mb-1">Company Summary</p>
                <p className="text-gray-700">{spotlight.company_summary}</p>
              </div>
            )}
            {spotlight.technology_focus && (
              <div className="md:col-span-2">
                <p className="text-xs font-medium text-gray-500 mb-1">Technology Focus</p>
                <p className="text-gray-700">{spotlight.technology_focus}</p>
              </div>
            )}
            <ConfigItem label="Last Scored" value={spotlight.last_scored_at ? formatDate(spotlight.last_scored_at) : 'Never'} />
            <ConfigItem label="Created" value={formatDate(spotlight.created_at)} />
          </div>
        </div>
      )}
    </div>
  )
}

function StatCard({ label, value, color }: { label: string; value: number | string; color?: string }) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-3 text-center">
      <p className={`text-xl font-bold ${color ?? 'text-gray-900'}`}>{value}</p>
      <p className="text-xs text-gray-500">{label}</p>
    </div>
  )
}

function ConfigItem({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <p className="text-xs font-medium text-gray-500 mb-1">{label}</p>
      <p className="text-gray-700">{value}</p>
    </div>
  )
}

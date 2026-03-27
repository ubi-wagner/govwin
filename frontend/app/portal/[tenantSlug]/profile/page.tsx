'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'

interface ProfileData {
  tenant: {
    name: string
    slug: string
    plan: string
    status: string
  }
  profile: {
    primary_naics: string[]
    secondary_naics: string[]
    keyword_domains: Record<string, string[]>
    is_small_business: boolean
    is_sdvosb: boolean
    is_wosb: boolean
    is_hubzone: boolean
    is_8a: boolean
    agency_priorities: Record<string, number>
    min_contract_value: number | null
    max_contract_value: number | null
    min_surface_score: number
    high_priority_score: number
  } | null
  userRole: string
}

const SET_ASIDE_OPTIONS = [
  { key: 'is_small_business', label: 'Small Business' },
  { key: 'is_sdvosb', label: 'SDVOSB' },
  { key: 'is_wosb', label: 'WOSB' },
  { key: 'is_hubzone', label: 'HUBZone' },
  { key: 'is_8a', label: '8(a)' },
] as const

export default function ProfilePage() {
  const params = useParams()
  const slug = params.tenantSlug as string
  const [data, setData] = useState<ProfileData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Edit mode
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveSuccess, setSaveSuccess] = useState(false)

  // Form state
  const [primaryNaics, setPrimaryNaics] = useState('')
  const [secondaryNaics, setSecondaryNaics] = useState('')
  const [setAsides, setSetAsides] = useState<Record<string, boolean>>({
    isSmallBusiness: false,
    isSdvosb: false,
    isWosb: false,
    isHubzone: false,
    is8a: false,
  })
  const [minContractValue, setMinContractValue] = useState('')
  const [maxContractValue, setMaxContractValue] = useState('')
  const [minSurfaceScore, setMinSurfaceScore] = useState('40')
  const [highPriorityScore, setHighPriorityScore] = useState('75')

  const isAdmin = data?.userRole === 'tenant_admin' || data?.userRole === 'master_admin'

  const fetchProfile = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/portal/${slug}/profile`)
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }
      const json = await res.json()
      setData(json)
      populateForm(json.profile)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load profile')
    } finally {
      setLoading(false)
    }
  }, [slug])

  function populateForm(profile: ProfileData['profile']) {
    if (!profile) return
    setPrimaryNaics((profile.primary_naics ?? []).join(', '))
    setSecondaryNaics((profile.secondary_naics ?? []).join(', '))
    setSetAsides({
      isSmallBusiness: profile.is_small_business ?? false,
      isSdvosb: profile.is_sdvosb ?? false,
      isWosb: profile.is_wosb ?? false,
      isHubzone: profile.is_hubzone ?? false,
      is8a: profile.is_8a ?? false,
    })
    setMinContractValue(profile.min_contract_value != null ? String(profile.min_contract_value) : '')
    setMaxContractValue(profile.max_contract_value != null ? String(profile.max_contract_value) : '')
    setMinSurfaceScore(String(profile.min_surface_score ?? 40))
    setHighPriorityScore(String(profile.high_priority_score ?? 75))
  }

  useEffect(() => {
    if (slug) fetchProfile()
  }, [slug, fetchProfile])

  const handleSave = async () => {
    setSaving(true)
    setSaveError(null)
    setSaveSuccess(false)

    const body: Record<string, unknown> = {
      primaryNaics: primaryNaics.split(',').map(s => s.trim()).filter(Boolean),
      secondaryNaics: secondaryNaics.split(',').map(s => s.trim()).filter(Boolean),
      isSmallBusiness: setAsides.isSmallBusiness,
      isSdvosb: setAsides.isSdvosb,
      isWosb: setAsides.isWosb,
      isHubzone: setAsides.isHubzone,
      is8a: setAsides.is8a,
      minSurfaceScore: Number(minSurfaceScore) || 40,
      highPriorityScore: Number(highPriorityScore) || 75,
    }
    if (minContractValue) body.minContractValue = Number(minContractValue)
    if (maxContractValue) body.maxContractValue = Number(maxContractValue)

    try {
      const res = await fetch(`/api/portal/${slug}/profile`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const respBody = await res.json().catch(() => ({}))
        throw new Error(respBody.error ?? `Failed to save (${res.status})`)
      }
      setSaveSuccess(true)
      setEditing(false)
      await fetchProfile()
      setTimeout(() => setSaveSuccess(false), 3000)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const handleCancel = () => {
    setEditing(false)
    setSaveError(null)
    if (data?.profile) populateForm(data.profile)
  }

  const profile = data?.profile

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Company Profile</h1>
          <p className="mt-1 text-sm text-gray-500">
            Your scoring configuration and company details.
          </p>
        </div>
        {isAdmin && !editing && !loading && (
          <button
            onClick={() => setEditing(true)}
            className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg font-medium hover:bg-blue-700"
          >
            Edit Profile
          </button>
        )}
      </div>

      {saveSuccess && (
        <div className="mb-4 bg-green-50 border border-green-200 rounded-lg p-3">
          <p className="text-sm text-green-700">Profile saved successfully. Scoring will update on the next run.</p>
        </div>
      )}

      {error ? (
        <div className="rounded-lg bg-red-50 p-4 text-sm text-red-700">
          Failed to load profile: {error}
          <button onClick={fetchProfile} className="ml-3 underline">Retry</button>
        </div>
      ) : loading ? (
        <div className="space-y-4">
          {[...Array(3)].map((_, i) => <div key={i} className="card animate-pulse h-32" />)}
        </div>
      ) : (
        <div className="space-y-6">
          {/* Company Details */}
          <div className="card">
            <h2 className="text-lg font-semibold text-gray-900">Company Details</h2>
            {data?.tenant ? (
              <dl className="mt-4 grid grid-cols-2 gap-4">
                <div>
                  <dt className="text-xs font-medium text-gray-500">Company</dt>
                  <dd className="text-sm text-gray-900">{data.tenant.name}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-gray-500">Plan</dt>
                  <dd className="text-sm text-gray-900 capitalize">{data.tenant.plan}</dd>
                </div>
              </dl>
            ) : (
              <p className="mt-2 text-sm text-gray-500">Profile data unavailable.</p>
            )}
          </div>

          {/* NAICS Codes */}
          <div className="card">
            <h2 className="text-lg font-semibold text-gray-900">NAICS Codes</h2>
            {editing ? (
              <div className="mt-4 space-y-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Primary NAICS (comma-separated)
                  </label>
                  <input
                    type="text"
                    value={primaryNaics}
                    onChange={(e) => setPrimaryNaics(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                    placeholder="e.g. 541512, 541519"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Secondary NAICS (comma-separated)
                  </label>
                  <input
                    type="text"
                    value={secondaryNaics}
                    onChange={(e) => setSecondaryNaics(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                    placeholder="e.g. 518210, 519190"
                  />
                </div>
              </div>
            ) : (
              <>
                {(profile?.primary_naics ?? []).length > 0 ? (
                  <div className="mt-4 space-y-3">
                    <div>
                      <p className="text-xs font-medium text-gray-500">Primary</p>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {profile!.primary_naics.map(n => (
                          <span key={n} className="badge-blue">{n}</span>
                        ))}
                      </div>
                    </div>
                    {(profile?.secondary_naics ?? []).length > 0 && (
                      <div>
                        <p className="text-xs font-medium text-gray-500">Secondary</p>
                        <div className="mt-1 flex flex-wrap gap-1.5">
                          {profile!.secondary_naics.map(n => (
                            <span key={n} className="badge-gray">{n}</span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="mt-2 text-sm text-gray-500">No NAICS codes configured yet.</p>
                )}
              </>
            )}
          </div>

          {/* Set-Aside Qualifications */}
          <div className="card">
            <h2 className="text-lg font-semibold text-gray-900">Set-Aside Qualifications</h2>
            <p className="mt-2 text-sm text-gray-500">
              Opportunities matching your set-aside status receive higher scores.
            </p>
            {editing ? (
              <div className="mt-4 flex flex-wrap gap-3">
                {SET_ASIDE_OPTIONS.map(({ key, label }) => {
                  const camelKey = key === 'is_small_business' ? 'isSmallBusiness'
                    : key === 'is_sdvosb' ? 'isSdvosb'
                    : key === 'is_wosb' ? 'isWosb'
                    : key === 'is_hubzone' ? 'isHubzone'
                    : 'is8a'
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setSetAsides(prev => ({ ...prev, [camelKey]: !prev[camelKey] }))}
                      className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                        setAsides[camelKey]
                          ? 'bg-blue-100 border-blue-300 text-blue-800 font-medium'
                          : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100'
                      }`}
                    >
                      {label}
                    </button>
                  )
                })}
              </div>
            ) : (
              <div className="mt-4 flex flex-wrap gap-2">
                {profile?.is_small_business && <span className="badge-blue">Small Business</span>}
                {profile?.is_sdvosb && <span className="badge-blue">SDVOSB</span>}
                {profile?.is_wosb && <span className="badge-blue">WOSB</span>}
                {profile?.is_hubzone && <span className="badge-blue">HUBZone</span>}
                {profile?.is_8a && <span className="badge-blue">8(a)</span>}
                {!profile?.is_small_business && !profile?.is_sdvosb && !profile?.is_wosb &&
                 !profile?.is_hubzone && !profile?.is_8a && (
                  <span className="text-sm text-gray-400">None configured</span>
                )}
              </div>
            )}
          </div>

          {/* Contract Value Range */}
          <div className="card">
            <h2 className="text-lg font-semibold text-gray-900">Contract Value Range</h2>
            {editing ? (
              <div className="mt-4 grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Min Value ($)</label>
                  <input
                    type="number"
                    value={minContractValue}
                    onChange={(e) => setMinContractValue(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                    placeholder="e.g. 50000"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Max Value ($)</label>
                  <input
                    type="number"
                    value={maxContractValue}
                    onChange={(e) => setMaxContractValue(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                    placeholder="e.g. 5000000"
                  />
                </div>
              </div>
            ) : (
              <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-xs font-medium text-gray-500">Min Value</p>
                  <p className="text-gray-700">{profile?.min_contract_value ? `$${Number(profile.min_contract_value).toLocaleString()}` : 'Any'}</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-gray-500">Max Value</p>
                  <p className="text-gray-700">{profile?.max_contract_value ? `$${Number(profile.max_contract_value).toLocaleString()}` : 'Any'}</p>
                </div>
              </div>
            )}
          </div>

          {/* Scoring */}
          <div className="card">
            <h2 className="text-lg font-semibold text-gray-900">Scoring Configuration</h2>
            {editing ? (
              <div className="mt-4 grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Minimum Surface Score (show in feed)
                  </label>
                  <input
                    type="number"
                    value={minSurfaceScore}
                    onChange={(e) => setMinSurfaceScore(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                    min={0}
                    max={100}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    High Priority Score Threshold
                  </label>
                  <input
                    type="number"
                    value={highPriorityScore}
                    onChange={(e) => setHighPriorityScore(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                    min={0}
                    max={100}
                  />
                </div>
              </div>
            ) : (
              <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
                <div className="rounded-lg bg-green-50 p-3">
                  <p className="font-medium text-green-800">High Priority</p>
                  <p className="text-green-600">Score {profile?.high_priority_score ?? 75}+</p>
                </div>
                <div className="rounded-lg bg-yellow-50 p-3">
                  <p className="font-medium text-yellow-800">Medium Priority</p>
                  <p className="text-yellow-600">Score {profile?.min_surface_score ?? 40}-{(profile?.high_priority_score ?? 75) - 1}</p>
                </div>
              </div>
            )}
          </div>

          {/* Keyword Domains (read-only for now) */}
          {!editing && profile?.keyword_domains && Object.keys(profile.keyword_domains).length > 0 && (
            <div className="card">
              <h2 className="text-lg font-semibold text-gray-900">Keyword Domains</h2>
              <div className="mt-4 space-y-3">
                {Object.entries(profile.keyword_domains).map(([domain, keywords]) => (
                  <div key={domain}>
                    <p className="text-xs font-medium text-gray-700">{domain}</p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {(keywords || []).map(kw => (
                        <span key={kw} className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">{kw}</span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Save/Cancel buttons */}
          {editing && (
            <div className="flex items-center gap-3">
              {saveError && (
                <p className="text-sm text-red-600 mr-auto">{saveError}</p>
              )}
              <button
                onClick={handleCancel}
                className="px-4 py-2 text-gray-600 hover:text-gray-800 text-sm"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-6 py-2 bg-blue-600 text-white text-sm rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

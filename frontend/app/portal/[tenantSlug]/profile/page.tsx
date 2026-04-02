'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'

interface PastSbirAward {
  agency: string
  program: 'SBIR' | 'STTR'
  phase: 'I' | 'II'
  awardAmount: number | null
  year: number | null
  topic: string
}

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
    technology_readiness_level: number | null
    research_areas: string[] | null
    target_agencies: string[] | null
    company_summary: string | null
    technology_focus: string | null
    past_sbir_awards: PastSbirAward[] | null
  } | null
  userRole: string
}

const TRL_LABELS: Record<number, string> = {
  1: 'Basic principles observed',
  2: 'Technology concept formulated',
  3: 'Proof of concept',
  4: 'Lab validation',
  5: 'Relevant environment validation',
  6: 'Relevant environment demonstration',
  7: 'Operational environment demonstration',
  8: 'System complete and qualified',
  9: 'Operational',
}

const TARGET_AGENCY_OPTIONS = ['DoD', 'NSF', 'NIH', 'DOE', 'NASA', 'DHS', 'USDA', 'EPA', 'DOT', 'Other']

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

  // SBIR/STTR profile fields
  const [trl, setTrl] = useState<string>('')
  const [researchAreas, setResearchAreas] = useState('')
  const [targetAgencies, setTargetAgencies] = useState<string[]>([])
  const [companySummary, setCompanySummary] = useState('')
  const [technologyFocus, setTechnologyFocus] = useState('')
  const [pastSbirAwards, setPastSbirAwards] = useState<PastSbirAward[]>([])

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
    // SBIR/STTR fields
    setTrl(profile.technology_readiness_level != null ? String(profile.technology_readiness_level) : '')
    setResearchAreas((profile.research_areas ?? []).join(', '))
    setTargetAgencies(profile.target_agencies ?? [])
    setCompanySummary(profile.company_summary ?? '')
    setTechnologyFocus(profile.technology_focus ?? '')
    setPastSbirAwards(profile.past_sbir_awards ?? [])
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
    // SBIR/STTR fields
    if (trl) body.technologyReadinessLevel = Number(trl)
    body.researchAreas = researchAreas.split(',').map(s => s.trim()).filter(Boolean)
    body.targetAgencies = targetAgencies
    body.companySummary = companySummary
    body.technologyFocus = technologyFocus
    body.pastSbirAwards = pastSbirAwards

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

          {/* SBIR/STTR Profile */}
          <div className="card">
            <h2 className="text-lg font-semibold text-gray-900">SBIR/STTR Profile</h2>
            <p className="mt-1 text-sm text-gray-500">
              Used for SBIR/STTR opportunity scoring and proposal AI.
            </p>
            {editing ? (
              <div className="mt-4 space-y-4">
                {/* TRL */}
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Technology Readiness Level (TRL)
                  </label>
                  <select
                    value={trl}
                    onChange={e => setTrl(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                  >
                    <option value="">Select TRL...</option>
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(level => (
                      <option key={level} value={level}>
                        TRL {level}: {TRL_LABELS[level]}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Research Areas */}
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Research Areas <span className="text-gray-400">(comma-separated)</span>
                  </label>
                  <input
                    type="text"
                    value={researchAreas}
                    onChange={e => setResearchAreas(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                    placeholder="e.g. Machine Learning, Sensor Fusion, Cybersecurity"
                  />
                </div>

                {/* Target Agencies */}
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Target Agencies
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {TARGET_AGENCY_OPTIONS.map(agency => (
                      <button
                        key={agency}
                        type="button"
                        onClick={() =>
                          setTargetAgencies(prev =>
                            prev.includes(agency) ? prev.filter(a => a !== agency) : [...prev, agency]
                          )
                        }
                        className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                          targetAgencies.includes(agency)
                            ? 'bg-blue-100 border-blue-300 text-blue-800 font-medium'
                            : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100'
                        }`}
                      >
                        {agency}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Company Summary */}
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Company Summary
                  </label>
                  <textarea
                    value={companySummary}
                    onChange={e => setCompanySummary(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                    rows={3}
                    placeholder="Brief summary of your company and capabilities (used in scoring and proposal AI)..."
                  />
                </div>

                {/* Technology Focus */}
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Technology Focus
                  </label>
                  <textarea
                    value={technologyFocus}
                    onChange={e => setTechnologyFocus(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                    rows={3}
                    placeholder="Describe your core technology areas and innovations..."
                  />
                </div>

                {/* Past SBIR/STTR Awards */}
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-2">
                    Past SBIR/STTR Awards
                  </label>
                  {pastSbirAwards.map((award, idx) => (
                    <div key={idx} className="mb-3 rounded-lg border border-gray-200 p-3">
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                        <input
                          type="text"
                          value={award.agency}
                          onChange={e => {
                            const updated = [...pastSbirAwards]
                            updated[idx] = { ...updated[idx], agency: e.target.value }
                            setPastSbirAwards(updated)
                          }}
                          className="border border-gray-300 rounded px-2 py-1 text-sm"
                          placeholder="Agency"
                        />
                        <select
                          value={award.program}
                          onChange={e => {
                            const updated = [...pastSbirAwards]
                            updated[idx] = { ...updated[idx], program: e.target.value as 'SBIR' | 'STTR' }
                            setPastSbirAwards(updated)
                          }}
                          className="border border-gray-300 rounded px-2 py-1 text-sm"
                        >
                          <option value="SBIR">SBIR</option>
                          <option value="STTR">STTR</option>
                        </select>
                        <select
                          value={award.phase}
                          onChange={e => {
                            const updated = [...pastSbirAwards]
                            updated[idx] = { ...updated[idx], phase: e.target.value as 'I' | 'II' }
                            setPastSbirAwards(updated)
                          }}
                          className="border border-gray-300 rounded px-2 py-1 text-sm"
                        >
                          <option value="I">Phase I</option>
                          <option value="II">Phase II</option>
                        </select>
                        <input
                          type="number"
                          value={award.awardAmount ?? ''}
                          onChange={e => {
                            const updated = [...pastSbirAwards]
                            updated[idx] = { ...updated[idx], awardAmount: e.target.value ? Number(e.target.value) : null }
                            setPastSbirAwards(updated)
                          }}
                          className="border border-gray-300 rounded px-2 py-1 text-sm"
                          placeholder="Amount ($)"
                        />
                        <input
                          type="number"
                          value={award.year ?? ''}
                          onChange={e => {
                            const updated = [...pastSbirAwards]
                            updated[idx] = { ...updated[idx], year: e.target.value ? Number(e.target.value) : null }
                            setPastSbirAwards(updated)
                          }}
                          className="border border-gray-300 rounded px-2 py-1 text-sm"
                          placeholder="Year"
                        />
                        <input
                          type="text"
                          value={award.topic}
                          onChange={e => {
                            const updated = [...pastSbirAwards]
                            updated[idx] = { ...updated[idx], topic: e.target.value }
                            setPastSbirAwards(updated)
                          }}
                          className="border border-gray-300 rounded px-2 py-1 text-sm"
                          placeholder="Topic"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => setPastSbirAwards(prev => prev.filter((_, i) => i !== idx))}
                        className="mt-2 text-xs text-red-600 hover:text-red-800"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() =>
                      setPastSbirAwards(prev => [
                        ...prev,
                        { agency: '', program: 'SBIR', phase: 'I', awardAmount: null, year: null, topic: '' },
                      ])
                    }
                    className="text-sm text-blue-600 hover:text-blue-800"
                  >
                    + Add Award
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-4 space-y-4">
                {/* TRL display */}
                <div>
                  <p className="text-xs font-medium text-gray-500">Technology Readiness Level</p>
                  {profile?.technology_readiness_level ? (
                    <div className="mt-1 flex items-center gap-2">
                      <span className="inline-flex items-center rounded-full bg-blue-100 px-2.5 py-0.5 text-sm font-medium text-blue-800">
                        TRL {profile.technology_readiness_level}
                      </span>
                      <span className="text-sm text-gray-600">
                        {TRL_LABELS[profile.technology_readiness_level] ?? ''}
                      </span>
                    </div>
                  ) : (
                    <p className="mt-1 text-sm text-gray-400">Not set</p>
                  )}
                </div>

                {/* Research Areas */}
                <div>
                  <p className="text-xs font-medium text-gray-500">Research Areas</p>
                  {(profile?.research_areas ?? []).length > 0 ? (
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {(profile?.research_areas ?? []).map(area => (
                        <span key={area} className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-700">{area}</span>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-1 text-sm text-gray-400">None configured</p>
                  )}
                </div>

                {/* Target Agencies */}
                <div>
                  <p className="text-xs font-medium text-gray-500">Target Agencies</p>
                  {(profile?.target_agencies ?? []).length > 0 ? (
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {(profile?.target_agencies ?? []).map(agency => (
                        <span key={agency} className="badge-blue">{agency}</span>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-1 text-sm text-gray-400">None configured</p>
                  )}
                </div>

                {/* Company Summary */}
                <div>
                  <p className="text-xs font-medium text-gray-500">Company Summary</p>
                  {profile?.company_summary ? (
                    <p className="mt-1 text-sm text-gray-700">{profile.company_summary}</p>
                  ) : (
                    <p className="mt-1 text-sm text-gray-400">Not provided</p>
                  )}
                </div>

                {/* Technology Focus */}
                <div>
                  <p className="text-xs font-medium text-gray-500">Technology Focus</p>
                  {profile?.technology_focus ? (
                    <p className="mt-1 text-sm text-gray-700">{profile.technology_focus}</p>
                  ) : (
                    <p className="mt-1 text-sm text-gray-400">Not provided</p>
                  )}
                </div>

                {/* Past SBIR Awards */}
                <div>
                  <p className="text-xs font-medium text-gray-500">Past SBIR/STTR Awards</p>
                  {(profile?.past_sbir_awards ?? []).length > 0 ? (
                    <div className="mt-2 overflow-x-auto">
                      <table className="min-w-full text-xs">
                        <thead>
                          <tr className="border-b border-gray-200 text-left text-gray-500">
                            <th className="pb-1 pr-4">Agency</th>
                            <th className="pb-1 pr-4">Program</th>
                            <th className="pb-1 pr-4">Phase</th>
                            <th className="pb-1 pr-4">Amount</th>
                            <th className="pb-1 pr-4">Year</th>
                            <th className="pb-1">Topic</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(profile?.past_sbir_awards ?? []).map((award, idx) => (
                            <tr key={idx} className="border-b border-gray-100">
                              <td className="py-1.5 pr-4 text-gray-700">{award.agency}</td>
                              <td className="py-1.5 pr-4">
                                <span className={`badge ${award.program === 'SBIR' ? 'badge-blue' : 'badge-purple'}`}>
                                  {award.program}
                                </span>
                              </td>
                              <td className="py-1.5 pr-4 text-gray-700">{award.phase}</td>
                              <td className="py-1.5 pr-4 text-gray-700">
                                {award.awardAmount ? `$${Number(award.awardAmount).toLocaleString()}` : '-'}
                              </td>
                              <td className="py-1.5 pr-4 text-gray-700">{award.year ?? '-'}</td>
                              <td className="py-1.5 text-gray-700">{award.topic}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="mt-1 text-sm text-gray-400">No past awards recorded</p>
                  )}
                </div>
              </div>
            )}
          </div>

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

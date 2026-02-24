'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'

interface ProfileData {
  tenant: {
    name: string
    slug: string
    plan: string
    status: string
  }
  profile: {
    primaryNaics: string[]
    secondaryNaics: string[]
    keywordDomains: Record<string, string[]>
    isSmallBusiness: boolean
    isSdvosb: boolean
    isWosb: boolean
    isHubzone: boolean
    is8a: boolean
    agencyPriorities: Record<string, number>
    minContractValue: number | null
    maxContractValue: number | null
    minSurfaceScore: number
    highPriorityScore: number
    selfService: boolean
  } | null
}

export default function ProfilePage() {
  const params = useParams()
  const slug = params.tenantSlug as string
  const [data, setData] = useState<ProfileData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/portal/${slug}/profile`)
      .then(r => r.ok ? r.json() : null)
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [slug])

  const profile = data?.profile

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900">Company Profile</h1>
      <p className="mt-1 text-sm text-gray-500">
        Your scoring configuration and company details.
        {' '}
        <span className="text-gray-400">Contact your admin to update.</span>
      </p>

      {loading ? (
        <div className="mt-6 space-y-4">
          {[...Array(3)].map((_, i) => <div key={i} className="card animate-pulse h-32" />)}
        </div>
      ) : (
        <div className="mt-6 space-y-6">
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
            {profile?.primaryNaics?.length ? (
              <div className="mt-4 space-y-3">
                <div>
                  <p className="text-xs font-medium text-gray-500">Primary</p>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {profile.primaryNaics.map(n => (
                      <span key={n} className="badge-blue">{n}</span>
                    ))}
                  </div>
                </div>
                {profile.secondaryNaics?.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-gray-500">Secondary</p>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {profile.secondaryNaics.map(n => (
                        <span key={n} className="badge-gray">{n}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <p className="mt-2 text-sm text-gray-500">No NAICS codes configured yet.</p>
            )}
          </div>

          {/* Set-Aside Qualifications */}
          <div className="card">
            <h2 className="text-lg font-semibold text-gray-900">Set-Aside Qualifications</h2>
            <p className="mt-2 text-sm text-gray-500">
              Opportunities matching your set-aside status receive higher scores.
            </p>
            {profile ? (
              <div className="mt-4 flex flex-wrap gap-2">
                {profile.isSmallBusiness && <span className="badge-blue">Small Business</span>}
                {profile.isSdvosb && <span className="badge-blue">SDVOSB</span>}
                {profile.isWosb && <span className="badge-blue">WOSB</span>}
                {profile.isHubzone && <span className="badge-blue">HUBZone</span>}
                {profile.is8a && <span className="badge-blue">8(a)</span>}
                {!profile.isSmallBusiness && !profile.isSdvosb && !profile.isWosb &&
                 !profile.isHubzone && !profile.is8a && (
                  <span className="text-sm text-gray-400">None configured</span>
                )}
              </div>
            ) : (
              <div className="mt-4"><span className="badge-gray">Not yet configured</span></div>
            )}
          </div>

          {/* Keyword Domains */}
          {profile?.keywordDomains && Object.keys(profile.keywordDomains).length > 0 && (
            <div className="card">
              <h2 className="text-lg font-semibold text-gray-900">Keyword Domains</h2>
              <div className="mt-4 space-y-3">
                {Object.entries(profile.keywordDomains).map(([domain, keywords]) => (
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

          {/* Scoring */}
          <div className="card">
            <h2 className="text-lg font-semibold text-gray-900">Scoring Configuration</h2>
            <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
              <div className="rounded-lg bg-green-50 p-3">
                <p className="font-medium text-green-800">High Priority</p>
                <p className="text-green-600">Score {profile?.highPriorityScore ?? 75}+</p>
              </div>
              <div className="rounded-lg bg-yellow-50 p-3">
                <p className="font-medium text-yellow-800">Medium Priority</p>
                <p className="text-yellow-600">Score {profile?.minSurfaceScore ?? 40}-{(profile?.highPriorityScore ?? 75) - 1}</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

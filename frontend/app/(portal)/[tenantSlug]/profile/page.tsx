'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'

interface ProfileData {
  tenant: {
    name: string
    slug: string
    plan: string
    status: string
    primaryEmail: string | null
    website: string | null
    ueiNumber: string | null
    cageCode: string | null
    samRegistered: boolean
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
    // Fetch tenant info via system — for now use the tenant slug to find info
    // Portal users see their own profile via a dedicated route
    fetch(`/api/opportunities?tenantSlug=${slug}&limit=0`)
      .then(r => r.json())
      .then(() => {
        // The profile data comes from tenant detail API
        // For portal users, we need a profile-specific endpoint
        // For now, show what's available
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [slug])

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
            <p className="mt-2 text-sm text-gray-500">
              These details are managed by your platform administrator. Contact them to request changes.
            </p>
            <div className="mt-4 rounded-lg bg-gray-50 p-4">
              <p className="text-sm text-gray-600">
                Profile data will appear here once your admin configures your company details,
                including NAICS codes, keyword domains, set-aside qualifications, and agency priorities.
              </p>
            </div>
          </div>

          {/* Set-Aside Qualifications */}
          <div className="card">
            <h2 className="text-lg font-semibold text-gray-900">Set-Aside Qualifications</h2>
            <p className="mt-2 text-sm text-gray-500">
              Opportunities matching your set-aside status receive higher scores.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <span className="badge-gray">Configure via admin panel</span>
            </div>
          </div>

          {/* Scoring */}
          <div className="card">
            <h2 className="text-lg font-semibold text-gray-900">Scoring Configuration</h2>
            <p className="mt-2 text-sm text-gray-500">
              How opportunities are scored against your profile.
            </p>
            <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
              <div className="rounded-lg bg-green-50 p-3">
                <p className="font-medium text-green-800">High Priority</p>
                <p className="text-green-600">Score 75+</p>
              </div>
              <div className="rounded-lg bg-yellow-50 p-3">
                <p className="font-medium text-yellow-800">Medium Priority</p>
                <p className="text-yellow-600">Score 50-74</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

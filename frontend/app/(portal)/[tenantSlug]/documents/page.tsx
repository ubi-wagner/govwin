'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'

interface DownloadLink {
  id: string
  title: string
  description: string | null
  url: string
  linkType: string
  isActive: boolean
  accessCount: number
  createdAt: string
}

export default function DocumentsPage() {
  const params = useParams()
  const slug = params.tenantSlug as string
  const [links, setLinks] = useState<DownloadLink[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Documents/links are fetched per-tenant
    // For now, show placeholder since the API route is for admin-curated links
    setLoading(false)
  }, [slug])

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900">Documents</h1>
      <p className="mt-1 text-sm text-gray-500">Admin-curated resources and downloads</p>

      {loading ? (
        <div className="mt-6 space-y-3">
          {[...Array(3)].map((_, i) => <div key={i} className="card animate-pulse h-16" />)}
        </div>
      ) : links.length === 0 ? (
        <div className="mt-12 text-center">
          <div className="mx-auto h-12 w-12 text-gray-300">
            <svg fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
            </svg>
          </div>
          <p className="mt-4 text-gray-500">No documents available yet</p>
          <p className="mt-1 text-sm text-gray-400">Your admin will share resources and templates here.</p>
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {links.map(link => (
            <a
              key={link.id}
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              className="card hover:border-brand-200 hover:shadow-md transition-all"
            >
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0 rounded-lg bg-brand-50 p-2">
                  <svg className="h-5 w-5 text-brand-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-900">{link.title}</p>
                  {link.description && <p className="mt-0.5 text-xs text-gray-500">{link.description}</p>}
                  <div className="mt-1 flex items-center gap-2">
                    <span className="badge-gray text-[10px]">{link.linkType}</span>
                    <span className="text-[10px] text-gray-400">{link.accessCount} downloads</span>
                  </div>
                </div>
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  )
}

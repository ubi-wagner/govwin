import { useEffect, useState } from 'react'
import { api } from '../lib/api'

interface SocialPost {
  id: string
  platform: string
  account_id: string
  content: string
  status: string
  scheduled_at: string | null
  published_at: string | null
  created_at: string
  metrics: {
    likes?: number
    shares?: number
    comments?: number
  } | null
}

const statusColors: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-600',
  scheduled: 'bg-blue-100 text-blue-700',
  published: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
}

export default function SocialPosts() {
  const [posts, setPosts] = useState<SocialPost[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    api.get<SocialPost[]>('/social/posts')
      .then(setPosts)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-900 mb-6">Social Posts</h1>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">{error}</div>
      )}

      {loading ? (
        <div className="text-gray-500">Loading social posts...</div>
      ) : posts.length === 0 ? (
        <div className="text-gray-500 bg-white border border-gray-200 rounded-lg p-8 text-center">
          No social posts yet.
        </div>
      ) : (
        <div className="space-y-3">
          {posts.map((p) => (
            <div key={p.id} className="bg-white border border-gray-200 rounded-lg p-4">
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-600">
                      {p.platform}
                    </span>
                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${statusColors[p.status] || 'bg-gray-100 text-gray-600'}`}>
                      {p.status}
                    </span>
                  </div>
                  <p className="text-sm text-slate-900 whitespace-pre-wrap line-clamp-3">{p.content}</p>
                  <div className="flex items-center gap-4 mt-2 text-xs text-gray-400">
                    {p.scheduled_at && <span>Scheduled: {new Date(p.scheduled_at).toLocaleString()}</span>}
                    {p.published_at && <span>Published: {new Date(p.published_at).toLocaleString()}</span>}
                    {p.metrics && (
                      <span>
                        {p.metrics.likes ?? 0} likes | {p.metrics.shares ?? 0} shares | {p.metrics.comments ?? 0} comments
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

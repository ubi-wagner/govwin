import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'

interface Post {
  id: string
  title: string
  status: string
  category: string
  author: string
  created_at: string
  published_at: string | null
}

const statusColors: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-600',
  in_review: 'bg-amber-100 text-amber-700',
  approved: 'bg-blue-100 text-blue-700',
  published: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
  reverted: 'bg-amber-100 text-amber-600',
  archived: 'bg-slate-100 text-slate-600',
}

const STAGE_ORDER = ['draft', 'in_review', 'approved', 'published']

function MiniStage({ status }: { status: string }) {
  const currentIndex = STAGE_ORDER.indexOf(status)
  return (
    <div className="flex items-center gap-0.5">
      {STAGE_ORDER.map((stage, i) => {
        const filled = currentIndex >= i
        const isCurrent = status === stage
        return (
          <div key={stage} className="flex items-center">
            {i > 0 && <div className={`w-3 h-px ${filled ? 'bg-blue-400' : 'bg-gray-300'}`} />}
            <div className={`w-2 h-2 rounded-full ${
              filled ? (isCurrent ? 'bg-blue-600 ring-2 ring-blue-200' : 'bg-blue-400')
              : 'bg-gray-300'
            }`} />
          </div>
        )
      })}
    </div>
  )
}

export default function ContentPipeline() {
  const [posts, setPosts] = useState<Post[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    api.get<Post[]>('/content/posts')
      .then(setPosts)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Content Pipeline</h1>
        <Link
          to="/content/new"
          className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
        >
          New Post
        </Link>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">{error}</div>
      )}

      {loading ? (
        <div className="text-gray-500">Loading posts...</div>
      ) : posts.length === 0 ? (
        <div className="text-gray-500 bg-white border border-gray-200 rounded-lg p-8 text-center">
          No content posts yet. Create your first post.
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm text-left">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 font-medium text-gray-600">Title</th>
                <th className="px-4 py-3 font-medium text-gray-600">Status</th>
                <th className="px-4 py-3 font-medium text-gray-600">Category</th>
                <th className="px-4 py-3 font-medium text-gray-600">Author</th>
                <th className="px-4 py-3 font-medium text-gray-600">Created</th>
                <th className="px-4 py-3 font-medium text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {posts.map((p) => (
                <tr key={p.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-slate-900">{p.title}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-1">
                      <MiniStage status={p.status} />
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium w-fit ${statusColors[p.status] || 'bg-gray-100 text-gray-600'}`}>
                        {p.status.replace('_', ' ')}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{p.category}</td>
                  <td className="px-4 py-3 text-gray-600">{p.author}</td>
                  <td className="px-4 py-3 text-gray-500">{new Date(p.created_at).toLocaleDateString()}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <Link to={`/content/${p.id}/edit`} className="text-blue-600 hover:text-blue-800 text-xs">
                        Edit
                      </Link>
                      <Link to={`/content/${p.id}/preview`} className="text-gray-600 hover:text-gray-800 text-xs">
                        Preview
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

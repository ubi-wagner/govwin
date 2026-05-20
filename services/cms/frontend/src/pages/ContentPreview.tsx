import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { api } from '../lib/api'

interface Post {
  id: string
  title: string
  body: string
  excerpt: string
  category: string
  tags: string
  author: string
  featured_image: string | null
  status: string
  published_at: string | null
  created_at: string
}

export default function ContentPreview() {
  const { id } = useParams()
  const [post, setPost] = useState<Post | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!id) return
    api.get<Post>(`/content/posts/${id}`)
      .then(setPost)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [id])

  if (loading) return <div className="text-gray-500">Loading preview...</div>

  if (error) {
    return (
      <div>
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">{error}</div>
        <Link to="/content" className="text-blue-600 hover:text-blue-800 text-sm mt-4 inline-block">
          Back to Pipeline
        </Link>
      </div>
    )
  }

  if (!post) return <div className="text-gray-500">Post not found.</div>

  const displayDate = post.published_at || post.created_at

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <Link to="/content" className="text-blue-600 hover:text-blue-800 text-sm">
          Back to Pipeline
        </Link>
        <Link
          to={`/content/${id}/edit`}
          className="px-3 py-1.5 text-sm bg-white border border-gray-300 rounded hover:bg-gray-50"
        >
          Edit
        </Link>
      </div>

      <article className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        {post.featured_image && (
          <img
            src={post.featured_image}
            alt={post.title}
            className="w-full h-64 object-cover"
          />
        )}

        <div className="p-8 max-w-prose mx-auto">
          {post.category && (
            <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-700 mb-4">
              {post.category}
            </span>
          )}

          <h1 className="text-3xl font-bold text-slate-900 leading-tight mb-4">
            {post.title}
          </h1>

          <div className="flex items-center gap-3 text-sm text-gray-500 mb-6 pb-6 border-b border-gray-100">
            {post.author && <span>By {post.author}</span>}
            {displayDate && (
              <span>{new Date(displayDate).toLocaleDateString('en-US', {
                year: 'numeric', month: 'long', day: 'numeric',
              })}</span>
            )}
            <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
              post.status === 'published' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
            }`}>
              {post.status}
            </span>
          </div>

          {post.excerpt && (
            <p className="text-lg text-gray-600 italic mb-6 leading-relaxed">
              {post.excerpt}
            </p>
          )}

          <div className="text-base text-gray-800 leading-relaxed space-y-4 [&>p]:mb-4">
            {post.body.split('\n\n').map((paragraph, i) => (
              <p key={i}>{paragraph}</p>
            ))}
          </div>

          {post.tags && (
            <div className="mt-8 pt-6 border-t border-gray-100 flex gap-2 flex-wrap">
              {post.tags.split(',').map((tag) => (
                <span
                  key={tag.trim()}
                  className="px-2 py-1 bg-gray-100 text-gray-600 rounded text-xs"
                >
                  {tag.trim()}
                </span>
              ))}
            </div>
          )}
        </div>
      </article>
    </div>
  )
}

import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { api } from '../lib/api'

interface PostForm {
  title: string
  body: string
  excerpt: string
  tags: string
  category: string
}

interface Post extends PostForm {
  id: string
  status: string
}

type SourceType = 'prompt' | 'url' | 'screenshot' | 'repackage'

interface GenerationForm {
  prompt: string
  category: string
  source_type: SourceType
  source_url: string
  source_content: string
  user_id: string
}

const emptyForm: PostForm = { title: '', body: '', excerpt: '', tags: '', category: '' }

const SOURCE_TYPE_OPTIONS: { value: SourceType; label: string }[] = [
  { value: 'prompt', label: 'Write from scratch' },
  { value: 'url', label: 'Generate from URL' },
  { value: 'screenshot', label: 'Upload screenshot' },
  { value: 'repackage', label: 'Repackage content' },
]

export default function ContentEditor() {
  const { id } = useParams()
  const navigate = useNavigate()
  const isEditing = Boolean(id)

  const [form, setForm] = useState<PostForm>(emptyForm)
  const [loading, setLoading] = useState(isEditing)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // AI generation state
  const [showGenerate, setShowGenerate] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [genForm, setGenForm] = useState<GenerationForm>({
    prompt: '',
    category: 'tip',
    source_type: 'prompt',
    source_url: '',
    source_content: '',
    user_id: '',
  })
  const [genResult, setGenResult] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    api.get<Post>(`/content/posts/${id}`)
      .then((post) => setForm({
        title: post.title,
        body: post.body,
        excerpt: post.excerpt || '',
        tags: post.tags || '',
        category: post.category || '',
      }))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [id])

  function handleChange(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }))
  }

  function handleGenChange(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) {
    const { name, value } = e.target
    setGenForm((prev) => ({ ...prev, [name]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      if (isEditing) {
        await api.patch(`/content/posts/${id}`, form)
      } else {
        await api.post('/content/posts', form)
      }
      navigate('/content')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault()
    setGenerating(true)
    setError('')
    setGenResult(null)
    try {
      const payload: Record<string, unknown> = {
        prompt: genForm.prompt,
        category: genForm.category,
        source_type: genForm.source_type,
        user_id: genForm.user_id || 'cms-ui',
      }
      if (genForm.source_type === 'url' && genForm.source_url) {
        payload.source_url = genForm.source_url
      }
      if (genForm.source_type === 'repackage' && genForm.source_content) {
        payload.source_content = genForm.source_content
      }

      const result = await api.post<{ data: { id: string; status: string } }>('/content/generations', payload)
      setGenResult(`Generation request created (ID: ${result.data.id}, status: ${result.data.status}). It will be processed by the AI worker.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Generation request failed')
    } finally {
      setGenerating(false)
    }
  }

  if (loading) return <div className="text-gray-500">Loading post...</div>

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold text-slate-900 mb-6">
        {isEditing ? 'Edit Post' : 'New Post'}
      </h1>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">{error}</div>
      )}

      {genResult && (
        <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded mb-4">{genResult}</div>
      )}

      {/* AI Generation Panel */}
      <div className="mb-6">
        <button
          type="button"
          onClick={() => setShowGenerate(!showGenerate)}
          className="px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-700 text-sm"
        >
          {showGenerate ? 'Hide AI Generator' : 'Generate with AI'}
        </button>

        {showGenerate && (
          <form onSubmit={handleGenerate} className="mt-4 p-4 bg-gray-50 border border-gray-200 rounded space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Source Type</label>
              <select
                name="source_type"
                value={genForm.source_type}
                onChange={handleGenChange}
                className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              >
                {SOURCE_TYPE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>

            {genForm.source_type === 'url' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Source URL</label>
                <input
                  name="source_url"
                  value={genForm.source_url}
                  onChange={handleGenChange}
                  type="url"
                  placeholder="https://example.com/article"
                  className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                />
              </div>
            )}

            {genForm.source_type === 'screenshot' && (
              <div className="bg-yellow-50 border border-yellow-200 text-yellow-700 px-4 py-3 rounded text-sm">
                Screenshot upload is handled via the Media API. Upload your screenshot first,
                then include the media ID in a direct API call to POST /api/content/generations
                with source_type &quot;screenshot&quot; and the attachment IDs in the &quot;attachments&quot; field.
              </div>
            )}

            {genForm.source_type === 'repackage' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Content to Repackage</label>
                <textarea
                  name="source_content"
                  value={genForm.source_content}
                  onChange={handleGenChange}
                  rows={8}
                  placeholder="Paste the existing content (article, report, etc.) that you want repackaged..."
                  className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent font-mono text-sm"
                />
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Instructions / Prompt</label>
              <textarea
                name="prompt"
                value={genForm.prompt}
                onChange={handleGenChange}
                rows={3}
                required
                placeholder="Describe what you want the AI to generate..."
                className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
              <select
                name="category"
                value={genForm.category}
                onChange={handleGenChange}
                className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              >
                <option value="tip">Tip</option>
                <option value="announcement">Announcement</option>
                <option value="product_update">Product Update</option>
                <option value="guide">Guide</option>
                <option value="resource">Resource</option>
                <option value="case_study">Case Study</option>
                <option value="blog_post">Blog Post</option>
              </select>
            </div>

            <button
              type="submit"
              disabled={generating}
              className="px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-700 disabled:opacity-50 text-sm"
            >
              {generating ? 'Submitting...' : 'Submit Generation Request'}
            </button>
          </form>
        )}
      </div>

      {/* Post Editor Form */}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
          <input
            name="title"
            value={form.title}
            onChange={handleChange}
            required
            className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Excerpt</label>
          <input
            name="excerpt"
            value={form.excerpt}
            onChange={handleChange}
            className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
            <input
              name="category"
              value={form.category}
              onChange={handleChange}
              className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Tags (comma-separated)</label>
            <input
              name="tags"
              value={form.tags}
              onChange={handleChange}
              className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Body</label>
          <textarea
            name="body"
            value={form.body}
            onChange={handleChange}
            rows={16}
            required
            className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono text-sm"
          />
        </div>

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 text-sm"
          >
            {saving ? 'Saving...' : isEditing ? 'Update Post' : 'Create Post'}
          </button>
          <button
            type="button"
            onClick={() => navigate('/content')}
            className="px-4 py-2 bg-white border border-gray-300 rounded hover:bg-gray-50 text-sm"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  )
}

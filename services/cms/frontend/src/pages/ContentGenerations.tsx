import { useEffect, useState } from 'react'
import { api } from '../lib/api'

interface Generation {
  id: string
  prompt: string
  category: string
  model: string
  status: string
  source_type: string
  source_url: string | null
  generated_title: string | null
  generated_excerpt: string | null
  generated_body: string | null
  generated_tags: string[] | null
  error_message: string | null
  tokens_used: number | null
  duration_ms: number | null
  created_at: string
  completed_at: string | null
}

const statusColors: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-700',
  generating: 'bg-blue-100 text-blue-700 animate-pulse',
  completed: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
  accepted: 'bg-emerald-100 text-emerald-700',
  rejected: 'bg-gray-100 text-gray-600',
}

export default function ContentGenerations() {
  const [generations, setGenerations] = useState<Generation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  function load() {
    api.get<Generation[]>('/content/generations')
      .then(setGenerations)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  // Auto-refresh for pending/generating
  useEffect(() => {
    const hasPending = generations.some((g) => g.status === 'pending' || g.status === 'generating')
    if (!hasPending) return
    const interval = setInterval(load, 5000)
    return () => clearInterval(interval)
  }, [generations])

  async function handleAction(genId: string, action: string) {
    setActionLoading(genId)
    setError('')
    try {
      await api.post(`/content/generations/${genId}/action`, { action, user_id: 'cms-admin' })
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed')
    } finally {
      setActionLoading(null)
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-slate-900">AI Generations</h1>
        <button onClick={load} className="px-3 py-1.5 text-sm bg-white border border-gray-300 rounded hover:bg-gray-50">
          Refresh
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">{error}</div>
      )}

      {loading ? (
        <div className="text-gray-500">Loading generations...</div>
      ) : generations.length === 0 ? (
        <div className="text-gray-500 bg-white border border-gray-200 rounded-lg p-8 text-center">
          No AI generations yet. Use the "Generate with AI" button on the New Post page.
        </div>
      ) : (
        <div className="space-y-4">
          {generations.map((g) => (
            <div key={g.id} className="bg-white border border-gray-200 rounded-lg overflow-hidden">
              {/* Header */}
              <div
                className="px-4 py-3 flex items-center justify-between cursor-pointer hover:bg-gray-50"
                onClick={() => setExpandedId(expandedId === g.id ? null : g.id)}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${statusColors[g.status] || 'bg-gray-100'}`}>
                      {g.status}
                    </span>
                    <span className="text-xs text-gray-400">{g.source_type}</span>
                    <span className="text-xs text-gray-400">{g.category}</span>
                    {g.tokens_used && (
                      <span className="text-xs text-gray-400">{g.tokens_used} tokens</span>
                    )}
                    {g.duration_ms && (
                      <span className="text-xs text-gray-400">{(g.duration_ms / 1000).toFixed(1)}s</span>
                    )}
                  </div>
                  <div className="font-medium text-slate-900 truncate">
                    {g.generated_title || g.prompt.substring(0, 80)}
                  </div>
                  {g.source_url && (
                    <div className="text-xs text-blue-500 truncate mt-0.5">{g.source_url}</div>
                  )}
                </div>
                <div className="flex items-center gap-2 ml-4 shrink-0">
                  {g.status === 'completed' && (
                    <>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleAction(g.id, 'accept') }}
                        disabled={actionLoading === g.id}
                        className="px-3 py-1.5 text-sm bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
                      >
                        {actionLoading === g.id ? '...' : 'Accept → Draft'}
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleAction(g.id, 'reject') }}
                        disabled={actionLoading === g.id}
                        className="px-3 py-1.5 text-sm bg-white border border-gray-300 text-gray-600 rounded hover:bg-gray-50 disabled:opacity-50"
                      >
                        Reject
                      </button>
                    </>
                  )}
                  {g.status === 'failed' && (
                    <button
                      onClick={(e) => { e.stopPropagation(); handleAction(g.id, 'retry') }}
                      disabled={actionLoading === g.id}
                      className="px-3 py-1.5 text-sm bg-amber-600 text-white rounded hover:bg-amber-700 disabled:opacity-50"
                    >
                      Retry
                    </button>
                  )}
                  <span className="text-gray-400 text-sm">{expandedId === g.id ? '▲' : '▼'}</span>
                </div>
              </div>

              {/* Error message */}
              {g.status === 'failed' && g.error_message && (
                <div className="px-4 py-2 bg-red-50 text-red-700 text-sm border-t border-red-100">
                  {g.error_message}
                </div>
              )}

              {/* Expanded preview */}
              {expandedId === g.id && g.status === 'completed' && g.generated_body && (
                <div className="border-t border-gray-200">
                  <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <span className="text-gray-500">Title:</span>{' '}
                        <span className="font-medium">{g.generated_title}</span>
                      </div>
                      <div>
                        <span className="text-gray-500">Tags:</span>{' '}
                        {(g.generated_tags || []).map((t) => (
                          <span key={t} className="inline-block px-1.5 py-0.5 bg-gray-200 rounded text-xs mr-1">{t}</span>
                        ))}
                      </div>
                    </div>
                    {g.generated_excerpt && (
                      <div className="mt-2 text-sm text-gray-600 italic">{g.generated_excerpt}</div>
                    )}
                  </div>
                  <div className="p-4 max-h-96 overflow-y-auto">
                    <div
                      className="prose prose-sm max-w-none"
                      dangerouslySetInnerHTML={{
                        __html: g.generated_body
                          .replace(/^# (.+)$/gm, '<h1>$1</h1>')
                          .replace(/^## (.+)$/gm, '<h2>$1</h2>')
                          .replace(/^### (.+)$/gm, '<h3>$1</h3>')
                          .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
                          .replace(/\*(.+?)\*/g, '<em>$1</em>')
                          .replace(/^- (.+)$/gm, '<li>$1</li>')
                          .replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>')
                          .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" style="max-width:200px" />')
                          .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" class="text-blue-600">$1</a>')
                          .replace(/\n\n/g, '</p><p>')
                          .replace(/^(?!<[hulo])/gm, '<p>')
                      }}
                    />
                  </div>
                </div>
              )}

              {/* Pending/generating indicator */}
              {(g.status === 'pending' || g.status === 'generating') && (
                <div className="px-4 py-3 border-t border-gray-100 bg-blue-50">
                  <div className="flex items-center gap-3">
                    <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                    <span className="text-sm text-blue-700">
                      {g.status === 'pending' ? 'Queued — waiting for AI worker...' : 'Generating content with Claude...'}
                    </span>
                  </div>
                  <div className="mt-2 flex gap-1">
                    {['Queued', 'Generating', 'Done'].map((s, i) => (
                      <div key={s} className={`h-1.5 flex-1 rounded-full ${
                        (g.status === 'pending' && i === 0) ? 'bg-blue-500 animate-pulse' :
                        (g.status === 'generating' && i <= 1) ? 'bg-blue-500' :
                        i === 0 ? 'bg-blue-500' : 'bg-blue-200'
                      }`} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

import { useEffect, useState, useCallback } from 'react'
import { api } from '../lib/api'

interface Todo {
  id: string
  title: string
  description: string
  status: string
  priority: string
  assigned_to: string | null
  due_date: string | null
  created_at: string
}

const statusFilters = ['all', 'open', 'in_progress', 'done'] as const
type StatusFilter = (typeof statusFilters)[number]

const priorityColors: Record<string, string> = {
  low: 'bg-gray-100 text-gray-600',
  medium: 'bg-blue-100 text-blue-700',
  high: 'bg-amber-100 text-amber-700',
  urgent: 'bg-red-100 text-red-700',
}

export default function Todos() {
  const [todos, setTodos] = useState<Todo[]>([])
  const [filter, setFilter] = useState<StatusFilter>('all')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [toggling, setToggling] = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    const query = filter === 'all' ? '' : `?status=${filter}`
    api.get<Todo[]>(`/todos${query}`)
      .then(setTodos)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [filter])

  useEffect(() => { load() }, [load])

  async function toggleStatus(todo: Todo) {
    setToggling(todo.id)
    const nextStatus = todo.status === 'done' ? 'open' : todo.status === 'open' ? 'in_progress' : 'done'
    try {
      await api.patch(`/todos/${todo.id}`, { status: nextStatus })
      setTodos((prev) => prev.map((t) => t.id === todo.id ? { ...t, status: nextStatus } : t))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed')
    } finally {
      setToggling(null)
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-slate-900">TODOs</h1>
        <div className="flex gap-1 bg-white border border-gray-200 rounded-lg p-1">
          {statusFilters.map((s) => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={`px-3 py-1 text-xs rounded ${
                filter === s
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              {s === 'all' ? 'All' : s === 'in_progress' ? 'In Progress' : s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">{error}</div>
      )}

      {loading ? (
        <div className="text-gray-500">Loading TODOs...</div>
      ) : todos.length === 0 ? (
        <div className="text-gray-500 bg-white border border-gray-200 rounded-lg p-8 text-center">
          No TODOs found{filter !== 'all' ? ` with status "${filter}"` : ''}.
        </div>
      ) : (
        <div className="space-y-2">
          {todos.map((t) => (
            <div key={t.id} className="bg-white border border-gray-200 rounded-lg p-4 flex items-start gap-3">
              <button
                onClick={() => toggleStatus(t)}
                disabled={toggling === t.id}
                className={`mt-0.5 w-5 h-5 rounded border flex items-center justify-center shrink-0 ${
                  t.status === 'done'
                    ? 'bg-green-600 border-green-600 text-white'
                    : t.status === 'in_progress'
                    ? 'bg-blue-100 border-blue-400'
                    : 'border-gray-300 hover:border-gray-400'
                }`}
              >
                {t.status === 'done' && (
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                )}
                {t.status === 'in_progress' && <span className="w-2 h-2 bg-blue-600 rounded-full" />}
              </button>
              <div className="flex-1 min-w-0">
                <div className={`font-medium ${t.status === 'done' ? 'text-gray-400 line-through' : 'text-slate-900'}`}>
                  {t.title}
                </div>
                {t.description && (
                  <div className="text-sm text-gray-500 mt-0.5">{t.description}</div>
                )}
                <div className="flex items-center gap-2 mt-2">
                  {t.priority && (
                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${priorityColors[t.priority] || 'bg-gray-100 text-gray-600'}`}>
                      {t.priority}
                    </span>
                  )}
                  {t.assigned_to && <span className="text-xs text-gray-400">{t.assigned_to}</span>}
                  {t.due_date && (
                    <span className="text-xs text-gray-400">Due: {new Date(t.due_date).toLocaleDateString()}</span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

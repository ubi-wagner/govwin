import { useState } from 'react'
import { api } from '../lib/api'

interface AIRevisionPanelProps {
  postId: string
  body: string
  onRevised: (newBody: string) => void
  disabled?: boolean
}

const actions = [
  { label: 'Regenerate', instruction: 'Completely rewrite this content while keeping the same topic and key points. Make it fresh and engaging.' },
  { label: 'Shorter', instruction: 'Make this content significantly shorter. Cut to essential points only. Remove redundancy.' },
  { label: 'Longer', instruction: 'Expand this content with more detail, examples, and supporting information. Add depth.' },
  { label: 'More specific', instruction: 'Add specific numbers, concrete examples, named entities, and actionable details.' },
  { label: 'Simpler', instruction: 'Rewrite using simpler language. Shorter sentences. Lower reading level. No jargon.' },
  { label: 'Stronger opening', instruction: 'Rewrite the opening paragraph to immediately hook the reader. Make it compelling.' },
  { label: 'Add metrics', instruction: 'Add relevant statistics, data points, dollar amounts, percentages, and metrics from SBIR/STTR/government contracting.' },
  { label: 'Fix compliance', instruction: 'Ensure proper SBIR/STTR terminology, add any needed disclaimers, fix technical accuracy for government contracting audience.' },
]

export default function AIRevisionPanel({ postId, body, onRevised, disabled }: AIRevisionPanelProps) {
  const [loading, setLoading] = useState(false)
  const [activeAction, setActiveAction] = useState<string | null>(null)
  const [customInstruction, setCustomInstruction] = useState('')
  const [error, setError] = useState('')

  const revise = async (instruction: string, actionLabel: string) => {
    setLoading(true)
    setActiveAction(actionLabel)
    setError('')
    try {
      const res = await api.post<{ revised_body: string }>(`/content/posts/${postId}/revise`, {
        instruction,
        current_body: body,
      })
      onRevised(res.revised_body)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Revision failed')
    } finally {
      setLoading(false)
      setActiveAction(null)
    }
  }

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4">
      <h3 className="text-sm font-semibold text-gray-700 mb-3">AI Revision</h3>

      {error && (
        <div className="bg-red-50 text-red-700 text-xs px-3 py-2 rounded mb-3">{error}</div>
      )}

      <div className="flex flex-wrap gap-2 mb-3">
        {actions.map((a) => (
          <button
            key={a.label}
            onClick={() => revise(a.instruction, a.label)}
            disabled={disabled || loading}
            className={`px-3 py-1.5 text-xs rounded-full border transition ${
              activeAction === a.label
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white text-gray-700 border-gray-300 hover:border-blue-400 hover:text-blue-600'
            } disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            {activeAction === a.label ? 'Revising...' : a.label}
          </button>
        ))}
      </div>

      <div className="flex gap-2">
        <input
          type="text"
          value={customInstruction}
          onChange={(e) => setCustomInstruction(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && customInstruction.trim()) {
              revise(customInstruction.trim(), 'Custom')
              setCustomInstruction('')
            }
          }}
          placeholder="Custom revision instruction..."
          disabled={disabled || loading}
          className="flex-1 px-3 py-1.5 text-sm border border-gray-300 rounded focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none disabled:opacity-50"
        />
        <button
          onClick={() => {
            if (customInstruction.trim()) {
              revise(customInstruction.trim(), 'Custom')
              setCustomInstruction('')
            }
          }}
          disabled={disabled || loading || !customInstruction.trim()}
          className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Apply
        </button>
      </div>

      {loading && (
        <div className="mt-2 text-xs text-gray-500 animate-pulse">
          Revising with AI...
        </div>
      )}
    </div>
  )
}

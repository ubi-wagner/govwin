'use client'

import type { ContentGeneration, ContentCategory } from '@/types'
import { CATEGORIES, CATEGORY_LABELS } from './constants'
import { GenerationStatusBadge } from './status-badge'

interface GenerationPanelProps {
  generations: ContentGeneration[]
  genPrompt: string
  genCategory: ContentCategory
  genModel: string
  genTemp: number
  generating: boolean
  onPromptChange: (v: string) => void
  onCategoryChange: (v: ContentCategory) => void
  onModelChange: (v: string) => void
  onTempChange: (v: number) => void
  onSubmit: () => void
  onAccept: (genId: string) => void
  onReject: (genId: string) => void
  onRetry: (genId: string) => void
}

export function GenerationPanel({
  generations, genPrompt, genCategory, genModel, genTemp, generating,
  onPromptChange, onCategoryChange, onModelChange, onTempChange,
  onSubmit, onAccept, onReject, onRetry,
}: GenerationPanelProps) {
  return (
    <>
      {/* Generation form */}
      <div className="rounded-xl border border-gray-200 bg-white p-5 mb-6">
        <h3 className="text-sm font-bold text-gray-900 mb-3">Generate Content with AI</h3>
        <div className="space-y-3">
          <textarea
            value={genPrompt}
            onChange={e => onPromptChange(e.target.value)}
            placeholder="Describe what content to generate... e.g. 'Write a tip about how to choose the right SBIR topic'"
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm h-24 resize-none focus:border-brand-300 focus:ring-1 focus:ring-brand-300"
          />
          <div className="flex gap-3">
            <select value={genCategory} onChange={e => onCategoryChange(e.target.value as ContentCategory)} className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs">
              {CATEGORIES.map(c => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
            </select>
            <input value={genModel} onChange={e => onModelChange(e.target.value)} className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs flex-1" placeholder="Model" />
            <input type="number" value={genTemp} onChange={e => onTempChange(Number(e.target.value))} min={0} max={1} step={0.1} className="w-20 rounded-lg border border-gray-200 px-3 py-1.5 text-xs" />
          </div>
          <button onClick={onSubmit} disabled={generating || !genPrompt.trim()} className="btn-primary text-sm px-4 py-2 disabled:opacity-50">
            {generating ? 'Submitting...' : 'Generate Content'}
          </button>
        </div>
      </div>

      {/* Generation list */}
      <h3 className="text-sm font-bold text-gray-900 mb-3">Recent Generations</h3>
      {generations.length === 0 ? (
        <p className="text-sm text-gray-400">No generations yet.</p>
      ) : (
        <div className="space-y-3">
          {generations.map(g => (
            <GenerationCard key={g.id} generation={g} onAccept={onAccept} onReject={onReject} onRetry={onRetry} />
          ))}
        </div>
      )}
    </>
  )
}

function GenerationCard({
  generation: g, onAccept, onReject, onRetry,
}: {
  generation: ContentGeneration
  onAccept: (id: string) => void
  onReject: (id: string) => void
  onRetry: (id: string) => void
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex items-start justify-between gap-2 mb-2">
        <p className="text-xs text-gray-500 line-clamp-2">{g.prompt}</p>
        <GenerationStatusBadge status={g.status} />
      </div>
      {g.generatedTitle && <p className="text-sm font-semibold text-gray-900">{g.generatedTitle}</p>}
      {g.generatedExcerpt && <p className="text-xs text-gray-500 mt-1">{g.generatedExcerpt}</p>}
      {g.errorMessage && <p className="text-xs text-red-500 mt-1">{g.errorMessage}</p>}
      {g.status === 'completed' && (
        <div className="flex gap-2 mt-3">
          <button onClick={() => onAccept(g.id)} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700">
            Accept → Draft
          </button>
          <button onClick={() => onReject(g.id)} className="rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-bold text-gray-600 hover:bg-gray-200">
            Reject
          </button>
        </div>
      )}
      {g.status === 'failed' && (
        <button onClick={() => onRetry(g.id)} className="mt-2 rounded-lg bg-amber-100 px-3 py-1.5 text-xs font-bold text-amber-700 hover:bg-amber-200">
          Retry
        </button>
      )}
    </div>
  )
}

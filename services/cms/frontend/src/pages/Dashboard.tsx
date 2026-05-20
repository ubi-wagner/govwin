import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'

interface Counts {
  emailAccounts: number | null
  activeCampaigns: number | null
  pendingOutbox: number | null
  contentPosts: number | null
  socialAccounts: number | null
  openTodos: number | null
}

const cards = [
  { key: 'emailAccounts' as const, label: 'Email Accounts', to: '/email/accounts', color: 'bg-blue-600' },
  { key: 'activeCampaigns' as const, label: 'Active Campaigns', to: '/email/campaigns', color: 'bg-indigo-600' },
  { key: 'pendingOutbox' as const, label: 'Pending Outbox', to: '/email/outbox', color: 'bg-amber-600' },
  { key: 'contentPosts' as const, label: 'Content Posts', to: '/content', color: 'bg-emerald-600' },
  { key: 'socialAccounts' as const, label: 'Social Accounts', to: '/social/accounts', color: 'bg-purple-600' },
  { key: 'openTodos' as const, label: 'Open TODOs', to: '/todos', color: 'bg-rose-600' },
]

export default function Dashboard() {
  const [counts, setCounts] = useState<Counts>({
    emailAccounts: null,
    activeCampaigns: null,
    pendingOutbox: null,
    contentPosts: null,
    socialAccounts: null,
    openTodos: null,
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    async function load() {
      try {
        const [accounts, campaigns, outbox, posts, social, todos] = await Promise.allSettled([
          api.get<unknown[]>('/email/accounts'),
          api.get<unknown[]>('/email/campaigns?status=active'),
          api.get<unknown[]>('/email/outbox?status=pending'),
          api.get<unknown[]>('/content/posts'),
          api.get<unknown[]>('/social/accounts'),
          api.get<unknown[]>('/todos?status=open'),
        ])
        setCounts({
          emailAccounts: accounts.status === 'fulfilled' ? (accounts.value as unknown[]).length : null,
          activeCampaigns: campaigns.status === 'fulfilled' ? (campaigns.value as unknown[]).length : null,
          pendingOutbox: outbox.status === 'fulfilled' ? (outbox.value as unknown[]).length : null,
          contentPosts: posts.status === 'fulfilled' ? (posts.value as unknown[]).length : null,
          socialAccounts: social.status === 'fulfilled' ? (social.value as unknown[]).length : null,
          openTodos: todos.status === 'fulfilled' ? (todos.value as unknown[]).length : null,
        })
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load dashboard')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  if (error) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-slate-900 mb-4">Dashboard</h1>
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">{error}</div>
      </div>
    )
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-900 mb-6">Dashboard</h1>
      <div className="grid grid-cols-3 gap-4">
        {cards.map((card) => (
          <Link
            key={card.key}
            to={card.to}
            className="block rounded-lg bg-white border border-gray-200 p-6 hover:shadow-md transition-shadow"
          >
            <div className={`inline-block px-2 py-1 rounded text-xs font-medium text-white mb-3 ${card.color}`}>
              {card.label}
            </div>
            <div className="text-3xl font-bold text-slate-900">
              {loading ? (
                <span className="text-gray-300">--</span>
              ) : counts[card.key] !== null ? (
                counts[card.key]
              ) : (
                <span className="text-gray-400 text-sm">unavailable</span>
              )}
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}

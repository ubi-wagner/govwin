import { useEffect, useState } from 'react'
import { api } from '../lib/api'

interface SocialAccount {
  id: string
  platform: string
  account_name: string
  platform_account_id: string | null
  status: string
  tenant_id: string | null
  token_expires_at: string | null
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

const platformColors: Record<string, string> = {
  twitter: 'bg-sky-100 text-sky-700',
  linkedin: 'bg-blue-100 text-blue-700',
  facebook: 'bg-indigo-100 text-indigo-700',
  instagram: 'bg-pink-100 text-pink-700',
}

export default function SocialAccounts() {
  const [accounts, setAccounts] = useState<SocialAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    api.get<SocialAccount[]>('/social/accounts')
      .then(setAccounts)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-900 mb-6">Social Accounts</h1>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">{error}</div>
      )}

      {loading ? (
        <div className="text-gray-500">Loading social accounts...</div>
      ) : accounts.length === 0 ? (
        <div className="text-gray-500 bg-white border border-gray-200 rounded-lg p-8 text-center">
          No social accounts connected yet.
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4">
          {accounts.map((a) => (
            <div key={a.id} className="bg-white border border-gray-200 rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${platformColors[a.platform] || 'bg-gray-100 text-gray-600'}`}>
                  {a.platform}
                </span>
                <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                  a.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
                }`}>
                  {a.status}
                </span>
              </div>
              <div className="font-medium text-slate-900">{a.account_name}</div>
              {a.platform_account_id && (
                <div className="text-sm text-gray-500">{a.platform_account_id}</div>
              )}
              {a.token_expires_at && (
                <div className="text-xs text-gray-400 mt-2">Token expires: {new Date(a.token_expires_at).toLocaleDateString()}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

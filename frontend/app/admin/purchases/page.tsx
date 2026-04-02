'use client'

import { useEffect, useState, useCallback } from 'react'

interface PendingPurchase {
  id: string
  tenant_id: string
  tenant_name: string
  tenant_slug: string
  proposal_id: string | null
  proposal_title: string | null
  purchase_type: 'phase_1' | 'phase_2'
  price_cents: number
  status: string
  purchased_at: string
  cancellation_deadline: string
  template_delivered_at: string | null
}

interface Template {
  id: string
  template_name: string
  agency: string
  program_type: string
}

export default function AdminPurchasesPage() {
  const [purchases, setPurchases] = useState<PendingPurchase[]>([])
  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [delivering, setDelivering] = useState<string | null>(null)
  const [deliverError, setDeliverError] = useState<string | null>(null)
  const [filterStatus, setFilterStatus] = useState<string>('pending')

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [purchasesRes, templatesRes] = await Promise.all([
        fetch(`/api/admin/purchases?status=${filterStatus}`),
        fetch('/api/admin/templates'),
      ])

      if (!purchasesRes.ok) {
        const body = await purchasesRes.json().catch(() => ({}))
        throw new Error(body.error ?? `Failed to fetch purchases (${purchasesRes.status})`)
      }
      if (!templatesRes.ok) {
        const body = await templatesRes.json().catch(() => ({}))
        throw new Error(body.error ?? `Failed to fetch templates (${templatesRes.status})`)
      }

      const [purchaseData, templateData] = await Promise.all([
        purchasesRes.json(),
        templatesRes.json(),
      ])

      setPurchases(purchaseData.data ?? [])
      setTemplates(templateData.data ?? [])
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to load data'
      setError(message)
      console.error('[AdminPurchasesPage] fetch error:', e)
    } finally {
      setLoading(false)
    }
  }, [filterStatus])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const handleDeliver = async (purchaseId: string, templateId: string) => {
    setDelivering(purchaseId)
    setDeliverError(null)
    try {
      const res = await fetch(`/api/admin/templates/${templateId}/deliver`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ purchaseId }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? `Failed to deliver template (${res.status})`)
      }
      await fetchData()
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to deliver template'
      setDeliverError(message)
      console.error('[AdminPurchasesPage] deliver error:', e)
    } finally {
      setDelivering(null)
    }
  }

  const formatPrice = (cents: number) => `$${(cents / 100).toFixed(0)}`
  const formatDate = (d: string) => new Date(d).toLocaleDateString()

  const statusBadge = (status: string) => {
    const styles: Record<string, string> = {
      pending: 'bg-yellow-100 text-yellow-800',
      active: 'bg-blue-100 text-blue-800',
      template_delivered: 'bg-green-100 text-green-800',
      cancelled: 'bg-gray-100 text-gray-600',
      refunded: 'bg-red-100 text-red-800',
      completed: 'bg-green-100 text-green-800',
    }
    return (
      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${styles[status] ?? 'bg-gray-100 text-gray-600'}`}>
        {status.replace(/_/g, ' ')}
      </span>
    )
  }

  return (
    <div className="max-w-6xl mx-auto p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Purchase Queue</h1>
        <p className="text-sm text-gray-500 mt-1">
          Manage proposal build purchases and deliver templates
        </p>
      </div>

      {/* Filters */}
      <div className="flex gap-4 mb-6">
        {['pending', 'active', 'template_delivered', 'cancelled', 'all'].map((s) => (
          <button
            key={s}
            onClick={() => setFilterStatus(s)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              filterStatus === s
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {s === 'all' ? 'All' : s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
          </button>
        ))}
      </div>

      {loading && (
        <div className="flex items-center justify-center py-12">
          <div className="text-gray-500">Loading purchases...</div>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center mb-6">
          <p className="text-red-700 mb-3">{error}</p>
          <button onClick={fetchData} className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700">
            Retry
          </button>
        </div>
      )}

      {deliverError && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
          <p className="text-red-700 text-sm">{deliverError}</p>
        </div>
      )}

      {!loading && !error && purchases.length === 0 && (
        <div className="text-center py-16 bg-gray-50 rounded-lg border border-dashed border-gray-300">
          <p className="text-gray-500 text-lg mb-2">No purchases found</p>
          <p className="text-gray-400 text-sm">
            {filterStatus === 'pending' ? 'No pending purchases awaiting template delivery.' : 'No purchases match the selected filter.'}
          </p>
        </div>
      )}

      {!loading && purchases.length > 0 && (
        <div className="space-y-4">
          {purchases.map((p) => (
            <div key={p.id} className="bg-white border border-gray-200 rounded-lg shadow-sm p-5">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="flex items-center gap-3 mb-1">
                    <h3 className="text-base font-semibold text-gray-900">
                      {p.tenant_name}
                    </h3>
                    {statusBadge(p.status)}
                    <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800">
                      {p.purchase_type === 'phase_1' ? 'Phase I' : 'Phase II'}
                    </span>
                    <span className="text-sm font-medium text-gray-700">{formatPrice(p.price_cents)}</span>
                  </div>
                  {p.proposal_title && (
                    <p className="text-sm text-gray-600">Proposal: {p.proposal_title}</p>
                  )}
                  <div className="flex gap-4 text-xs text-gray-500 mt-1">
                    <span>Purchased: {formatDate(p.purchased_at)}</span>
                    <span>Cancel deadline: {formatDate(p.cancellation_deadline)}</span>
                    {p.template_delivered_at && <span>Delivered: {formatDate(p.template_delivered_at)}</span>}
                  </div>
                </div>

                {/* Deliver action for pending purchases */}
                {p.status === 'pending' && templates.length > 0 && (
                  <div className="flex items-center gap-2">
                    <select
                      id={`template-${p.id}`}
                      className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
                      defaultValue=""
                    >
                      <option value="" disabled>Select template...</option>
                      {templates.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.agency} {t.program_type.toUpperCase()} — {t.template_name}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() => {
                        const select = document.getElementById(`template-${p.id}`) as HTMLSelectElement | null
                        const templateId = select?.value
                        if (!templateId) return
                        handleDeliver(p.id, templateId)
                      }}
                      disabled={delivering === p.id}
                      className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50 transition-colors whitespace-nowrap"
                    >
                      {delivering === p.id ? 'Delivering...' : 'Deliver Template'}
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

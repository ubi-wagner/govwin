'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'

interface TeamMember {
  id: string
  name: string
  email: string
  role: string
  phone: string | null
  last_login_at: string | null
  status: 'active' | 'inactive'
}

interface Invitation {
  id: string
  name: string
  email: string
  role: string
  status: string
  expires_at: string | null
}

interface TeamLimits {
  maxSeats: number
  currentSeats: number
  pendingInvites: number
  productTier: string
}

interface TeamData {
  members: TeamMember[]
  invitations: Invitation[]
  limits: TeamLimits
}

interface InviteForm {
  name: string
  email: string
  role: string
  company: string
  phone: string
  notes: string
}

const emptyForm: InviteForm = {
  name: '',
  email: '',
  role: 'team_member',
  company: '',
  phone: '',
  notes: '',
}

export default function TeamPage() {
  const { tenantSlug } = useParams<{ tenantSlug: string }>()

  const [teamData, setTeamData] = useState<TeamData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [showInviteForm, setShowInviteForm] = useState(false)
  const [inviteForm, setInviteForm] = useState<InviteForm>(emptyForm)
  const [inviteSubmitting, setInviteSubmitting] = useState(false)
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [inviteSuccess, setInviteSuccess] = useState<string | null>(null)

  const [resendingId, setResendingId] = useState<string | null>(null)

  const fetchTeamData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/portal/${tenantSlug}/team`)
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? `Failed to load team data (HTTP ${res.status})`)
      }
      const json = await res.json()
      setTeamData(json.data ?? null)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load team data'
      setError(message)
    } finally {
      setLoading(false)
    }
  }, [tenantSlug])

  useEffect(() => {
    fetchTeamData()
  }, [fetchTeamData])

  const handleInviteSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setInviteSubmitting(true)
    setInviteError(null)
    setInviteSuccess(null)

    try {
      const res = await fetch(`/api/portal/${tenantSlug}/team`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(inviteForm),
      })

      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? `Failed to send invitation (HTTP ${res.status})`)
      }

      setInviteSuccess(`Invitation sent to ${inviteForm.email}`)
      setInviteForm(emptyForm)
      setShowInviteForm(false)
      await fetchTeamData()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to send invitation'
      setInviteError(message)
    } finally {
      setInviteSubmitting(false)
    }
  }

  const handleResend = async (invitationId: string) => {
    setResendingId(invitationId)
    try {
      const res = await fetch(`/api/portal/${tenantSlug}/team`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resendInvitationId: invitationId }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? 'Failed to resend invitation')
      }
      await fetchTeamData()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to resend invitation'
      setInviteError(message)
    } finally {
      setResendingId(null)
    }
  }

  const formatDate = (dateStr: string | null): string => {
    if (!dateStr) return 'Never'
    try {
      return new Date(dateStr).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    } catch {
      return 'Unknown'
    }
  }

  const formatRole = (role: string): string => {
    return role
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase())
  }

  if (loading) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Team</h1>
        <div className="mt-6 space-y-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="card animate-pulse h-16" />
          ))}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Team</h1>
        <div className="mt-6 rounded-lg bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
        <button
          onClick={fetchTeamData}
          className="mt-4 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          Retry
        </button>
      </div>
    )
  }

  if (!teamData) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Team</h1>
        <div className="mt-6 text-sm text-gray-500">No team data available.</div>
      </div>
    )
  }

  const { members, invitations, limits } = teamData
  const seatsUsed = limits.currentSeats
  const seatsTotal = limits.maxSeats
  const seatsRemaining = seatsTotal - seatsUsed - limits.pendingInvites
  const isAtLimit = seatsRemaining <= 0
  const isNearLimit = seatsRemaining > 0 && seatsRemaining <= 2

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-gray-900">Team</h1>
          <span className="inline-flex items-center rounded-full bg-blue-100 px-3 py-0.5 text-sm font-medium text-blue-800">
            Seats: {seatsUsed}/{seatsTotal} used
          </span>
        </div>
        <button
          onClick={() => {
            setShowInviteForm(!showInviteForm)
            setInviteError(null)
            setInviteSuccess(null)
          }}
          disabled={isAtLimit}
          className={`rounded-md px-4 py-2 text-sm font-medium text-white ${
            isAtLimit
              ? 'cursor-not-allowed bg-gray-400'
              : 'bg-blue-600 hover:bg-blue-700'
          }`}
        >
          Invite Team Member
        </button>
      </div>
      <p className="mt-1 text-sm text-gray-500">
        Manage your team members and invitations
        {limits.productTier ? ` \u2014 ${formatRole(limits.productTier)} plan` : ''}
      </p>

      {/* Seat limit warnings */}
      {isAtLimit && (
        <div className="mt-4 rounded-lg bg-red-50 border border-red-200 p-4 text-sm text-red-700">
          You have reached your seat limit ({seatsTotal} seats). Remove a member or upgrade your plan to invite more.
        </div>
      )}
      {isNearLimit && (
        <div className="mt-4 rounded-lg bg-yellow-50 border border-yellow-200 p-4 text-sm text-yellow-700">
          You are approaching your seat limit ({seatsRemaining} seat{seatsRemaining === 1 ? '' : 's'} remaining).
        </div>
      )}

      {/* Success / Error banners */}
      {inviteSuccess && (
        <div className="mt-4 rounded-lg bg-green-50 border border-green-200 p-4 text-sm text-green-700">
          {inviteSuccess}
        </div>
      )}
      {inviteError && (
        <div className="mt-4 rounded-lg bg-red-50 border border-red-200 p-4 text-sm text-red-700">
          {inviteError}
        </div>
      )}

      {/* Invite Form */}
      {showInviteForm && (
        <div className="mt-6 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Invite Team Member</h2>
          <form onSubmit={handleInviteSubmit} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="invite-name" className="block text-sm font-medium text-gray-700">
                  Name <span className="text-red-500">*</span>
                </label>
                <input
                  id="invite-name"
                  type="text"
                  required
                  value={inviteForm.name}
                  onChange={(e) => setInviteForm({ ...inviteForm, name: e.target.value })}
                  className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  placeholder="Full name"
                />
              </div>
              <div>
                <label htmlFor="invite-email" className="block text-sm font-medium text-gray-700">
                  Email <span className="text-red-500">*</span>
                </label>
                <input
                  id="invite-email"
                  type="email"
                  required
                  value={inviteForm.email}
                  onChange={(e) => setInviteForm({ ...inviteForm, email: e.target.value })}
                  className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  placeholder="email@company.com"
                />
              </div>
              <div>
                <label htmlFor="invite-role" className="block text-sm font-medium text-gray-700">
                  Role
                </label>
                <select
                  id="invite-role"
                  value={inviteForm.role}
                  onChange={(e) => setInviteForm({ ...inviteForm, role: e.target.value })}
                  className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value="team_member">Team Member</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <div>
                <label htmlFor="invite-company" className="block text-sm font-medium text-gray-700">
                  Company
                </label>
                <input
                  id="invite-company"
                  type="text"
                  value={inviteForm.company}
                  onChange={(e) => setInviteForm({ ...inviteForm, company: e.target.value })}
                  className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  placeholder="Company name"
                />
              </div>
              <div>
                <label htmlFor="invite-phone" className="block text-sm font-medium text-gray-700">
                  Phone
                </label>
                <input
                  id="invite-phone"
                  type="tel"
                  value={inviteForm.phone}
                  onChange={(e) => setInviteForm({ ...inviteForm, phone: e.target.value })}
                  className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  placeholder="(555) 123-4567"
                />
              </div>
            </div>
            <div>
              <label htmlFor="invite-notes" className="block text-sm font-medium text-gray-700">
                Notes
              </label>
              <textarea
                id="invite-notes"
                rows={3}
                value={inviteForm.notes}
                onChange={(e) => setInviteForm({ ...inviteForm, notes: e.target.value })}
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                placeholder="Optional notes about this team member"
              />
            </div>
            <div className="flex items-center gap-3">
              <button
                type="submit"
                disabled={inviteSubmitting}
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {inviteSubmitting ? 'Sending...' : 'Send Invitation'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowInviteForm(false)
                  setInviteForm(emptyForm)
                  setInviteError(null)
                }}
                className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Team Members */}
      <div className="mt-8">
        <h2 className="text-lg font-semibold text-gray-900">Members ({members.length})</h2>
        <div className="mt-4 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Name</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Email</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Role</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Phone</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Last Login</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {members.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-sm text-gray-500">
                      No team members found.
                    </td>
                  </tr>
                ) : (
                  members.map((member) => (
                    <tr key={member.id} className="hover:bg-gray-50">
                      <td className="whitespace-nowrap px-4 py-3 text-sm font-medium text-gray-900">
                        {member.name}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">
                        {member.email}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">
                        {formatRole(member.role)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">
                        {member.phone ?? '\u2014'}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">
                        {formatDate(member.last_login_at)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm">
                        <span
                          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                            member.status === 'active'
                              ? 'bg-green-100 text-green-800'
                              : 'bg-gray-100 text-gray-600'
                          }`}
                        >
                          {member.status === 'active' ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Pending Invitations */}
      <div className="mt-8">
        <h2 className="text-lg font-semibold text-gray-900">Pending Invitations ({invitations.length})</h2>
        <div className="mt-4 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Name</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Email</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Role</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Expires</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {invitations.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-sm text-gray-500">
                      No pending invitations.
                    </td>
                  </tr>
                ) : (
                  invitations.map((invite) => (
                    <tr key={invite.id} className="hover:bg-gray-50">
                      <td className="whitespace-nowrap px-4 py-3 text-sm font-medium text-gray-900">
                        {invite.name}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">
                        {invite.email}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">
                        {formatRole(invite.role)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm">
                        <span className="inline-flex items-center rounded-full bg-yellow-100 px-2.5 py-0.5 text-xs font-medium text-yellow-800">
                          {formatRole(invite.status)}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">
                        {formatDate(invite.expires_at)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm">
                        <button
                          onClick={() => handleResend(invite.id)}
                          disabled={resendingId === invite.id}
                          className="text-blue-600 hover:text-blue-800 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {resendingId === invite.id ? 'Resending...' : 'Resend'}
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}

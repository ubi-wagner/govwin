'use client'

import { useState, useEffect, useCallback } from 'react'
import { signOut } from 'next-auth/react'
import Link from 'next/link'

interface ConsentStatus {
  accepted: boolean
  currentVersion: string
  acceptedVersion: string | null
  acceptedAt: string | null
}

/**
 * ConsentGate — renders a blocking modal when the user has not accepted
 * current legal documents. Blocks the entire app until consent is given.
 *
 * Used in two contexts:
 *  1. Registration flow: first-time acceptance (includes authority representation)
 *  2. Login flow: re-acceptance when legal docs have been updated
 *
 * The `isRegistration` prop controls whether the authority representation
 * checkbox is shown (only for the person registering the account).
 */
export function ConsentGate({
  isRegistration = false,
  onAccepted,
}: {
  isRegistration?: boolean
  onAccepted?: () => void
}) {
  const [status, setStatus] = useState<Record<string, ConsentStatus> | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Consent checkboxes
  const [termsAccepted, setTermsAccepted] = useState(false)
  const [privacyAccepted, setPrivacyAccepted] = useState(false)
  const [aiAccepted, setAiAccepted] = useState(false)
  const [authorityAccepted, setAuthorityAccepted] = useState(false)

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/consent', { cache: 'no-store' })
      if (res.status === 401) {
        // Session invalid — sign out immediately
        signOut({ callbackUrl: '/login' })
        return
      }
      if (!res.ok) return // API unavailable — don't block
      const data = await res.json()
      setStatus(data.data ?? null)
    } catch {
      // Silently fail — don't block the app if consent API is unreachable
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadStatus() }, [loadStatus])

  // Determine what needs acceptance
  // Only check document types that the server actually returned (exist in legal_document_versions)
  const needsTerms = status?.terms_of_service !== undefined && !status.terms_of_service.accepted
  const needsPrivacy = status?.privacy_policy !== undefined && !status.privacy_policy.accepted
  const needsAi = status?.ai_disclosure !== undefined && !status.ai_disclosure.accepted
  const needsAuthority = isRegistration
    && status?.authority_representation !== undefined
    && !status.authority_representation.accepted
  const needsConsent = needsTerms || needsPrivacy || needsAi || needsAuthority

  // If loading or already consented, render nothing
  if (loading || !needsConsent) return null

  const allChecked = termsAccepted && privacyAccepted && aiAccepted && (!needsAuthority || authorityAccepted)

  async function recordConsent(documentType: string, version: string, summary: string) {
    const res = await fetch('/api/consent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ documentType, documentVersion: version, action: 'accept', summary }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Unknown error' }))
      // Session is stale (user doesn't exist in DB) — force sign out
      if (res.status === 401 || err.code === 'SESSION_INVALID') {
        signOut({ callbackUrl: '/login' })
        throw new Error('Session expired. Signing you out...')
      }
      throw new Error(err.error ?? `Failed to record ${documentType} consent`)
    }
  }

  async function handleAcceptAll() {
    if (!allChecked || !status) return
    setSubmitting(true)
    setError(null)

    try {
      const promises: Promise<void>[] = []

      if (needsTerms) {
        promises.push(recordConsent(
          'terms_of_service',
          status.terms_of_service?.currentVersion ?? '2026-03-25-v1',
          'Accepted Terms of Service'
        ))
      }
      if (needsPrivacy) {
        promises.push(recordConsent(
          'privacy_policy',
          status.privacy_policy?.currentVersion ?? '2026-03-25-v1',
          'Accepted Privacy Policy'
        ))
      }
      if (needsAi) {
        promises.push(recordConsent(
          'ai_disclosure',
          status.ai_disclosure?.currentVersion ?? '2026-03-25-v1',
          'Acknowledged AI Disclosure'
        ))
      }
      if (needsAuthority) {
        promises.push(recordConsent(
          'authority_representation',
          status.authority_representation?.currentVersion ?? '2026-03-25-v1',
          'Confirmed authority to represent organization'
        ))
      }

      await Promise.all(promises)
      // All POSTs succeeded — dismiss the gate immediately.
      // Don't re-fetch (avoids cache/timing issues causing the wall to loop).
      setStatus(null)
      onAccepted?.()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to record consent')
    } finally {
      setSubmitting(false)
    }
  }

  const isUpdate = status?.terms_of_service?.acceptedVersion != null && needsTerms

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-br from-brand-600 to-brand-700 px-6 py-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/20">
              <svg className="h-5 w-5 text-white" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" />
              </svg>
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">
                {isUpdate ? 'Updated Terms' : 'Legal Agreement'}
              </h2>
              <p className="text-sm text-white/80">
                {isUpdate
                  ? 'Our legal documents have been updated. Please review and accept to continue.'
                  : 'Please review and accept our terms to continue.'
                }
              </p>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4 max-h-[60vh] overflow-y-auto">
          {/* Authority representation — registration only */}
          {needsAuthority && (
            <div className="rounded-xl bg-amber-50 border border-amber-200 p-4">
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={authorityAccepted}
                  onChange={e => setAuthorityAccepted(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-amber-300 text-amber-600 focus:ring-amber-500"
                />
                <div>
                  <p className="text-sm font-semibold text-amber-900">
                    Authority to Represent
                  </p>
                  <p className="mt-1 text-xs text-amber-700 leading-relaxed">
                    I represent and warrant that I am authorized to act on behalf of my organization
                    in registering this account. I understand that as the Account Administrator, I am
                    responsible for the actions and compliance of all users I add to this account,
                    including their adherence to these Terms.
                  </p>
                </div>
              </label>
            </div>
          )}

          {/* Terms of Service */}
          {needsTerms && (
            <label className="flex items-start gap-3 cursor-pointer rounded-xl border border-gray-200 p-4 hover:bg-gray-50 transition-colors">
              <input
                type="checkbox"
                checked={termsAccepted}
                onChange={e => setTermsAccepted(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
              />
              <div>
                <p className="text-sm font-semibold text-gray-900">Terms of Service</p>
                <p className="mt-0.5 text-xs text-gray-500">
                  I agree to the{' '}
                  <Link href="/legal/terms" target="_blank" className="text-brand-600 hover:text-brand-700 underline">
                    Terms of Service
                  </Link>
                  {' '}and{' '}
                  <Link href="/legal/acceptable-use" target="_blank" className="text-brand-600 hover:text-brand-700 underline">
                    Acceptable Use Policy
                  </Link>.
                </p>
              </div>
            </label>
          )}

          {/* Privacy Policy */}
          {needsPrivacy && (
            <label className="flex items-start gap-3 cursor-pointer rounded-xl border border-gray-200 p-4 hover:bg-gray-50 transition-colors">
              <input
                type="checkbox"
                checked={privacyAccepted}
                onChange={e => setPrivacyAccepted(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
              />
              <div>
                <p className="text-sm font-semibold text-gray-900">Privacy Policy</p>
                <p className="mt-0.5 text-xs text-gray-500">
                  I acknowledge and accept the{' '}
                  <Link href="/legal/privacy" target="_blank" className="text-brand-600 hover:text-brand-700 underline">
                    Privacy Policy
                  </Link>, including how my data is collected, used, and shared with third parties.
                </p>
              </div>
            </label>
          )}

          {/* AI Disclosure */}
          {needsAi && (
            <label className="flex items-start gap-3 cursor-pointer rounded-xl border border-gray-200 p-4 hover:bg-gray-50 transition-colors">
              <input
                type="checkbox"
                checked={aiAccepted}
                onChange={e => setAiAccepted(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
              />
              <div>
                <p className="text-sm font-semibold text-gray-900">AI & Machine Learning Disclosure</p>
                <p className="mt-0.5 text-xs text-gray-500">
                  I acknowledge the{' '}
                  <Link href="/legal/ai-disclosure" target="_blank" className="text-brand-600 hover:text-brand-700 underline">
                    AI Disclosure
                  </Link>, including that AI-generated analysis is informational only and should not be the
                  sole basis for business decisions.
                </p>
              </div>
            </label>
          )}

          {/* Error */}
          {error && (
            <div className="rounded-xl bg-red-50 border border-red-200 p-3 space-y-2">
              <p className="text-sm text-red-700">{error}</p>
              <p className="text-xs text-red-600">
                If this persists, try{' '}
                <button
                  onClick={() => signOut({ callbackUrl: '/login' })}
                  className="underline font-medium hover:text-red-800"
                >
                  signing out
                </button>
                {' '}and logging back in.
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-gray-100 px-6 py-4 bg-gray-50">
          <button
            onClick={handleAcceptAll}
            disabled={!allChecked || submitting}
            className="btn-primary w-full py-3 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Recording consent...
              </span>
            ) : (
              'I Agree — Continue'
            )}
          </button>
          <p className="mt-3 text-center text-[10px] text-gray-400">
            Your acceptance is recorded with timestamp, IP address, and document version for audit purposes.
          </p>
        </div>
      </div>
    </div>
  )
}

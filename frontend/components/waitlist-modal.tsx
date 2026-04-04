'use client'

import { useState, useEffect, useCallback } from 'react'
import { getStoredVisitorId } from '@/components/analytics-tracker'

/**
 * Global waitlist modal — lives in the marketing layout.
 * Intercepts ALL "Join the Waitlist" / "Join Waitlist" clicks site-wide
 * and opens this form instead of navigating.
 */
export function WaitlistModal() {
  const [open, setOpen] = useState(false)
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [company, setCompany] = useState('')
  const [technology, setTechnology] = useState('')
  const [notes, setNotes] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Intercept all waitlist-related clicks
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      const target = e.target as HTMLElement
      const el = target.closest('a, button') as HTMLElement | null
      if (!el) return

      const text = el.textContent?.trim() ?? ''
      const href = el.getAttribute('href')

      // Match any "Join Waitlist" / "Join the Waitlist" button or link
      const isWaitlistCTA =
        /join\s*(the\s*)?waitlist/i.test(text) ||
        (href === '/get-started' && /join|waitlist/i.test(text))

      if (isWaitlistCTA) {
        e.preventDefault()
        e.stopPropagation()
        setOpen(true)
      }
    }

    // Also listen for custom event (for programmatic triggers)
    function handleCustomOpen() {
      setOpen(true)
    }

    document.addEventListener('click', handleClick, true)
    window.addEventListener('open-waitlist', handleCustomOpen)
    return () => {
      document.removeEventListener('click', handleClick, true)
      window.removeEventListener('open-waitlist', handleCustomOpen)
    }
  }, [])

  // Lock body scroll when open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => { document.body.style.overflow = '' }
  }, [open])

  const handleClose = useCallback(() => {
    setOpen(false)
    setTimeout(() => {
      setFullName('')
      setEmail('')
      setPhone('')
      setCompany('')
      setTechnology('')
      setNotes('')
      setSubmitted(false)
      setError(null)
    }, 300)
  }, [])

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && open) handleClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, handleClose])

  function validatePhone(val: string): boolean {
    if (!val) return true // optional
    const digits = val.replace(/\D/g, '')
    return digits.length >= 10
  }

  function validateEmail(val: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)
  }

  async function handleSubmit() {
    // Validate required fields
    if (!fullName.trim()) {
      setError('Full name is required.')
      return
    }
    if (!email.trim() || !validateEmail(email.trim())) {
      setError('Please enter a valid email address.')
      return
    }
    if (phone.trim() && !validatePhone(phone.trim())) {
      setError('Please enter a valid phone number (at least 10 digits).')
      return
    }

    setError(null)
    setSubmitting(true)
    try {
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: fullName.trim(),
          email: email.trim(),
          phone: phone.trim() || undefined,
          company: company.trim() || undefined,
          technology: technology.trim() || undefined,
          notes: notes.trim() || undefined,
          visitorId: getStoredVisitorId() ?? undefined,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error ?? 'Something went wrong. Please try again.')
        return
      }
      setSubmitted(true)
    } catch {
      setError('Unable to connect. Please try again later.')
    } finally {
      setSubmitting(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={handleClose}>
      <div
        className="relative mx-4 w-full max-w-lg rounded-2xl bg-white shadow-2xl animate-fade-in-up"
        onClick={e => e.stopPropagation()}
      >
        {/* X close button */}
        <button
          onClick={handleClose}
          className="absolute right-4 top-4 z-10 rounded-lg p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
          aria-label="Close"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
          </svg>
        </button>

        <div className="p-8">
          {submitted ? (
            <div className="text-center py-4">
              <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50 mb-5">
                <svg className="h-7 w-7 text-emerald-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                </svg>
              </div>
              <h3 className="text-xl font-bold text-gray-900">You&apos;re on the list!</h3>
              <p className="mt-3 text-sm text-gray-500 leading-relaxed max-w-sm mx-auto">
                We&apos;ll notify you at <span className="font-semibold text-gray-700">{email}</span> when
                RFP Pipeline launches on May 15, 2026. Up to 20 small businesses will be selected for early access
                and personal onboarding by our founder — plus 3 months of free Pipeline Engine subscription.
              </p>
              <button onClick={handleClose} className="btn-primary mt-8 px-8 py-3 text-sm">
                Got it
              </button>
            </div>
          ) : (
            <>
              <div className="text-center mb-6">
                <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50">
                  <svg className="h-6 w-6 text-brand-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.59 14.37a6 6 0 0 1-5.84 7.38v-4.8m5.84-2.58a14.98 14.98 0 0 0 6.16-12.12A14.98 14.98 0 0 0 9.631 8.41m5.96 5.96a14.926 14.926 0 0 1-5.841 2.58m-.119-8.54a6 6 0 0 0-7.381 5.84h4.8m2.581-5.84a14.927 14.927 0 0 0-2.58 5.84m2.699 2.7c-.103.021-.207.041-.311.06a15.09 15.09 0 0 1-2.448-2.448 14.9 14.9 0 0 1 .06-.312m-2.24 2.39a4.493 4.493 0 0 0-1.757 4.306 4.493 4.493 0 0 0 4.306-1.758M16.5 9a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Z" />
                  </svg>
                </div>
                <h3 className="mt-4 text-xl font-bold text-gray-900">Join the Waitlist</h3>
                <p className="mt-2 text-sm text-gray-500">
                  Launching May 15, 2026. Up to 20 small businesses will be selected for early access and personal onboarding by our founder — plus 3 months free.
                </p>
              </div>

              <div className="space-y-4">
                {/* Name & Email — required */}
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className="label">Full Name <span className="text-red-500">*</span></label>
                    <input
                      type="text"
                      className="input"
                      placeholder="Jane Smith"
                      value={fullName}
                      onChange={e => { setFullName(e.target.value); setError(null) }}
                    />
                  </div>
                  <div>
                    <label className="label">Email <span className="text-red-500">*</span></label>
                    <input
                      type="email"
                      className="input"
                      placeholder="jane@company.com"
                      value={email}
                      onChange={e => { setEmail(e.target.value); setError(null) }}
                    />
                  </div>
                </div>

                {/* Phone & Company — optional */}
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className="label">Phone</label>
                    <input
                      type="tel"
                      className="input"
                      placeholder="(555) 123-4567"
                      value={phone}
                      onChange={e => { setPhone(e.target.value); setError(null) }}
                    />
                  </div>
                  <div>
                    <label className="label">Company</label>
                    <input
                      type="text"
                      className="input"
                      placeholder="Acme Technologies"
                      value={company}
                      onChange={e => setCompany(e.target.value)}
                    />
                  </div>
                </div>

                {/* Technology / Innovation Summary — textarea */}
                <div>
                  <label className="label">Technology or Innovation Summary</label>
                  <textarea
                    className="input min-h-[72px] resize-y"
                    placeholder="Briefly describe your technology, innovation area, or what you're working on..."
                    rows={3}
                    value={technology}
                    onChange={e => setTechnology(e.target.value)}
                  />
                </div>

                {/* Notes to Team — textarea */}
                <div>
                  <label className="label">Notes for the RFP Pipeline Team</label>
                  <textarea
                    className="input min-h-[72px] resize-y"
                    placeholder="Questions, interests, or anything you'd like us to know..."
                    rows={3}
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                  />
                </div>

                {error && (
                  <p className="text-sm text-red-600 font-medium">{error}</p>
                )}

                <button
                  className="btn-primary w-full py-3 text-base font-bold"
                  onClick={handleSubmit}
                  disabled={submitting}
                >
                  {submitting ? 'Joining...' : 'Join the Waitlist'}
                </button>

                <p className="text-center text-xs text-gray-400 pt-1">
                  Questions? Contact us at{' '}
                  <a href="mailto:eric@rfppipeline.com" className="text-brand-600 hover:underline font-medium">
                    eric@rfppipeline.com
                  </a>
                </p>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

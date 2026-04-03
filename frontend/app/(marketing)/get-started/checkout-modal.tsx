'use client'

import { useState } from 'react'
import { Modal } from '@/components/page-sections'

/** Client wrapper: billing toggle + pricing cards + waitlist modal */
export function InteractivePricingSection({
  plans,
}: {
  plans: { name: string; price: string; period: string; description: string; features: string[]; cta: string; popular: boolean }[]
}) {
  const [waitlistOpen, setWaitlistOpen] = useState(false)
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null)
  const [billingPeriod, setBillingPeriod] = useState<'monthly' | 'annual'>('monthly')

  // Form fields
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [company, setCompany] = useState('')
  const [companySize, setCompanySize] = useState('')
  const [technology, setTechnology] = useState('')
  const [notes, setNotes] = useState('')

  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleJoinWaitlist = async () => {
    if (!fullName.trim()) {
      setError('Full name is required.')
      return
    }
    if (!email || !email.includes('@')) {
      setError('Please enter a valid email address.')
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
          companySize: companySize || undefined,
          technology: technology.trim() || undefined,
          notes: notes.trim() || undefined,
          plan: selectedPlan,
          billingPeriod,
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

  const handleClose = () => {
    setWaitlistOpen(false)
    setTimeout(() => {
      setFullName('')
      setEmail('')
      setPhone('')
      setCompany('')
      setCompanySize('')
      setTechnology('')
      setNotes('')
      setSubmitted(false)
      setError(null)
    }, 300)
  }

  return (
    <>
      {/* Billing toggle */}
      <section className="bg-white px-4 pb-4 sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-xs items-center justify-center">
          <div className="flex items-center rounded-xl bg-gray-100 p-1">
            <button
              onClick={() => setBillingPeriod('monthly')}
              className={`rounded-lg px-4 py-2 text-sm font-semibold transition-all ${
                billingPeriod === 'monthly'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              Monthly
            </button>
            <button
              onClick={() => setBillingPeriod('annual')}
              className={`rounded-lg px-4 py-2 text-sm font-semibold transition-all ${
                billingPeriod === 'annual'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              Annual
              <span className="ml-1.5 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                Save 20%
              </span>
            </button>
          </div>
        </div>
      </section>

      {/* Pricing cards */}
      <section className="bg-white px-4 pb-20 pt-8 sm:px-6 sm:pb-24 lg:px-8">
        <div className="mx-auto grid max-w-6xl grid-cols-1 gap-6 md:grid-cols-3 md:items-start">
          {plans.map(plan => {
            const priceNum = parseInt(plan.price.replace('$', ''), 10)
            const displayPrice = billingPeriod === 'annual'
              ? `$${Math.round(priceNum * 0.8)}`
              : plan.price
            return (
              <PricingCardLocal
                key={plan.name}
                name={plan.name}
                price={displayPrice}
                period={billingPeriod === 'annual' ? 'month, billed annually' : plan.period}
                description={plan.description}
                features={plan.features}
                cta="Join the Waitlist"
                popular={plan.popular}
                onSelect={() => { setSelectedPlan(plan.name); setWaitlistOpen(true) }}
              />
            )
          })}
        </div>
      </section>

      {/* Waitlist Modal */}
      <Modal open={waitlistOpen} onClose={handleClose} maxWidth="max-w-lg">
        <div className="relative p-8">
          {/* X close button — top right */}
          <button
            onClick={handleClose}
            className="absolute right-4 top-4 rounded-lg p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
            aria-label="Close"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>

          {submitted ? (
            /* Success state */
            <div className="text-center py-4">
              <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50 mb-5">
                <svg className="h-7 w-7 text-emerald-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                </svg>
              </div>
              <h3 className="text-xl font-bold text-gray-900">You&apos;re on the list!</h3>
              <p className="mt-3 text-sm text-gray-500 leading-relaxed max-w-sm mx-auto">
                We&apos;ll notify you at <span className="font-semibold text-gray-700">{email}</span> as
                soon as RFP Pipeline launches on May 15, 2026. Beta testers get the first 3 months of Pipeline Engine free and priority access to our Builders.
              </p>
              <button
                onClick={handleClose}
                className="btn-primary mt-8 px-8 py-3 text-sm"
              >
                Got it
              </button>
            </div>
          ) : (
            /* Waitlist form */
            <>
              <div className="text-center mb-6">
                <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50">
                  <svg className="h-6 w-6 text-brand-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.59 14.37a6 6 0 0 1-5.84 7.38v-4.8m5.84-2.58a14.98 14.98 0 0 0 6.16-12.12A14.98 14.98 0 0 0 9.631 8.41m5.96 5.96a14.926 14.926 0 0 1-5.841 2.58m-.119-8.54a6 6 0 0 0-7.381 5.84h4.8m2.581-5.84a14.927 14.927 0 0 0-2.58 5.84m2.699 2.7c-.103.021-.207.041-.311.06a15.09 15.09 0 0 1-2.448-2.448 14.9 14.9 0 0 1 .06-.312m-2.24 2.39a4.493 4.493 0 0 0-1.757 4.306 4.493 4.493 0 0 0 4.306-1.758M16.5 9a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Z" />
                  </svg>
                </div>
                <h3 className="mt-4 text-xl font-bold text-gray-900">Join the Waitlist</h3>
                <p className="mt-2 text-sm text-gray-500">
                  Launching May 15, 2026. Beta testers get the first 3 months free.
                </p>
              </div>

              {selectedPlan && (
                <div className="rounded-xl bg-gray-50 p-4 mb-6">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-gray-900">{selectedPlan}</span>
                    <span className="text-sm font-bold text-gray-900">
                      {(() => {
                        const plan = plans.find(p => p.name === selectedPlan)
                        if (!plan) return ''
                        return `${plan.price}/${plan.period}`
                      })()}
                    </span>
                  </div>
                </div>
              )}

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
                      onChange={e => setPhone(e.target.value)}
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

                {/* Company Size — optional */}
                <div>
                  <label className="label">Company Size</label>
                  <select
                    className="input"
                    value={companySize}
                    onChange={e => setCompanySize(e.target.value)}
                  >
                    <option value="">Select...</option>
                    <option value="1-5">1-5 employees</option>
                    <option value="6-25">6-25 employees</option>
                    <option value="26-100">26-100 employees</option>
                    <option value="101-500">101-500 employees</option>
                    <option value="500+">500+ employees</option>
                  </select>
                </div>

                {/* Technology focus — optional */}
                <div>
                  <label className="label">Technology Focus</label>
                  <input
                    type="text"
                    className="input"
                    placeholder="e.g. AI/ML, cybersecurity, advanced materials..."
                    value={technology}
                    onChange={e => setTechnology(e.target.value)}
                  />
                </div>

                {/* Notes — optional */}
                <div>
                  <label className="label">Notes for the RFP Pipeline Team</label>
                  <textarea
                    className="input min-h-[72px] resize-y"
                    placeholder="Anything you'd like us to know..."
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
                  onClick={handleJoinWaitlist}
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
      </Modal>
    </>
  )
}

/** Inline PricingCard to avoid importing server component in client */
function PricingCardLocal({ name, price, period, description, features, cta, popular, onSelect }: {
  name: string; price: string; period: string; description: string
  features: string[]; cta: string; popular: boolean; onSelect: () => void
}) {
  return (
    <div className={`relative overflow-hidden rounded-2xl border bg-white p-7 shadow-card transition-all duration-300 hover:shadow-card-hover hover:-translate-y-1 ${popular ? 'border-brand-300 ring-2 ring-brand-500/20' : 'border-gray-200/80'}`}>
      {popular && (
        <div className="absolute right-4 top-4 rounded-full bg-brand-600 px-3 py-1 text-[10px] font-bold text-white">
          Most Popular
        </div>
      )}
      <h3 className="text-lg font-bold text-gray-900">{name}</h3>
      <div className="mt-3 flex items-baseline gap-1">
        <span className="text-4xl font-extrabold text-gray-900">{price}</span>
        <span className="text-sm text-gray-500">/{period}</span>
      </div>
      <p className="mt-3 text-sm text-gray-500">{description}</p>
      <ul className="mt-6 space-y-3">
        {features.map(f => (
          <li key={f} className="flex items-start gap-2 text-sm text-gray-600">
            <svg className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
            </svg>
            {f}
          </li>
        ))}
      </ul>
      <button onClick={onSelect} className={`mt-8 w-full rounded-xl py-3 text-sm font-bold transition-all ${popular ? 'btn-primary' : 'btn-secondary'}`}>
        {cta}
      </button>
    </div>
  )
}

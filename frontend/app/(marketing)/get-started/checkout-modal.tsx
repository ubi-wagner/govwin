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
  const [email, setEmail] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleJoinWaitlist = async () => {
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
        body: JSON.stringify({ email, plan: selectedPlan, billingPeriod }),
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
    // Reset form state after modal animation
    setTimeout(() => {
      setEmail('')
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
                cta="Join Waitlist"
                popular={plan.popular}
                onSelect={() => { setSelectedPlan(plan.name); setWaitlistOpen(true) }}
              />
            )
          })}
        </div>
      </section>

      {/* Waitlist Modal */}
      <Modal open={waitlistOpen} onClose={handleClose} maxWidth="max-w-md">
        <div className="p-8">
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
                <h3 className="mt-4 text-xl font-bold text-gray-900">SBIR/STTR Intelligence — Launching Soon</h3>
                <p className="mt-2 text-sm text-gray-500">
                  Your 24/7 SBIR/STTR lookout is almost ready.
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

              <p className="text-sm text-gray-600 leading-relaxed mb-6">
                Join the waitlist as a Beta Tester and get the <span className="font-semibold text-gray-900">first 3 months of Pipeline Engine free</span> and{' '}
                <span className="font-semibold text-gray-900">priority access to our Builders</span>. Launching May 15, 2026.
              </p>

              <div className="space-y-4">
                <div>
                  <label className="label">Email</label>
                  <input
                    type="email"
                    className="input"
                    placeholder="you@company.com"
                    value={email}
                    onChange={e => { setEmail(e.target.value); setError(null) }}
                  />
                </div>

                {error && (
                  <p className="text-sm text-red-600 font-medium">{error}</p>
                )}

                <button
                  className="btn-primary w-full py-3 text-base"
                  onClick={handleJoinWaitlist}
                  disabled={submitting}
                >
                  {submitting ? 'Joining...' : 'Join Waitlist'}
                </button>

                <p className="text-center text-xs text-gray-400 pt-2">
                  Questions? Contact us at{' '}
                  <a href="mailto:eric@rfppipeline.com" className="text-brand-600 hover:underline font-medium">
                    eric@rfppipeline.com
                  </a>
                </p>
              </div>

              <button onClick={handleClose} className="mt-4 w-full text-center text-xs font-medium text-gray-400 hover:text-gray-600 transition-colors">
                &larr; Back to plans
              </button>
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

'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Modal } from '@/components/page-sections'

/** Client wrapper: billing toggle + pricing cards + checkout modal */
export function InteractivePricingSection({
  plans,
}: {
  plans: { name: string; price: string; period: string; description: string; features: string[]; cta: string; popular: boolean }[]
}) {
  const [checkoutOpen, setCheckoutOpen] = useState(false)
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null)
  const [billingPeriod, setBillingPeriod] = useState<'monthly' | 'annual'>('monthly')

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
                cta={plan.cta}
                popular={plan.popular}
                onSelect={() => { setSelectedPlan(plan.name); setCheckoutOpen(true) }}
              />
            )
          })}
        </div>
      </section>

      {/* Checkout Modal */}
      <Modal open={checkoutOpen} onClose={() => setCheckoutOpen(false)} maxWidth="max-w-md">
        <div className="p-8">
          <div className="flex items-center justify-center gap-2 text-xs font-medium text-gray-400 mb-6">
            <span className="text-brand-600 font-bold">1. Choose Plan</span>
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
            </svg>
            <span className="font-bold text-gray-900">2. Payment</span>
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
            </svg>
            <span>3. Setup</span>
          </div>

          <div className="text-center mb-6">
            <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50">
              <svg className="h-6 w-6 text-brand-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 0 0 2.25-2.25V6.75A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25v10.5A2.25 2.25 0 0 0 4.5 19.5Z" />
              </svg>
            </div>
            <h3 className="mt-3 text-lg font-bold text-gray-900">Subscribe to {selectedPlan}</h3>
            <p className="mt-1 text-sm text-gray-500">
              {billingPeriod === 'annual' ? 'Billed annually' : 'Billed monthly'} &middot; Cancel anytime
            </p>
          </div>

          <div className="rounded-xl bg-gray-50 p-4 mb-6">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-gray-900">{selectedPlan} Plan</span>
              <span className="text-sm font-bold text-gray-900">
                {selectedPlan && (() => {
                  const plan = plans.find(p => p.name === selectedPlan)
                  if (!plan) return ''
                  const price = parseInt(plan.price.replace('$', ''), 10)
                  return billingPeriod === 'annual'
                    ? `$${Math.round(price * 0.8)}/mo`
                    : `${plan.price}/mo`
                })()}
              </span>
            </div>
            {billingPeriod === 'annual' && (
              <p className="mt-1 text-xs text-emerald-600 font-medium">You save 20% with annual billing</p>
            )}
          </div>

          <div className="space-y-4">
            <div>
              <label className="label">Email</label>
              <input type="email" className="input" placeholder="you@company.com" />
            </div>
            <div>
              <label className="label">Card Information</label>
              <div className="rounded-xl border border-gray-300 bg-white p-4 text-center">
                <div className="flex items-center justify-center gap-2 text-gray-400">
                  <svg className="h-8 w-8" viewBox="0 0 32 32" fill="none">
                    <rect x="1" y="6" width="30" height="20" rx="3" stroke="currentColor" strokeWidth="1.5" />
                    <rect x="1" y="10" width="30" height="4" fill="currentColor" opacity="0.15" />
                    <rect x="4" y="18" width="8" height="3" rx="1" fill="currentColor" opacity="0.2" />
                  </svg>
                </div>
                <p className="mt-2 text-xs text-gray-400">Stripe integration placeholder</p>
                <p className="mt-1 text-[10px] text-gray-300">Payment processing will be connected here</p>
              </div>
            </div>

            {/* Legal agreement — required before checkout */}
            <div className="rounded-xl bg-gray-50 border border-gray-200 p-4 space-y-3">
              <p className="text-xs font-semibold text-gray-700">Legal Agreement</p>
              <label className="flex items-start gap-2 cursor-pointer">
                <input type="checkbox" className="mt-0.5 h-3.5 w-3.5 rounded border-gray-300 text-brand-600 focus:ring-brand-500" />
                <span className="text-[11px] text-gray-600 leading-relaxed">
                  I represent that I am authorized to act on behalf of my organization.
                  As Account Administrator, I accept responsibility for all users I add to this account.
                </span>
              </label>
              <label className="flex items-start gap-2 cursor-pointer">
                <input type="checkbox" className="mt-0.5 h-3.5 w-3.5 rounded border-gray-300 text-brand-600 focus:ring-brand-500" />
                <span className="text-[11px] text-gray-600 leading-relaxed">
                  I agree to the{' '}
                  <Link href="/legal/terms" target="_blank" className="text-brand-600 underline">Terms of Service</Link>,{' '}
                  <Link href="/legal/privacy" target="_blank" className="text-brand-600 underline">Privacy Policy</Link>, and{' '}
                  <Link href="/legal/ai-disclosure" target="_blank" className="text-brand-600 underline">AI Disclosure</Link>.
                </span>
              </label>
            </div>

            <button className="btn-primary w-full py-3 text-base" onClick={() => setCheckoutOpen(false)}>
              Subscribe &middot; Start 14-Day Trial
            </button>
            <div className="flex items-center justify-center gap-4 pt-2">
              <div className="flex items-center gap-1 text-[10px] text-gray-400">
                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
                </svg>
                Secure checkout
              </div>
              <div className="flex items-center gap-1 text-[10px] text-gray-400">
                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" />
                </svg>
                256-bit encryption
              </div>
              <span className="text-[10px] font-medium text-gray-400">Powered by Stripe</span>
            </div>
          </div>
          <button onClick={() => setCheckoutOpen(false)} className="mt-4 w-full text-center text-xs font-medium text-gray-400 hover:text-gray-600 transition-colors">
            &larr; Back to plans
          </button>
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

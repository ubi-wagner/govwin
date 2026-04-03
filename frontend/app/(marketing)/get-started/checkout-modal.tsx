'use client'

import { useState } from 'react'

/** Client wrapper: billing toggle + pricing cards — clicks dispatch to global WaitlistModal */
export function InteractivePricingSection({
  plans,
}: {
  plans: { name: string; price: string; period: string; description: string; features: string[]; cta: string; popular: boolean }[]
}) {
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
                cta="Join the Waitlist"
                popular={plan.popular}
                onSelect={() => {
                  // Dispatch custom event that the global WaitlistModal listens for
                  window.dispatchEvent(new CustomEvent('open-waitlist'))
                }}
              />
            )
          })}
        </div>
      </section>
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

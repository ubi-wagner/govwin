'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Section, SectionHeader, PricingCard, Modal } from '@/components/page-sections'

const plans = [
  {
    name: 'Starter',
    price: '$49',
    period: 'month',
    description: 'Perfect for small businesses exploring federal contracting.',
    features: [
      'Up to 50 scored opportunities/month',
      '1 user workspace',
      '3 NAICS code profiles',
      'Weekly email digest',
      'SAM.gov opportunity scanning',
      'Basic deadline alerts',
    ],
    cta: 'Start Free Trial',
    popular: false,
  },
  {
    name: 'Professional',
    price: '$149',
    period: 'month',
    description: 'For active bidders who need a competitive edge.',
    features: [
      'Unlimited scored opportunities',
      'Up to 5 user workspaces',
      'Unlimited NAICS code profiles',
      'Daily email digest + real-time alerts',
      'AI-powered scoring & ranking',
      'Set-aside matching',
      'Document management',
      'Priority support',
    ],
    cta: 'Start Free Trial',
    popular: true,
  },
  {
    name: 'Enterprise',
    price: '$399',
    period: 'month',
    description: 'For teams and accelerators managing multiple pipelines.',
    features: [
      'Everything in Professional',
      'Unlimited user workspaces',
      'Multi-tenant management',
      'Batch onboarding (accelerator cohorts)',
      'Custom scoring profiles',
      'API access',
      'Dedicated account manager',
      'SSO & advanced security',
    ],
    cta: 'Contact Sales',
    popular: false,
  },
]

const faqs = [
  {
    q: 'How does the free trial work?',
    a: 'You get 14 days of full access to your selected plan. No credit card required to start. You can upgrade, downgrade, or cancel at any time.',
  },
  {
    q: 'Can I change plans later?',
    a: 'Absolutely. Upgrade or downgrade at any time. Changes take effect at your next billing cycle. No penalties or hidden fees.',
  },
  {
    q: 'Do you offer annual billing?',
    a: 'Yes — annual plans save you 20%. Contact us for a custom annual agreement with additional perks.',
  },
  {
    q: 'What payment methods do you accept?',
    a: 'We accept all major credit cards (Visa, Mastercard, Amex) and ACH bank transfers for annual plans. Processed securely via Stripe.',
  },
  {
    q: 'Is there a setup fee?',
    a: 'No setup fees, ever. Your workspace is provisioned instantly when you subscribe. We help you configure your scoring profile during onboarding.',
  },
  {
    q: 'Do you offer discounts for startups or nonprofits?',
    a: 'Yes. SBIR/STTR applicants and registered nonprofits qualify for 25% off any plan. Contact our team to apply.',
  },
]

export default function GetStartedPage() {
  const [checkoutOpen, setCheckoutOpen] = useState(false)
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null)
  const [billingPeriod, setBillingPeriod] = useState<'monthly' | 'annual'>('monthly')

  function handleSelectPlan(planName: string) {
    setSelectedPlan(planName)
    setCheckoutOpen(true)
  }

  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden bg-white px-4 pt-16 pb-8 sm:px-6 sm:pt-24 sm:pb-12 lg:px-8">
        <div className="absolute inset-0 -z-10 bg-hero-mesh" />
        <div className="mx-auto max-w-4xl text-center">
          <div className="inline-flex items-center rounded-full bg-brand-50 px-4 py-1.5 text-xs font-bold text-brand-700 ring-1 ring-brand-600/10">
            14-day free trial &middot; No credit card required
          </div>
          <h1 className="mt-6 text-4xl font-extrabold tracking-tight text-gray-900 sm:text-5xl">
            Choose the plan that fits your{' '}
            <span className="bg-gradient-to-r from-brand-600 to-cyan-500 bg-clip-text text-transparent">
              mission
            </span>
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-gray-600">
            Start with a free trial on any plan. Scale as your pipeline grows.
          </p>
        </div>
      </section>

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
              <PricingCard
                key={plan.name}
                name={plan.name}
                price={displayPrice}
                period={billingPeriod === 'annual' ? 'month, billed annually' : plan.period}
                description={plan.description}
                features={plan.features}
                cta={plan.cta}
                popular={plan.popular}
                onSelect={() => handleSelectPlan(plan.name)}
              />
            )
          })}
        </div>
      </section>

      {/* Feature comparison */}
      <Section className="bg-surface-50">
        <SectionHeader
          eyebrow="Compare Plans"
          title="Everything included at a glance"
        />
        <div className="mt-12 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="py-4 pr-4 text-sm font-bold text-gray-900 w-1/3">Feature</th>
                <th className="px-4 py-4 text-center text-sm font-bold text-gray-900">Starter</th>
                <th className="px-4 py-4 text-center text-sm font-bold text-brand-600">Professional</th>
                <th className="pl-4 py-4 text-center text-sm font-bold text-gray-900">Enterprise</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {[
                ['Scored Opportunities', '50/mo', 'Unlimited', 'Unlimited'],
                ['User Workspaces', '1', '5', 'Unlimited'],
                ['NAICS Profiles', '3', 'Unlimited', 'Unlimited'],
                ['SAM.gov Scanning', true, true, true],
                ['AI Scoring & Ranking', false, true, true],
                ['Set-Aside Matching', false, true, true],
                ['Deadline Alerts', 'Basic', 'Real-time', 'Real-time'],
                ['Document Management', false, true, true],
                ['Multi-Tenant', false, false, true],
                ['API Access', false, false, true],
                ['Support', 'Email', 'Priority', 'Dedicated'],
              ].map(([feature, starter, pro, enterprise], i) => (
                <tr key={i} className="hover:bg-white transition-colors">
                  <td className="py-3.5 pr-4 text-sm text-gray-700">{feature}</td>
                  <td className="px-4 py-3.5 text-center">{renderCell(starter)}</td>
                  <td className="px-4 py-3.5 text-center bg-brand-50/30">{renderCell(pro)}</td>
                  <td className="pl-4 py-3.5 text-center">{renderCell(enterprise)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {/* FAQ */}
      <Section className="bg-white">
        <SectionHeader
          eyebrow="FAQ"
          title="Common questions"
        />
        <div className="mx-auto mt-12 max-w-3xl divide-y divide-gray-100">
          {faqs.map((faq, i) => (
            <div key={i} className="py-5">
              <h3 className="text-sm font-bold text-gray-900">{faq.q}</h3>
              <p className="mt-2 text-sm leading-relaxed text-gray-500">{faq.a}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* Contact CTA */}
      <section className="relative overflow-hidden bg-cta-gradient px-4 py-20 sm:px-6 sm:py-24 lg:px-8">
        <div className="absolute -left-20 -top-20 h-60 w-60 rounded-full bg-brand-500/10 blur-3xl" />
        <div className="absolute -bottom-20 -right-20 h-60 w-60 rounded-full bg-cyan-500/10 blur-3xl" />
        <div className="relative mx-auto max-w-3xl text-center">
          <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
            Need a custom solution?
          </h2>
          <p className="mt-4 text-lg text-gray-300">
            For accelerator programs, government agencies, or large teams — let&apos;s talk about a tailored plan.
          </p>
          <div className="mt-8 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
            <a
              href="mailto:eric@rfppipeline.com"
              className="btn-cta bg-white text-brand-700 hover:bg-gray-100 shadow-xl"
            >
              Contact Sales
              <svg className="ml-2 h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" />
              </svg>
            </a>
            <Link href="/about" className="group text-sm font-semibold text-gray-300 hover:text-white transition-colors">
              Learn more about us
              <span className="ml-1 inline-block transition-transform group-hover:translate-x-0.5">&rarr;</span>
            </Link>
          </div>
        </div>
      </section>

      {/* ── Stripe Checkout Modal ── */}
      <Modal open={checkoutOpen} onClose={() => setCheckoutOpen(false)} maxWidth="max-w-md">
        <div className="p-8">
          {/* Progress breadcrumb */}
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
            <h3 className="mt-3 text-lg font-bold text-gray-900">
              Subscribe to {selectedPlan}
            </h3>
            <p className="mt-1 text-sm text-gray-500">
              {billingPeriod === 'annual' ? 'Billed annually' : 'Billed monthly'} &middot; Cancel anytime
            </p>
          </div>

          {/* Plan summary */}
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
              <p className="mt-1 text-xs text-emerald-600 font-medium">
                You save 20% with annual billing
              </p>
            )}
          </div>

          {/* Stripe placeholder form */}
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
                <p className="mt-2 text-xs text-gray-400">
                  Stripe integration placeholder
                </p>
                <p className="mt-1 text-[10px] text-gray-300">
                  Payment processing will be connected here
                </p>
              </div>
            </div>

            <button
              className="btn-primary w-full py-3 text-base"
              onClick={() => {
                setCheckoutOpen(false)
                // Stripe checkout will be integrated here
              }}
            >
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

          {/* Back button */}
          <button
            onClick={() => setCheckoutOpen(false)}
            className="mt-4 w-full text-center text-xs font-medium text-gray-400 hover:text-gray-600 transition-colors"
          >
            &larr; Back to plans
          </button>
        </div>
      </Modal>
    </>
  )
}

function renderCell(value: boolean | string | undefined) {
  if (value === true) {
    return (
      <svg className="mx-auto h-5 w-5 text-brand-600" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
      </svg>
    )
  }
  if (value === false) {
    return <span className="text-gray-300">&mdash;</span>
  }
  return <span className="text-sm text-gray-700 font-medium">{value}</span>
}

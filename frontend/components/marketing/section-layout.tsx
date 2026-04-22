/**
 * Marketing section components — CMS-ready building blocks.
 *
 * Every prop is serializable text, numbers, enums, or href strings.
 * A future CMS can populate any of these sections by pushing JSON
 * into the component's props, with zero React changes needed.
 *
 * Design goals:
 *   - All variants controlled by enum props (no className overrides)
 *   - No inline images/svgs — CMS can add an `icon` name later
 *   - Every section has explicit top/bottom padding tied to the
 *     semantic hierarchy (hero > primary > secondary > footer-cta)
 */

import Link from 'next/link';
import type { ReactNode } from 'react';

// ─── Hero ────────────────────────────────────────────────────────────

export interface HeroProps {
  eyebrow?: string;
  headline: string | ReactNode;
  subheadline?: string;
  primaryCta?: { label: string; href: string };
  secondaryCta?: { label: string; href: string };
  note?: string;
  variant?: 'dark' | 'light';
}

export function Hero({
  eyebrow,
  headline,
  subheadline,
  primaryCta,
  secondaryCta,
  note,
  variant = 'dark',
}: HeroProps) {
  const isDark = variant === 'dark';
  return (
    <section className={isDark ? 'bg-gradient-to-b from-navy-900 to-navy-800' : 'bg-gradient-to-b from-gray-50 to-white'}>
      <div className="max-w-6xl mx-auto px-6 py-24 md:py-36">
        <div className="max-w-3xl">
          {eyebrow && (
            <p className={`text-sm font-semibold uppercase tracking-wider mb-4 ${isDark ? 'text-brand-400' : 'text-brand-600'}`}>
              {eyebrow}
            </p>
          )}
          <h1 className={`font-display text-4xl md:text-6xl font-bold leading-tight ${isDark ? 'text-white' : 'text-navy-800'}`}>
            {headline}
          </h1>
          {subheadline && (
            <p className={`mt-8 text-lg md:text-xl leading-relaxed ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
              {subheadline}
            </p>
          )}
          {(primaryCta || secondaryCta) && (
            <div className="mt-10 flex flex-col sm:flex-row gap-4">
              {primaryCta && (
                <Link
                  href={primaryCta.href}
                  className="inline-flex items-center justify-center px-8 py-4 bg-brand-600 hover:bg-brand-500 text-white text-lg font-semibold rounded-lg shadow-lg transition-all hover:shadow-xl"
                >
                  {primaryCta.label}
                </Link>
              )}
              {secondaryCta && (
                <Link
                  href={secondaryCta.href}
                  className={`inline-flex items-center justify-center px-8 py-4 border rounded-lg text-lg font-semibold transition-colors ${
                    isDark
                      ? 'border-gray-500 hover:border-brand-400 text-gray-300 hover:text-white'
                      : 'border-gray-300 hover:border-brand-400 text-gray-700 hover:text-brand-700'
                  }`}
                >
                  {secondaryCta.label}
                </Link>
              )}
            </div>
          )}
          {note && <p className={`mt-6 text-sm ${isDark ? 'text-gray-500' : 'text-gray-500'}`}>{note}</p>}
        </div>
      </div>
    </section>
  );
}

// ─── SectionHeader ───────────────────────────────────────────────────

export interface SectionHeaderProps {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  align?: 'left' | 'center';
}

export function SectionHeader({ eyebrow, title, subtitle, align = 'center' }: SectionHeaderProps) {
  return (
    <div className={align === 'center' ? 'text-center max-w-3xl mx-auto' : 'max-w-3xl'}>
      {eyebrow && (
        <p className="text-sm font-semibold text-brand-600 uppercase tracking-wider mb-3">
          {eyebrow}
        </p>
      )}
      <h2 className="font-display text-3xl md:text-4xl font-bold text-navy-800">{title}</h2>
      {subtitle && <p className="mt-4 text-lg text-gray-600 leading-relaxed">{subtitle}</p>}
    </div>
  );
}

// ─── Section wrapper (consistent padding + background) ──────────────

export interface SectionProps {
  variant?: 'white' | 'gray' | 'dark';
  children: ReactNode;
  border?: boolean;
}

export function Section({ variant = 'white', children, border = true }: SectionProps) {
  const bg = variant === 'dark' ? 'bg-navy-900' : variant === 'gray' ? 'bg-gray-50' : 'bg-white';
  return (
    <section className={`${bg} ${border ? 'border-t' : ''}`}>
      <div className="max-w-6xl mx-auto px-6 py-20 md:py-28">{children}</div>
    </section>
  );
}

// ─── FeatureGrid ─────────────────────────────────────────────────────

export interface FeatureItem {
  title: string;
  body: string;
  number?: string;
}

export interface FeatureGridProps {
  columns?: 2 | 3 | 4;
  items: FeatureItem[];
  variant?: 'plain' | 'bordered';
}

export function FeatureGrid({ columns = 3, items, variant = 'bordered' }: FeatureGridProps) {
  const gridCols = columns === 2 ? 'md:grid-cols-2' : columns === 4 ? 'sm:grid-cols-2 md:grid-cols-4' : 'md:grid-cols-3';
  return (
    <div className={`grid gap-6 md:gap-8 ${gridCols}`}>
      {items.map((item, i) => (
        <div
          key={i}
          className={
            variant === 'bordered'
              ? 'p-6 rounded-lg border border-gray-200 bg-white hover:border-brand-300 hover:shadow-sm transition-all'
              : 'p-6'
          }
        >
          {item.number && (
            <span className="text-5xl font-bold text-brand-100 font-display block">{item.number}</span>
          )}
          <h3 className={`font-display text-xl font-semibold text-navy-800 ${item.number ? 'mt-2' : ''}`}>
            {item.title}
          </h3>
          <p className="mt-3 text-gray-600 leading-relaxed">{item.body}</p>
        </div>
      ))}
    </div>
  );
}

// ─── PricingTier ─────────────────────────────────────────────────────

export interface PricingTierProps {
  label?: string;
  name: string;
  price: string;
  period?: string;
  description?: string;
  features: string[];
  cta?: { label: string; href: string };
  highlighted?: boolean;
}

export function PricingTier({
  label, name, price, period, description, features, cta, highlighted,
}: PricingTierProps) {
  return (
    <div className={`p-8 rounded-xl border-2 flex flex-col ${
      highlighted ? 'border-brand-500 bg-white shadow-xl ring-4 ring-brand-100' : 'border-gray-200 bg-white'
    }`}>
      {label && (
        <p className="text-xs font-semibold text-brand-600 uppercase tracking-wider">{label}</p>
      )}
      <h3 className="mt-2 font-display text-2xl font-bold text-navy-800">{name}</h3>
      <div className="mt-3 flex items-baseline gap-2">
        <span className="text-3xl font-bold text-navy-800 font-display">{price}</span>
        {period && <span className="text-gray-500 text-sm">{period}</span>}
      </div>
      {description && <p className="mt-2 text-sm text-gray-500">{description}</p>}
      <ul className="mt-6 space-y-3 flex-1">
        {features.map((f) => (
          <li key={f} className="flex items-start gap-2 text-sm text-gray-700">
            <svg className="mt-0.5 w-4 h-4 text-brand-500 shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
            </svg>
            <span>{f}</span>
          </li>
        ))}
      </ul>
      {cta && (
        <Link
          href={cta.href}
          className={`mt-8 inline-flex items-center justify-center px-5 py-3 rounded-lg font-semibold transition-colors ${
            highlighted
              ? 'bg-brand-600 hover:bg-brand-500 text-white'
              : 'bg-gray-100 hover:bg-gray-200 text-navy-800'
          }`}
        >
          {cta.label}
        </Link>
      )}
    </div>
  );
}

// ─── ProcessStep ─────────────────────────────────────────────────────

export interface ProcessStepProps {
  number: string;
  title: string;
  body: string;
  details?: string[];
}

export function ProcessStep({ number, title, body, details }: ProcessStepProps) {
  return (
    <div className="relative flex gap-6 pb-10 last:pb-0">
      <div className="shrink-0">
        <div className="w-12 h-12 rounded-full bg-brand-600 text-white font-bold font-display flex items-center justify-center text-lg">
          {number}
        </div>
      </div>
      <div className="flex-1 pb-2">
        <h3 className="font-display text-xl font-semibold text-navy-800">{title}</h3>
        <p className="mt-2 text-gray-600 leading-relaxed">{body}</p>
        {details && details.length > 0 && (
          <ul className="mt-4 space-y-2">
            {details.map((d, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-gray-600">
                <span className="mt-1.5 w-1.5 h-1.5 bg-brand-500 rounded-full shrink-0" />
                {d}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ─── CtaSection ──────────────────────────────────────────────────────

export interface CtaSectionProps {
  eyebrow?: string;
  headline: string;
  subheadline?: string;
  cta: { label: string; href: string };
  note?: string;
  variant?: 'dark' | 'gradient';
}

export function CtaSection({ eyebrow, headline, subheadline, cta, note, variant = 'dark' }: CtaSectionProps) {
  return (
    <section className={variant === 'gradient' ? 'bg-gradient-to-r from-brand-700 to-navy-900' : 'bg-navy-900'}>
      <div className="max-w-4xl mx-auto px-6 py-20 text-center">
        {eyebrow && (
          <p className="text-sm font-semibold text-brand-300 uppercase tracking-wider mb-3">{eyebrow}</p>
        )}
        <h2 className="font-display text-3xl md:text-4xl font-bold text-white">{headline}</h2>
        {subheadline && (
          <p className="mt-4 text-lg text-gray-300 max-w-2xl mx-auto leading-relaxed">{subheadline}</p>
        )}
        <Link
          href={cta.href}
          className="mt-10 inline-flex items-center justify-center px-10 py-4 bg-brand-600 hover:bg-brand-500 text-white text-lg font-semibold rounded-lg shadow-lg transition-all hover:shadow-xl"
        >
          {cta.label}
        </Link>
        {note && <p className="mt-4 text-sm text-gray-500">{note}</p>}
      </div>
    </section>
  );
}

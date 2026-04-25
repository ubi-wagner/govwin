/**
 * CSS-only wordmark matching RFP Pipeline Logo V0.4.
 *
 * "RFP" in bold black sans-serif caps, "Pipeline" in italic serif
 * coral red, with the APPLY · CURATE · DRAFT · WIN tagline below.
 *
 * Two variants: 'light' (dark text on light bg) and 'dark' (white +
 * citrus on dark bg). Matches the A1/A3 compact horizontal treatment.
 */

import Link from 'next/link';

interface Props {
  variant?: 'light' | 'dark';
  size?: 'sm' | 'md' | 'lg';
  showTagline?: boolean;
  className?: string;
}

const sizes = {
  sm: { rfp: 'text-xl', pipeline: 'text-xl', tagline: 'text-[8px]', gap: 'gap-0.5', arrow: 'h-[2px]' },
  md: { rfp: 'text-3xl', pipeline: 'text-3xl', tagline: 'text-[10px]', gap: 'gap-1', arrow: 'h-[3px]' },
  lg: { rfp: 'text-5xl', pipeline: 'text-5xl', tagline: 'text-xs', gap: 'gap-1.5', arrow: 'h-1' },
};

export function Wordmark({ variant = 'light', size = 'md', showTagline = false, className = '' }: Props) {
  const s = sizes[size];
  const isDark = variant === 'dark';

  return (
    <Link href="/" className={`inline-block ${className}`} aria-label="RFP Pipeline — Home">
      <div className="flex items-baseline">
        <span
          className={`font-display font-black tracking-tight ${s.rfp} ${
            isDark ? 'text-white' : 'text-navy-900'
          }`}
        >
          RFP
        </span>
        <span
          className={`font-prose italic ${s.pipeline} ml-1 ${
            isDark ? 'text-citrus-400' : 'text-brand-500'
          }`}
        >
          Pipeline
        </span>
      </div>
      {/* Arrow + green dot */}
      <div className={`flex items-center ${s.gap} mt-0.5`}>
        <div
          className={`flex-1 ${s.arrow} rounded-full ${
            isDark
              ? 'bg-gradient-to-r from-citrus-600 to-citrus-400'
              : 'bg-gradient-to-r from-brand-400 to-brand-500'
          }`}
        />
        <div className="w-2 h-2 rounded-full bg-award shrink-0" />
      </div>
      {showTagline && (
        <div
          className={`${s.tagline} tracking-[0.35em] uppercase font-display font-medium mt-1.5 ${
            isDark ? 'text-gray-400' : 'text-navy-400'
          }`}
        >
          Apply &middot; Curate &middot; Draft &middot; Win
        </div>
      )}
    </Link>
  );
}

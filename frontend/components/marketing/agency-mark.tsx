/**
 * AgencyMark — tasteful, ORIGINAL vector marks that evoke the federal R&D
 * agencies our customers pursue. These are decorative, minimalist, single-color
 * (currentColor) graphics in our own house style — deliberately NOT reproductions
 * of official government seals/insignia (which we must not imitate). Use them as
 * inline placeholders/accents wherever the copy references an agency or program.
 *
 *   <AgencyMark name="airforce" className="h-10 w-10 text-brand-600" />
 *
 * All marks share a 0 0 48 48 viewBox and inherit color + size from className.
 */

import type { SVGProps, ReactNode } from 'react';

export type AgencyName =
  | 'airforce' | 'navy' | 'army' | 'dod' | 'darpa'
  | 'nsf' | 'doe' | 'sbir' | 'federal';

const P: Record<AgencyName, ReactNode> = {
  // Air Force — ascending twin wings + a star (aerospace ascent).
  airforce: (
    <>
      <path d="M24 7l3 5 6 2-6 2-3 5-3-5-6-2 6-2 3-5z" fill="currentColor" opacity="0.9" />
      <path d="M8 30c6-3 11-4 16-4s10 1 16 4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M11 36c5-2.4 9-3.4 13-3.4s8 1 13 3.4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.55" />
    </>
  ),
  // Navy — an anchor.
  navy: (
    <>
      <circle cx="24" cy="11" r="3.4" fill="none" stroke="currentColor" strokeWidth="2.2" />
      <path d="M24 14.4V38" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M16 24h16" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M11 28c1.5 6 6.5 10 13 10s11.5-4 13-10" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
    </>
  ),
  // Army — bold chevrons (rank) under a star.
  army: (
    <>
      <path d="M24 8l2.2 4 4.4 1.4-4.4 1.4L24 20l-2.2-4.2-4.4-1.4 4.4-1.4L24 8z" fill="currentColor" />
      <path d="M13 26l11-6 11 6M13 33l11-6 11 6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  // DoD — a pentagon with a center star.
  dod: (
    <>
      <path d="M24 7l16 11.6-6.1 18.8H14.1L8 18.6 24 7z" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" />
      <path d="M24 18l1.9 3.9 4.3.6-3.1 3 .7 4.3-3.8-2-3.8 2 .7-4.3-3.1-3 4.3-.6L24 18z" fill="currentColor" />
    </>
  ),
  // DARPA — connected research nodes (a small graph).
  darpa: (
    <>
      <path d="M12 14l12 6 12-8M12 14v18l12 6 12-6V18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" opacity="0.5" />
      <circle cx="12" cy="14" r="3.2" fill="currentColor" />
      <circle cx="36" cy="12" r="3.2" fill="currentColor" />
      <circle cx="24" cy="20" r="3.6" fill="currentColor" />
      <circle cx="12" cy="32" r="3.2" fill="currentColor" />
      <circle cx="36" cy="30" r="3.2" fill="currentColor" />
      <circle cx="24" cy="40" r="3.2" fill="currentColor" />
    </>
  ),
  // NSF — an atom (orbits + nucleus).
  nsf: (
    <>
      <circle cx="24" cy="24" r="3" fill="currentColor" />
      <ellipse cx="24" cy="24" rx="16" ry="6.5" fill="none" stroke="currentColor" strokeWidth="2" />
      <ellipse cx="24" cy="24" rx="16" ry="6.5" fill="none" stroke="currentColor" strokeWidth="2" transform="rotate(60 24 24)" />
      <ellipse cx="24" cy="24" rx="16" ry="6.5" fill="none" stroke="currentColor" strokeWidth="2" transform="rotate(120 24 24)" />
    </>
  ),
  // DOE — an energy bolt in a ring.
  doe: (
    <>
      <circle cx="24" cy="24" r="16" fill="none" stroke="currentColor" strokeWidth="2.2" opacity="0.55" />
      <path d="M26 12l-9 14h6l-2 10 9-14h-6l2-10z" fill="currentColor" />
    </>
  ),
  // SBIR/STTR — a small-business R&D rocket.
  sbir: (
    <>
      <path d="M24 6c5 4 7.5 9.5 7.5 16 0 3.5-.7 6.7-2 9.5h-11c-1.3-2.8-2-6-2-9.5C16.5 15.5 19 10 24 6z" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" />
      <circle cx="24" cy="19" r="3.2" fill="currentColor" />
      <path d="M18.5 31l-4 5 4-1M29.5 31l4 5-4-1" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M24 34v6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </>
  ),
  // Generic federal — a shield with a star.
  federal: (
    <>
      <path d="M24 7l14 5v9c0 9-6 15.5-14 19-8-3.5-14-10-14-19v-9l14-5z" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" />
      <path d="M24 16l1.9 3.9 4.3.6-3.1 3 .7 4.3-3.8-2-3.8 2 .7-4.3-3.1-3 4.3-.6L24 16z" fill="currentColor" />
    </>
  ),
};

const ALIASES: Record<string, AgencyName> = {
  'air force': 'airforce', usaf: 'airforce', af: 'airforce', aerospace: 'airforce',
  'us navy': 'navy', naval: 'navy', usn: 'navy', maritime: 'navy',
  'us army': 'army', usa: 'army',
  'department of defense': 'dod', defense: 'dod', dhs: 'dod',
  'nsf': 'nsf', 'national science foundation': 'nsf',
  'doe': 'doe', 'department of energy': 'doe', energy: 'doe',
  'sbir': 'sbir', sttr: 'sbir', sba: 'sbir', 'small business': 'sbir',
  darpa: 'darpa',
};

export function resolveAgency(raw: string): AgencyName {
  const k = raw.trim().toLowerCase();
  if (k in P) return k as AgencyName;
  return ALIASES[k] ?? 'federal';
}

interface AgencyMarkProps extends SVGProps<SVGSVGElement> {
  name: string;
  title?: string;
}

export function AgencyMark({ name, title, ...props }: AgencyMarkProps) {
  const key = resolveAgency(name);
  return (
    <svg viewBox="0 0 48 48" fill="none" role={title ? 'img' : 'presentation'} aria-hidden={title ? undefined : true} {...props}>
      {title && <title>{title}</title>}
      {P[key]}
    </svg>
  );
}

export default AgencyMark;

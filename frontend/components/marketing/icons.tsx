/**
 * MarketingIcon — bespoke line-art icons for the marketing content buckets.
 *
 * Same grammar as components/marketing/diagrams.tsx: hand-drawn SVG, no icon
 * fonts, no emoji. Every icon is a 24×24 single-stroke drawing that inherits its
 * color from the caller via `currentColor` (set a Tailwind `text-*` class), so it
 * tracks the RFP Pipeline palette. A few use a filled accent (sparkle, medal star)
 * or drawn vector text (a "$") — also currentColor.
 *
 * Icons are keyed by a stable NAME stored in a block's `metadata.icon`, so they
 * are fully editable/toggle-able from the admin editor (change the name, or clear
 * it). An unknown/empty name renders nothing — never a raw string or emoji.
 */
import type { ReactNode } from 'react';

const display = { fontFamily: 'var(--font-display, inherit)' } as const;

// name -> { label (a11y), paths }. Paths assume a 0 0 24 24 viewBox, stroke
// driven by the parent <svg> (currentColor, round caps/joins).
const ICONS: Record<string, { label: string; paths: ReactNode }> = {
  // ── Features ──────────────────────────────────────────────────────────
  // Source Scout — a targeting scope/crosshair locking onto funding ($).
  'source-scout': {
    label: 'Source Scout',
    paths: (
      <>
        <circle cx="10.5" cy="10.5" r="6.6" />
        <path d="M10.5 1.6v2.3M10.5 16.7v2.3M1.6 10.5h2.3M16.7 10.5h2.3" />
        <path d="M15.4 15.4 21 21" />
        <text x="10.5" y="13.9" textAnchor="middle" fontSize="9.5" fontWeight={700} fill="currentColor" stroke="none" style={display}>$</text>
      </>
    ),
  },
  // RFP Curation — scattered pages resolved into a structured, ordered outline.
  curation: {
    label: 'RFP Curation',
    paths: (
      <>
        <rect x="2.4" y="6.3" width="7" height="9" rx="1.2" transform="rotate(-13 5.9 10.8)" />
        <rect x="4.2" y="5" width="7" height="9" rx="1.2" transform="rotate(7 7.7 9.5)" />
        <path d="M12.5 12h2.4m-1.1-1.2L14.9 12l-1.1 1.2" />
        <rect x="16.1" y="4.4" width="5.7" height="15.2" rx="1.2" />
        <path d="M17.6 8.1h2.7M17.6 11.1h2.7M17.6 14.1h2.7M17.6 17.1h1.6" />
      </>
    ),
  },
  // Spotlight Feed — a ranked feed with the top match highlighted (sparkle).
  spotlight: {
    label: 'Spotlight Feed',
    paths: (
      <>
        <rect x="3" y="3.6" width="18" height="16.8" rx="2.4" />
        <path d="M7.4 6.6c.2 1.7.5 2 2.2 2.2-1.7.2-2 .5-2.2 2.2-.2-1.7-.5-2-2.2-2.2 1.7-.2 2-.5 2.2-2.2Z" fill="currentColor" stroke="none" />
        <path d="M11.8 8.8h6" />
        <path d="M6.4 13.6h11.2M6.4 16.8h7.6" />
      </>
    ),
  },
  // Proposal Workspace — a structured window with stage-gated lanes + a passed gate.
  workspace: {
    label: 'Proposal Workspace',
    paths: (
      <>
        <rect x="3" y="4" width="18" height="16" rx="2.2" />
        <path d="M3 8.2h18M9 8.2V20M15 8.2V20" />
        <path d="M10.2 13.4l1.1 1.1 2.3-2.5" />
      </>
    ),
  },
  // AI Drafting — a page being drafted (pen) with an AI spark.
  'ai-drafting': {
    label: 'AI Drafting',
    paths: (
      <>
        <path d="M6 3.6h6.8L17 7.8v8.6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8.8a2 2 0 0 1 2-2Z" />
        <path d="M12.6 3.6V8H17" />
        <path d="M6.8 11h5.2M6.8 13.7h3.6" />
        <path d="M9.4 18.4l5-5 1.8 1.8-5 5-2.3.5z" />
        <path d="M19.4 3.1c.16 1.2.42 1.46 1.6 1.6-1.18.16-1.44.42-1.6 1.6-.16-1.18-.42-1.44-1.6-1.6 1.18-.16 1.44-.4 1.6-1.6Z" fill="currentColor" stroke="none" />
      </>
    ),
  },
  // Content Library — a catalog of reusable atoms (grid) with one tagged.
  library: {
    label: 'Content Library',
    paths: (
      <>
        <rect x="3.5" y="3.5" width="7" height="7" rx="1.3" />
        <rect x="13.5" y="3.5" width="7" height="7" rx="1.3" />
        <rect x="3.5" y="13.5" width="7" height="7" rx="1.3" />
        <rect x="13.5" y="13.5" width="7" height="7" rx="1.3" />
        <path d="M15.3 17l1.1 1.1 2.3-2.5" />
      </>
    ),
  },
  // Compliance Engine — a requirements matrix/checklist (two met, one open).
  compliance: {
    label: 'Compliance Engine',
    paths: (
      <>
        <rect x="4" y="3.5" width="16" height="17" rx="2.2" />
        <rect x="6.6" y="6.6" width="2.7" height="2.7" rx="0.6" />
        <path d="M7 7.9l.7.7 1.3-1.4" />
        <path d="M11.4 8h5.6" />
        <rect x="6.6" y="11.1" width="2.7" height="2.7" rx="0.6" />
        <path d="M7 12.4l.7.7 1.3-1.4" />
        <path d="M11.4 12.5h5.6" />
        <rect x="6.6" y="15.6" width="2.7" height="2.7" rx="0.6" />
        <path d="M11.4 17h5.6" />
      </>
    ),
  },
  // Export Package — a submission carton with an export arrow leaving it.
  export: {
    label: 'Export Package',
    paths: (
      <>
        <path d="M4 12.5V18a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5.5" />
        <path d="M4 12.5 6 9h12l2 3.5" />
        <path d="M12 3.4v8M9 6.2l3-2.8 3 2.8" />
      </>
    ),
  },

  // ── About pillars ─────────────────────────────────────────────────────
  // The Expert — a medal (expertise / award) with a ribbon.
  expert: {
    label: 'The Expert',
    paths: (
      <>
        <circle cx="12" cy="9" r="5.2" />
        <path d="M12 6.4l.9 1.9 2 .3-1.5 1.4.35 2L12 12l-1.75.9.35-2L9.1 9.6l2-.3z" fill="currentColor" stroke="none" />
        <path d="M9.4 13.5 8 21l4-2 4 2-1.4-7.5" />
      </>
    ),
  },
  // The AI — an isolated AI: a processor node enclosed in a protective boundary.
  isolation: {
    label: 'Isolated AI',
    paths: (
      <>
        <path d="M12 3l7 2.3v5.2c0 4.3-3 7.1-7 9-4-1.9-7-4.7-7-9V5.3z" />
        <rect x="9.3" y="8" width="5.4" height="5.4" rx="1" />
        <path d="M12 6.4v1.6M12 13.4v1.6M7.7 10.7h1.6M14.7 10.7h1.6" />
      </>
    ),
  },
  // The Automation — a stage-gated pipeline: nodes, gates, a flow arrow.
  automation: {
    label: 'Stage-gated Automation',
    paths: (
      <>
        <path d="M3.4 12h13.2M14.6 9.4 17.8 12l-3.2 2.6" />
        <circle cx="5" cy="12" r="1.9" />
        <circle cx="11" cy="12" r="1.9" />
        <path d="M8 9.8v4.4" />
      </>
    ),
  },
  // The Collaboration — two teammates (overlapping figures).
  collaboration: {
    label: 'Collaboration',
    paths: (
      <>
        <circle cx="8.6" cy="8" r="2.7" />
        <path d="M3.7 18.8c0-2.9 2.2-4.8 4.9-4.8 1 0 2 .27 2.8.74" />
        <circle cx="15.6" cy="9.3" r="2.4" />
        <path d="M12.5 15.4c.8-.74 1.9-1.16 3.1-1.16 2.5 0 4.5 1.8 4.5 4.5" />
      </>
    ),
  },

  // ── The Expert credentials ─────────────────────────────────────────────
  // Funding Secured — a coin ($) with a verified check badge.
  funding: {
    label: 'Funding Secured',
    paths: (
      <>
        <circle cx="9.8" cy="9.8" r="6.4" />
        <text x="9.8" y="13.1" textAnchor="middle" fontSize="9" fontWeight={700} fill="currentColor" stroke="none" style={display}>$</text>
        <circle cx="17.6" cy="17.4" r="3.7" />
        <path d="M16 17.4l1.1 1.1 2-2.2" />
      </>
    ),
  },
  // Operations Scale — ascending bars with a rising trend.
  scale: {
    label: 'Operations Scale',
    paths: (
      <>
        <path d="M4 20.2h16" />
        <rect x="5" y="13" width="3" height="6.4" rx="0.6" />
        <rect x="10.5" y="9.5" width="3" height="9.9" rx="0.6" />
        <rect x="16" y="5.5" width="3" height="13.9" rx="0.6" />
        <path d="M5.5 11 10 8l4 1.6 5-3.8M17.2 5.2h2.3v2.3" />
      </>
    ),
  },
  // Startup Launch Track Record — a rocket lifting off.
  launch: {
    label: 'Startup Launch',
    paths: (
      <>
        <path d="M12 2.8c2.8 2.1 4 5.1 4 8.6 0 1.4-.25 2.7-.65 3.8H8.65C8.25 14.1 8 12.8 8 11.4c0-3.5 1.2-6.5 4-8.6Z" />
        <circle cx="12" cy="9" r="1.6" />
        <path d="M8.65 15.2 6.4 16.6l.4-3.5M15.35 15.2l2.25 1.4-.4-3.5" />
        <path d="M10.2 18.4c.6 1.6 1.8 2.6 1.8 2.6s1.2-1 1.8-2.6" />
      </>
    ),
  },
  // Executive Leadership — a flag planted on the summit.
  leadership: {
    label: 'Executive Leadership',
    paths: (
      <>
        <path d="M4.5 20h15" />
        <path d="M6.5 20 11 7.5l3 6.6 1.8-2.7L19 20" />
        <path d="M11 7.5V3.2l3.4 1.15L11 5.5" />
      </>
    ),
  },
};

export const ICON_NAMES = Object.keys(ICONS);

export function MarketingIcon({
  name,
  className = 'h-7 w-7',
}: {
  name?: string | null;
  className?: string;
}) {
  if (!name) return null;
  const icon = ICONS[name];
  if (!icon) return null; // unknown/legacy value -> render nothing (no raw text/emoji)
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      role="img"
      aria-label={icon.label}
    >
      {icon.paths}
    </svg>
  );
}

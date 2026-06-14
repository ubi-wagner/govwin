/**
 * MarketingIcon — bespoke line-art icon palette for the marketing content buckets.
 *
 * Same grammar as components/marketing/diagrams.tsx: hand-drawn SVG, no icon
 * fonts, no emoji. Every icon is a 24×24 single-stroke drawing that inherits its
 * color from the caller via `currentColor` (set a Tailwind `text-*` class), so it
 * tracks the RFP Pipeline palette. A few use a filled accent (sparkle, medal star)
 * or drawn vector text (a "$") — also currentColor.
 *
 * Icons are keyed by a stable NAME stored in a block's `metadata.icon`, so they
 * are fully editable from the admin page editor (a dropdown picker, or the
 * metadata field). An unknown/empty name renders nothing — never a raw string or
 * emoji. ICON_CATALOG groups the names by category for the picker + the docs.
 */
import type { ReactNode } from 'react';

const display = { fontFamily: 'var(--font-display, inherit)' } as const;

const ICONS: Record<string, { label: string; paths: ReactNode }> = {
  // ── Discovery & Sourcing ───────────────────────────────────────────────
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
  radar: {
    label: 'Radar',
    paths: (
      <>
        <path d="M12 3a9 9 0 1 0 9 9" />
        <path d="M12 7a5 5 0 0 1 5 5" />
        <path d="M12 12 19 5.5" />
        <circle cx="17" cy="7" r="1.2" fill="currentColor" stroke="none" />
        <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
      </>
    ),
  },
  target: {
    label: 'Target',
    paths: (
      <>
        <circle cx="12" cy="12" r="8" />
        <circle cx="12" cy="12" r="4" />
        <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
      </>
    ),
  },
  funnel: {
    label: 'Funnel / Match',
    paths: <path d="M4 5h16l-6 7.5V19l-4 2v-8.5z" />,
  },
  'alert-bell': {
    label: 'Alert / Reminder',
    paths: (
      <>
        <path d="M6 16.5h12l-1.6-2.2v-3.3a4.4 4.4 0 0 0-8.8 0v3.3z" />
        <path d="M10.4 19.2a1.8 1.8 0 0 0 3.2 0" />
      </>
    ),
  },
  deadline: {
    label: 'Deadline',
    paths: (
      <>
        <rect x="4" y="5" width="16" height="15" rx="2" />
        <path d="M4 9.2h16M8 3.2v3.6M16 3.2v3.6" />
        <path d="M12 12.3v2.6l1.9 1.1" />
      </>
    ),
  },
  ingest: {
    label: 'Daily Ingestion',
    paths: (
      <>
        <ellipse cx="12" cy="5.6" rx="6" ry="2.2" />
        <path d="M6 5.6v5.6c0 1.2 2.7 2.2 6 2.2s6-1 6-2.2V5.6" />
        <path d="M12 15v5.4M9.4 18l2.6 2.6L14.6 18" />
      </>
    ),
  },
  sources: {
    label: 'Federal Sources',
    paths: (
      <>
        <circle cx="12" cy="12" r="8.2" />
        <path d="M3.8 12h16.4" />
        <path d="M12 3.8a13 13 0 0 1 0 16.4M12 3.8a13 13 0 0 0 0 16.4" />
      </>
    ),
  },

  // ── Curation & Expert ──────────────────────────────────────────────────
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
  expert: {
    label: 'The Expert (medal)',
    paths: (
      <>
        <circle cx="12" cy="9" r="5.2" />
        <path d="M12 6.4l.9 1.9 2 .3-1.5 1.4.35 2L12 12l-1.75.9.35-2L9.1 9.6l2-.3z" fill="currentColor" stroke="none" />
        <path d="M9.4 13.5 8 21l4-2 4 2-1.4-7.5" />
      </>
    ),
  },
  verified: {
    label: 'Verified (shield-check)',
    paths: (
      <>
        <path d="M12 3l7 2.3v5.2c0 4.3-3 7.1-7 9-4-1.9-7-4.7-7-9V5.3z" />
        <path d="M8.6 11.7l2.4 2.4 4.4-4.7" />
      </>
    ),
  },
  review: {
    label: 'Expert Review',
    paths: (
      <>
        <rect x="4" y="3.2" width="10.5" height="14.5" rx="1.5" />
        <path d="M6.4 7h5.6M6.4 10h3.4" />
        <circle cx="15" cy="14.5" r="3.6" />
        <path d="M17.6 17.1 20.6 20.1" />
      </>
    ),
  },
  stamp: {
    label: 'Approval Stamp',
    paths: (
      <>
        <rect x="6.5" y="15.5" width="11" height="3" rx="0.8" />
        <path d="M9.5 15.5v-2.5h5v2.5" />
        <path d="M10.4 13l-.6-4.2a2.2 2.2 0 0 1 4.4 0L13.6 13" />
      </>
    ),
  },
  star: {
    label: 'Star / Quality',
    paths: <path d="M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.6 6.8 19.2l1-5.8L3.5 9.2l5.9-.9z" />,
  },

  // ── AI & Automation ────────────────────────────────────────────────────
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
  isolation: {
    label: 'Isolated AI (shield-chip)',
    paths: (
      <>
        <path d="M12 3l7 2.3v5.2c0 4.3-3 7.1-7 9-4-1.9-7-4.7-7-9V5.3z" />
        <rect x="9.3" y="8" width="5.4" height="5.4" rx="1" />
        <path d="M12 6.4v1.6M12 13.4v1.6M7.7 10.7h1.6M14.7 10.7h1.6" />
      </>
    ),
  },
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
  chip: {
    label: 'Processor / Chip',
    paths: (
      <>
        <rect x="7" y="7" width="10" height="10" rx="1.5" />
        <rect x="10" y="10" width="4" height="4" rx="0.5" />
        <path d="M9.5 4v3M12 4v3M14.5 4v3M9.5 17v3M12 17v3M14.5 17v3M4 9.5h3M4 12h3M4 14.5h3M17 9.5h3M17 12h3M17 14.5h3" />
      </>
    ),
  },
  spark: {
    label: 'AI Spark',
    paths: (
      <>
        <path d="M11 3c.4 3.6 1 4.2 4.6 4.6C12 8 11.4 8.6 11 12.2 10.6 8.6 10 8 6.4 7.6 10 7.2 10.6 6.6 11 3Z" fill="currentColor" stroke="none" />
        <path d="M17.5 13c.2 1.8.4 2 2.2 2.2-1.8.2-2 .4-2.2 2.2-.2-1.8-.4-2-2.2-2.2 1.8-.2 2-.4 2.2-2.2Z" fill="currentColor" stroke="none" />
      </>
    ),
  },
  agent: {
    label: 'AI Agent',
    paths: (
      <>
        <rect x="5" y="8" width="14" height="11" rx="2.6" />
        <path d="M12 5.2V8" />
        <circle cx="12" cy="4.4" r="1.1" />
        <circle cx="9.6" cy="13" r="1.3" fill="currentColor" stroke="none" />
        <circle cx="14.4" cy="13" r="1.3" fill="currentColor" stroke="none" />
        <path d="M9.8 16.4h4.4" />
      </>
    ),
  },
  network: {
    label: 'Network / Nodes',
    paths: (
      <>
        <circle cx="12" cy="5" r="2.1" />
        <circle cx="5" cy="17.5" r="2.1" />
        <circle cx="19" cy="17.5" r="2.1" />
        <path d="M10.8 6.7 6.2 15.8M13.2 6.7 17.8 15.8M7 17.5h10" />
      </>
    ),
  },

  // ── Proposal & Documents ───────────────────────────────────────────────
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
  compliance: {
    label: 'Compliance Matrix',
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
  'proposal-doc': {
    label: 'Proposal Document',
    paths: (
      <>
        <path d="M7 3h6.5L18 7.5v12A1.5 1.5 0 0 1 16.5 21h-9A1.5 1.5 0 0 1 6 19.5v-15A1.5 1.5 0 0 1 7.5 3Z" />
        <path d="M13 3v4.5h4.5" />
        <path d="M8.5 12h7M8.5 15h7M8.5 18h4" />
      </>
    ),
  },
  template: {
    label: 'Template',
    paths: (
      <>
        <rect x="5" y="3" width="14" height="18" rx="1.8" />
        <path d="M8 7h8" />
        <rect x="8" y="10" width="8" height="7.5" rx="0.8" />
      </>
    ),
  },
  edit: {
    label: 'Edit / Draft',
    paths: (
      <>
        <path d="M4.5 19.5 4 20l.6-3.4L16 5.2a2 2 0 0 1 2.8 2.8L7.4 19.4 4.5 19.5Z" />
        <path d="M14.5 6.7l2.8 2.8" />
      </>
    ),
  },
  history: {
    label: 'Version History',
    paths: (
      <>
        <path d="M4.2 10A8 8 0 1 1 4 13.5" />
        <path d="M3.5 15.5 4 11l4.3.6" />
        <path d="M12 8v4.2l3 1.8" />
      </>
    ),
  },
  outline: {
    label: 'Outline',
    paths: (
      <>
        <circle cx="5" cy="6.5" r="1.1" fill="currentColor" stroke="none" />
        <circle cx="5" cy="12" r="1.1" fill="currentColor" stroke="none" />
        <circle cx="5" cy="17.5" r="1.1" fill="currentColor" stroke="none" />
        <path d="M9 6.5h10M9 12h10M9 17.5h7" />
      </>
    ),
  },

  // ── Collaboration & Access ─────────────────────────────────────────────
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
  'external-collab': {
    label: 'External Collaborator',
    paths: (
      <>
        <circle cx="14.5" cy="8" r="2.6" />
        <path d="M9.8 19c0-2.8 2.1-4.7 4.7-4.7s4.7 1.9 4.7 4.7" />
        <path d="M2.5 11h5.5M5.5 8.5 8 11l-2.5 2.5" />
      </>
    ),
  },
  team: {
    label: 'Team',
    paths: (
      <>
        <circle cx="12" cy="7" r="2.4" />
        <circle cx="5.4" cy="9" r="1.9" />
        <circle cx="18.6" cy="9" r="1.9" />
        <path d="M7.6 18c0-2.5 2-4.3 4.4-4.3S16.4 15.5 16.4 18" />
        <path d="M2.6 16.6c0-1.8 1.3-3.1 3-3.1M21.4 16.6c0-1.8-1.3-3.1-3-3.1" />
      </>
    ),
  },
  lock: {
    label: 'Access Lock',
    paths: (
      <>
        <rect x="5" y="10" width="14" height="10" rx="2" />
        <path d="M8 10V7a4 4 0 0 1 8 0v3" />
        <circle cx="12" cy="15" r="1.3" fill="currentColor" stroke="none" />
      </>
    ),
  },
  key: {
    label: 'Key / Permission',
    paths: (
      <>
        <circle cx="8" cy="8" r="4.2" />
        <path d="M11 11l8.5 8.5M16.5 16.5l2-2M18.5 18.5l2-2" />
      </>
    ),
  },
  audit: {
    label: 'Audit Trail',
    paths: (
      <>
        <rect x="4" y="3.2" width="12.5" height="17.6" rx="1.5" />
        <path d="M6.8 7.6l1 1 2-2.2M6.8 12.4l1 1 2-2.2" />
        <path d="M12 7.4h2.2M12 12.2h1.6" />
        <circle cx="17" cy="17" r="3.4" />
        <path d="M17 15.4V17l1.1.8" />
      </>
    ),
  },

  // ── Outcomes & Business ────────────────────────────────────────────────
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
  'non-dilutive': {
    label: 'Non-dilutive (keep equity)',
    paths: (
      <>
        <circle cx="10.5" cy="11.5" r="6" />
        <text x="10.5" y="14.8" textAnchor="middle" fontSize="8.5" fontWeight={700} fill="currentColor" stroke="none" style={display}>$</text>
        <rect x="14.8" y="15" width="6.2" height="5" rx="1" />
        <path d="M16.3 15v-1.4a1.8 1.8 0 0 1 3.4-.8" />
      </>
    ),
  },
  billions: {
    label: 'Billions a Year',
    paths: (
      <>
        <ellipse cx="12" cy="6" rx="6" ry="2.2" />
        <path d="M6 6v3c0 1.2 2.7 2.2 6 2.2s6-1 6-2.2V6" />
        <path d="M6 9.6v3c0 1.2 2.7 2.2 6 2.2s6-1 6-2.2v-3" />
        <path d="M6 13.2v3c0 1.2 2.7 2.2 6 2.2s6-1 6-2.2v-3" />
      </>
    ),
  },
  growth: {
    label: 'Growth',
    paths: (
      <>
        <path d="M4 4v16h16" />
        <path d="M7 15.5l4-4 3 2 5-6" />
        <path d="M16.5 7.5H19v2.5" />
      </>
    ),
  },
  partnership: {
    label: 'Partnership',
    paths: (
      <>
        <circle cx="9" cy="12" r="4.2" />
        <circle cx="15" cy="12" r="4.2" />
      </>
    ),
  },
  trophy: {
    label: 'Win / Trophy',
    paths: (
      <>
        <path d="M8 4h8v4.5a4 4 0 0 1-8 0z" />
        <path d="M8 5.2H5.4a2.6 2.6 0 0 0 3.1 3.1M16 5.2h2.6a2.6 2.6 0 0 1-3.1 3.1" />
        <path d="M12 12.5v3.5M9 20h6M10 20l.6-4h2.8l.6 4" />
      </>
    ),
  },

  // ── Funding Programs ───────────────────────────────────────────────────
  'program-sbir': {
    label: 'SBIR (innovation)',
    paths: (
      <>
        <path d="M9 16a5 5 0 1 1 6 0c-.7.5-1 1.3-1 2.2h-4c0-.9-.3-1.7-1-2.2Z" />
        <path d="M10 20h4M10.6 22h2.8" />
      </>
    ),
  },
  'program-sttr': {
    label: 'STTR (tech transfer)',
    paths: (
      <>
        <circle cx="5.5" cy="12" r="3" />
        <circle cx="18.5" cy="12" r="3" />
        <path d="M9 10.4h6m-1.6-1.6 1.6 1.6-1.6 1.6M15 13.6H9m1.6 1.6L9 13.6l1.6-1.6" />
      </>
    ),
  },
  'program-baa': {
    label: 'BAA (broad announcement)',
    paths: (
      <>
        <path d="M4 10v4l3.2.5L9 19h2l-1.4-4L18 17V7l-8.4 2.6L4 10Z" />
        <path d="M18 9.2a3 3 0 0 1 0 5.6" />
      </>
    ),
  },
  'program-ota': {
    label: 'OTA (fast / flexible)',
    paths: <path d="M13 2.5 5 13h5l-1 8.5L19 11h-5l1-8.5z" />,
  },
  'program-cso': {
    label: 'CSO (commercial opening)',
    paths: (
      <>
        <path d="M4 7.5A1.5 1.5 0 0 1 5.5 6H9l2 2h7A1.5 1.5 0 0 1 19.5 9.5v.5" />
        <path d="M3.6 11h16.8l-1.7 7.2A1.6 1.6 0 0 1 17.1 19.5H5.4" />
      </>
    ),
  },
  'program-grants': {
    label: 'Grants / NOFO',
    paths: (
      <>
        <rect x="5" y="3" width="11.5" height="15" rx="1.5" />
        <path d="M8 7h5.5M8 10h5.5M8 13h3" />
        <circle cx="16.5" cy="17" r="3" />
        <path d="M15.1 18.8 14.5 21l2-1 2 1-.6-2.2" />
      </>
    ),
  },

  // ── Trust & Misc ───────────────────────────────────────────────────────
  shield: {
    label: 'Shield',
    paths: <path d="M12 3l7 2.3v5.2c0 4.3-3 7.1-7 9-4-1.9-7-4.7-7-9V5.3z" />,
  },
  'no-training': {
    label: 'No Model Training',
    paths: (
      <>
        <ellipse cx="11" cy="6.5" rx="5.5" ry="2" />
        <path d="M5.5 6.5v8c0 1.1 2.5 2 5.5 2 .6 0 1.2 0 1.7-.1" />
        <path d="M16.5 8.4v2.2" />
        <circle cx="15.5" cy="15.5" r="4.5" />
        <path d="M12.3 12.3 18.7 18.7" />
      </>
    ),
  },
  memory: {
    label: 'Structured Memory',
    paths: (
      <>
        <path d="M12 3.5 4 7.5l8 4 8-4z" />
        <path d="M4 11.5l8 4 8-4M4 15.5l8 4 8-4" />
      </>
    ),
  },
  clock: {
    label: 'SLA / Clock',
    paths: (
      <>
        <circle cx="12" cy="12" r="8.2" />
        <path d="M12 7v5.2l3.2 1.9" />
      </>
    ),
  },
  qualify: {
    label: 'Qualify / Eligible',
    paths: (
      <>
        <circle cx="12" cy="12" r="8.5" />
        <path d="M8.3 12l2.4 2.4 4.8-5.1" />
      </>
    ),
  },
  support: {
    label: 'Ask the Expert',
    paths: (
      <>
        <path d="M20 14a2 2 0 0 1-2 2H9.5L5.5 20v-4H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2z" />
        <path d="M8.5 9.5h7M8.5 12h4.5" />
      </>
    ),
  },
};

// Ordered groups for the admin picker + docs. Every name appears once.
export const ICON_CATALOG: { category: string; names: string[] }[] = [
  { category: 'Discovery & Sourcing', names: ['source-scout', 'spotlight', 'radar', 'target', 'funnel', 'alert-bell', 'deadline', 'ingest', 'sources'] },
  { category: 'Curation & Expert', names: ['curation', 'expert', 'verified', 'review', 'stamp', 'star'] },
  { category: 'AI & Automation', names: ['ai-drafting', 'isolation', 'automation', 'chip', 'spark', 'agent', 'network'] },
  { category: 'Proposal & Documents', names: ['workspace', 'library', 'compliance', 'export', 'proposal-doc', 'template', 'edit', 'history', 'outline'] },
  { category: 'Collaboration & Access', names: ['collaboration', 'external-collab', 'team', 'lock', 'key', 'audit'] },
  { category: 'Outcomes & Business', names: ['funding', 'scale', 'launch', 'leadership', 'non-dilutive', 'billions', 'growth', 'partnership', 'trophy'] },
  { category: 'Funding Programs', names: ['program-sbir', 'program-sttr', 'program-baa', 'program-ota', 'program-cso', 'program-grants'] },
  { category: 'Trust & Misc', names: ['shield', 'no-training', 'memory', 'clock', 'qualify', 'support'] },
];

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

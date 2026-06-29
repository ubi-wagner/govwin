/**
 * Pure presentation helpers for the opportunity card (no React, no DB) so the
 * formatting logic is unit-testable in the node test env. Imports are type-only
 * (erased at compile time) so this never pulls in @/lib/db.
 */
import type { ComplianceSummary } from '@/lib/cards/card';

export type Tone = 'gray' | 'blue' | 'amber' | 'green' | 'red' | 'purple';

const TONE_CLASS: Record<Tone, string> = {
  gray: 'bg-gray-100 text-gray-700',
  blue: 'bg-blue-50 text-blue-700',
  amber: 'bg-amber-100 text-amber-700',
  green: 'bg-green-100 text-green-700',
  red: 'bg-red-100 text-red-700',
  purple: 'bg-purple-50 text-purple-700',
};

export function toneClass(tone: Tone): string {
  return TONE_CLASS[tone];
}

/** Live build-stage chip metadata. */
export function stageMeta(stage: string): { label: string; tone: Tone } {
  switch (stage) {
    case 'draft':
      return { label: 'Draft', tone: 'blue' };
    case 'review':
      return { label: 'In review', tone: 'amber' };
    case 'final':
      return { label: 'Final', tone: 'purple' };
    case 'submitted':
      return { label: 'Submitted', tone: 'green' };
    case 'archived':
      return { label: 'Archived', tone: 'gray' };
    default:
      return { label: stage || 'unknown', tone: 'gray' };
  }
}

/**
 * The LIVE compliance burden, as a progress bar. Both the percent AND the label
 * use the SAME denominator — mandatory-APPLICABLE requirements (mandatory minus
 * not_applicable), matching getComplianceSummary.percentComplete — so the bar and
 * the "X/Y satisfied" text always agree (pct = X/Y). Tone escalates as the burden
 * clears: red (<50%), amber (<100%), green (complete). A matrix with no applicable
 * mandatory requirement (none yet, or all marked N/A) reads neutral, not "done".
 */
export function complianceProgress(c: ComplianceSummary): {
  pct: number;
  label: string;
  tone: Tone;
  empty: boolean;
} {
  if (c.mandatoryApplicable === 0) {
    return { pct: 0, label: 'No compliance items yet', tone: 'gray', empty: true };
  }
  const pct = Math.max(0, Math.min(100, c.percentComplete));
  const tone: Tone = pct >= 100 ? 'green' : pct >= 50 ? 'amber' : 'red';
  return {
    pct,
    label: `${c.mandatorySatisfied}/${c.mandatoryApplicable} mandatory satisfied`,
    tone,
    empty: false,
  };
}

/** Spotlight bucket key → human label (mirrors the mig-081 taxonomy). */
export function bucketLabel(key: string | null | undefined): string | null {
  if (!key) return null;
  const map: Record<string, string> = {
    technology_innovation: 'Technology & Innovation',
    service_offering: 'Service Offering',
    capabilities: 'Capabilities',
    readiness: 'Readiness',
    prior_funding: 'Prior Funding',
  };
  return map[key] ?? key;
}

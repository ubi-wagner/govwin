/**
 * Pure automation-matching helpers (#107) — DB-free so unit tests can import
 * them without pulling in @/lib/db. The runtime evaluator (triggers.ts) builds
 * on these.
 */

export interface AutomationEvent {
  eventId?: string | null;
  namespace: string;
  type: string;
  tenantId: string | null;
  payload: Record<string, unknown>;
}

/** Actions the evaluator executes for real (vs. records-only / deferred). */
export const EXECUTABLE = new Set(['create_todo', 'notify_admin']);

/** `{key}` interpolation from the event payload; unknown keys collapse to ''. */
export function interpolate(template: string, payload: Record<string, unknown>): string {
  return template.replace(/\{(\w+)\}/g, (_m, k: string) => {
    const v = payload?.[k];
    return v == null ? '' : String(v);
  });
}

/**
 * Flat subset match: every key in `conditions` must equal the payload's value.
 * Empty/absent conditions always match. Pure — the heart of rule targeting.
 */
export function conditionsMatch(
  conditions: Record<string, unknown> | null | undefined,
  payload: Record<string, unknown>,
): boolean {
  if (!conditions || typeof conditions !== 'object') return true;
  const keys = Object.keys(conditions);
  if (keys.length === 0) return true;
  return keys.every((k) => {
    const want = conditions[k];
    const got = payload?.[k];
    if (want !== null && typeof want === 'object') return JSON.stringify(want) === JSON.stringify(got);
    return got === want;
  });
}

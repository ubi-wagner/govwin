/**
 * AUDIT-COVERAGE INVARIANT — "no business write without a domain event."
 *
 * Government-compliance + regression-detection guard (docs/EVENT_AUDIT_2026-08-08.md): every API
 * route that MUTATES a business table must post a `system_events` audit (directly, or via a lib it
 * calls, or via createTask/logActivity). This test turns that convention into an enforced invariant
 * so a *future* action can't ship unaudited.
 *
 * Heuristic (deliberately conservative → low false positives):
 *   • Only routes that export a write verb (POST/PUT/PATCH/DELETE) are considered.
 *   • A route "writes" if the route file OR one of its 1-level local imports (@/… or relative)
 *     contains an INSERT/UPDATE/DELETE against a table OTHER than the audit tables themselves.
 *   • It's "audited" if that same write-path text references emitEvent* / createTask / logActivity /
 *     system_events.
 *   • Genuinely-exempt writes (read-watermarks, session pins, etc.) go in ALLOWLIST with a reason.
 *
 * Deep (2+ level) delegation is intentionally not chased — this catches the common direct / one-hop
 * pattern with no false positives; deepen only if a real gap slips through.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const FRONTEND = path.join(__dirname, '..');
const API_DIR = path.join(FRONTEND, 'app', 'api');

// Mutating routes that intentionally do NOT emit a domain event. Each entry MUST carry a reason —
// adding one is a reviewed decision, which is the whole point of the guard.
const ALLOWLIST: Record<string, string> = {
  // Anonymous public marketing telemetry (page views / time-on-page): high-volume, non-actor,
  // no auth — recorded to the analytics tables, NOT the actor-audit spine. Auditing every
  // pageview to system_events would be volume noise, not compliance signal.
  'app/api/analytics/pageview/route.ts':
    'anonymous public marketing telemetry — not an actor business action; lives in analytics tables',
};

const AUDIT_TABLES = new Set([
  'system_events', 'activity_log', 'activity_logs', 'audit_log', 'audit_logs', 'agent_task_queue',
]);
const AUDIT_SIGNAL = /\b(emitEvent(?:Single|Start|End)?|createTask|logActivity|recordAudit|emitAudit)\b|system_events/;
const WRITE_VERB = /export\s+(?:async\s+)?function\s+(?:POST|PUT|PATCH|DELETE)\b/;

function walk(dir: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (e.name === 'route.ts' || e.name === 'route.tsx') out.push(p);
  }
  return out;
}

function resolveImport(spec: string, fromFile: string): string | null {
  let base: string;
  if (spec.startsWith('@/')) base = path.join(FRONTEND, spec.slice(2));
  else if (spec.startsWith('.')) base = path.resolve(path.dirname(fromFile), spec);
  else return null; // node_modules — not ours
  for (const cand of [base + '.ts', base + '.tsx', path.join(base, 'index.ts')]) {
    if (fs.existsSync(cand) && fs.statSync(cand).isFile()) return cand;
  }
  return null;
}

function localImports(content: string, fromFile: string): string[] {
  const out: string[] = [];
  for (const m of content.matchAll(/(?:import|export)\s+[^'";]*?from\s+['"]([^'"]+)['"]/g)) {
    const r = resolveImport(m[1], fromFile);
    if (r) out.push(r);
  }
  return out;
}

function hasBusinessWrite(text: string): boolean {
  for (const m of text.matchAll(/\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+["'`]?([a-z_][a-z0-9_]*)/gi)) {
    if (!AUDIT_TABLES.has(m[1].toLowerCase())) return true;
  }
  return false;
}

function scan(): { route: string; writePath: string[] }[] {
  const violations: { route: string; writePath: string[] }[] = [];
  for (const route of walk(API_DIR)) {
    const rel = path.relative(FRONTEND, route);
    const content = fs.readFileSync(route, 'utf8');
    if (!WRITE_VERB.test(content)) continue; // read-only route (GET etc.)

    const files = [route, ...localImports(content, route)];
    const texts = files.map((f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } });

    const writers = files.filter((_f, i) => hasBusinessWrite(texts[i]));
    if (writers.length === 0) continue; // no business mutation on the 1-hop write path

    const audited = texts.some((t) => AUDIT_SIGNAL.test(t));
    if (audited) continue;
    if (ALLOWLIST[rel]) continue;

    violations.push({ route: rel, writePath: writers.map((f) => path.relative(FRONTEND, f)) });
  }
  return violations;
}

describe('audit coverage — no business write without a domain event', () => {
  it('every mutating api route audits (or is allowlisted with a reason)', () => {
    const violations = scan();
    const msg = violations
      .map((v) => `  ✗ ${v.route}\n      writes: ${v.writePath.join(', ')}`)
      .join('\n');
    expect(
      violations,
      violations.length
        ? `\nUnaudited mutating routes — add an emitEvent*/createTask on the write path, or allowlist ` +
            `with a reason in __tests__/audit-coverage.test.ts:\n${msg}\n`
        : '',
    ).toEqual([]);
  });
});

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
  // AUDIT FIX (PATTERN_AUDIT HIGH-5): exposed when the vacuous auth.ts signal was excluded.
  // Each below is read-side/advisory — the BUSINESS landing that follows it audits.
  'app/api/admin/documents/[documentId]/export/route.ts':
    'export stream + download counter — read-side; document mutations audit on their own routes',
  'app/api/admin/documents/upload-image/route.ts':
    'media blob upload for the editor picker — the insert into a canvas/section audits downstream',
  'app/api/portal/[tenantSlug]/uploads/image/route.ts':
    'media blob upload for the editor picker — the insert into a canvas/section audits downstream',
  'app/api/portal/[tenantSlug]/atoms/propose-regions/route.ts':
    'advisory box proposals (nothing lands) — the human Atomize/Capture commit audits the landing',
  'app/api/partner/tenants/precheck/route.ts':
    'eligibility precheck — validation only; the actual request/creation routes audit',
  'app/api/partner/tenants/route.ts':
    'partner console list + request relay — the accept/creation flows (admin routes + create-tenant lib) audit the landing',
  'app/api/portal/[tenantSlug]/library/foundation/[foundationId]/export/route.ts':
    'foundation doc export stream — read-side; saves/publishes audit on their own routes',
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

/** What the last scan actually EXAMINED — so "no violations" can be told apart from "no routes". */
let lastScan = { routes: 0, mutating: 0, withWrites: 0 };

function scan(): { route: string; writePath: string[] }[] {
  const violations: { route: string; writePath: string[] }[] = [];
  lastScan = { routes: 0, mutating: 0, withWrites: 0 };
  for (const route of walk(API_DIR)) {
    lastScan.routes += 1;
    const rel = path.relative(FRONTEND, route);
    const content = fs.readFileSync(route, 'utf8');
    if (!WRITE_VERB.test(content)) continue; // read-only route (GET etc.)
    lastScan.mutating += 1;

    const files = [route, ...localImports(content, route)];
    const texts = files.map((f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } });

    const writers = files.filter((_f, i) => hasBusinessWrite(texts[i]));
    if (writers.length === 0) continue; // no business mutation on the 1-hop write path
    lastScan.withWrites += 1;

    // AUDIT FIX (PATTERN_AUDIT HIGH-5): auth.ts carries its own session-bookkeeping
    // system_events INSERT, and EVERY authenticated route imports @/auth — counting it as
    // the route's audit signal made this moat vacuous. Only non-auth files count.
    const audited = texts.some((t, i) => !/(^|[\/])auth\.ts$/.test(files[i]) && AUDIT_SIGNAL.test(t));
    if (audited) continue;
    if (ALLOWLIST[rel]) continue;

    violations.push({ route: rel, writePath: writers.map((f) => path.relative(FRONTEND, f)) });
  }
  // Server actions ('use server') are mutating entry points too — the moat must see them, not just
  // app/api routes (found during the "check the work" adversarial pass; empty of writes today).
  for (const af of walkTs(path.join(FRONTEND, 'app', 'actions'))) {
    const rel = path.relative(FRONTEND, af);
    const content = fs.readFileSync(af, 'utf8');
    if (!/['"]use server['"]/.test(content)) continue;
    const files = [af, ...localImports(content, af)];
    const texts = files.map((f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } });
    const writers = files.filter((_f, i) => hasBusinessWrite(texts[i]));
    if (writers.length === 0) continue;
    if (texts.some((t) => AUDIT_SIGNAL.test(t))) continue;
    if (ALLOWLIST[rel]) continue;
    violations.push({ route: rel, writePath: writers.map((f) => path.relative(FRONTEND, f)) });
  }
  return violations;
}

function walkTs(dir: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walkTs(p));
    else if (e.name.endsWith('.ts') && !e.name.endsWith('.test.ts')) out.push(p);
  }
  return out;
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

  it('actually EXAMINED the route surface — silence is not a pass', () => {
    // This moat asserts `violations === []` and never asserted it had looked at anything. Move
    // `app/api`, rename a route file convention, or break `walk`, and it goes green having examined
    // ZERO routes — while claiming that no business write is unaudited, which is a
    // government-compliance claim, not a style preference. Same failure that let `schema-check`
    // clear a nonexistent column after reading none of a file's queries (bug log B74).
    //
    // Floors sit well under the real numbers so ordinary churn never trips them and a collapse
    // always does. If a refactor genuinely shrinks the surface, move these DELIBERATELY.
    scan();
    expect(lastScan.routes, `only ${lastScan.routes} route files walked — the scan is not reading app/api`).toBeGreaterThan(200);
    expect(lastScan.mutating, `only ${lastScan.mutating} routes carried a write verb`).toBeGreaterThan(80);
    expect(lastScan.withWrites, `only ${lastScan.withWrites} routes had a business write on the path`).toBeGreaterThan(40);
  });
});

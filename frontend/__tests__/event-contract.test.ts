/**
 * EVENT-CONTRACT INVARIANT — namespace registry · type format · start/end pairing.
 *
 * Companion to audit-coverage.test.ts (which enforces *presence* of an emit on every write path).
 * This enforces *correctness* of every literal emit call site, so the audit trail stays uniform and
 * queryable for government-compliance reporting. Binding spec: docs/EVENT_CONTRACT.md.
 *
 * Checks (frontend emit call sites — emitEventStart / emitEventSingle):
 *   1. namespace ∈ REGISTRY (and never a FORBIDDEN one).
 *   2. type = entity.action_past_tense (snake_case, ≥1 dot) — except documented exceptions.
 *   3. per file: an emitEventStart is never left without an emitEventEnd (no orphan brackets).
 *
 * Only *literal* namespace/type are validated; dynamic (`type: ev.type`) call sites are computed
 * from already-validated sources and are out of static scope.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const FRONTEND = path.join(__dirname, '..');
const SCAN_DIRS = ['app', 'lib', 'components'].map((d) => path.join(FRONTEND, d));

// The authoritative event-namespace registry (docs/EVENT_CONTRACT.md §Namespace registry).
const REGISTRY = new Set(['finder', 'capture', 'identity', 'proposal', 'library', 'system', 'tool']);
const FORBIDDEN = new Set(['admin', 'cms', 'spotlight']);
const TYPE_RE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;

// Deliberate, documented type-format exceptions. Each MUST carry a reason (adding one is reviewed).
const TYPE_ALLOWLIST: Record<string, string> = {
  'tool:invoke':
    'generic tool-invocation bracket — the bare action is the type, phase (start/end) lives in the ' +
    'phase column (tool·invoke·start / ·end); the specific tool is in the payload. See lib/tools/registry.ts.',
};

function walk(dir: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.next', '__tests__', 'e2e'].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if ((e.name.endsWith('.ts') || e.name.endsWith('.tsx')) &&
             !e.name.endsWith('.test.ts') && !e.name.endsWith('.spec.ts')) out.push(p);
  }
  return out;
}

const EMIT = /emitEvent(Single|Start|End)\s*\(/g;

function scan(): string[] {
  const violations: string[] = [];
  for (const base of SCAN_DIRS) {
    for (const fp of walk(base)) {
      const txt = fs.readFileSync(fp, 'utf8');
      const rel = path.relative(FRONTEND, fp);
      let starts = 0, ends = 0;
      for (const m of txt.matchAll(EMIT)) {
        const kind = m[1];
        if (kind === 'End') { ends++; continue; }
        if (kind === 'Start') starts++;
        const win = txt.slice(m.index! + m[0].length, m.index! + m[0].length + 600);
        const ns = /namespace:\s*'([^']+)'/.exec(win)?.[1];
        const ty = /type:\s*'([^']+)'/.exec(win)?.[1];
        const line = txt.slice(0, m.index!).split('\n').length;
        const loc = `${rel}:${line}`;
        if (ns) {
          if (FORBIDDEN.has(ns)) violations.push(`FORBIDDEN namespace '${ns}' at ${loc}`);
          else if (!REGISTRY.has(ns)) violations.push(`UNKNOWN namespace '${ns}' at ${loc} (add to REGISTRY in docs/EVENT_CONTRACT.md if intended)`);
        }
        if (ns && ty && !TYPE_RE.test(ty) && !TYPE_ALLOWLIST[`${ns}:${ty}`]) {
          violations.push(`BAD type format '${ns}:${ty}' at ${loc} (want entity.action_past_tense)`);
        }
      }
      // starts > ends means at least one emitEventStart has no emitEventEnd on any path — a real
      // orphan the file-level "ends===0" check would miss when a *different* handler in the file ends.
      if (starts > ends) violations.push(`ORPHAN start (${starts} emitEventStart, ${ends} emitEventEnd) in ${rel}`);
    }
  }
  return violations;
}

describe('event contract — namespace registry · type format · start/end pairing', () => {
  it('every literal emit call site is contract-compliant', () => {
    const v = scan();
    expect(v, v.length ? `\nEvent-contract violations (see docs/EVENT_CONTRACT.md):\n  ${v.join('\n  ')}\n` : '').toEqual([]);
  });
});

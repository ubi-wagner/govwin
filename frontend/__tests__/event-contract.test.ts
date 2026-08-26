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
 *   4. per TRY: an emitEventStart inside a try whose catch RETURNS must have an end in that catch.
 *
 * Check 4 exists because check 3 cannot see the common case. A route emits `start` inside its one
 * big try, closes the bracket on the success path, and returns 500 from the catch — the file
 * contains an `emitEventEnd`, the counts balance, and the throw path leaves the `start` row
 * unterminated forever. Thirty-one handlers had exactly that shape; the sandbox corpus carried the
 * proof as two `proposal.created` starts with no end. Fixed in one pass by
 * `scripts/fix-open-event-brackets.mjs`; this check is what stops the next one being written.
 *
 * Prefer `withEventBracket()` (lib/events.ts) in new code — it makes the bracket impossible to drop.
 *
 * Only *literal* namespace/type are validated; dynamic (`type: ev.type`) call sites are computed
 * from already-validated sources and are out of static scope.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import ts from 'typescript';
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

// Raw `INSERT INTO system_events` bypasses the emitter helpers. The DB CHECK constraints (mig 069/007)
// still enforce namespace/phase/actor_type on EVERY insert, but raw inserts skip the emit-layer
// conventions, so each sanctioned site is allowlisted with a reason. A NEW raw insert fails this guard
// until it uses the emitEvent* helpers or is reviewed in. Keys are FRONTEND-relative paths.
const RAW_INSERT_ALLOWLIST: Record<string, string> = {
  'lib/events.ts': 'the canonical emitter helpers (emitEventStart/End/Single)',
  'auth.ts': 'identity login / login_failed — raw because NextAuth authorize() must not import the automation-triggering emit layer; literals are conformant',
  'lib/process/launch-template.ts': 'workflow-trigger emit (namespace/type from a validated template)',
  'app/api/events/route.ts': 'admin-only client-facing emit endpoint — validates namespace + type before insert',
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

/** What the last scan actually READ — so "no violations" can be told apart from "nothing scanned". */
let lastScan = { sites: 0, literal: 0, files: 0 };

function scan(): string[] {
  const violations: string[] = [];
  lastScan = { sites: 0, literal: 0, files: 0 };
  for (const base of SCAN_DIRS) {
    for (const fp of walk(base)) {
      const txt = fs.readFileSync(fp, 'utf8');
      const rel = path.relative(FRONTEND, fp);
      let starts = 0, ends = 0;
      const hits = [...txt.matchAll(EMIT)];
      if (hits.length) lastScan.files += 1;
      lastScan.sites += hits.length;
      for (const m of hits) {
        const kind = m[1];
        if (kind === 'End') { ends++; continue; }
        if (kind === 'Start') starts++;
        const win = txt.slice(m.index! + m[0].length, m.index! + m[0].length + 600);
        const ns = /namespace:\s*'([^']+)'/.exec(win)?.[1];
        const ty = /type:\s*'([^']+)'/.exec(win)?.[1];
        if (ns) lastScan.literal += 1;
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
      violations.push(...unclosedOnThrow(txt, rel));
      // 100%-surface: raw inserts bypass the helpers. Sanctioned ones are allowlisted; a new one fails.
      if (txt.includes('INSERT INTO system_events') && !RAW_INSERT_ALLOWLIST[rel]) {
        violations.push(`RAW insert into system_events in ${rel} — use the emitEvent* helpers, or allowlist it (with a reason) in event-contract.test.ts`);
      }
    }
  }
  return violations;
}

/**
 * CHECK 4 · a bracket a throw can walk out of.
 *
 * Structural, via the TypeScript AST rather than counting: find each `emitEventStart`, walk up to
 * the innermost enclosing `try` that has a `catch`, and require an `emitEventEnd` in that catch
 * whenever the catch RETURNS. A catch that rethrows is fine — the bracket is the caller's to close.
 *
 * Deliberately narrow: it reports only the shape it can prove from the tree, so a green result is
 * not a claim that every control-flow path is covered — it is a claim that this specific,
 * previously-systematic mistake is not present.
 */
function unclosedOnThrow(txt: string, rel: string): string[] {
  if (!txt.includes('emitEventStart')) return [];
  const sf = ts.createSourceFile(rel, txt, ts.ScriptTarget.Latest, true);
  const out: string[] = [];
  const callee = (n: ts.Node) => (ts.isCallExpression(n) ? n.expression.getText(sf).split('.').pop() : null);
  const has = (n: ts.Node, f: (x: ts.Node) => boolean): boolean => {
    let hit = false;
    const go = (x: ts.Node) => { if (hit) return; if (f(x)) { hit = true; return; } ts.forEachChild(x, go); };
    go(n);
    return hit;
  };
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && callee(node) === 'emitEventStart') {
      for (let p: ts.Node | undefined = node.parent; p; p = p.parent) {
        if (!ts.isTryStatement(p) || !p.catchClause) continue;
        const cc = p.catchClause;
        if (has(cc, ts.isReturnStatement) && !has(cc, (n) => callee(n) === 'emitEventEnd')) {
          const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
          out.push(
            `UNCLOSED-ON-THROW start at ${rel}:${line} — the enclosing catch returns without an ` +
            `emitEventEnd, so a throw leaves the start row unterminated. Close it in the catch ` +
            `(hoist the id to \`let x: string | null = null\` above the try), or use withEventBracket().`,
          );
        }
        break; // only the innermost enclosing try can catch it first
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

describe('event contract — namespace registry · type format · start/end pairing', () => {
  it('every literal emit call site is contract-compliant', () => {
    const v = scan();
    expect(v, v.length ? `\nEvent-contract violations (see docs/EVENT_CONTRACT.md):\n  ${v.join('\n  ')}\n` : '').toEqual([]);
  });

  it('actually READ the emit surface — silence is not a pass', () => {
    // This guard asserts `violations === []` and, until now, never asserted it had found anything.
    // Rename the helpers, move a directory, or land a codemod that changes the call shape, and it
    // goes green having validated ZERO call sites — the failure mode that let `schema-check` clear
    // a nonexistent column after reading none of a file's queries (bug log B74).
    //
    // The floors sit well under the real numbers (409 call sites in 195 files, 274 with a literal
    // namespace at the time of writing), so ordinary churn never trips them and a collapse always
    // does. If a refactor genuinely shrinks the emit surface, move these DELIBERATELY.
    scan();
    expect(lastScan.sites, `only ${lastScan.sites} emitEvent* call sites found — the scan is not reading the codebase`).toBeGreaterThan(250);
    expect(lastScan.literal, `only ${lastScan.literal} call sites had a literal namespace to validate`).toBeGreaterThan(150);
    expect(lastScan.files).toBeGreaterThan(100);
  });
});

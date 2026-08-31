/**
 * `auditLog()` WROTE TO A TABLE THAT HAD BEEN DROPPED FOR 74 MIGRATIONS.
 *
 * Migration 142 dropped `audit_log`, annotated `→ system_events (live audit trail)`. Nothing
 * updated `lib/db.ts`, whose `auditLog()` kept inserting into it — inside a catch that only logs.
 * So every call raised `relation "audit_log" does not exist`, printed to stderr, and returned
 * normally. The caller believed it had left a record.
 *
 * All 46 call sites are the post-award Projects tree, written long AFTER mig 142 against a helper
 * that was already dead. The entire Projects audit trail — baselines, gate closures, invoice
 * submission, CLIN edits, member assignment — had never recorded a single row, and no lens could
 * see it: the function returns void, swallows its failure, and nothing reads it back.
 *
 * These are static checks on purpose. The live behaviour is exercised by the drives; what has to
 * be guarded HERE is the pair of properties that made the bug invisible and would let it return:
 * the destination table, and whether the action strings can legally land there.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { EVENT_NAMESPACES } from '../lib/event-namespaces';

const ROOT = join(__dirname, '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next' || entry.startsWith('.')) continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(p)) out.push(p);
  }
  return out;
}

const SOURCES = [join(ROOT, 'app'), join(ROOT, 'lib')].flatMap((d) => walk(d));

describe('auditLog writes somewhere that exists', () => {
  it('no code inserts into the dropped audit_log table', () => {
    const offenders: string[] = [];
    for (const f of SOURCES) {
      const src = readFileSync(f, 'utf8');
      // The table, as a SQL identifier — not the function name `auditLog`, and not the log tag
      // `[auditLog]`, both of which are legitimate and appear in the fixed code.
      if (/\b(INSERT\s+INTO|FROM|UPDATE|DELETE\s+FROM)\s+audit_log\b/i.test(src)) {
        offenders.push(f.replace(ROOT + '/', ''));
      }
    }
    expect(offenders, `audit_log was dropped in migration 142 (→ system_events). These still use it:\n  ${offenders.join('\n  ')}`).toEqual([]);
  });

  it('every auditLog action names a registered namespace', () => {
    // A row whose namespace is not in EVENT_NAMESPACES violates system_events_namespace_chk. The
    // INSERT would throw into auditLog's catch — i.e. it would go silent again, which is exactly
    // the failure mode this whole file exists to prevent. Catch it at build time instead.
    const bad: string[] = [];
    for (const f of SOURCES) {
      const src = readFileSync(f, 'utf8');
      if (!src.includes('auditLog(')) continue;
      // Actions are written as a literal in the call object at every site; a computed action would
      // not match here and is reported by the runtime guard in auditLog() instead.
      for (const m of src.matchAll(/auditLog\(\s*\{[^}]*?action:\s*['"]([^'"]+)['"]/gs)) {
        const action = m[1];
        const ns = action.includes('.') ? action.slice(0, action.indexOf('.')) : '';
        if (!(EVENT_NAMESPACES as readonly string[]).includes(ns)) {
          bad.push(`${f.replace(ROOT + '/', '')}: "${action}"`);
        }
      }
    }
    expect(bad, `these audit actions would violate system_events_namespace_chk:\n  ${bad.join('\n  ')}`).toEqual([]);
  });

  it('finds the call sites it claims to be checking', () => {
    // THE INSTRUMENT BEFORE THE FINDING. Both assertions above pass trivially against zero matches
    // — a rename of the helper, or a regex that stops matching, turns this file into two green
    // checks of nothing. Pin the shape: there is a real, non-trivial population being checked.
    const withCalls = SOURCES.filter((f) => readFileSync(f, 'utf8').includes('auditLog('));
    expect(withCalls.length).toBeGreaterThan(5);
  });
});

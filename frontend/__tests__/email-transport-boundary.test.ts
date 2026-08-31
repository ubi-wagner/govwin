/**
 * THE SEND SEAM IS A BOUNDARY, and this test is what makes it one.
 *
 * `lib/email/index.ts` owns four things no transport may reimplement: the suppression check,
 * idempotency, the `email_send_ledger` table, and sender resolution. A caller that reaches a transport
 * directly gets none of them — it double-sends on replay, mails an address that hard-bounced last
 * week, and leaves no row to answer "why did this notification not go?".
 *
 * This is not hypothetical. The storage abstraction was written with the same intent and was
 * bypassed by two routes, one of them customer-facing, because nothing enforced it
 * (`storage-abstraction-boundary.test.ts` is the corresponding guard, added after the fact). Email
 * gets its guard on day one instead.
 *
 * It also catches the quieter version: eleven call sites were converted here, and three of them
 * were `await import('@/lib/email')` rather than a top-level import — invisible to the grep that
 * first counted them as eight. A source scan finds both.
 *
 * ── THE INSTRUMENT BEFORE THE FINDING ────────────────────────────────────────────────────────
 * The first test below feeds the scanner a file that is DEFINITELY a violation and requires it to
 * be flagged. A scanner whose file list is empty — a wrong root, a typo in an extension filter —
 * reports "no offenders" and looks exactly like a clean codebase.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const SKIP_DIRS = new Set(['node_modules', '.next', '__tests__', 'e2e', 'e2e-artifacts', 'public', 'scripts']);

/** The one directory allowed to hold a transport. */
const DRIVERS = join('lib', 'email', 'drivers');
/** The whole seam — allowed to touch the ledger tables and to import its own drivers. */
const SEAM = join('lib', 'email');

/**
 * `lib/google-calendar.ts` imports `googleapis` and must keep doing so: it books calendar events,
 * which is not mail and does not belong behind a send seam. The exemption is NAMED rather than
 * pattern-matched, so adding a second googleapis importer is a finding rather than a silence — and
 * the rules below distinguish `google.calendar(` from `google.gmail(` anyway, which is the property
 * that actually matters.
 */
const GOOGLEAPIS_EXEMPT = new Set(['lib/google-calendar.ts']);

function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(full)) out.push(full);
    }
  };
  for (const d of ['app', 'lib']) {
    try { if (statSync(join(ROOT, d)).isDirectory()) walk(join(ROOT, d)); } catch { /* absent */ }
  }
  return out;
}

const rel = (f: string) => f.replace(ROOT + '/', '');
const read = (f: string) => readFileSync(f, 'utf8');

/**
 * The file with its comments removed — for asking what the code DOES.
 *
 * This repository documents each rule at its own site, so a scan of raw source finds the PROSE
 * about a constraint and reports it as a violation of that constraint. The outbound-mail console
 * explains in a header comment which tables it must not query, and that comment alone failed the
 * ledger check below while the file contained no query at all.
 *
 * Only the identifier checks use this. The import checks above deliberately do not: an import
 * inside a comment is not an import, but neither is it worth the risk of a stripper mangling one.
 */
const code = (f: string) =>
  read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

/** Files outside a given subtree. */
function outside(subtree: string): string[] {
  return sourceFiles().filter((f) => !f.includes(subtree));
}

describe('email transport boundary', () => {
  it('the scanner can see the codebase at all', () => {
    // A boundary test whose file list is empty passes every assertion below for the wrong reason.
    const files = sourceFiles();
    expect(files.length, 'no source files found — the scan root or extension filter is wrong').toBeGreaterThan(200);
    expect(files.map(rel)).toContain('lib/email/index.ts');
    expect(files.map(rel)).toContain('lib/email/drivers/gmail.ts');
  });

  it('the rules would flag a violation', () => {
    // Red by construction: assert the patterns against strings that ARE violations, so the rules
    // below cannot pass merely by never matching anything.
    const rules: Array<[string, RegExp]> = [
      ["const g = google.gmail({ version: 'v1', auth })", /\bgoogle\.gmail\s*\(/],
      ["fetch('https://api.postmarkapp.com/email')", /api\.postmarkapp\.com/],
      ["fetch('https://api.resend.com/emails')", /api\.resend\.com/],
      ['INSERT INTO email_send_ledger (id) VALUES (1)', /\bemail_send_ledger\b/],
      ['SELECT * FROM email_suppressions', /\bemail_suppressions\b/],
    ];
    for (const [sample, pattern] of rules) {
      expect(pattern.test(sample), `rule ${pattern} failed to match its own example`).toBe(true);
    }
  });

  it('only lib/email/drivers sends through a mail transport', () => {
    const offenders = outside(DRIVERS).filter((f) => {
      const src = read(f);
      return /\bgoogle\.gmail\s*\(/.test(src)
        || /api\.postmarkapp\.com/.test(src)
        || /api\.resend\.com/.test(src);
    });
    expect(
      offenders.map(rel),
      'these files hand a message to a provider without passing through send(), so they get no '
      + 'suppression check, no idempotency, and no ledger row',
    ).toEqual([]);
  });

  it('only lib/email/drivers imports googleapis for mail', () => {
    const offenders = outside(DRIVERS)
      .filter((f) => /from ['"]googleapis['"]/.test(read(f)))
      .map(rel)
      .filter((f) => !GOOGLEAPIS_EXEMPT.has(f));
    expect(
      offenders,
      `googleapis may be imported by ${DRIVERS} and, for calendar only, by `
      + `${[...GOOGLEAPIS_EXEMPT].join(', ')}. A new importer needs a stated reason here.`,
    ).toEqual([]);
  });

  it('only lib/email touches the ledger tables', () => {
    // Migration 215 makes `email_send_ledger` read-only and `email_suppressions` unreadable on the app
    // role, so a stray query does not silently succeed — it fails at run time, in whatever request
    // happened to reach it. Catching it here is the difference between a failing test and a
    // 500 in production.
    const offenders = outside(SEAM).filter((f) => {
      const src = code(f);
      return /\bemail_send_ledger\b/.test(src) || /\bemail_suppressions\b/.test(src);
    });
    expect(
      offenders.map(rel),
      'the ledger is written in one place. It is denied to the application role by RLS '
      + '(migration 215), so a query here fails at run time rather than at build time.',
    ).toEqual([]);
  });

  it('nothing imports a driver or the ledger directly', () => {
    const offenders = outside(SEAM).filter((f) => {
      const src = read(f);
      return /from ['"]@\/lib\/email\/(drivers|ledger)/.test(src)
        || /import\(['"]@\/lib\/email\/(drivers|ledger)/.test(src);
    });
    expect(
      offenders.map(rel),
      "import { send } from '@/lib/email' — the seam is the public surface; a driver is not",
    ).toEqual([]);
  });

  it('no caller still uses the pre-seam sendEmail export', () => {
    // `lib/email.ts` is gone, so this would be a type error too — but a dynamic
    // `await import('@/lib/email')` destructuring `sendEmail` is NOT, and three of the eleven call
    // sites were exactly that shape. It fails at run time inside a best-effort catch, which is to
    // say it fails silently.
    const offenders = sourceFiles().filter((f) => /\bsendEmail\s*[,}]/.test(read(f)));
    expect(
      offenders.map(rel),
      'sendEmail no longer exists; a destructured dynamic import of it resolves to undefined and '
      + 'throws inside whatever catch block surrounds the send',
    ).toEqual([]);
  });
});

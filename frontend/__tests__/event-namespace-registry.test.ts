/**
 * ONE REGISTRY, RECONCILED ACROSS EVERYTHING THAT WRITES IT DOWN.
 *
 * The event-namespace registry cannot have a single source of truth, and pretending otherwise is
 * how it drifted. It has to exist in TypeScript (the app), in Python (the pipeline and the catalog
 * script), and as a `CHECK` constraint in Postgres — none of which can import the others. Three
 * copies is the floor.
 *
 * ── WHAT ACTUALLY HAPPENED, WHICH IS WHY THIS FILE EXISTS ────────────────────────────────────
 * The registry was a literal in **nine** places across three languages, a SQL migration and four
 * documents. Adding `project` (migration 217) updated four of them and left five on the old seven.
 * Two of those five were live defects:
 *
 *   · `app/api/events/route.ts` re-declared the list and would have answered **422 to every
 *     `project:` event** — while the database accepted them from every other path.
 *   · `pipeline/tests/test_observability_contract.py` re-declared it and would have failed the
 *     first project-namespace event the pipeline emitted.
 *
 * Neither showed up in any test run, because nothing yet emitted a project event through those two
 * paths. That is drift's whole character: it is invisible until the moment it costs something.
 *
 * ── THE RULE ─────────────────────────────────────────────────────────────────────────────────
 * You cannot have one source of truth across a database constraint, two languages and a document.
 * **You can have one test that refuses to let them diverge** — and it must name WHICH one
 * disagreed, because "the registries do not match" sends someone to read nine files.
 *
 * Every TypeScript reader now imports `EVENT_NAMESPACES`; this file asserts that no TypeScript
 * reader has quietly gone back to a literal, and that the Python copy, the SQL and the docs all say
 * the same thing.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { EVENT_NAMESPACES, FORBIDDEN_NAMESPACES } from '@/lib/events';

const REPO = path.resolve(process.cwd(), '..');
const read = (p: string) => fs.readFileSync(path.join(REPO, p), 'utf8');
const exists = (p: string) => fs.existsSync(path.join(REPO, p));

/** The registry as this test understands it — sorted, so comparisons are order-independent. */
const CANON = [...EVENT_NAMESPACES].sort();

/** Pull a set of quoted namespace-ish words out of a blob, keeping only registry candidates. */
function extractSet(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(/['"]([a-z_]+)['"]/g)) found.add(m[1]);
  return [...found].filter((w) => CANON.includes(w) || w === 'project').sort();
}

describe('the registry has exactly one copy per runtime', () => {
  it('TypeScript exports it, and it is the eight we expect', () => {
    expect(CANON).toEqual([
      'capture', 'finder', 'identity', 'library', 'project', 'proposal', 'system', 'tool',
    ]);
    expect([...FORBIDDEN_NAMESPACES].sort()).toEqual(['admin', 'cms', 'spotlight']);
  });

  it('no TypeScript file re-declares the list as a literal', () => {
    // The specific shape that went wrong: a local const listing the namespaces, which then goes
    // stale silently. `lib/events.ts` is the one legal home.
    const offenders: string[] = [];
    const walk = (dir: string) => {
      const abs = path.join(REPO, dir);
      if (!fs.existsSync(abs)) return;
      for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
        if (e.name.startsWith('.') || e.name === 'node_modules') continue;
        const relPath = path.join(dir, e.name);
        if (e.isDirectory()) walk(relPath);
        else if (/\.tsx?$/.test(e.name)) {
          if (relPath === path.join('frontend', 'lib', 'events.ts')) continue;
          const src = read(relPath);
          // Three of the eight adjacent in one literal is the signature; no prose does that.
          if (/['"]finder['"]\s*,\s*['"]capture['"]\s*,\s*['"]identity['"]/.test(src)) {
            offenders.push(relPath);
          }
        }
      }
    };
    walk(path.join('frontend', 'app'));
    walk(path.join('frontend', 'lib'));
    walk(path.join('frontend', '__tests__'));
    expect(
      offenders,
      'these files write the registry out again instead of importing EVENT_NAMESPACES from '
      + '@/lib/events. A copy is a copy whether or not it agrees today.',
    ).toEqual([]);
  });

  it('the Python copy agrees with the TypeScript one', () => {
    const src = read(path.join('pipeline', 'src', 'events.py'));
    const block = src.match(/EVENT_NAMESPACES[^=]*=\s*frozenset\(\{([\s\S]*?)\}\)/);
    expect(block, 'pipeline/src/events.py does not export EVENT_NAMESPACES').toBeTruthy();
    expect(extractSet(block![1]), 'the Python registry disagrees with the TypeScript one').toEqual(CANON);
  });

  it('no Python file re-declares the list either', () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      const abs = path.join(REPO, dir);
      if (!fs.existsSync(abs)) return;
      for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
        if (e.name.startsWith('.') || e.name === '__pycache__') continue;
        const relPath = path.join(dir, e.name);
        if (e.isDirectory()) walk(relPath);
        else if (e.name.endsWith('.py')) {
          if (relPath === path.join('pipeline', 'src', 'events.py')) continue;
          const src = read(relPath);
          if (/["']finder["']\s*,\s*["']capture["']\s*,\s*["']identity["']/.test(src)) offenders.push(relPath);
        }
      }
    };
    walk('pipeline');
    walk('scripts');
    walk(path.join('services', 'cms', 'src'));
    expect(
      offenders,
      'these files write the registry out again instead of importing it from pipeline/src/events.py',
    ).toEqual([]);
  });
});

describe('the database CHECK agrees', () => {
  it('the newest namespace migration lists exactly the registry', () => {
    // The CHECK is the ENFORCEMENT — it raises 23514 at the insert, where the TypeScript set only
    // warns. If it and the code disagree, the code is wrong by definition.
    const migDir = path.join(REPO, 'db', 'migrations');
    const namespaceMigrations = fs.readdirSync(migDir)
      .filter((f) => /namespace/i.test(f) && f.endsWith('.sql'))
      .sort();
    expect(namespaceMigrations.length, 'no namespace migration found').toBeGreaterThan(0);

    const newest = namespaceMigrations[namespaceMigrations.length - 1];
    const src = fs.readFileSync(path.join(migDir, newest), 'utf8');
    const check = src.match(/system_events_namespace_chk[\s\S]*?CHECK\s*\(([\s\S]*?)\)\s*;/);
    expect(check, `${newest} does not define system_events_namespace_chk`).toBeTruthy();
    expect(
      extractSet(check![1]),
      `${newest}'s CHECK disagrees with the code registry. The CHECK wins — it is what actually `
      + 'refuses an insert; the code merely logs.',
    ).toEqual(CANON);
  });
});

describe('the documents agree', () => {
  // Docs drift the most and matter the least at run time — but a doc that lists seven namespaces is
  // how the next person writes the eighth copy wrong. Each file is checked only where it actually
  // enumerates the set.
  const DOCS = [
    'docs/EVENT_CONTRACT.md',
    'CLAUDE.md',
    'ARCHITECTURE_V10.md',
    'CLAUDE_CLIFFNOTES.md',
  ];

  for (const doc of DOCS) {
    it(`${doc} lists the whole registry where it enumerates it`, () => {
      if (!exists(doc)) return;                     // absent is not a failure; wrong is
      const src = read(doc);
      const all = src.split('\n');
      // DOES THIS DOCUMENT ENUMERATE THE REGISTRY AT ALL? A passing mention of `finder` is not a
      // copy; three of them together is.
      const enumerates = all.some((l, i) => {
        const ctx = all.slice(i, i + 3).join(' ');
        return /finder/.test(l) && /capture/.test(ctx) && /identity/.test(ctx);
      });
      if (!enumerates) return;

      // Then assert the WHOLE DOCUMENT names every namespace.
      //
      // Not a window, because layout defeats windows: CLAUDE.md wraps its list across two lines and
      // EVENT_CONTRACT.md §4 is a TABLE with one namespace per row — a three-line window reported
      // `library` missing from a document that devotes a row to it. Both were the instrument, not
      // the document.
      //
      // ── KNOWN LIMITS, stated rather than hidden ─────────────────────────────────────────────
      // 1. A doc could mention a namespace in unrelated prose and satisfy the check below. That is
      //    why the COUNT assertion after it exists.
      // 2. The count assertion reads phrases of the form "<N> … namespaces". It does NOT catch a
      //    back-reference — CLAUDE_CLIFFNOTES.md's "set is the 7 listed above" was reverted by a
      //    red probe and this file did not notice, because there is no parseable count in it.
      //    Widening the pattern to catch it would mean matching any number near any list, which is
      //    how the first version flagged `### 6.2 Namespaces` as claiming two.
      //
      // So: a stated count is guarded; a prose back-reference to a count is not. Anyone changing
      // the registry still has to read the four documents, and this file narrows that from
      // "everything" to "the sentences that do not state a number".
      for (const ns of CANON) {
        expect(
          new RegExp(`\\b${ns}\\b`).test(src),
          `${doc} enumerates the event-namespace registry but never mentions '${ns}'. `
          + 'A doc listing seven when there are eight is how the next copy gets written wrong.',
        ).toBe(true);
      }

      // AND THE COUNT, which is what the limit above misses.
      //
      // The mention check passed on three documents that still said "the 7 canonical namespaces",
      // because `project` appeared elsewhere in each of them. A stated count is precise, is
      // layout-independent, and is exactly the sentence a reader trusts — so it gets its own
      // assertion rather than relying on the presence of a word.
      const COUNTS: Record<string, number> = {
        one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
      };
      // The pattern is deliberately narrow. A loose one ("a number within 40 characters of the
      // word namespace") flagged `### 6.2 Namespaces → templates` as claiming two, and a schema
      // table row containing `019/028/030a` and `trigger_namespace` as claiming nineteen. Both were
      // the instrument. So: the number must start a phrase, at most two words may separate it from
      // the word, and the word must be PLURAL — which excludes every `*_namespace` identifier.
      all.forEach((line, i) => {
        const m = line.match(
          /(?:^|[\s*(])(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\*{0,2}\s+(?:\w+\s+){0,2}namespaces\b/i,
        );
        if (!m) return;
        const raw = m[1].toLowerCase();
        const stated = COUNTS[raw] ?? Number(raw);
        if (!Number.isFinite(stated) || stated < 2 || stated > 20) return;   // not a registry count
        expect(
          stated,
          `${doc}:${i + 1} states ${stated} namespaces; the registry has ${CANON.length}:\n    `
          + line.trim().slice(0, 160),
        ).toBe(CANON.length);
      });
    });
  }
});

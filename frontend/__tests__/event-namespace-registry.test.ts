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
import { EVENT_NAMESPACES, FORBIDDEN_NAMESPACES } from '@/lib/event-namespaces';

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
          if (relPath === path.join('frontend', 'lib', 'event-namespaces.ts')) continue;
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

  it('the registry module imports NOTHING, so a client component can use it', () => {
    // It used to live in `lib/events.ts`, which imports the database client. The moment a CLIENT
    // component imported the registry, `postgres` and `node:async_hooks` were pulled into the
    // browser bundle and `next build` failed:
    //
    //   Import trace: node:async_hooks → lib/tenant-context.ts → lib/db.ts → lib/events.ts
    //                 → app/admin/events/event-stream-client.tsx
    //
    // tsc and vitest both passed. A client component importing a server module is invisible to
    // both — only a build sees it, which is exactly why this assertion is here and not left to one.
    const src = read(path.join('frontend', 'lib', 'event-namespaces.ts'));
    const imports = src.split('\n').filter((l) => /^\s*import\s/.test(l));
    expect(
      imports,
      'lib/event-namespaces.ts must stay a leaf. Any import here can reach a client bundle '
      + 'through event-stream-client.tsx and break the build in a way no unit test can see.',
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
  /**
   * ── DISCOVERED, NOT MAINTAINED (B173) ───────────────────────────────────────────────────────
   *
   * This was a hand-written list of four, and `docs/DATA_FLOW.md` — the canonical cross-section of
   * the request path, whose invariant 3 read "**seven** namespaces only" and listed seven — was
   * never on it. The guard passed for as long as that sentence was wrong, because the guard was
   * never pointed at the file. A hand-maintained list of what to check has the same shape of
   * problem as a hand-maintained schema doc: it is correct until the next thing is added.
   *
   * So the live documents are FOUND with the same `enumerates` predicate used below, and the
   * historical ones are EXCUSED BY NAME WITH A REASON. An unexplained exclusion is how a real
   * document leaves the checklist — and a dated audit or a superseded contract SHOULD still say
   * seven, because that is what was true when it was written.
   */
  const HISTORICAL = [
    [/^ARCHITECTURE_V9\.md$/, 'superseded by V10 — records the state at the time'],
    [/^docs\/archive\//, 'archived by definition'],
    [/^docs\/EVENT_CONTRACT_V[0-9]+\.md$/, 'superseded contract version'],
    [/^docs\/EVENT_AUDIT_\d{4}-\d{2}-\d{2}\.md$/, 'a dated audit is a snapshot, not a claim about today'],
    [/^docs\/V1_READY_REPORT\.md$/, 'a dated readiness report'],
    [/^docs\/PROPOSAL_LIFECYCLE_V1\.md$/, 'V1 lifecycle, superseded'],
    [/^docs\/BUG_LOG_/, 'a bug log quotes the state at the time of each entry'],
    // NOT historical — excused because it does not enumerate the registry at all. It names
    // EXAMPLE trigger types in a rule table (`capture:purchase.completed`,
    // `proposal:document.locked`, `finder:source.change_detected` …), which puts four namespace
    // words near each other without ever claiming to list the closed set. Every tightening of the
    // discovery predicate that was tried still matched it, and the ones that would not also
    // dropped EVENT_CONTRACT.md, whose §4 is a table with one namespace per ROW. Naming it here
    // with the reason beats a predicate tuned until it happens to exclude one file.
    [/^docs\/RFP_ADMIN_OPERATIONS_GUIDE\.md$/, 'names example trigger types, does not enumerate the set'],
  ] as const;

  const DOCS = (() => {
    const out: string[] = [];
    const walk = (dir: string) => {
      const abs = path.join(REPO, dir);
      if (!fs.existsSync(abs)) return;
      for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
        if (e.name.startsWith('.') || e.name === 'node_modules') continue;
        const next = dir === '.' ? e.name : `${dir}/${e.name}`;
        if (e.isDirectory()) { walk(next); continue; }
        if (!e.name.endsWith('.md')) continue;
        if (HISTORICAL.some(([re]) => re.test(next))) continue;
        const all = read(next).split('\n');
        const enumerates = all.some((l, i) => {
          const ctx = all.slice(i, i + 3).join(' ');
          return /finder/.test(l) && /capture/.test(ctx) && /identity/.test(ctx);
        });
        if (enumerates) out.push(next);
      }
    };
    walk('.');
    walk('docs');
    walk('docs/user-guides');
    return out.sort();
  })();

  it('the discovery found the documents that matter, not none of them', () => {
    // The guard's own guard: a discovery that silently finds nothing reports a clean run over
    // every document at once — strictly worse than the four-item list it replaced.
    expect(DOCS, 'namespace-enumerating docs were discovered').toContain('CLAUDE.md');
    expect(DOCS).toContain('docs/DATA_FLOW.md');
    expect(DOCS.length).toBeGreaterThan(6);
  });

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

/**
 * ── THE FOURTH PLACE THE REGISTRY IS COPIED: A UI CONSTANT (B173) ──────────────────────────────
 *
 * Everything above reconciles the three RUNTIMES and the DOCUMENTS. A hard-coded list in a React
 * component is neither, and that is where the eighth namespace went missing for real:
 *
 *     app/portal/[tenantSlug]/activity/activity-stream-client.tsx
 *
 * held a hand-written `NAMESPACE_TABS` of seven. `project` — migration 217, and the whole
 * post-award half of a customer's life with this product — had no tab. The rows were in the feed;
 * the control to isolate them was not. `/admin/events` derived its filter from `EVENT_NAMESPACES`
 * all along, so the OPERATOR console gained the tab automatically and the CUSTOMER's did not.
 *
 * The check is deliberately satisfied two ways, because both are correct: a file may DERIVE from
 * `EVENT_NAMESPACES` (preferred — then it cannot drift), or it may name all of them. What it may
 * not do is name most of them.
 */
/**
 * Comments stripped BEFORE asking whether a file derives from the registry.
 *
 * ⚠️ THE FIRST VERSION OF THIS GUARD WAS INERT, and the red test is the only reason anyone knows.
 * The escape hatch is "a file that mentions EVENT_NAMESPACES is deriving, so skip it" — and the
 * fixed component carries a long comment EXPLAINING that it derives from EVENT_NAMESPACES. Revert
 * the fix and the comment stays; the guard reads the word, takes the escape hatch, and reports a
 * clean run over the exact defect it was written for.
 *
 * Third occurrence of "a scan that reads prose as code" in one sitting, this time inside the check
 * built after the previous two.
 */
const stripComments = (src: string) => src
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:"'`\\])\/\/[^\n]*/g, '$1');

describe('a hard-coded namespace list in the UI is complete', () => {
  /** Files that build a namespace list for a person to choose from. */
  const UI_FILES = [
    'app/portal/[tenantSlug]/activity/activity-stream-client.tsx',
    'app/admin/events/event-stream-client.tsx',
  ];

  for (const f of UI_FILES) {
    it(`${f} offers every namespace`, () => {
      if (!exists(`frontend/${f}`)) return;
      const src = stripComments(read(`frontend/${f}`));

      // Deriving from the registry is the strongest form of agreement — nothing to drift.
      // Measured on CODE: see the note above this describe block.
      if (/EVENT_NAMESPACES/.test(src)) return;

      for (const ns of CANON) {
        expect(
          new RegExp(`['"\`]${ns}['"\`]`).test(src),
          `${f} hard-codes a namespace list and omits '${ns}'. A customer cannot filter by a `
          + 'namespace that has no control, however many rows it holds. Derive the list from '
          + 'EVENT_NAMESPACES instead of typing it out.',
        ).toBe(true);
      }
    });
  }

  /**
   * AND THE LIST OF UI FILES IS ITSELF DISCOVERED, not maintained — the failure above was a file
   * nobody thought to add to a list, so a fixed list would reproduce it exactly one component from
   * now. Anything that pairs three namespace string literals is a copy of the registry.
   */
  it('no OTHER component quietly holds a partial copy', () => {
    const roots = ['app', 'components'];
    const found: string[] = [];
    const walk = (dir: string) => {
      const abs = path.join(REPO, 'frontend', dir);
      if (!fs.existsSync(abs)) return;
      for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
        const next = path.join(dir, e.name);
        if (e.isDirectory()) { walk(next); continue; }
        if (!/\.tsx?$/.test(e.name)) continue;
        const raw = stripComments(read(path.join('frontend', next)));
        // ⚠️ AN EMIT IS NOT A LIST, and the first version could not tell them apart. A route that
        // posts to three namespaces writes `namespace: 'library'` three times in three separate
        // calls — normal, correct, and nothing to do with offering a person a choice. It reported
        // three such routes as holding "a partial copy of the registry", which is the same
        // signal-conflation this file exists to catch, committed by the check itself.
        //
        // So the emit sites are removed before counting. What is left is a namespace named for
        // some OTHER reason, and three of those together is a list.
        const src = raw
          .replace(/namespace\s*[:=]\s*['"`][a-z]+['"`]/g, ' ')
          .replace(/namespace\s+IN\s*\([^)]*\)/gi, ' ');
        const quoted = CANON.filter((ns) => new RegExp(`['"\`]${ns}['"\`]`).test(src));
        if (quoted.length >= 3 && quoted.length < CANON.length && !/EVENT_NAMESPACES/.test(raw)) {
          found.push(`${next} — has ${quoted.join(',')} · missing ${CANON.filter((n) => !quoted.includes(n)).join(',')}`);
        }
      }
    };
    for (const r of roots) walk(r);

    // A file may legitimately name a SUBSET — the notification bell selects four namespaces on
    // purpose, and the reason is written at the query. Those are listed here with their reason
    // rather than excluded by a pattern, because an unexplained exemption is how the next real one
    // hides behind it.
    const EXCUSED: Record<string, string> = {
      'app/api/portal/[tenantSlug]/notifications/route.ts':
        'the bell deliberately selects a subset; the omission of project for a partner_user is '
        + 'load-bearing and documented at the query',
      'app/portal/[tenantSlug]/activity/activity-stream-client.tsx':
        'derives from EVENT_NAMESPACES (matched only by its label map)',
    };
    const real = found.filter((f) => !Object.keys(EXCUSED).some((k) => f.startsWith(k)));
    expect(real, `component(s) holding a PARTIAL copy of the namespace registry:\n  ${real.join('\n  ')}`)
      .toEqual([]);
  });
});

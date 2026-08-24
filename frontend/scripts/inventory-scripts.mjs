/**
 * GENERATE docs/SCRIPT_INVENTORY.md — what every harness script is, and whether anything needs it.
 *
 * WHY THIS IS GENERATED AND NOT WRITTEN. A hand-maintained list of "which scripts matter" is wrong
 * the day after it is written, and its wrongness is invisible — which is the same property that let
 * fixture rot sit unnoticed (B98-B102). So every column here is EVIDENCE, computed fresh:
 *
 *   · who calls it        — the branch-drive runner, package.json, another script, a doc
 *   · does it still work  — does it hold an identifier the database no longer has (the audit's rule)
 *   · when was it touched — git's answer, not a guess
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It does not mark anything "deprecated" on its own authority.
 * Deprecation is a DECISION; this can only observe that nothing references a script and that it can
 * no longer run. Those go in a section that asks for a call rather than announcing one.
 *
 *   cd frontend && DATABASE_URL_OWNER=… node scripts/inventory-scripts.mjs
 */
import { readFileSync, readdirSync, existsSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL_OWNER || process.env.DATABASE_URL, { max: 4 });
const files = readdirSync('scripts').filter((f) => /\.(mjs|mts|sh)$/.test(f)).sort();
const libs = existsSync('scripts/lib')
  ? readdirSync('scripts/lib').filter((f) => /\.(mjs|mts)$/.test(f)).map((f) => `lib/${f}`).sort() : [];
const all = [...files, ...libs];
const src = new Map(all.map((f) => [f, readFileSync(`scripts/${f}`, 'utf8')]));

// ── who calls it ────────────────────────────────────────────────────────────────────────────────
const runner = src.get('run-branch-drives.sh') ?? '';
const suite = new Set([...runner.matchAll(/"[a-z0-9-]+\|scripts\/([^"]+)"/g)].map((m) => m[1]));
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const pkgText = JSON.stringify(pkg.scripts ?? {});

/**
 * Every markdown file in the repo, so "a doc tells someone to run this" counts as a reference.
 *
 * EXCLUDING THIS FILE'S OWN OUTPUT. `SCRIPT_INVENTORY.md` names every script in the tree, so once
 * it exists a naive scan finds every script "documented" — and the second run of this generator
 * duly reported 190 DOCUMENTED and zero UNREFERENCED, having read its own previous answer as
 * evidence. The instrument was measuring itself. Excluded by name, and the exclusion is the
 * load-bearing line in this function.
 */
const docText = execSync(
  `find .. -name '*.md' -not -path '*/node_modules/*' -not -path '*/.next/*' `
  + `-not -name 'SCRIPT_INVENTORY.md' -print0 | xargs -0 cat`,
  { encoding: 'utf8', maxBuffer: 200 * 1024 * 1024 });

const calledByScript = new Map(all.map((f) => [f, new Set()]));
for (const [caller, text] of src) {
  for (const f of all) {
    const base = f.replace(/^lib\//, '');
    if (caller === f) continue;
    if (text.includes(`scripts/${f}`) || text.includes(`./${f}`) || text.includes(`./lib/${base}`)) {
      calledByScript.get(f).add(caller);
    }
  }
}

// ── does it still work: the audit's rule, reused verbatim ───────────────────────────────────────
const UUID = /['"]([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})['"]/g;
const EMAIL = /['"]([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})['"]/g;
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*(\/\/|#).*$/gm, '');
const guarded = (l) => /process\.env\.[A-Z_]+\s*(\?\?|\|\|)/.test(l)
  || /\b(TEMP|PROBE|SCENARIO|FIXTURE|THROWAWAY|NEW)_/.test(l) || /@scenario\.test|zz\./.test(l);
const literals = new Map();
for (const [f, text] of src) {
  const hits = [];
  for (const line of strip(text).split('\n')) {
    for (const m of line.matchAll(UUID)) {
      if (m[1] !== '00000000-0000-0000-0000-000000000000') hits.push({ k: 'uuid', v: m[1], g: guarded(line) });
    }
    for (const m of line.matchAll(EMAIL)) hits.push({ k: 'email', v: m[1], g: guarded(line) });
  }
  literals.set(f, hits);
}
const uuids = [...new Set([...literals.values()].flat().filter((h) => h.k === 'uuid').map((h) => h.v))];
const emails = [...new Set([...literals.values()].flat().filter((h) => h.k === 'email').map((h) => h.v))];
const tables = (await sql`
  SELECT c.relname FROM pg_class c
  JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'id' AND NOT a.attisdropped
  JOIN pg_type t ON t.oid = a.atttypid AND t.typname = 'uuid'
  WHERE c.relkind = 'r' AND c.relnamespace = 'public'::regnamespace`).map((r) => r.relname);
const alive = new Set();
if (uuids.length) {
  const u = tables.map((t) => `SELECT id FROM "${t}" WHERE id = ANY($1::uuid[])`).join(' UNION ');
  for (const r of await sql.unsafe(u, [uuids])) alive.add(r.id);
}
const liveEmail = new Set((await sql`SELECT email FROM users WHERE email = ANY(${emails})`).map((r) => r.email));
const rot = (f) => literals.get(f).filter((h) => !h.g
  && (h.k === 'uuid' ? !alive.has(h.v) : !liveEmail.has(h.v) && !/example\.(com|org)$/.test(h.v))).length;

// ── when was it touched ─────────────────────────────────────────────────────────────────────────
const touched = (f) => {
  try {
    return execSync(`git log -1 --format=%cs -- frontend/scripts/${f}`, { cwd: '..', encoding: 'utf8' }).trim()
      || '—';
  } catch { return '—'; }
};

// ── classify, on evidence only ──────────────────────────────────────────────────────────────────
const LENSES = new Set(['verify-surfaces.mjs', 'verify-api-contract.mjs', 'verify-db-crud.mjs', 'verify-ui-vs-db.mjs']);
const RULERS = new Set(['verify-ruler-on-proposals.mts', 'verify-ruler-on-stored-artifacts.mts',
  'verify-exports-on-stored-artifacts.mts', 'calibrate-page-ruler.mts', 'calibrate-slide-ruler.mts',
  'sweep-mold-quality.mts', 'diagnose-mold-ruler.mts']);

const classify = (f) => {
  if (f.startsWith('lib/')) return 'LIBRARY';
  if (suite.has(f)) return 'SUITE';
  if (LENSES.has(f)) return 'LENS';
  if (f.startsWith('crosscheck-')) return 'CROSS-CHECK';
  if (RULERS.has(f)) return 'RULER';
  if (calledByScript.get(f).size > 0) return 'CALLED-BY-ANOTHER';
  if (pkgText.includes(f)) return 'NPM-WIRED';
  if (docText.includes(f)) return 'DOCUMENTED';
  return rot(f) > 0 ? 'CANNOT-RUN' : 'UNREFERENCED';
};
const rows = all.map((f) => ({
  f, cls: classify(f), rot: rot(f), touched: touched(f),
  callers: [...calledByScript.get(f)].slice(0, 2).join(', '),
}));

const ORDER = ['SUITE', 'LENS', 'CROSS-CHECK', 'RULER', 'LIBRARY', 'CALLED-BY-ANOTHER', 'NPM-WIRED',
  'DOCUMENTED', 'UNREFERENCED', 'CANNOT-RUN'];
const MEANING = {
  SUITE: 'Runs on every `run-branch-drives.sh`. This is the regression net.',
  LENS: 'One of the four lenses. Run after a UI change or a deploy.',
  'CROSS-CHECK': 'Shares no code with the lenses — the thing that can dissent. Not a fifth lens.',
  RULER: 'Canvas measurement + calibration. Anything touching layout or export runs these.',
  LIBRARY: 'Imported by other scripts; never run directly.',
  'CALLED-BY-ANOTHER': 'Invoked by another script rather than by a person.',
  'NPM-WIRED': 'Reachable via `npm run` — package.json names it.',
  DOCUMENTED: 'No code references it, but a document tells someone to run it.',
  UNREFERENCED: 'Nothing references it and it holds no dead identifier. It may still work — nobody knows. **Needs a call.**',
  'CANNOT-RUN': 'Nothing references it AND it drives an identifier the database no longer has. It cannot do what it says. **Needs a call.**',
};

let md = `# SCRIPT_INVENTORY.md — every harness script, and whether anything needs it

> **Generated** by \`frontend/scripts/inventory-scripts.mjs\`. Do not hand-edit: every column is
> computed evidence, and a hand-maintained version would be wrong the day after it was written —
> invisibly, which is exactly the property that let fixture rot sit unnoticed (B98–B102).
>
> Regenerate: \`cd frontend && DATABASE_URL_OWNER=… node scripts/inventory-scripts.mjs\`

## What the columns mean

| column | evidence |
|---|---|
| **class** | who references it — the branch-drive runner, package.json, another script, a doc, or nothing |
| **rot** | count of identifiers it drives that the live database no longer has (env-var fallbacks and literals it CREATES do not count) |
| **touched** | git's date for the last commit to that file |

**Nothing here is marked "deprecated."** Deprecation is a decision. This can observe that nothing
references a script and that it can no longer run; the sections at the bottom collect those and ask
for a call rather than announcing one.

**"Validated" is not a column, on purpose.** Whether a script passes is a property of *today's* run,
not of the file, and freezing it here would recreate the problem this document exists to prevent —
a stale green nobody re-checks. The live answer is \`bash scripts/run-branch-drives.sh\`, whose
table is the record. Everything in **SUITE** below ran in that suite; everything else did not.

`;
for (const cls of ORDER) {
  const group = rows.filter((r) => r.cls === cls);
  if (!group.length) continue;
  md += `\n## ${cls} — ${group.length}\n\n${MEANING[cls]}\n\n`;
  md += '| script | rot | touched |' + (cls === 'CALLED-BY-ANOTHER' ? ' called by |' : '') + '\n';
  md += '|---|---|---|' + (cls === 'CALLED-BY-ANOTHER' ? '---|' : '') + '\n';
  for (const r of group.sort((a, b) => a.f.localeCompare(b.f))) {
    md += `| \`${r.f}\` | ${r.rot || '—'} | ${r.touched} |`
      + (cls === 'CALLED-BY-ANOTHER' ? ` ${r.callers} |` : '') + '\n';
  }
}
// ── THE QUADRANT THAT ACTUALLY BITES ────────────────────────────────────────────────────────────
//
// Unreferenced-and-rotted is inert: nobody runs it, so it misleads nobody. DOCUMENTED-and-rotted is
// the dangerous one — a document tells a person to run it, they do, and it drives an identifier
// that is gone. That is the exact shape of the eight false findings this week, except aimed at a
// human instead of a suite. It gets its own section, first among the sections that ask for a call.
const trap = rows.filter((r) => (r.cls === 'DOCUMENTED' || r.cls === 'NPM-WIRED') && r.rot > 0);
if (trap.length) {
  md += `\n---\n\n## ⚠ Documented but rotted — ${trap.length}\n\n`
    + 'A document tells someone to run these, and each drives at least one identifier the database no\n'
    + 'longer has. They will fail confusingly rather than loudly. Either the script needs the\n'
    + '"build the scenario it needs" treatment, or the document should stop pointing at it.\n\n'
    + '| script | rot | touched |\n|---|---|---|\n';
  for (const r of trap.sort((a, b) => b.rot - a.rot)) {
    md += `| \`${r.f}\` | ${r.rot} | ${r.touched} |\n`;
  }
}

md += `\n---\n\n## Totals\n\n| class | count |\n|---|---|\n`;
for (const cls of ORDER) {
  const n = rows.filter((r) => r.cls === cls).length;
  if (n) md += `| ${cls} | ${n} |\n`;
}
md += `| **total** | **${rows.length}** |\n`;

writeFileSync('../docs/SCRIPT_INVENTORY.md', md);
console.log(`wrote docs/SCRIPT_INVENTORY.md — ${rows.length} scripts`);
for (const cls of ORDER) {
  const n = rows.filter((r) => r.cls === cls).length;
  if (n) console.log(`  ${cls.padEnd(20)} ${n}`);
}
await sql.end();

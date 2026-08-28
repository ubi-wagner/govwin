/**
 * HOW MUCH OF THE LIVE SAFETY NET IS POINTING AT THINGS THAT NO LONGER EXIST?
 *
 * "Fixture rot" is countable, not a vibe. But the raw count over every script in the tree
 * overstates it three ways, and each correction matters:
 *
 *   1. MOST SCRIPTS ARE NOT THE SAFETY NET. `immo-*`, `t3cp-*`, `seed-*` and the one-off probes are
 *      historical: they built an artifact once, in a sprint that is over. A dead uuid in one of
 *      those is a dead script, not a blind spot — nothing runs it and nothing reports it green.
 *      What matters is the estate that RUNS: the 27 branch drives, the four lenses, and the two
 *      capture harnesses that produce the guides.
 *   2. A DEAD LITERAL BEHIND AN ENV VAR IS UNREACHABLE. `process.env.TEST_TENANT_ID ?? '<uuid>'`
 *      never reads the uuid when the runner exports the variable — which it does, resolved from the
 *      live database. That is the "resolve, don't pin" pattern already applied; the literal is a
 *      documented last resort, not a live dependency.
 *   3. A LITERAL IN A COMMENT IS PROSE.
 *   4. AN ID THAT IS *SUPPOSED* TO RESOLVE TO NOTHING IS THE FIXTURE, NOT ROT. A drive proving a
 *      refusal — "assigning to somebody not on the project is refused", "a comment anchored at a
 *      milestone from another contract is refused" — needs an id that exists nowhere. Absent from
 *      the database is the CORRECT and required state for it, and flagging it asks somebody to
 *      "resolve or build" a row whose absence is the whole assertion. Marked by NAME, using the
 *      same signal as correction 1 — a comment cannot carry it, because comments are stripped
 *      before the scan.
 *
 * So this reports three numbers, narrowest first, and the narrowest is the one to worry about.
 */
import { readFileSync, readdirSync, existsSync } from 'fs';
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL_OWNER || process.env.DATABASE_URL, { max: 4 });
const UUID = /['"]([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})['"]/g;
const EMAIL = /['"]([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})['"]/g;

// ── the LIVE safety net, read from the runner rather than hand-listed ──────────────────────────
const runner = readFileSync('scripts/run-branch-drives.sh', 'utf8');
const suite = [...runner.matchAll(/"[a-z0-9-]+\|(scripts\/[^"]+)"/g)].map((m) => m[1].replace('scripts/', ''));
const LENSES = ['verify-surfaces.mjs', 'verify-api-contract.mjs', 'verify-db-crud.mjs', 'verify-ui-vs-db.mjs'];
const CAPTURES = ['capture-guides.mjs'];
const NET = new Set([...suite, ...LENSES, ...CAPTURES].filter((f) => existsSync(`scripts/${f}`)));

const all = readdirSync('scripts').filter((f) => /\.(mjs|mts)$/.test(f)).sort();

/** Strip comments so prose does not count as a dependency, then find literals. */
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
/** Is this literal a fallback behind an env var on the same line? Then it is unreachable in the suite. */
const guarded = (line) => /process\.env\.[A-Z_]+\s*(\?\?|\|\|)/.test(line);
/**
 * A literal the script CREATES looks exactly like one it CONSUMES — and the first version of this
 * audit could not tell them apart, so it flagged `drive-collaborator-boundary`'s TEMP_EMAIL, an
 * address that drive invents and then deletes. "Absent from the database" is the CORRECT state for
 * a fixture a script is about to make. Naming conventions are the only signal available here, so
 * they are honoured explicitly rather than silently: TEMP/PROBE/SCENARIO/FIXTURE-marked constants
 * are declarations of intent to create.
 */
const CREATES = /\b(TEMP|PROBE|SCENARIO|FIXTURE|THROWAWAY|NEW)_/;
/**
 * …and the mirror of it: a constant whose name DECLARES that the row must not exist. A drive
 * proving a refusal needs an id that resolves to nothing, and "absent" is its required state.
 *
 * Deliberately a narrow, explicit vocabulary rather than a general opt-out: somebody has to name
 * the constant this way, which is an act, and it reads at every use site — `assigneeUserId: NOBODY`
 * says what it is doing where it is doing it.
 */
// No trailing \b: `_` is a word character, so `\bNOBODY\b` does NOT match `NOBODY_EMAIL` — the
// first version of this correction silently did nothing, which is the failure mode a correction to
// an over-counting audit must not have. `CREATES` above is prefix-shaped for the same reason.
const ABSENT = /\b(ABSENT|NOBODY|STRANGER|NOT_ON|NONEXISTENT|ELSEWHERE)/;
const creating = (line) => CREATES.test(line) || ABSENT.test(line) || /@scenario\.test|zz\./.test(line);

const scan = (file) => {
  const src = strip(readFileSync(`scripts/${file}`, 'utf8'));
  const out = [];
  for (const line of src.split('\n')) {
    for (const m of line.matchAll(UUID)) {
      if (m[1] === '00000000-0000-0000-0000-000000000000') continue;
      out.push({ kind: 'uuid', v: m[1], guarded: guarded(line) || creating(line) });
    }
    for (const m of line.matchAll(EMAIL)) {
      out.push({ kind: 'email', v: m[1], guarded: guarded(line) || creating(line) });
    }
  }
  return out;
};

const perFile = new Map(all.map((f) => [f, scan(f)]));
const uuids = [...new Set([...perFile.values()].flat().filter((h) => h.kind === 'uuid').map((h) => h.v))];
const emails = [...new Set([...perFile.values()].flat().filter((h) => h.kind === 'email').map((h) => h.v))];

const tables = (await sql`
  SELECT c.relname FROM pg_class c
  JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'id' AND NOT a.attisdropped
  JOIN pg_type t ON t.oid = a.atttypid AND t.typname = 'uuid'
  WHERE c.relkind = 'r' AND c.relnamespace = 'public'::regnamespace`).map((r) => r.relname);
const alive = new Set();
if (uuids.length) {
  const union = tables.map((t) => `SELECT id FROM "${t}" WHERE id = ANY($1::uuid[])`).join(' UNION ');
  for (const r of await sql.unsafe(union, [uuids])) alive.add(r.id);
}
const liveEmail = new Set((await sql`SELECT email FROM users WHERE email = ANY(${emails})`).map((r) => r.email));
const isDead = (h) => (h.kind === 'uuid' ? !alive.has(h.v) : !liveEmail.has(h.v) && !/example\.(com|org)$/.test(h.v));

const report = (label, files) => {
  const rows = [];
  for (const f of files) {
    const dead = (perFile.get(f) ?? []).filter(isDead);
    const reachable = dead.filter((h) => !h.guarded);
    if (dead.length) rows.push({ f, dead: dead.length, reachable: reachable.length, sample: reachable[0] ?? dead[0] });
  }
  const bad = rows.filter((r) => r.reachable > 0);
  console.log(`\n${label}`);
  console.log(`  scripts:                        ${files.length}`);
  console.log(`  holding ANY dead literal:       ${rows.length}`);
  console.log(`  holding a REACHABLE dead one:   ${bad.length}   ← the number that matters`);
  for (const r of bad.sort((a, b) => b.reachable - a.reachable)) {
    console.log(`     ✗ ${r.f.padEnd(40)} ${r.reachable} reachable  ${r.sample.kind} ${String(r.sample.v).slice(0, 12)}…`);
  }
  return bad.length;
};

const netBad = report('LIVE SAFETY NET (branch suite + four lenses + guide capture)', [...NET]);
report('EVERYTHING ELSE (one-off sprint scripts, seeds, probes — nothing runs these on a schedule)',
  all.filter((f) => !NET.has(f)));
console.log(`\n${netBad === 0
  ? '✅ nothing in the live safety net depends on an identifier that no longer exists.'
  : `❌ ${netBad} script(s) in the live safety net can still drive a dead identifier.`}\n`);
await sql.end();
process.exit(netBad === 0 ? 0 : 1);

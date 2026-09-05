#!/usr/bin/env node
/**
 * Does the deployment documentation name every variable the code actually reads?
 *
 * ── WHY A CHECKER AND NOT AN EDIT ────────────────────────────────────────────────────────────
 * `docs/SECRETS_INVENTORY.md` and `docs/RAILWAY_ENV_VARS.md` are the two documents an operator
 * reads before a deploy, and both are hand-maintained. On its first accurate run this found
 * **9 undocumented variables** — the storage switch (`STORAGE_DRIVER`, `LOCAL_STORAGE_DIR`,
 * `AWS_REGION`), four capability gates (`ATOM_EMBED`, `ATOM_OCR`, `ATOM_VISION`,
 * `VISUAL_REVIEW`), a proposer switch and a matching threshold.
 *
 * The number matters less than how it was reached. A hand-rolled grep first said **25**, and it
 * was wrong on BOTH sides: it matched bare ALL-CAPS words in the docs (counting prose like "CORS"
 * as a documented variable) and missed `process.env['X']` in the code. The instrument that reads
 * only backticked names and both access idioms says 9. First output describes the harness.
 *
 * A missing row is not a tidiness problem. It is a variable nobody sets in Railway, a capability
 * that silently does nothing in production, and a debugging session that starts from a document
 * asserting the variable does not exist. This repo has already learned the general form of that
 * lesson once — CLAUDE_CLIFFNOTES §1 froze at migration 067 and misled for 135 migrations — which
 * is why `SCHEMA_MAP.md` is generated. The env inventory is the same shape of document, and it
 * had the same problem.
 *
 * So: sweep the code, parse the docs, and report the difference in BOTH directions.
 *
 *   UNDOCUMENTED  read by code, named in neither doc — an operator cannot know to set it
 *   STALE         named in a doc, read by nothing — an operator sets it for no reason
 *   EXEMPT        deliberately not operator-configurable, each with a stated reason
 *
 * ── WHAT IS EXEMPT, AND WHY THAT LIST IS EXPLICIT ────────────────────────────────────────────
 * Some variables are supplied BY the platform (`RAILWAY_*`, `NODE_ENV`, `PORT`), or exist only
 * inside the test harness (`PLAYWRIGHT_*`, `GUIDE_*`). Documenting them as things to set would be
 * wrong. But "exempt" has to be a decision somebody wrote down, not a silent filter — an
 * unexplained exclusion is how a real variable disappears from an operator's checklist.
 *
 *   cd frontend && node scripts/audit-env-inventory.mjs
 *   node scripts/audit-env-inventory.mjs --check    # self-test only
 * Exit 0 when both docs are complete; 1 when something is undocumented; 2 on a harness defect.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');

/** Where the running services read configuration from. Harness + script trees are NOT swept. */
const CODE_ROOTS = [
  'frontend/app', 'frontend/lib', 'frontend/components', 'frontend/auth.ts', 'frontend/middleware.ts',
  'frontend/instrumentation.ts', 'frontend/next.config.ts',
  'pipeline/src', 'services/cms/src',
];
const DOCS = ['docs/SECRETS_INVENTORY.md', 'docs/RAILWAY_ENV_VARS.md', 'RAILWAY.md'];

/**
 * Not operator-configurable. Each entry carries the reason, because an unexplained exclusion is
 * indistinguishable from an oversight the next time somebody reads this list.
 */
const EXEMPT = {
  NODE_ENV: 'set by the build/runtime, never by an operator',
  NEXT_PHASE: 'set by Next during build',
  PORT: 'injected by the platform',
  HOSTNAME: 'injected by the platform',
  RAILWAY_ENVIRONMENT: 'injected by Railway',
  RAILWAY_ENVIRONMENT_NAME: 'injected by Railway',
  RAILWAY_GIT_COMMIT_SHA: 'injected by Railway',
  APP_RELEASE: 'derived from the Railway commit sha at build time',
  PLAYWRIGHT_BROWSERS_PATH: 'test harness only — the sandbox browser location',
  PLAYWRIGHT_CHROMIUM_EXECUTABLE: 'test harness only',
  PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: 'test harness only',
  // Both are TEST-ONLY session-bound shorteners, refused when NODE_ENV === 'production' and able
  // only to make a bound SHORTER (lib/session-policy.ts, pinned in __tests__/session-policy.test.ts).
  // Exempt rather than documented BECAUSE they must never appear on an operator's checklist: a
  // variable in RAILWAY_ENV_VARS.md reads as one somebody may set, and these two exist purely so
  // scripts/prove-session-cap.mts can drive a 12-hour cap and a 2-hour idle window in 90 seconds.
  SESSION_CAP_MS_OVERRIDE: 'test harness only — refused in production, and can only shorten a bound',
  SESSION_IDLE_MS_OVERRIDE: 'test harness only — refused in production, and can only shorten a bound',
};

function walk(p, out = []) {
  const abs = path.join(REPO, p);
  if (!existsSync(abs)) return out;
  if (statSync(abs).isFile()) { out.push(abs); return out; }
  for (const e of readdirSync(abs)) {
    if (e === 'node_modules' || e === '__pycache__' || e === '.next' || e.startsWith('.')) continue;
    walk(path.join(p, e), out);
  }
  return out;
}

/**
 * Every environment variable the services read.
 *
 * Both idioms, because the tree is two languages: `process.env.NAME` / `process.env['NAME']` in
 * TypeScript, and `os.environ[...]` / `os.getenv(...)` in Python. A name reached only through a
 * computed key cannot be found by any static scan and is not claimed to be.
 */
function readByCode() {
  const found = new Map();   // NAME → Set(relative file)
  const add = (name, file) => {
    if (!found.has(name)) found.set(name, new Set());
    found.get(name).add(path.relative(REPO, file));
  };
  const files = CODE_ROOTS.flatMap((r) => walk(r));
  for (const f of files) {
    if (!/\.(ts|tsx|js|mjs|py)$/.test(f)) continue;
    const text = readFileSync(f, 'utf8');
    for (const m of text.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) add(m[1], f);
    for (const m of text.matchAll(/process\.env\[\s*['"]([A-Z][A-Z0-9_]*)['"]\s*\]/g)) add(m[1], f);
    for (const m of text.matchAll(/os\.environ(?:\.get)?\[?\(?\s*['"]([A-Z][A-Z0-9_]*)['"]/g)) add(m[1], f);
    for (const m of text.matchAll(/os\.getenv\(\s*['"]([A-Z][A-Z0-9_]*)['"]/g)) add(m[1], f);
    /**
     * THE INDIRECTION THIS AUDIT WAS BLIND TO.
     *
     * `pipeline/src/main.py` reads its scheduled-poke URLs through one helper:
     *
     *     _run_poker('card reconcile sweep', 'CARD_RECONCILE_URL', 3600, _reconcile_report)
     *     async def _run_poker(name, url_var, ...):  url = os.environ.get(url_var)
     *
     * so the only `os.environ.get` in the tree takes a VARIABLE, and the name itself never appears
     * next to it. The header above is honest that a computed key cannot be found by a static scan —
     * but the effect was that THREE deployment-critical variables were invisible here, and none of
     * them was in the canonical deploy docs either. Each one gates a sweep that ships inert when
     * unset: the card reconcile that heals a tenant who never opens their feed, the agent-gate
     * auto-advance, and the space-presence sweep that closes an "opened your workspace" bracket
     * whose owner shut the tab. Silently doing nothing in production is the exact failure this
     * audit exists to catch, and it could not see its own best examples.
     *
     * The call site names the variable as a literal, so it IS statically findable — just not by a
     * pattern that only looks where the read happens. Matched here as its own idiom rather than by
     * loosening the others, because a rule that accepted any quoted ALL-CAPS string would start
     * counting log tags and dict keys as environment variables.
     */
    for (const m of text.matchAll(/_run_poker\(\s*['"][^'"]*['"]\s*,\s*['"]([A-Z][A-Z0-9_]*)['"]/g)) add(m[1], f);
  }
  return found;
}

/**
 * Names the docs actually DOCUMENT.
 *
 * Only inside backticks. The first version matched any ALL-CAPS word, which counted prose like
 * "CORS" and "SCHEDULING" as documented variables — a parser that invents rows on the doc side
 * under-reports the gap, which is the dangerous direction here.
 */
function namedInDocs() {
  const found = new Map();
  for (const d of DOCS) {
    const abs = path.join(REPO, d);
    if (!existsSync(abs)) continue;
    const text = readFileSync(abs, 'utf8');
    // Any NAME inside a backticked span, not only a span that IS the name. The docs write
    // `ATOM_OCR=off` and `AWS_S3_BUCKET_NAME` alike, and requiring the whole span to be the
    // identifier reported both `ATOM_OCR` and `ATOM_VISION` as undocumented while section E
    // explains exactly what they do. Backticks still keep prose out, which is the property that
    // matters — the first version matched bare ALL-CAPS words and counted "CORS" as a variable.
    for (const span of text.matchAll(/`([^`\n]{2,120})`/g)) {
      for (const m of span[1].matchAll(/\b([A-Z][A-Z0-9_]{2,})\b/g)) {
        if (!found.has(m[1])) found.set(m[1], new Set());
        found.get(m[1]).add(d);
      }
    }
  }
  return found;
}

const code = readByCode();
const docs = namedInDocs();

const undocumented = [...code.keys()].filter((n) => !docs.has(n) && !(n in EXEMPT)).sort();
const exempted = [...code.keys()].filter((n) => n in EXEMPT).sort();
// A doc name nothing reads. Swept across the WHOLE repo, not just the service roots: a variable
// read only by a harness or a shell script is still real, and calling it stale would be wrong.
const everything = readFileSync(path.join(REPO, 'docs/SECRETS_INVENTORY.md'), 'utf8');
// DEPLOYMENT FILES COUNT AS CODE HERE. `CMS_SERVICE_URL` lives in `docker-compose.yml` and
// `SEED_DEV_ACCOUNTS` in the frontend Dockerfile + entrypoint — both are read at run time by
// something, and calling them stale because the sweep only knew about source files would have
// deleted two live rows from an operator's checklist. A false "stale" is the dangerous direction
// on this side: nobody argues with a doc that dropped a variable.
const allCode = [...walk('frontend/scripts'), ...walk('scripts'), ...walk('pipeline'), ...walk('services'),
  ...walk('frontend/app'), ...walk('frontend/lib'), ...walk('frontend/components'),
  ...walk('docker-compose.yml'), ...walk('frontend/Dockerfile'), ...walk('frontend/entrypoint.sh'),
  ...walk('.github')]
  .filter((f) => /(\.(ts|tsx|js|mjs|mts|py|sh|ya?ml|json)|Dockerfile.*|entrypoint\.sh)$/.test(f))
  .map((f) => { try { return readFileSync(f, 'utf8'); } catch { return ''; } }).join('\n');
const stale = [...docs.keys()].filter((n) => !new RegExp(`\\b${n}\\b`).test(allCode)).sort();

// ── SELF-TEST ────────────────────────────────────────────────────────────────────────────────
const SELF = [
  { why: 'DATABASE_URL is read by code AND documented — the baseline case',
    ok: () => code.has('DATABASE_URL') && docs.has('DATABASE_URL') },
  { why: 'the doc parser reads only backticked names, so prose is not counted as documented',
    ok: () => !docs.has('CORS') && !docs.has('SCHEDULING') },
  { // Both are documented in section E as `ATOM_OCR=off` / `ATOM_VISION=off` — a name with a
    // value attached is still a documented name.
    why: 'a name written inside a larger backticked span counts as documented',
    ok: () => docs.has('ATOM_OCR') && docs.has('ATOM_VISION') },
  { why: 'a platform-injected name is exempt WITH a reason, never silently dropped',
    ok: () => Object.values(EXEMPT).every((r) => typeof r === 'string' && r.length > 8) },
  { why: 'the Python idiom is swept, not just the TypeScript one',
    ok: () => [...code.entries()].some(([, files]) => [...files].some((f) => f.endsWith('.py'))) },
  { // A name passed INTO the poker helper and read there through a variable. All three were
    // invisible until the idiom was matched, and each gates a sweep that ships inert when unset —
    // the audit could not see its own best examples of "a capability that silently does nothing".
    why: 'a variable named only at a _run_poker call site is still found',
    ok: () => ['CARD_RECONCILE_URL', 'AGENT_GATE_SWEEP_URL', 'SPACE_PRESENCE_SWEEP_URL']
      .every((n) => code.has(n)) },
  { // Both were reported STALE by the first version, which swept only source files.
    why: 'a variable used only in docker-compose or the Dockerfile is not stale',
    ok: () => !stale.includes('CMS_SERVICE_URL') && !stale.includes('SEED_DEV_ACCOUNTS') },
];
console.log('── self-test ──');
let bad = 0;
for (const t of SELF) {
  let p = false; try { p = Boolean(t.ok()); } catch { p = false; }
  console.log(`  ${p ? '✓' : '✗'} ${t.why}`);
  if (!p) bad += 1;
}
if (bad) { console.error(`\n✗ ${bad} self-test(s) failed — the counts below would be unearned.`); process.exit(2); }
if (process.argv.includes('--check')) process.exit(0);

console.log(`\n── ${code.size} variable(s) read by the three services · ${docs.size} named in the deploy docs ──\n`);
if (undocumented.length) {
  console.log(`✗ ${undocumented.length} UNDOCUMENTED — an operator cannot know to set these:`);
  for (const n of undocumented) {
    console.log(`  · ${n}  ← ${[...code.get(n)].slice(0, 2).join(', ')}`);
  }
} else {
  console.log('✓ every variable the services read is named in the deploy documentation.');
}
if (stale.length) {
  console.log(`\n⚠ ${stale.length} named in a doc but read NOWHERE in the repo (candidates, not findings —`);
  console.log('  a name can legitimately appear in prose about a third-party service):');
  for (const n of stale) console.log(`  · ${n}`);
}
console.log(`\n· ${exempted.length} exempt (platform-injected or harness-only), each with a stated reason`);
process.exit(undocumented.length ? 1 : 0);

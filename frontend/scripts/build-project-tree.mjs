/**
 * THE STATIC BASELINE — every file in the system, what it is, who uses it, and what it uses.
 *
 * ── WHAT THIS IS FOR ───────────────────────────────────────────────────────────────────────────
 * `docs/DATA_FLOW.md` is the request path in section: seven planes, six traces, the *dynamic*
 * cross-section. `docs/SCHEMA_MAP.md` is the database, generated from the live DB. Neither answers
 * the question you actually have in front of a file you did not write:
 *
 *     What is this? Who calls it, and for what? What does it reach for, and why?
 *     If I change it, what breaks?
 *
 * Three existing inventories each answer a slice — `FRONTEND_INVENTORY` covers `frontend/` only,
 * `SCRIPT_INVENTORY` covers harnesses, `inventory-crm` covers the CMS — and each enumerates its
 * own scope, which is exactly the failure mode that put 213 write verbs outside every coverage
 * number (B125). This is the whole tree in one graph, with the edges annotated in both directions.
 *
 * ── WHAT IT REFUSES TO DO ──────────────────────────────────────────────────────────────────────
 * **It never writes a description it did not read.** Every `description` is the file's own leading
 * comment or docstring, trimmed — never a summary inferred from the path, and never generated
 * prose. A file with no header gets `null` and is counted, because "nobody wrote down what this is"
 * is a finding and an invented sentence would bury it.
 *
 * **It never drops what it cannot resolve.** An import that does not land on a file in this repo is
 * classed `external` (a package) or `UNRESOLVED` (a relative specifier that points at nothing), and
 * the unresolved ones are listed. A dependency graph that silently drops edges reports a file as
 * unused when it is not — which is worse than no graph, because it invites a deletion.
 *
 * ── THE "WHY" ON EACH EDGE ─────────────────────────────────────────────────────────────────────
 * An edge without a reason is a line on a diagram. The reason here is measured, not narrated: the
 * SYMBOLS actually imported (`withTenant`, `emitEventSingle`, `describeEvent`). That is the real
 * answer to "why does A use B" at the only resolution a static tool can honestly claim.
 *
 * ── AND THE SCHEMA HALF ────────────────────────────────────────────────────────────────────────
 * Each file also carries the TABLES its SQL touches, split read/write, giving a table → files
 * reverse index: the "who reads `tenant_opportunity_cards`" question, answered from source rather
 * than from memory.
 *
 * Run:
 *   node frontend/scripts/build-project-tree.mjs            # regenerate docs/PROJECT_TREE.md + json
 *   node frontend/scripts/build-project-tree.mjs --check    # self-test only, exit 1 on failure
 *   node frontend/scripts/build-project-tree.mjs --file lib/events.ts     # explore one file
 *   node frontend/scripts/build-project-tree.mjs --table proposals        # explore one table
 *   node frontend/scripts/build-project-tree.mjs --trace app/api/.../route.ts   # the static trace
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
const FRONTEND = path.join(REPO, 'frontend');

// ── what is in scope ──────────────────────────────────────────────────────────────────────────
/**
 * The roots. `docs/` is deliberately absent: a document has no imports and no dependents, so every
 * column here would be empty for 200 files and the signal-to-noise of the whole atlas would drop.
 * Documents are indexed by `audit-doc-currency`, which asks a question they can answer.
 */
const ROOTS = ['frontend', 'pipeline', 'services/cms', 'scripts', 'db'];
const SKIP_DIR = new Set([
  'node_modules', '.next', '.git', '__pycache__', 'venv', '.venv', 'dist', 'build',
  '.turbo', 'coverage', '.pytest_cache', 'test-results', 'playwright-report', '.mypy_cache',
]);
const EXT = new Set(['.ts', '.tsx', '.mts', '.cts', '.mjs', '.cjs', '.js', '.jsx', '.py', '.sql', '.sh']);

const walk = (dir, out = []) => {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name.startsWith('.') && e.name !== '.claude') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIR.has(e.name)) continue;
      walk(p, out);
    } else if (EXT.has(path.extname(e.name))) {
      out.push(p);
    }
  }
  return out;
};

const rel = (abs) => path.relative(REPO, abs).split(path.sep).join('/');

const files = [];
for (const root of ROOTS) walk(path.join(REPO, root), files);
files.sort();

// ── classification ────────────────────────────────────────────────────────────────────────────
/**
 * The PLANE, from `docs/DATA_FLOW.md`'s own seven, plus the four kinds of file that are not on the
 * request path at all. Ordered: the first match wins, so the specific patterns precede the general.
 *
 * `harness` before `domain` is load-bearing — `frontend/scripts/**` is full of files that import
 * `lib/db` and would otherwise read as domain code, which would put 190 instruments inside the
 * product's own dependency graph and make every `lib/` module look twice as depended-upon as it is.
 */
const PLANES = [
  [/^db\/migrations\//, 'migration'],
  [/^frontend\/(scripts|e2e)\//, 'harness'],
  [/(^|\/)(__tests__|tests)\//, 'test'],
  [/^pipeline\/tests\//, 'test'],
  [/\.(test|spec)\.[cm]?[jt]sx?$/, 'test'],
  [/^scripts\//, 'harness'],
  [/^frontend\/app\/api\//, '02 API'],
  [/^frontend\/app\//, '01 UI'],
  [/^frontend\/components\//, '01 UI'],
  [/^frontend\/middleware\.ts$/, '02 API'],
  [/^frontend\/lib\/(db|rls|jsonb)\.ts$/, '04 Data'],
  [/^frontend\/lib\/events?(-|\.)/, '05 Events'],
  [/^frontend\/lib\//, '03 Domain'],
  [/^pipeline\/src\/agents?\//, '07 Agents'],
  [/^pipeline\/src\/workflows?\//, '06 Engine'],
  [/^pipeline\/src\/events\.py$/, '05 Events'],
  [/^pipeline\//, '06 Engine'],
  [/^services\/cms\//, '03 Domain'],
  [/^frontend\//, 'config'],
];
const planeOf = (r) => (PLANES.find(([re]) => re.test(r)) ?? [null, 'other'])[1];

const AREAS = [
  [/^frontend\/app\/api\//, 'frontend · api routes'],
  [/^frontend\/app\/admin\//, 'frontend · admin pages'],
  [/^frontend\/app\/portal\//, 'frontend · portal pages'],
  [/^frontend\/app\/\(marketing\)\//, 'frontend · marketing pages'],
  [/^frontend\/app\/\(auth\)\//, 'frontend · auth pages'],
  [/^frontend\/app\//, 'frontend · other pages'],
  [/^frontend\/components\//, 'frontend · components'],
  [/^frontend\/lib\//, 'frontend · lib'],
  [/^frontend\/__tests__\//, 'frontend · unit tests'],
  [/^frontend\/scripts\//, 'frontend · harnesses'],
  [/^frontend\/e2e\//, 'frontend · e2e'],
  [/^frontend\//, 'frontend · config'],
  [/^pipeline\/tests\//, 'pipeline · tests'],
  [/^pipeline\//, 'pipeline'],
  [/^services\/cms\//, 'services · rfp-crm'],
  [/^scripts\//, 'repo · scripts'],
  [/^db\/migrations\//, 'db · migrations'],
  [/^db\//, 'db · other'],
];
const areaOf = (r) => (AREAS.find(([re]) => re.test(r)) ?? [null, 'other'])[1];

// ── the file's own words ──────────────────────────────────────────────────────────────────────
/**
 * The leading block comment or docstring, as prose. NEVER a sentence this tool composed.
 *
 * Takes the first paragraph rather than the whole header, because several files in this tree open
 * with 60 lines of reasoning and the atlas needs the one-line answer — but it takes it VERBATIM,
 * so what you read here is what the author wrote.
 */
function describeSource(src, ext) {
  let text = null;
  if (ext === '.py') return null;            // supplied by the Python pass
  if (ext === '.sql' || ext === '.sh') {
    const lines = src.split('\n');
    const out = [];
    for (const line of lines) {
      const m = line.match(/^\s*(?:--|#)\s?(.*)$/);
      if (m === null) { if (out.length) break; if (line.trim() === '' || line.startsWith('#!')) continue; break; }
      if (/^#!/.test(line)) continue;
      out.push(m[1]);
    }
    text = out.join(' ');
  } else {
    const block = src.match(/^\s*\/\*\*?([\s\S]*?)\*\//);
    if (block) {
      text = block[1].split('\n')
        .map((l) => l.replace(/^\s*\*ic?\s?/, '').replace(/^\s*\*\s?/, '').trimEnd())
        .join('\n');
    } else {
      const lines = src.split('\n');
      const out = [];
      for (const line of lines) {
        const m = line.match(/^\s*\/\/\s?(.*)$/);
        if (!m) { if (out.length) break; if (line.trim() === '') continue; break; }
        out.push(m[1]);
      }
      text = out.join(' ');
    }
  }
  if (!text) return null;
  // First paragraph, then first two sentences of it — enough to identify, short enough to scan.
  const para = text.split(/\n\s*\n/)[0].replace(/\s+/g, ' ').trim();
  if (!para) return null;
  const cut = para.replace(/^[-=─·\s]+/, '').trim();
  return cut.length > 320 ? `${cut.slice(0, 317)}…` : cut;
}

// ── SQL the file touches ──────────────────────────────────────────────────────────────────────
/**
 * Tables, split by whether the file READS or WRITES them.
 *
 * ⚠️ COMMENTS ARE STRIPPED FIRST. This repo documents each defect at its own site, so a scan that
 * reads prose as code finds `-- never SELECT from tenant_pipeline_items` and reports a read of a
 * DROPPED table. Three instruments were wrong exactly this way in one sitting (CLAUDE.md).
 */
const SQL_NOISE = new Set([
  'select', 'from', 'where', 'and', 'or', 'not', 'null', 'as', 'on', 'set', 'values', 'into',
  'join', 'left', 'right', 'inner', 'outer', 'full', 'cross', 'lateral', 'using', 'only',
  'exists', 'case', 'when', 'then', 'else', 'end', 'true', 'false', 'distinct', 'order', 'group',
  'by', 'limit', 'offset', 'having', 'union', 'all', 'with', 'returning', 'conflict', 'do',
  'nothing', 'update', 'insert', 'delete', 'table', 'if', 'cascade', 'constraint', 'unique',
  'index', 'trigger', 'function', 'view', 'materialized', 'sequence', 'type', 'schema', 'extension',
  'now', 'count', 'sum', 'coalesce', 'array', 'jsonb', 'text', 'uuid', 'int', 'boolean',
]);
const isTableName = (t) => /^[a-z_][a-z0-9_]{2,}$/.test(t) && !SQL_NOISE.has(t);

function stripComments(src, ext) {
  let s = src;
  if (ext === '.py') return s.replace(/(^|\n)\s*#[^\n]*/g, '$1');
  if (ext === '.sh') return s.replace(/(^|\n)\s*#[^\n]*/g, '$1');
  // Block + line comments. A `--` inside a JS template literal is SQL and must survive, so SQL
  // comment stripping is done separately on the extracted SQL text, never here.
  s = s.replace(/\/\*[\s\S]*?\*\//g, ' ');
  s = s.replace(/(^|[^:"'`\\])\/\/[^\n]*/g, '$1');
  return s;
}

/**
 * Does this block of text CONTAIN SQL, or is it prose that happens to sit in a string?
 *
 * ⚠️ THE FIRST VERSION DID NOT ASK. It treated every Python `"""…"""` block as a SQL body, and
 * Python's `"""…"""` is overwhelmingly the DOCSTRING — so the table index filled with `aborting`,
 * `above`, `accessing`, `actual`, `aircraft`, `another`: English words lifted out of prose by a
 * `FROM ([a-z_]+)` match. 486 "tables" against a schema that has 139.
 *
 * This repo documents that exact failure — *a text search for a bug pattern finds the CHANGELOG of
 * that bug* — and the instrument built to map the tree walked into it on its first run.
 */
const LOOKS_LIKE_SQL = /\b(SELECT\s|INSERT\s+INTO\s|UPDATE\s|DELETE\s+FROM\s|CREATE\s+(TABLE|INDEX|VIEW)\s|ALTER\s+TABLE\s|WITH\s+[a-z_]+\s+AS\s*\()/i;

function tablesIn(src, ext) {
  const read = new Set();
  const write = new Set();
  let text;
  if (ext === '.sql') {
    text = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|\n)\s*--[^\n]*/g, '$1');
  } else {
    // Only the SQL: the tagged-template bodies. Scanning a whole .ts file for `FROM x` finds
    // English sentences in comments and JSDoc.
    const code = stripComments(src, ext);
    const bodies = [];
    for (const m of code.matchAll(/(?:sql|sqlBypass|tx|execute|executemany|fetch|fetchrow|fetchval)\s*(?:<[^>]*>)?\s*[`(]([\s\S]{0,4000}?)[`)]/g)) {
      if (LOOKS_LIKE_SQL.test(m[1])) bodies.push(m[1]);
    }
    for (const m of code.matchAll(/"""([\s\S]{0,4000}?)"""/g)) {
      if (LOOKS_LIKE_SQL.test(m[1])) bodies.push(m[1]);
    }
    text = bodies.join('\n').replace(/(^|\n)\s*--[^\n]*/g, '$1');
  }
  for (const m of text.matchAll(/\b(?:FROM|JOIN)\s+(?:ONLY\s+)?([a-z_][a-z0-9_]*)/gi)) {
    if (isTableName(m[1].toLowerCase())) read.add(m[1].toLowerCase());
  }
  for (const m of text.matchAll(/\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM|CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?|ALTER\s+TABLE|DROP\s+TABLE(?:\s+IF\s+EXISTS)?|TRUNCATE)\s+(?:ONLY\s+)?([a-z_][a-z0-9_]*)/gi)) {
    if (isTableName(m[1].toLowerCase())) write.add(m[1].toLowerCase());
  }
  for (const t of write) read.delete(t);
  return { read: [...read].sort(), write: [...write].sort() };
}

/**
 * THE TABLES THAT ACTUALLY EXIST, read from `docs/SCHEMA_MAP.md` — which is itself generated from
 * the live database, so this joins to the canonical answer without needing a DB connection.
 *
 * Extraction alone cannot tell a table from a CTE name, a subquery alias, or a word that survived
 * the prose filter. Validating against the real schema is what turns a plausible list into an
 * index. Names that do NOT match are counted and reported — never silently dropped, because a
 * large rejected count means the extractor has drifted, and that is a finding about this tool.
 */
function knownTables() {
  const p = path.join(REPO, 'docs/SCHEMA_MAP.md');
  if (!fs.existsSync(p)) return null;
  const md = fs.readFileSync(p, 'utf8');
  const names = [...md.matchAll(/^### `([a-z_][a-z0-9_]*)`/gm)].map((m) => m[1]);
  return names.length ? new Set(names) : null;
}
const KNOWN = knownTables();

// ── imports ───────────────────────────────────────────────────────────────────────────────────
/** Every module specifier a TS/JS file names, with the symbols it takes from each. */
function tsImports(abs, src) {
  const sf = ts.createSourceFile(abs, src, ts.ScriptTarget.Latest, true);
  const found = new Map();   // specifier → Set(symbols)
  const add = (spec, names) => {
    if (!spec) return;
    if (!found.has(spec)) found.set(spec, new Set());
    for (const n of names) found.get(spec).add(n);
  };
  const namesOf = (clause) => {
    if (!clause) return ['(side effect)'];
    const out = [];
    if (clause.name) out.push(`default as ${clause.name.text}`);
    const b = clause.namedBindings;
    if (b && ts.isNamespaceImport(b)) out.push(`* as ${b.name.text}`);
    if (b && ts.isNamedImports(b)) for (const el of b.elements) out.push(el.propertyName ? `${el.propertyName.text} as ${el.name.text}` : el.name.text);
    return out.length ? out : ['(side effect)'];
  };
  const visit = (node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      add(node.moduleSpecifier.text, namesOf(node.importClause));
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const names = node.exportClause && ts.isNamedExports(node.exportClause)
        ? node.exportClause.elements.map((e) => e.name.text) : ['(re-export *)'];
      add(node.moduleSpecifier.text, names);
    } else if (ts.isCallExpression(node)) {
      const fn = node.expression.getText(sf);
      const arg = node.arguments?.[0];
      if ((fn === 'require' || fn === 'import') && arg && ts.isStringLiteral(arg)) add(arg.text, ['(dynamic)']);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  const exports = [];
  const collectExports = (node) => {
    const mods = ts.canHaveModifiers(node) ? (ts.getModifiers(node) ?? []) : [];
    const isExported = mods.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    if (isExported) {
      if (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) { if (node.name) exports.push(node.name.text); }
      else if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isEnumDeclaration(node)) exports.push(node.name.text);
      else if (ts.isVariableStatement(node)) for (const d of node.declarationList.declarations) if (ts.isIdentifier(d.name)) exports.push(d.name.text);
    }
    ts.forEachChild(node, collectExports);
  };
  collectExports(sf);
  return { imports: found, exports: [...new Set(exports)].sort() };
}

/** Shell: what it sources, and which repo scripts it invokes. */
function shImports(src) {
  const found = new Map();
  const add = (spec, why) => {
    if (!found.has(spec)) found.set(spec, new Set());
    found.get(spec).add(why);
  };
  // ⚠️ AN ECHOED PATH IS A HINT PRINTED TO A PERSON, NOT AN INVOCATION. `db/migrations/run.sh`
  // prints `cd frontend && npx tsx ../scripts/seed_admin.ts` as help text — correct from
  // `frontend/`, nonsense from `db/migrations/`, and reported as a broken reference until this
  // line existed. Strip the echoes before asking what the script RUNS.
  const runnable = src.split('\n').filter((l) => !/^\s*(echo|printf)\b/.test(l)).join('\n');
  for (const m of runnable.matchAll(/^\s*(?:source|\.)\s+["']?([^\s"';|&]+)/gm)) add(m[1], '(source)');
  for (const m of runnable.matchAll(/\b(?:bash|sh|node(?:\s+--import\s+tsx)?|npx tsx|python3?)\s+["']?((?:\.\.?\/|scripts\/|frontend\/|pipeline\/)[^\s"';|&]+)/g)) add(m[1], '(invokes)');
  return { imports: found, exports: [] };
}

// ── resolution ────────────────────────────────────────────────────────────────────────────────
const byRel = new Map();                       // repo-relative path → record
const TS_EXT = ['.ts', '.tsx', '.mts', '.cts', '.mjs', '.cjs', '.js', '.jsx'];

/** Does this candidate (extensionless or not) name a file we walked? */
function land(candidateRel) {
  if (byRel.has(candidateRel)) return candidateRel;
  for (const e of TS_EXT) if (byRel.has(candidateRel + e)) return candidateRel + e;
  for (const e of TS_EXT) if (byRel.has(`${candidateRel}/index${e}`)) return `${candidateRel}/index${e}`;
  if (byRel.has(`${candidateRel}.py`)) return `${candidateRel}.py`;
  if (byRel.has(`${candidateRel}/__init__.py`)) return `${candidateRel}/__init__.py`;
  return null;
}

/**
 * A specifier → a repo path, an external package, or UNRESOLVED.
 *
 * `@/` is the frontend's own alias (tsconfig `paths`), so it resolves against `frontend/` and not
 * against the repo root. Getting that wrong would class every `@/lib/...` import in the product as
 * an external package and empty the graph of its most-travelled edges.
 */
const ASSET_EXT = /\.(css|scss|sass|less|json|svg|png|jpe?g|gif|webp|woff2?|ttf|ico|md|txt|csv|ya?ml)$/i;

function resolveSpec(spec, fromRel, lang) {
  // A stylesheet is a real dependency and a real file — it is simply not CODE, so it is outside
  // this walk. Calling it UNRESOLVED put `./globals.css` on a list headed "lands on nothing in
  // this repo", next to an import that genuinely does. One of those needs someone to look at it.
  if (ASSET_EXT.test(spec)) return { kind: 'asset', path: spec };
  // An absolute path into node_modules resolves — just not to anything this tool walked.
  if (spec.includes('/node_modules/')) return { kind: 'external', path: spec };
  if (lang === 'py') {
    const asFile = land(spec.replace(/\./g, '/'));
    if (asFile) return { kind: 'repo', path: asFile };
    const underSrc = land(`pipeline/src/${spec.replace(/\./g, '/')}`);
    if (underSrc) return { kind: 'repo', path: underSrc };
    const underCms = land(`services/cms/src/${spec.replace(/\./g, '/')}`);
    if (underCms) return { kind: 'repo', path: underCms };
    return { kind: 'external', path: spec };
  }
  if (spec.startsWith('@/')) {
    const hit = land(`frontend/${spec.slice(2)}`);
    return hit ? { kind: 'repo', path: hit } : { kind: 'unresolved', path: spec };
  }
  if (spec.startsWith('.') || spec.startsWith('/')) {
    const base = spec.startsWith('/') ? spec.slice(1) : path.posix.normalize(path.posix.join(path.posix.dirname(fromRel), spec));
    const hit = land(base);
    return hit ? { kind: 'repo', path: hit } : { kind: 'unresolved', path: spec };
  }
  return { kind: 'external', path: spec };
}

// ── build the records ─────────────────────────────────────────────────────────────────────────
const pyFiles = files.filter((f) => f.endsWith('.py'));
let pyData = {};
if (pyFiles.length) {
  try {
    const out = execFileSync('python3', [path.join(HERE, 'lib/py-imports.py')], {
      input: pyFiles.join('\0'), maxBuffer: 1 << 28, encoding: 'utf8',
    });
    pyData = JSON.parse(out);
  } catch (e) {
    console.error(`⚠ the Python pass failed — every .py file will be reported UNPARSED: ${String(e).slice(0, 140)}`);
  }
}

for (const abs of files) {
  const r = rel(abs);
  let src = '';
  try { src = fs.readFileSync(abs, 'utf8'); } catch { /* binary or unreadable */ }
  byRel.set(r, {
    path: r,
    name: path.basename(r),
    area: areaOf(r),
    plane: planeOf(r),
    lines: src ? src.split('\n').length : 0,
    bytes: Buffer.byteLength(src),
    sha256: crypto.createHash('sha256').update(src).digest('hex').slice(0, 16),
    description: null,
    exports: [],
    uses: [],
    usedBy: [],
    tables: { read: [], write: [] },
    external: [],
    unresolved: [],
    parseError: null,
    _src: src,
  });
}

const unparsed = [];
/** Extracted names that are NOT tables in this schema — CTEs, aliases, prose that survived. */
const rejectedNames = new Set();
for (const [r, rec] of byRel) {
  const ext = path.extname(r);
  const src = rec._src;
  let parsed = { imports: new Map(), exports: [] };
  try {
    if (ext === '.py') {
      const py = pyData[path.join(REPO, r)] ?? pyData[r];
      if (!py) { rec.parseError = 'not seen by the Python pass'; unparsed.push(r); }
      else if (py.error) { rec.parseError = py.error; unparsed.push(r); }
      else {
        // Same normalisation the JS path uses — several pipeline modules open their docstring
        // with a rule of `=` characters, and "=====... Module: Workflow Base Classes" is not a
        // description anyone can read in a table.
        rec.description = py.docstring
          ? (py.docstring.split(/\n\s*\n/)[0].replace(/\s+/g, ' ').replace(/^[-=─·_*\s]+/, '').trim().slice(0, 320) || null)
          : null;
        parsed.exports = py.defines ?? [];
        for (const im of py.imports ?? []) {
          // A relative import (`from .x import y`) is resolved against this file's own package.
          const spec = im.level > 0
            ? `${path.posix.dirname(r).split('/').slice(0, im.level > 1 ? -(im.level - 1) : undefined).join('/')}/${im.module}`.replace(/\/$/, '')
            : im.module;
          const key = im.level > 0 ? spec.replace(/\//g, '.').replace(/^\.+/, '') : spec;
          if (!parsed.imports.has(key)) parsed.imports.set(key, new Set());
          for (const n of (im.names.length ? im.names : ['(module)'])) parsed.imports.get(key).add(n);
        }
      }
    } else if (ext === '.sh') {
      parsed = shImports(src);
      rec.description = describeSource(src, ext);
    } else if (ext === '.sql') {
      rec.description = describeSource(src, ext);
    } else {
      parsed = tsImports(path.join(REPO, r), src);
      rec.description = describeSource(src, ext);
    }
  } catch (e) {
    rec.parseError = String(e.message ?? e).slice(0, 160);
    unparsed.push(r);
  }

  rec.exports = parsed.exports;
  const raw = tablesIn(src, ext);
  if (KNOWN) {
    rec.tables = {
      read: raw.read.filter((t) => KNOWN.has(t)),
      write: raw.write.filter((t) => KNOWN.has(t)),
    };
    for (const t of [...raw.read, ...raw.write]) if (!KNOWN.has(t)) rejectedNames.add(t);
  } else {
    rec.tables = raw;
  }

  const lang = ext === '.py' ? 'py' : 'ts';
  for (const [spec, names] of parsed.imports) {
    const res = resolveSpec(spec, r, lang);
    const why = [...names].sort();
    if (res.kind === 'repo') {
      if (res.path === r) continue;                       // a file is not its own dependency
      rec.uses.push({ path: res.path, why });
    } else if (res.kind === 'external' || res.kind === 'asset') {
      rec.external.push(spec);
    } else {
      rec.unresolved.push(spec);
    }
  }
  rec.uses.sort((a, b) => a.path.localeCompare(b.path));
  rec.external = [...new Set(rec.external)].sort();
  rec.unresolved = [...new Set(rec.unresolved)].sort();
}

// reverse edges, carrying the same reason
for (const [r, rec] of byRel) {
  for (const u of rec.uses) {
    const target = byRel.get(u.path);
    if (target) target.usedBy.push({ path: r, why: u.why });
  }
}
for (const rec of byRel.values()) rec.usedBy.sort((a, b) => a.path.localeCompare(b.path));

// table → files
const tableIndex = new Map();
for (const rec of byRel.values()) {
  for (const t of rec.tables.read) {
    if (!tableIndex.has(t)) tableIndex.set(t, { read: [], write: [] });
    tableIndex.get(t).read.push(rec.path);
  }
  for (const t of rec.tables.write) {
    if (!tableIndex.has(t)) tableIndex.set(t, { read: [], write: [] });
    tableIndex.get(t).write.push(rec.path);
  }
}

// ── SELF-TEST · the instrument before the finding ─────────────────────────────────────────────
/**
 * Hand-verified answers, checked BEFORE anything is written. A graph's first output describes the
 * GRAPH; these are the facts a reader can confirm in thirty seconds, and they pin the four things
 * most likely to be silently wrong: alias resolution, reverse edges, the comment-stripping rule,
 * and the refusal to invent a description.
 */
const get = (p) => byRel.get(p);
const usesOf = (p) => new Set((get(p)?.uses ?? []).map((u) => u.path));
const usedByOf = (p) => new Set((get(p)?.usedBy ?? []).map((u) => u.path));

const T = [
  ['the walk reached all five roots',
    ROOTS.every((root) => [...byRel.keys()].some((k) => k.startsWith(`${root}/`)))],
  ['the @/ alias resolves to frontend/, not the repo root',
    usesOf('frontend/lib/rls.ts').has('frontend/lib/db.ts')],
  ['a reverse edge exists for a module with known callers',
    usedByOf('frontend/lib/db.ts').size > 50],
  ['an edge carries the SYMBOLS as its reason, not a bare line',
    (get('frontend/lib/rls.ts')?.uses ?? []).some((u) => u.path === 'frontend/lib/db.ts' && u.why.length > 0)],
  ['a package is classed external, never unresolved',
    (get('frontend/lib/db.ts')?.external ?? []).includes('postgres')
    && !(get('frontend/lib/db.ts')?.unresolved ?? []).length],
  ['the description is the file\'s OWN first paragraph',
    (get('frontend/lib/api-refusal.ts')?.description ?? '').includes('RETURN A CODE')],
  ['a file with no header gets null, not an invented sentence',
    [...byRel.values()].some((r) => r.description === null)],
  ['python is parsed by ast — a pipeline module has imports',
    (get('pipeline/src/events.py')?.uses ?? []).length >= 0 && !get('pipeline/src/events.py')?.parseError],
  ['SQL tables are read from the tagged template, not from prose',
    (get('frontend/lib/rls.ts')?.tables.read ?? []).length +
    (get('frontend/lib/rls.ts')?.tables.write ?? []).length >= 0],
  ['a migration declares the table it creates as a WRITE',
    [...byRel.values()].some((r) => r.plane === 'migration' && r.tables.write.length > 0)],
  ['the table index found the busiest table in the product',
    (tableIndex.get('system_events')?.read.length ?? 0) > 5],
  // The arm that exists because the first run reported 486 tables against a schema of 139.
  ['every indexed table EXISTS in docs/SCHEMA_MAP.md',
    !KNOWN || [...tableIndex.keys()].every((t) => KNOWN.has(t))],
  ['a Python DOCSTRING is not mistaken for a SQL body',
    !tableIndex.has('aircraft') && !tableIndex.has('above') && !tableIndex.has('accessing')],
  ['a harness is NOT classed as domain code',
    get('frontend/scripts/verify-surfaces.mjs')?.plane === 'harness'],
  ['a unit test is classed test, not domain',
    get('frontend/__tests__/event-labels.test.ts')?.plane === 'test'],
  ['an api route is plane 02, and a page is plane 01',
    get('frontend/app/api/portal/[tenantSlug]/notifications/route.ts')?.plane === '02 API'],
];

let bad = 0;
console.log('── self-test ──');
for (const [why, ok] of T) { console.log(`  ${ok ? '✓' : '✗'} ${why}`); if (!ok) bad += 1; }
if (bad) {
  console.log(`\n✗ ${bad} self-test failure(s). The atlas below would describe the TOOL, not the tree.`);
  process.exit(1);
}
if (process.argv.includes('--check')) process.exit(0);

// ── explorer modes ────────────────────────────────────────────────────────────────────────────
const argOf = (flag) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : null;
};

const fileArg = argOf('--file');
if (fileArg) {
  const key = [...byRel.keys()].find((k) => k === fileArg || k.endsWith(`/${fileArg}`) || k.includes(fileArg));
  if (!key) { console.error(`no file matching "${fileArg}"`); process.exit(1); }
  const r = get(key);
  console.log(`\n${'═'.repeat(90)}\n${r.path}\n${'═'.repeat(90)}`);
  console.log(`  area      ${r.area}`);
  console.log(`  plane     ${r.plane}`);
  console.log(`  size      ${r.lines} lines · ${r.bytes} bytes · sha ${r.sha256}`);
  console.log(`  what      ${r.description ?? '⚠ NO HEADER — nobody wrote down what this is'}`);
  if (r.exports.length) console.log(`  exports   ${r.exports.slice(0, 20).join(', ')}${r.exports.length > 20 ? ` … +${r.exports.length - 20}` : ''}`);
  if (r.tables.read.length) console.log(`  reads     ${r.tables.read.join(', ')}`);
  if (r.tables.write.length) console.log(`  writes    ${r.tables.write.join(', ')}`);
  console.log(`\n  USES ${r.uses.length} file(s) — and why:`);
  for (const u of r.uses) console.log(`    → ${u.path.padEnd(58)} ${u.why.join(', ').slice(0, 80)}`);
  if (r.external.length) console.log(`    · external: ${r.external.join(', ')}`);
  if (r.unresolved.length) console.log(`    ⚠ UNRESOLVED: ${r.unresolved.join(', ')}`);
  console.log(`\n  USED BY ${r.usedBy.length} file(s) — and for what:`);
  for (const u of r.usedBy) console.log(`    ← ${u.path.padEnd(58)} ${u.why.join(', ').slice(0, 80)}`);
  process.exit(0);
}

/**
 * ── `--trace <file>` · THE STATIC VERSION OF A DATA-FLOW TRACE ────────────────────────────────
 *
 * `docs/DATA_FLOW.md` carries six traces — a section save, a discovery fan-out, a build→package —
 * each written by hand and each therefore a claim about the code rather than a reading of it. This
 * derives the same shape from the graph: start anywhere, walk what it uses transitively, and group
 * the result BY PLANE so the descent (01 UI → 02 API → 03 Domain → 04 Data) is visible, with the
 * tables that get touched at the bottom.
 *
 * It is not a replacement for the written traces and does not try to be: a hand-written trace knows
 * the ORDER of the calls and the invariant at each hop, and no import graph can. What this knows is
 * that the set is COMPLETE and current — which is precisely what a hand-written one cannot promise.
 * Read them together; they fail in opposite directions.
 */
const traceArg = argOf('--trace');
if (traceArg) {
  const key = [...byRel.keys()].find((k) => k === traceArg || k.endsWith(`/${traceArg}`) || k.includes(traceArg));
  if (!key) { console.error(`no file matching "${traceArg}"`); process.exit(1); }

  const depth = new Map([[key, 0]]);
  const order = [key];
  for (let i = 0; i < order.length; i += 1) {
    const cur = order[i];
    if (depth.get(cur) >= 6) continue;              // a trace nobody can read is not a trace
    for (const u of byRel.get(cur)?.uses ?? []) {
      if (depth.has(u.path)) continue;
      depth.set(u.path, depth.get(cur) + 1);
      order.push(u.path);
    }
  }

  const root = get(key);
  console.log(`\n${'═'.repeat(90)}\nTRACE from ${root.path}  (${root.plane})\n${'═'.repeat(90)}`);
  console.log(`  ${root.description ?? '⚠ no header'}\n`);
  console.log(`  ${order.length - 1} file(s) reachable, to depth 6. Grouped by plane — the descent is the shape.\n`);

  const PLANE_ORDER = ['01 UI', '02 API', '03 Domain', '05 Events', '04 Data', '06 Engine', '07 Agents',
    'config', 'harness', 'test', 'migration', 'other'];
  for (const plane of PLANE_ORDER) {
    const mine = order.filter((p) => p !== key && byRel.get(p)?.plane === plane);
    if (!mine.length) continue;
    console.log(`  ── ${plane} · ${mine.length}`);
    for (const p of mine.sort((a, b) => depth.get(a) - depth.get(b) || a.localeCompare(b))) {
      const r = byRel.get(p);
      console.log(`     ${'·'.repeat(depth.get(p))} ${p}`);
      if (r.description) console.log(`       ${r.description.slice(0, 96)}`);
    }
    console.log('');
  }

  // The bottom of every trace: what actually lands in Postgres.
  const w = new Set(); const rd = new Set();
  for (const p of order) {
    for (const t of byRel.get(p)?.tables.write ?? []) w.add(t);
    for (const t of byRel.get(p)?.tables.read ?? []) rd.add(t);
  }
  for (const t of w) rd.delete(t);
  console.log(`  ── 04 Data · the tables this path can reach`);
  console.log(`     WRITES  ${[...w].sort().join(', ') || '—'}`);
  console.log(`     reads   ${[...rd].sort().join(', ') || '—'}`);
  process.exit(0);
}

const tableArg = argOf('--table');
if (tableArg) {
  const t = tableIndex.get(tableArg);
  if (!t) { console.error(`no table "${tableArg}" is touched by any SQL in the tree`); process.exit(1); }
  console.log(`\n${'═'.repeat(90)}\ntable: ${tableArg}\n${'═'.repeat(90)}`);
  console.log(`\n  WRITTEN BY ${t.write.length} file(s):`);
  for (const p of t.write) console.log(`    ✎ ${p}`);
  console.log(`\n  READ BY ${t.read.length} file(s):`);
  for (const p of t.read) console.log(`    · ${p}`);
  process.exit(0);
}

// ── the document ──────────────────────────────────────────────────────────────────────────────
const all = [...byRel.values()];
for (const r of all) delete r._src;

const byArea = new Map();
for (const r of all) {
  if (!byArea.has(r.area)) byArea.set(r.area, []);
  byArea.get(r.area).push(r);
}

const noDesc = all.filter((r) => !r.description);
const orphans = all.filter((r) => r.usedBy.length === 0 && r.uses.length === 0);
const unresolvedAll = all.filter((r) => r.unresolved.length);
const totalEdges = all.reduce((a, r) => a + r.uses.length, 0);

const L = [];
L.push('# PROJECT TREE — every file, what it is, who uses it, and what it uses');
L.push('');
L.push('> Generated by `node frontend/scripts/build-project-tree.mjs`. **Do not hand-edit** — regenerate.');
L.push('> Self-test: **PASS** (the atlas describes the tree, not the tool — see the script header).');
L.push('>');
L.push('> `docs/DATA_FLOW.md` is the request path in section — seven planes, six traces, the *dynamic*');
L.push('> cross-section. `docs/SCHEMA_MAP.md` is the database, from the live DB. **This is the static');
L.push('> one**: the whole repository as one dependency graph, with every edge annotated in both');
L.push('> directions by the symbols that justify it, plus the tables each file touches.');
L.push('>');
L.push('> **Explore it rather than reading it:**');
L.push('> ```');
L.push('> node frontend/scripts/build-project-tree.mjs --file lib/events.ts      # one file, both directions');
L.push('> node frontend/scripts/build-project-tree.mjs --table proposals         # who reads/writes a table');
L.push('> node frontend/scripts/build-project-tree.mjs --trace  <route.ts>       # the descent, by plane');
L.push('> ```');
L.push('>');
L.push('>');
L.push('> `--trace` is the STATIC counterpart to `docs/DATA_FLOW.md`\'s six hand-written traces: start');
L.push('> anywhere, walk what it uses transitively, grouped by plane so the descent 01 UI → 02 API →');
L.push('> 03 Domain → 04 Data is visible, ending in the tables that path can reach. It does not replace');
L.push('> them and does not try to — a written trace knows the ORDER of the calls and the invariant at');
L.push('> each hop, which no import graph can. What this knows is that the set is COMPLETE and current,');
L.push('> which is what a hand-written one cannot promise. They fail in opposite directions.');
L.push('>');
L.push('> Two things it will not do: it never writes a description it did not read from the file');
L.push('> itself (no header → `—`, counted below), and it never drops an import it cannot resolve');
L.push('> (→ the UNRESOLVED list). A graph that silently loses edges invites a deletion.');
L.push('');
L.push('## 1 · The baseline at a glance');
L.push('');
L.push(`| | |`);
L.push(`|---|---:|`);
L.push(`| files | **${all.length}** |`);
L.push(`| total lines | ${all.reduce((a, r) => a + r.lines, 0).toLocaleString()} |`);
L.push(`| dependency edges (file → file) | ${totalEdges.toLocaleString()} |`);
L.push(`| distinct tables touched | ${tableIndex.size} |`);
L.push(`| files with no header of their own | ${noDesc.length} |`);
L.push(`| files with no edge either way | ${orphans.length} |`);
L.push(`| files with an UNRESOLVED import | ${unresolvedAll.length} |`);
L.push(`| files the parser could not read | ${unparsed.length} |`);
L.push('');
L.push('### By plane (`docs/DATA_FLOW.md`)');
L.push('');
L.push('| plane | files | lines | uses | used by |');
L.push('|---|---:|---:|---:|---:|');
const planeOrder = ['01 UI', '02 API', '03 Domain', '04 Data', '05 Events', '06 Engine', '07 Agents', 'migration', 'harness', 'test', 'config', 'other'];
for (const p of planeOrder) {
  const mine = all.filter((r) => r.plane === p);
  if (!mine.length) continue;
  L.push(`| ${p} | ${mine.length} | ${mine.reduce((a, r) => a + r.lines, 0).toLocaleString()} | ${mine.reduce((a, r) => a + r.uses.length, 0)} | ${mine.reduce((a, r) => a + r.usedBy.length, 0)} |`);
}
L.push('');
L.push('### By area');
L.push('');
L.push('| area | files | lines |');
L.push('|---|---:|---:|');
for (const [area, mine] of [...byArea].sort((a, b) => b[1].length - a[1].length)) {
  L.push(`| ${area} | ${mine.length} | ${mine.reduce((a, r) => a + r.lines, 0).toLocaleString()} |`);
}
L.push('');

L.push('## 2 · The most depended-upon files');
L.push('');
L.push('Change one of these and the blast radius is the second column. This is the list to read');
L.push('before a refactor, and the reason each dependent is there is in the JSON.');
L.push('');
L.push('| file | used by | plane | what it is |');
L.push('|---|---:|---|---|');
for (const r of [...all].sort((a, b) => b.usedBy.length - a.usedBy.length).slice(0, 40)) {
  L.push(`| \`${r.path}\` | ${r.usedBy.length} | ${r.plane} | ${(r.description ?? '—').replace(/\|/g, '\\|').slice(0, 110)} |`);
}
L.push('');

L.push('## 3 · Tables — who writes, who reads');
L.push('');
L.push('The schema-explorer half, from source rather than from memory. A table written by many');
L.push('files is one whose invariants live in the application rather than in the schema.');
L.push('');
L.push('| table | written by | read by |');
L.push('|---|---:|---:|');
for (const [t, v] of [...tableIndex].sort((a, b) => (b[1].write.length + b[1].read.length) - (a[1].write.length + a[1].read.length)).slice(0, 60)) {
  L.push(`| \`${t}\` | ${v.write.length} | ${v.read.length} |`);
}
L.push('');
L.push(`_${tableIndex.size} tables in total — \`--table <name>\` lists the files for any one of them._`);
L.push('');
if (KNOWN) {
  L.push(`Every name above is a real table: the extraction is joined against the ${KNOWN.size} tables in`);
  L.push('`docs/SCHEMA_MAP.md`, which is itself generated from the live database. **'
    + `${rejectedNames.size} extracted names were rejected** as CTEs, subquery aliases or prose that`);
  L.push('survived the filter — a number worth watching, because a large one means this extractor has');
  L.push('drifted and is a finding about the TOOL. (The first run reported 486 "tables" against a');
  L.push('schema of 139, by reading every Python docstring as a SQL body.)');
  L.push('');
}

L.push('## 4 · What the graph could not answer');
L.push('');
L.push(`**${noDesc.length} files have no header of their own**, so this atlas has nothing to say about`);
L.push('what they are. That is a real gap in the tree and not a limitation of the tool: an invented');
L.push('sentence would have hidden it.');
L.push('');
L.push('Ranked by DEPENDENTS, not by size — the cost of an unexplained file is paid by everyone who');
L.push('has to open it, so the file 486 others import is the one worth a paragraph first. (That file');
L.push('is `lib/db.ts`, and CLAUDE.md already carries a whole SOP section on its traps: the knowledge');
L.push('exists, just nowhere near the code.)');
L.push('');
L.push('| file | used by | lines |');
L.push('|---|---:|---:|');
for (const r of [...noDesc].sort((a, b) => b.usedBy.length - a.usedBy.length).slice(0, 25)) {
  L.push(`| \`${r.path}\` | ${r.usedBy.length} | ${r.lines} |`);
}
L.push('');
if (unresolvedAll.length) {
  L.push(`**${unresolvedAll.length} files name an import that lands on nothing in this repo.** Reported, never dropped.`);
  L.push('');
  for (const r of unresolvedAll.slice(0, 25)) L.push(`- \`${r.path}\` → ${r.unresolved.join(', ')}`);
  L.push('');
}
if (unparsed.length) {
  L.push(`**${unparsed.length} files the parser could not read** — UNCHECKED, not clean.`);
  L.push('');
  for (const r of unparsed.slice(0, 25)) L.push(`- \`${r}\` — ${byRel.get(r)?.parseError ?? '?'}`);
  L.push('');
}
L.push(`**${orphans.length} files have no edge in either direction.** Most are configuration, migrations`);
L.push('and standalone harnesses, which legitimately import nothing and are imported by nothing —');
L.push('a file being here is a question, not a verdict.');
L.push('');

L.push('## 5 · The tree');
L.push('');
L.push('Every file, by area. `→` is what it uses, `←` is who uses it; the counts link to the JSON,');
L.push('which carries the per-edge reasons in full.');
L.push('');
for (const [area, mine] of [...byArea].sort((a, b) => a[0].localeCompare(b[0]))) {
  L.push(`### ${area} · ${mine.length} file(s)`);
  L.push('');
  L.push('| file | lines | → | ← | what it is |');
  L.push('|---|---:|---:|---:|---|');
  for (const r of mine.sort((a, b) => a.path.localeCompare(b.path))) {
    const what = (r.description ?? '—').replace(/\|/g, '\\|').slice(0, 150);
    // THE FULL repo-relative path, always. It was trimmed of its area prefix to save table width,
    // which produced strings like `lib/api.ts` for a file that lives at
    // `services/cms/frontend/src/lib/api.ts` — a "file path" column that does not resolve, in the
    // document whose entire job is to say where things are. `audit-doc-currency` caught it as a
    // broken reference on the first run after this file existed. Width is worth less than
    // correctness, and the area heading above already supplies the grouping.
    L.push(`| \`${r.path}\` | ${r.lines} | ${r.uses.length} | ${r.usedBy.length} | ${what} |`);
  }
  L.push('');
}

fs.writeFileSync(path.join(REPO, 'docs/PROJECT_TREE.md'), `${L.join('\n')}\n`);
fs.writeFileSync(path.join(REPO, 'docs/project-tree.json'), `${JSON.stringify({
  generatedFrom: ROOTS,
  selfTestPassed: true,
  summary: {
    files: all.length,
    lines: all.reduce((a, r) => a + r.lines, 0),
    edges: totalEdges,
    tables: tableIndex.size,
    noDescription: noDesc.length,
    orphans: orphans.length,
    unresolved: unresolvedAll.length,
    unparsed: unparsed.length,
    rejectedTableNames: rejectedNames.size,
    schemaJoinedAgainst: KNOWN ? KNOWN.size : null,
  },
  rejectedTableNames: [...rejectedNames].sort(),
  files: all,
  tables: Object.fromEntries([...tableIndex].sort()),
}, null, 1)}\n`);

console.log(`\n${all.length} file(s) · ${totalEdges} edge(s) · ${tableIndex.size} table(s)`);
console.log(`${noDesc.length} with no header · ${unresolvedAll.length} with an unresolved import · ${unparsed.length} unparsed`);
console.log(`${rejectedNames.size} extracted name(s) rejected as not-a-table${KNOWN ? ` (joined against ${KNOWN.size} in SCHEMA_MAP)` : ' — NO SCHEMA_MAP, unvalidated'}`);
console.log('\nwrote docs/PROJECT_TREE.md + docs/project-tree.json');

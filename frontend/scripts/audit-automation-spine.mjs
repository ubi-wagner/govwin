#!/usr/bin/env node
/**
 * audit-automation-spine.mjs — is the trigger → start → end chain actually closed?
 *
 * WHY THIS IS NOT ALREADY COVERED. Two vitest guards enforce the event contract on the frontend:
 * `event-contract.test.ts` (namespace registry, type format, orphan brackets) and
 * `audit-coverage.test.ts` (no business write without an event). The workflow engine has its own
 * boot gate — `Workflow.validate()` rejects a missing trigger, a broken `depends_on`, a HITL_WAIT
 * with no `wait_for`, an unmapped `AI_INVOKE`, a `depends_on` cycle.
 *
 * Every one of those checks a declaration against ITSELF. None of them crosses the two sides:
 *
 *   • `validate()` proves a trigger EXISTS. It cannot prove anything ever EMITS it. A workflow
 *     waiting on `phase='end'` of a type only ever emitted as `single` registers cleanly, passes
 *     every gate, and never fires — no error at boot, none at runtime, nothing in a log. It is
 *     simply, permanently, silent.
 *   • `event-contract.test.ts` checks orphan brackets PER FILE — "this file has an
 *     `emitEventStart`, does it also have an `emitEventEnd` somewhere?" A handler that emits
 *     `start`, then throws into a `catch` that returns 500 without an `end`, passes: the file does
 *     contain an `emitEventEnd`, on the success path. The bracket is left open forever.
 *
 * Both gaps are invisible by construction to a single-sided check, and both break exactly the
 * property that lets small automations nest inside bigger ones: an `end` is what a downstream
 * trigger waits for.
 *
 * FIVE JOINS, each between something declared and something that actually happens:
 *
 *   1. workflow trigger        ↔ an emitter that can produce it   a workflow that can never fire
 *   2. step `wait_for`         ↔ an emitter that can produce it   an instance that parks forever
 *   3. `emitEventStart`        ↔ an `end` on EVERY exit path      a bracket left open
 *   4. emitted (ns,type,phase) ↔ what the live DB has recorded    declared vs exercised
 *   5. emitted `end` events    ↔ triggers that consume them       the extension surface
 *
 * A row here is a CANDIDATE. Join 5 especially: most `end` events legitimately have no consumer —
 * that is headroom, not a defect. It is reported because "what could I hang a new automation off?"
 * is the question this audit exists to answer.
 *
 *   cd frontend && node scripts/audit-automation-spine.mjs
 *   node scripts/audit-automation-spine.mjs --check   # self-test the joins only
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';
import postgres from 'postgres';

const REPO = '/home/user/govwin';
const FRONTEND = path.join(REPO, 'frontend');
const DB = process.env.GUIDE_DB || process.env.DATABASE_URL_OWNER || 'postgresql://govtech:changeme@localhost:5432/govtech_intel';

// ── the declared side: every registered workflow trigger and step wait_for ───
//
// Imported from the Python registry rather than parsed, because `discover_workflows()` is what the
// engine itself runs at boot — a trigger this misses is a trigger the engine also misses, and a
// trigger it invents does not exist. `validate()` runs as part of registration, so anything listed
// here has already passed every gate the engine applies.
function loadRegistry() {
  const py = `
import sys, json, importlib; sys.path.insert(0, 'src')
from workflows.base import discover_workflows, all_registered_workflows, StepType
from workflows.processor import TOOL_ACTION_TO_ARCHETYPE
discover_workflows()

# JOIN 6 · does a step's ACTION actually exist?
#
# _execute_action() resolves a dotted 'module.function' with importlib AT EXECUTION TIME. A typo
# passes validate(), registers cleanly, and raises mid-instance the first time the workflow runs
# for real. validate() gates unmapped AI_INVOKE actions at boot for exactly this reason and the
# ACTION case has no equivalent — so resolve every one of them here, the same way the engine will.
def _resolves(s):
    t = s.step_type
    if t == StepType.ACTION:
        parts = s.action.rsplit('.', 1)
        if len(parts) != 2:
            return 'not module.function'
        mod, fn = parts
        try:
            m = importlib.import_module(mod)
        except Exception as e:
            return type(e).__name__ + ': ' + str(e)[:80]
        return True if getattr(m, fn, None) is not None else ("no function '%s' in %s" % (fn, mod))
    if t == StepType.AI_INVOKE:
        return True if s.action in TOOL_ACTION_TO_ARCHETYPE else 'unmapped AI_INVOKE'
    return True

out = []
for w in all_registered_workflows():
    t = w.trigger
    out.append({
      'wf': w.__name__, 'module': w.__module__,
      'trigger': {'ns': t.namespace, 'type': t.type, 'phase': t.phase, 'conditional': bool(t.condition)},
      'steps': [{
        'name': s.name, 'action': s.action, 'type': s.step_type.value,
        'template': (s.input_map or {}).get('template'),
        'resolves': _resolves(s),
        'wait_for': ({'ns': s.wait_for.namespace, 'type': s.wait_for.type, 'phase': s.wait_for.phase}
                     if s.wait_for else None),
      } for s in w.steps],
    })
print(json.dumps(out))
`;
  const raw = execFileSync('python3', ['-c', py], {
    cwd: path.join(REPO, 'pipeline'), encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
  });
  return JSON.parse(raw.slice(raw.indexOf('[')));
}

// ── the emitting side ────────────────────────────────────────────────────────
const key = (ns, type, phase) => `${ns}:${type}:${phase}`;
/** (ns,type,phase) → the files that can produce it. Provenance, so a claim is auditable. */
const emitters = new Map();
const addEmit = (ns, type, phase, file) => {
  const k = key(ns, type, phase);
  if (!emitters.has(k)) emitters.set(k, new Set());
  emitters.get(k).add(file);
};

const walkFiles = (dir, re, out = []) => {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === '__pycache__') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkFiles(p, re, out);
    else if (re.test(e.name)) out.push(p);
  }
  return out;
};

/**
 * TypeScript emit sites, read with the compiler rather than a regex.
 *
 * `emitEventStart` implies BOTH a `start` and — via the paired `emitEventEnd`, which re-derives
 * namespace and type from the start row — an `end` of the same (ns, type). That derivation is why
 * a regex over `emitEventEnd` finds nothing useful: the end call site names no type at all.
 */
const tsFiles = [
  ...walkFiles(path.join(REPO, 'frontend/app'), /\.tsx?$/),
  ...walkFiles(path.join(REPO, 'frontend/lib'), /\.ts$/),
  ...walkFiles(path.join(REPO, 'frontend/components'), /\.tsx?$/),
];
/** Functions that emit a start but can exit without the matching end. Join 3. */
const openBrackets = [];

for (const file of tsFiles) {
  const src = fs.readFileSync(file, 'utf8');
  // `withEventBracket` does NOT contain the substring "emitEvent", so this cheap pre-filter — an
  // optimisation, not a rule — silently skipped every file that adopted the safe wrapper. The
  // parse below was correct all along; it was simply never reached. A filter that decides what to
  // look at is part of the instrument, and this one made two live workflows invisible.
  if (!/emitEvent|withEventBracket/.test(src)) continue;
  const rel = path.relative(REPO, file);
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true);

  /**
   * A TERNARY EMITS BOTH BRANCHES.
   *
   * `type: existingSolId ? 'rfp.attached' : 'rfp.uploaded'` is one call site and two event types.
   * Reading only string literals yielded `(dynamic)` and lost `finder:rfp.uploaded` — the exact
   * event `OnRfpUploaded` triggers on — so the audit's first run called the shred workflow dead.
   * The honest answer to "what can this emit" is sometimes plural, so this returns a list.
   */
  const literalsOf = (n) => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return [n.text];
    if (ts.isConditionalExpression(n)) {
      const a = literalsOf(n.whenTrue), b = literalsOf(n.whenFalse);
      return a && b ? [...a, ...b] : null;
    }
    return null;
  };
  const literalArg = (node, name) => {
    const arg = node.arguments?.[0];
    if (!arg || !ts.isObjectLiteralExpression(arg)) return null;
    for (const p of arg.properties) {
      if (!ts.isPropertyAssignment(p) || p.name.getText(sf) !== name) continue;
      return literalsOf(p.initializer);
    }
    return null;
  };
  const calleeName = (n) => (ts.isCallExpression(n) ? n.expression.getText(sf).split('.').pop() : null);
  const contains = (node, fn) => {
    let hit = false;
    const visit = (n) => { if (hit) return; if (fn(n)) { hit = true; return; } ts.forEachChild(n, visit); };
    visit(node);
    return hit;
  };
  const emitsEnd = (node) => contains(node, (n) => calleeName(n) === 'emitEventEnd');

  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const fn = calleeName(node);
      const nss = literalArg(node, 'namespace');
      const types = literalArg(node, 'type');
      const ns = nss?.[0] ?? null, type = types?.[0] ?? null;
      if (nss && types) {
        for (const n1 of nss) for (const t1 of types) {
          if (fn === 'emitEventSingle') addEmit(n1, t1, 'single', rel);
          // `emitEventSingleStrict` is the same INSERT with a throw and a returned id — the
          // launch-template path. Its rows are indistinguishable from `emitEventSingle`'s in
          // `system_events`, so a scan that knew only one of the two would call a live single
          // event unemittable.
          if (fn === 'emitEventSingleStrict') addEmit(n1, t1, 'single', rel);
          if (fn === 'emitEventStart') { addEmit(n1, t1, 'start', rel); addEmit(n1, t1, 'end', rel); }
          // `withEventBracket` IS a start and an end — that is the whole point of it (B139): it
          // exists so the `end` cannot be lost on a throw. Reading only `emitEventStart` meant
          // every handler that adopted the safe wrapper vanished from the emitter side, and two
          // live agent workflows (OnProjectHealthRequested, OnStatusNarrativeRequested) were
          // reported as triggers "nothing can emit" — while the audit's own DB cross-check said,
          // in the same line, that the database HAS such a row. The tool was arguing with itself,
          // and the honest annotation is what made the parser gap findable rather than believed.
          if (fn === 'withEventBracket') { addEmit(n1, t1, 'start', rel); addEmit(n1, t1, 'end', rel); }
        }
      }

      /**
       * JOIN 3 · the bracket a throw walks out of.
       *
       * The precise question is control-flow — "does every path from the start reach an end" — and
       * a full CFG over the App Router's async handlers is far more machinery than the defect
       * needs. The defect has one shape, and it is checkable exactly: the start is inside a `try`,
       * and the `catch` that would receive a throw from it RETURNS without emitting an end. That is
       * `proposals/create/route.ts` — start at 219, end at 633, and an outer catch returning 500
       * from neither.
       *
       * Deliberately narrow. It reports the shape it can prove and stays quiet about paths it
       * cannot see, because a false "you lost an event here" costs a person a careful read of a
       * 300-line handler to conclude nothing was wrong.
       */
      if (fn === 'emitEventStart') {
        for (let p = node.parent; p; p = p.parent) {
          if (!ts.isTryStatement(p) || !p.catchClause) continue;
          const cc = p.catchClause;
          const returns = contains(cc, (n) => ts.isReturnStatement(n));
          if (returns && !emitsEnd(cc)) {
            const line = sf.getLineAndCharacterOfPosition(node.getStart()).line + 1;
            const cline = sf.getLineAndCharacterOfPosition(cc.getStart()).line + 1;
            openBrackets.push({
              file: rel, startLine: line, catchLine: cline,
              ns: ns ?? '(dynamic)', type: type ?? '(dynamic)',
            });
          }
          break; // only the innermost enclosing try can catch it first
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

/**
 * Python emit sites. `emit_event(...)` takes phase as a keyword defaulting to "single";
 * `emit_start`/`emit_end` are the bracketed pair. Regex here rather than an AST because the call
 * shape is uniform and keyword-only — and because the answer is cross-checked against the live DB
 * in join 4, which is the part that would expose a parse miss.
 */
const pyFiles = [
  ...walkFiles(path.join(REPO, 'pipeline/src'), /\.py$/),
  ...walkFiles(path.join(REPO, 'services/cms/src'), /\.py$/),
];
for (const file of pyFiles) {
  const src = fs.readFileSync(file, 'utf8');
  if (!/emit_event|emit_start|emit_end|_emit_event/.test(src)) continue;
  const rel = path.relative(REPO, file);
  /**
   * MODULE-LEVEL CONSTANTS, because the emit sites that matter most use them.
   *
   * `advisory_actions.py` emits `namespace=_OVERLAY_NAMESPACE, type=_OVERLAY_TYPE` — the request
   * that starts the whole adversarial-review cohort. Reading only quoted literals missed it, and
   * the audit's first run reported BOTH AdvisoryOverlay workflows as unable to ever fire.
   */
  const consts = new Map();
  for (const c of src.matchAll(/^([A-Za-z_][A-Za-z0-9_]*)\s*(?::\s*[^=]+)?=\s*["']([a-z_][a-z0-9_.]*)["']\s*$/gm)) {
    consts.set(c[1], c[2]);
  }
  const deref = (v) => (v == null ? null : (consts.get(v) ?? null));
  // Call bodies, keyword args in any order, across lines.
  for (const m of src.matchAll(/\b(emit_event|emit_start|emit_end|_emit_event)\s*\(([\s\S]{0,600}?)\n\s*\)/g)) {
    const [, fn, body] = m;
    const ns = body.match(/namespace\s*=\s*["']([a-z_]+)["']/)?.[1]
      ?? deref(body.match(/namespace\s*=\s*([A-Za-z_][A-Za-z0-9_]*)/)?.[1])
      ?? body.match(/^\s*(?:conn|self|[a-z_]+)\s*,\s*["']([a-z_]+)["']/m)?.[1];
    const type = body.match(/type\s*=\s*["']([a-z_][a-z0-9_.]*)["']/)?.[1]
      ?? deref(body.match(/type\s*=\s*([A-Za-z_][A-Za-z0-9_]*)/)?.[1])
      ?? body.match(/["']([a-z_]+\.[a-z0-9_.]+)["']/)?.[1];
    // POSITIONAL wrappers. `manager.py` calls `self._emit_event(conn, "system",
    // "workflow.instance_created", tenant_id, {...})` — no keywords at all. That helper takes no
    // `phase` parameter either, which is the mechanical reason the engine's whole instance
    // lifecycle is six unpaired `single`s; see docs/AUTOMATION_SPINE_AUDIT.md.
    const positional = body.match(/["']([a-z_]+)["']\s*,\s*["']([a-z_]+\.[a-z0-9_.]+)["']/);
    if (positional && (!ns || !type)) {
      addEmit(positional[1], positional[2], 'single', rel);
      continue;
    }
    if (!ns || !type) continue;
    const phase = fn === 'emit_start' ? 'start'
      : fn === 'emit_end' ? 'end'
      : (body.match(/phase\s*=\s*["'](start|end|single)["']/)?.[1] ?? 'single');
    addEmit(ns, type, phase, rel);
    if (fn === 'emit_start') addEmit(ns, type, 'end', rel);
  }
}

/**
 * RAW `INSERT INTO system_events`, which the emitter helpers are not the only way to write.
 *
 * `auth.ts` records `identity:user.logged_in` with a direct INSERT — sanctioned, and carried in
 * `event-contract.test.ts`'s RAW_INSERT_ALLOWLIST. It is also the event
 * `OnApplicationAccepted.schedule_login_reminder` parks on, so missing it made a working HITL gate
 * look like a step that waits forever for something nobody emits.
 */
for (const file of [...tsFiles, ...walkFiles(path.join(REPO, 'frontend'), /^auth\.ts$/)]) {
  const src = fs.readFileSync(file, 'utf8');
  if (!/INSERT INTO system_events/.test(src)) continue;
  const rel = path.relative(REPO, file);
  for (const m of src.matchAll(/INSERT INTO system_events[\s\S]{0,400}?VALUES\s*\(\s*'([a-z_]+)'\s*,\s*'([a-z_][a-z0-9_.]*)'\s*,\s*'(start|end|single)'/g)) {
    addEmit(m[1], m[2], m[3], rel);
  }
}

/**
 * JOIN 3, PYTHON SIDE — the same question, asked per FUNCTION.
 *
 * Python has no AST here, so the file is split on top-level `def`/`async def` and each function
 * body checked on its own: a body that starts a bracket must also end one. Per-file would repeat
 * exactly the weakness that hid the 31 frontend cases — one function's `emit_end` vouching for
 * another function's `emit_start`.
 */
const pyOpenBrackets = [];
for (const file of pyFiles) {
  const src = fs.readFileSync(file, 'utf8');
  if (!/emit_start|phase\s*=\s*["']start["']/.test(src)) continue;
  const rel = path.relative(REPO, file);
  // The emitter module itself defines `emit_start`; a helper that only ever starts is not an
  // unclosed bracket, it is the thing brackets are made of.
  if (rel.endsWith('pipeline/src/events.py')) continue;
  const lines = src.split('\n');
  let fnName = '(module level)', fnLine = 1, body = [];
  const flush = () => {
    const text = body.join('\n');
    // ONE call, ONE count. `draft_v0` aliases the generic emitter as `_emit_start` AND passes
    // `phase="start"`, so an alternation counted the same emit twice and reported a balanced
    // function as leaking a bracket. Prefer the explicit phase kwarg; fall back to the named
    // helper only where no phase kwarg appears at all.
    const countPhase = (t, ph) => {
      const kw = (t.match(new RegExp(`phase\\s*=\\s*["']${ph}["']`, 'g')) ?? []).length;
      if (kw) return kw;
      return (t.match(new RegExp(`\\bemit_${ph}\\s*\\(`, 'g')) ?? []).length;
    };
    const starts = countPhase(text, 'start');
    const ends = countPhase(text, 'end');
    if (starts > ends) pyOpenBrackets.push({ file: rel, fn: fnName, line: fnLine, starts, ends });
  };
  lines.forEach((l, i) => {
    // TOP-LEVEL defs only. `analyze_section_diff` closes its bracket from a nested `def _end()`
    // at indent 4; splitting on every `def` attributed that end to the helper and reported the
    // outer function as leaking a start. A nested helper is part of its enclosing function.
    const m = /^(?:async\s+)?def\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(l);
    if (m) { flush(); fnName = m[1]; fnLine = i + 1; body = []; }
    body.push(l);
  });
  flush();
}

// ── the observed side ────────────────────────────────────────────────────────
const sql = postgres(DB, { max: 2, transform: { column: { from: (c) => c } } });

/**
 * TWO EMITTERS THAT LIVE IN THE DATABASE, NOT IN ANY FILE.
 *
 * This is the part no source scan can reach, and it is not an oversight in the design — it is the
 * design, and it is what makes the spine extensible without a deploy:
 *
 *   • THE SHARED CRON. `pipeline_schedules` rows with `run_type='event'` carry the event in
 *     `source` ("system:ops.digest_requested"); `tick_schedules()` claims the row and emits it.
 *     The event type is CONFIGURATION. Four workflows are driven this way and every one of them
 *     read as dead until this query was added.
 *   • THE GENERIC LAUNCHER. `launchTemplate()` reads `process_templates.trigger_key`, parses
 *     "namespace:type:phase", and INSERTs it — refusing anything that is not `phase='single'`,
 *     because a launch is one fire and a bracketed template is reactive by nature. So EVERY
 *     registered single-phase trigger is emittable by definition, from the admin UI, with no code
 *     written for it. That is the answer to "how do I plug a new workflow in": declare a
 *     single-phase trigger and it is launchable the moment its template row exists.
 */
const schedules = await sql`
  SELECT source FROM pipeline_schedules WHERE run_type = 'event' AND source LIKE '%:%'`;
for (const r of schedules) {
  const [ns, type] = String(r.source).split(':');
  if (ns && type) addEmit(ns, type, 'single', 'pipeline_schedules (shared cron)');
}
const templates = await sql`
  SELECT trigger_key FROM process_templates WHERE trigger_key LIKE '%:%:single'`;
for (const r of templates) {
  const [ns, type, phase] = String(r.trigger_key).split(':');
  if (ns && type && phase === 'single') addEmit(ns, type, 'single', 'process_templates (launchTemplate overlay)');
}
const observedRows = await sql`
  SELECT namespace, type, phase, count(*)::int AS n FROM system_events GROUP BY 1,2,3`;
const observed = new Map(observedRows.map((r) => [key(r.namespace, r.type, r.phase), r.n]));

const unterminated = await sql`
  SELECT s.namespace, s.type, count(*)::int AS n
  FROM system_events s
  WHERE s.phase = 'start'
    AND NOT EXISTS (SELECT 1 FROM system_events e WHERE e.parent_event_id = s.id AND e.phase = 'end')
  GROUP BY 1,2 ORDER BY 3 DESC`;
await sql.end();

// ── the joins ────────────────────────────────────────────────────────────────
const registry = loadRegistry();
const canEmit = (t) => emitters.has(key(t.ns, t.type, t.phase));
const wasSeen = (t) => observed.has(key(t.ns, t.type, t.phase));

const deadTriggers = registry
  .filter((w) => !canEmit(w.trigger))
  .map((w) => ({ ...w.trigger, wf: w.wf, seen: wasSeen(w.trigger) }));

const deadWaits = registry.flatMap((w) => w.steps
  .filter((s) => s.wait_for && !canEmit(s.wait_for))
  .map((s) => ({ wf: w.wf, step: s.name, ...s.wait_for, seen: wasSeen(s.wait_for) })));

// Join 5 · every `end` an emitter can produce, and whether a trigger consumes it. Headroom, not
// defects: this is the list of places a new automation can be attached without touching anything.
const consumedEnds = new Set(registry.map((w) => key(w.trigger.ns, w.trigger.type, w.trigger.phase)));
for (const w of registry) for (const s of w.steps) if (s.wait_for) consumedEnds.add(key(s.wait_for.ns, s.wait_for.type, s.wait_for.phase));
const emittedEnds = [...emitters.keys()].filter((k) => k.endsWith(':end'));
const unconsumedEnds = emittedEnds.filter((k) => !consumedEnds.has(k));

// ── the detector's own control ───────────────────────────────────────────────
// Two handlers, identical but for the one line that matters, run through the same code path the
// real scan uses. If the detector cannot tell these apart, every clean result above is unearned.
const BAD_SHAPE = `
export async function POST() {
  try {
    const startId = await emitEventStart({ namespace: 'finder', type: 'thing.done', actor: a });
    await emitEventEnd(startId, { result: {} });
    return NextResponse.json({ data: 1 });
  } catch (e) {
    return NextResponse.json({ error: 'x', code: 'DB_ERROR' }, { status: 500 });
  }
}`;
const GOOD_SHAPE = BAD_SHAPE.replace(
  "  } catch (e) {\n    return",
  "  } catch (e) {\n    await emitEventEnd(startId, { error: { message: 'x' } });\n    return",
);
function detectsOpenBracket(source) {
  const sf = ts.createSourceFile('control.ts', source, ts.ScriptTarget.Latest, true);
  const callee = (n) => (ts.isCallExpression(n) ? n.expression.getText(sf).split('.').pop() : null);
  const has = (n, f) => {
    let hit = false;
    const go = (x) => { if (hit) return; if (f(x)) { hit = true; return; } ts.forEachChild(x, go); };
    go(n);
    return hit;
  };
  let found = false;
  const visit = (node) => {
    if (ts.isCallExpression(node) && callee(node) === 'emitEventStart') {
      for (let p = node.parent; p; p = p.parent) {
        if (!ts.isTryStatement(p) || !p.catchClause) continue;
        const cc = p.catchClause;
        if (has(cc, ts.isReturnStatement) && !has(cc, (n) => callee(n) === 'emitEventEnd')) found = true;
        break;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}
const detectorSeesBadShape = detectsOpenBracket(BAD_SHAPE);
const detectorSeesGoodShape = detectsOpenBracket(GOOD_SHAPE);

/**
 * JOIN 7 · a NOTIFY step's template ↔ a renderer that exists.
 *
 * A NOTIFY step names a template STRING; the CRM, in a different service with a different database,
 * defines one. Nothing compared the two. Eight of the fifteen named templates existed nowhere, so
 * `render_template()` returned None and the listener emitted `system:notification.failed` instead
 * of an email — six of them had already been requested in this sandbox.
 *
 * The registry is assembled in two pieces (`TEMPLATES = {...}` then `TEMPLATES.update({...})`), and
 * the `.update` block carries a comment recording the last time this broke: "absence meant
 * rfp_admin stopped being notified (the 052 regression)". Read via the Python AST rather than a
 * regex, because a regex over `'name': lambda` counts BOTH pieces and reports 21 where the first
 * dict alone holds 11 — right answer, wrong reasoning, and it would have been wrong the moment a
 * third piece appeared.
 */
function crmTemplateNames() {
  const py = `
import ast, json
tree = ast.parse(open('services/cms/src/templates.py').read())
names = set()
for node in ast.walk(tree):
    if isinstance(node, ast.Assign) and isinstance(node.value, ast.Dict):
        for t in node.targets:
            if isinstance(t, ast.Name) and t.id == 'TEMPLATES':
                names |= {k.value for k in node.value.keys if isinstance(k, ast.Constant)}
    if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr == 'update':
        if isinstance(node.func.value, ast.Name) and node.func.value.id == 'TEMPLATES':
            for a in node.args:
                if isinstance(a, ast.Dict):
                    names |= {k.value for k in a.keys if isinstance(k, ast.Constant)}
print(json.dumps(sorted(names)))
`;
  const raw = execFileSync('python3', ['-c', py], { cwd: REPO, encoding: 'utf8' });
  return new Set(JSON.parse(raw.slice(raw.indexOf('['))));
}
const crmTemplates = crmTemplateNames();
const notifySteps = registry.flatMap((w) => w.steps
  .filter((s) => s.type === 'notify')
  .map((s) => ({ wf: w.wf, step: s.name, template: String(s.template ?? '').replace(/^["']|["']$/g, '') })));
// A template resolved from the payload at run time cannot be checked statically — reported as such
// rather than counted either way.
const dynamicNotify = notifySteps.filter((n) => n.template.startsWith('payload.') || n.template.startsWith('step.'));
const missingTemplates = notifySteps
  .filter((n) => n.template && !dynamicNotify.includes(n) && !crmTemplates.has(n.template));

/**
 * JOIN 7b · the FRONTEND'S notification templates ↔ the same renderers.
 *
 * A NOTIFY step is not the only thing that names a template any more. The frontend emits
 * `system:notification.requested` with a `template` in the payload — the Projects capability sends
 * every one of its mails that way, deliberately, so the digest and the ledger see them like any
 * other. The CRM renders those by exactly the same lookup, and misses them exactly the same way:
 * `render_template()` returns None and the listener emits `notification.failed` instead of an
 * email.
 *
 * JOIN 7 walked only the Python step registry, so this whole second population of template names
 * was outside it — which is how B141 could recur in a place the audit that exists to prevent B141
 * does not look. Uncovered is not passing.
 */
function frontendTemplateNames() {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir)) {
      if (e === 'node_modules' || e === '.next' || e.startsWith('.')) continue;
      const p = path.join(dir, e);
      if (fs.statSync(p).isDirectory()) walk(p);
      else if (/\.tsx?$/.test(e)) {
        const text = fs.readFileSync(p, 'utf8');
        if (!/notification\.requested/.test(text)) continue;
        // ANY string, not `[a-z0-9_]+`. The first version used the narrow class, and when the
        // red test renamed a template to `project_review_decidedX` the match failed outright —
        // so the site DISAPPEARED from the count instead of being flagged, and the audit
        // reported "0 with NO renderer" while looking at a broken one. A scanner that silently
        // drops what it cannot parse reports a clean run, which is worse than not scanning.
        for (const m of text.matchAll(/\btemplate\s*:\s*'([^']*)'/g)) {
          out.push({ file: path.relative(FRONTEND, p), template: m[1] });
        }
        // A template resolved from a variable cannot be checked here. Reported, not assumed.
        for (const m of text.matchAll(/\btemplate\s*:\s*([A-Za-z_$][\w$.]*)\s*[,}]/g)) {
          out.push({ file: path.relative(FRONTEND, p), template: null, dynamic: m[1] });
        }
      }
    }
  };
  for (const d of ['lib', 'app']) walk(path.join(FRONTEND, d));
  return out;
}
const frontendTemplates = frontendTemplateNames();
const dynamicFrontendTemplates = frontendTemplates.filter((t) => t.template === null);
const missingFrontendTemplates = frontendTemplates
  .filter((t) => t.template !== null && !crmTemplates.has(t.template));

// JOIN 6 · results, computed in the registry loader where the engine's own imports are available.
const unresolvableSteps = registry.flatMap((w) => w.steps
  .filter((s) => s.resolves !== true)
  .map((s) => ({ wf: w.wf, step: s.name, type: s.type, action: s.action, why: s.resolves })));
const skippedTypes = registry.flatMap((w) => w.steps
  .filter((s) => s.type === 'api_call')
  .map((s) => ({ wf: w.wf, step: s.name })));

// ── self-test ────────────────────────────────────────────────────────────────
// The join is a claim. Each answer below was verified by hand against the source first.
const T = [
  ['the registry loaded and is the real one', registry.length > 30 && registry.some((w) => w.wf === 'OnApplicationAccepted')],
  ['emitters were parsed from BOTH languages',
    [...emitters.values()].some((s) => [...s].some((f) => f.endsWith('.ts')))
    && [...emitters.values()].some((s) => [...s].some((f) => f.endsWith('.py')))],
  // Verified by hand: app/api/.../applications/[id]/accept emits capture:application.accepted.
  ['a known frontend emit is found', emitters.has(key('capture', 'application.accepted', 'single'))
    || emitters.has(key('capture', 'application.accepted', 'end'))],
  // emitEventStart implies an end of the same type — the pairing the end call site cannot name.
  // The wrapper that exists so an `end` is never lost must itself register an `end`, or the audit
  // punishes exactly the handlers that adopted it.
  ['withEventBracket registers BOTH phases',
    emitters.has(key('project', 'status_narrative.requested', 'start'))
    && emitters.has(key('project', 'status_narrative.requested', 'end'))],
  ['emitEventStart registers BOTH phases', emitters.has(key('proposal', 'proposal.created', 'start'))
    && emitters.has(key('proposal', 'proposal.created', 'end'))],
  /**
   * A DETECTOR PINNED TO A REAL DEFECT STOPS PROVING ANYTHING THE MOMENT THE DEFECT IS FIXED.
   *
   * This case first read "the open-bracket check finds proposals/create/route.ts", which was true,
   * hand-verified, and exactly the wrong test: closing that bracket made it fail, and the only
   * ways out were to delete the check or to leave the bug in. A detector's self-test has to be a
   * control it carries with it — source built here, in the shape it must catch, and the shape it
   * must not. Same reason `verify-surfaces` opens each lane by driving a page it knows is broken.
   */
  ['the open-bracket detector catches the shape it exists for', detectorSeesBadShape],
  ['…and stays quiet on the same handler once the catch closes the bracket', !detectorSeesGoodShape],
  ['the live corpus was read', observed.size > 20],
  ['every step action was resolved, not assumed', registry.flatMap((w) => w.steps).every((s) => s.resolves !== undefined)],
  // The CRM registry is built in two pieces; reading only the first reports working templates as absent.
  ['the CRM template registry includes the .update() block',
    crmTemplates.has('rfp_ready_for_curation') && crmTemplates.size > 20],
  // Each of the five below is an emit MECHANISM the first run did not know about, and each one
  // turned a working, wired, shipping workflow into a false "can never fire". Verified by hand.
  ['a ternary emit registers both branches (rfp-upload)', emitters.has(key('finder', 'rfp.uploaded', 'end'))],
  ['a python module-constant emit is resolved (advisory_actions)',
    emitters.has(key('proposal', 'proposal.advisory_overlay_requested', 'end'))],
  ['a raw INSERT emit is found (auth.ts → user.logged_in)',
    emitters.has(key('identity', 'user.logged_in', 'single'))],
  ['the shared cron counts as an emitter (pipeline_schedules)',
    [...emitters.get(key('system', 'ops.digest_requested', 'single')) ?? []].some((f) => f.includes('cron'))],
  ['a single-phase trigger is launchable via process_templates',
    emitters.has(key('proposal', 'project.collaboration_requested', 'single'))],
];
let bad = 0;
console.log('── join self-test ──');
for (const [why, ok] of T) { console.log(`  ${ok ? '✓' : '✗'} ${why}`); if (!ok) bad++; }
if (bad) console.log(`  ${bad} failure(s) — the audit below is not trustworthy.`);
if (process.argv.includes('--check')) process.exit(bad ? 1 : 0);

// ── report ───────────────────────────────────────────────────────────────────
const steps = registry.reduce((a, w) => a + w.steps.length, 0);
console.log(`\n══ 1 · workflow triggers ↔ something that emits them ══`);
console.log(`   ${registry.length} workflows · ${steps} steps · ${emitters.size} distinct (ns,type,phase) emittable`);
console.log(`   ${deadTriggers.length} trigger(s) nothing can emit — the workflow can never fire:`);
for (const d of deadTriggers) console.log(`   · ${d.wf.padEnd(34)} waits on ${`${d.ns}:${d.type}`.padEnd(46)} phase=${d.phase}${d.seen ? '  (but the DB HAS such a row — parser gap)' : ''}`);

console.log(`\n══ 2 · step wait_for ↔ something that emits them ══`);
const waits = registry.flatMap((w) => w.steps.filter((s) => s.wait_for));
console.log(`   ${waits.length} step(s) park on an event · ${deadWaits.length} park on one nothing emits:`);
for (const d of deadWaits) console.log(`   · ${d.wf}.${d.step} waits on ${d.ns}:${d.type} phase=${d.phase}`);

console.log(`\n══ 3 · brackets a throw can walk out of ══`);
console.log(`   ${openBrackets.length} emitEventStart call(s) inside a try whose catch returns without an end:`);
for (const o of openBrackets) console.log(`   · ${o.file}:${o.startLine}  (${o.ns}:${o.type}) → catch at :${o.catchLine}`);
console.log(`   ${pyOpenBrackets.length} python function(s) start more brackets than they end:`);
for (const o of pyOpenBrackets) console.log(`   · ${o.file}:${o.line} ${o.fn}()  starts=${o.starts} ends=${o.ends}`);
console.log(`   live corpus — start rows never terminated:`);
for (const u of unterminated) console.log(`   · ${`${u.namespace}:${u.type}`.padEnd(50)} ${u.n}`);
if (!unterminated.length) console.log('   · none');

console.log(`\n══ 6 · every step's action ↔ an implementation that exists ══`);
const stepCount = registry.reduce((a, w) => a + w.steps.length, 0);
console.log(`   ${stepCount} steps · ${unresolvableSteps.length} whose action cannot be resolved:`);
for (const u of unresolvableSteps) console.log(`   · ${u.wf}.${u.step} (${u.type}) → ${u.action}  ${u.why}`);
if (skippedTypes.length) {
  console.log(`   ⚠ ${skippedTypes.length} api_call step(s) — the dispatcher skips these ("not implemented in V1"):`);
  for (const k of skippedTypes) console.log(`   · ${k.wf}.${k.step}`);
}

console.log(`\n══ 7 · every NOTIFY step ↔ a renderer that exists ══`);
console.log(`   ${notifySteps.length} notify steps · ${crmTemplates.size} templates the CRM can render`);
console.log(`   ${dynamicNotify.length} resolve their template from the payload (not statically checkable)`);
console.log(`   ${missingTemplates.length} name a template with NO renderer — these emit notification.failed, not email:`);
for (const m of missingTemplates) console.log(`   · ${m.wf}.${m.step} → ${m.template}`);
console.log(`   ── and the FRONTEND's own notification.requested payloads, same renderers ──`);
console.log(`   ${frontendTemplates.length - dynamicFrontendTemplates.length} literal · ${dynamicFrontendTemplates.length} resolved from a variable (unchecked) · ${missingFrontendTemplates.length} with NO renderer:`);
for (const m of missingFrontendTemplates) console.log(`   ✗ ${m.file} → ${m.template}`);
for (const m of dynamicFrontendTemplates) console.log(`   ? ${m.file} → ${m.dynamic} (dynamic)`);

console.log(`\n══ 4 · declared ↔ exercised ══`);
const neverSeen = [...emitters.keys()].filter((k) => !observed.has(k));
console.log(`   ${emitters.size} emittable · ${observed.size} distinct (ns,type,phase) in the corpus · ${neverSeen.length} never fired here`);
const unknownToSource = [...observed.keys()].filter((k) => !emitters.has(k));
console.log(`   ${unknownToSource.length} observed with no emitter the scan can see (dynamic emit, or a parser gap):`);
for (const k of unknownToSource.slice(0, 12)) console.log(`   · ${k}  ×${observed.get(k)}`);
if (unknownToSource.length > 12) console.log(`   · …and ${unknownToSource.length - 12} more`);

console.log(`\n══ 5 · the extension surface ══`);
console.log(`   ${emittedEnds.length} bracketed operations emit an 'end' · ${emittedEnds.length - unconsumedEnds.length} already have a workflow attached`);
console.log(`   ${unconsumedEnds.length} 'end' events nothing consumes — where a new automation can attach with no code change`);

fs.writeFileSync(path.join(REPO, 'docs/automation-spine-audit.json'), JSON.stringify({
  workflows: registry.length, steps, deadTriggers, deadWaits, openBrackets,
  unresolvableSteps, missingTemplates, dynamicNotify, pyOpenBrackets,
  frontendTemplates, missingFrontendTemplates,
  unterminated, emittable: [...emitters.keys()].sort(),
  observed: Object.fromEntries(observed), unconsumedEnds: unconsumedEnds.sort(),
}, null, 1));
console.log(`\nwrote docs/automation-spine-audit.json`);
process.exit(deadTriggers.length || deadWaits.length || openBrackets.length
  || unresolvableSteps.length || missingTemplates.length ? 1 : 0);

#!/usr/bin/env node
/**
 * fix-open-event-brackets.mjs — close the start/end brackets a throw walks out of.
 *
 * THE DEFECT. The canonical API-route template wraps the handler in one big `try`, and
 * `emitEventStart` lands inside it:
 *
 *     try {
 *       const startId = await emitEventStart({ namespace: 'finder', type: 'source.created', … });
 *       …work…
 *       await emitEventEnd(startId, { result: … });
 *       return NextResponse.json({ data });
 *     } catch (e) {
 *       return NextResponse.json({ error: …, code: 'DB_ERROR' }, { status: 500 });   // ← no end
 *     }
 *
 * If anything in between throws, the `start` row is never terminated. Not a cosmetic loss:
 *
 *   • `docs/EVENT_CONTRACT.md` states the invariant outright — "a handler that emits `start` MUST
 *     emit `end` on *every* exit path (success return AND catch block)".
 *   • The workflow engine's `EventTrigger.matches()` is built on it: it skips events carrying
 *     `error`, because "a failed op still emits a terminal phase='end' event (with error set)".
 *     A handler that emits nothing gives the engine no terminal event at all — so anything waiting
 *     on that operation waits forever, with no signal that it never will arrive.
 *   • `duration_ms` is computed on `end`, so the failure path — the one you most want timed — has
 *     no latency data.
 *   • The audit trail keeps a row that says "started" and never says anything else.
 *
 * WHY IT WAS WRITTEN THIS WAY, which is the part worth fixing properly: `const startId` is declared
 * INSIDE the try, so it is not in scope in the catch. The pattern is not carelessness — closing the
 * bracket there is a syntax error. The fix hoists the binding to `let startId: string | null = null`
 * above the try, so the catch can reach it.
 *
 * `frontend/lib/events.ts` gains `withEventBracket()` so new code does not have to remember any of
 * this; this codemod is for the 31 sites that predate it.
 *
 *   node scripts/fix-open-event-brackets.mjs --dry     # print the plan, touch nothing
 *   node scripts/fix-open-event-brackets.mjs           # apply
 */
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const REPO = '/home/user/govwin';
const DRY = process.argv.includes('--dry');

const walk = (dir, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
};

const plan = [];
for (const file of walk(path.join(REPO, 'frontend/app'))) {
  const src = fs.readFileSync(file, 'utf8');
  if (!src.includes('emitEventStart')) continue;
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true);
  const rel = path.relative(REPO, file);

  const calleeName = (n) => (ts.isCallExpression(n) ? n.expression.getText(sf).split('.').pop() : null);
  const contains = (node, fn) => {
    let hit = false;
    const visit = (n) => { if (hit) return; if (fn(n)) { hit = true; return; } ts.forEachChild(n, visit); };
    visit(node);
    return hit;
  };

  const visit = (node) => {
    if (ts.isCallExpression(node) && calleeName(node) === 'emitEventStart') {
      let tryStmt = null;
      for (let p = node.parent; p; p = p.parent) {
        if (ts.isTryStatement(p) && p.catchClause) { tryStmt = p; break; }
      }
      if (tryStmt) {
        const cc = tryStmt.catchClause;
        const returns = contains(cc, (n) => ts.isReturnStatement(n));
        const hasEnd = contains(cc, (n) => calleeName(n) === 'emitEventEnd');
        if (returns && !hasEnd) {
          // The binding that holds the start id, and how it is declared.
          // Two shapes reach the same place: `const startId = await emitEventStart(…)` (a
          // declaration, which must be hoisted) and a bare `startId = await emitEventStart(…)`
          // where someone already hoisted `let startId` above the try — that one needs only the
          // catch-side emit. Reading only declarations reported the second kind as "discards the
          // start id", which would have quietly left two sites unfixed.
          let decl = null;
          let assignName = null;
          for (let p = node.parent; p; p = p.parent) {
            if (ts.isVariableStatement(p)) { decl = p; break; }
            if (ts.isBinaryExpression(p) && p.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
              assignName = p.left.getText(sf); break;
            }
            if (ts.isBlock(p)) break;
          }
          const name = decl?.declarationList.declarations[0]?.name.getText(sf) ?? assignName;
          const isConst = decl ? (decl.declarationList.flags & ts.NodeFlags.Const) !== 0 : false;
          plan.push({
            file, rel, name, isConst,
            declStart: decl?.getStart(sf) ?? null,
            // Consume the trailing space too — dropping just the keyword leaves `     startId`,
            // a stray indent that survives review as noise in every one of the 28 diffs.
            declKeywordEnd: decl ? decl.getStart(sf) + (isConst ? 'const '.length : 'let '.length) : null,
            tryStart: tryStmt.getStart(sf),
            tryLine: sf.getLineAndCharacterOfPosition(tryStmt.getStart(sf)).line + 1,
            catchVar: cc.variableDeclaration?.name.getText(sf) ?? null,
            catchBlockStart: cc.block.getStart(sf),
            catchLine: sf.getLineAndCharacterOfPosition(cc.getStart(sf)).line + 1,
            indent: ' '.repeat(sf.getLineAndCharacterOfPosition(tryStmt.getStart(sf)).character),
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

console.log(`${plan.length} open bracket(s) in ${new Set(plan.map((p) => p.rel)).size} file(s)`);
const unnamed = plan.filter((p) => !p.name);
const noCatchVar = plan.filter((p) => !p.catchVar);
if (unnamed.length) {
  // A start whose id is discarded cannot be closed at all — that is a different, larger fix.
  console.log(`  ⚠ ${unnamed.length} discard the start id (cannot be closed mechanically):`);
  for (const p of unnamed) console.log(`    · ${p.rel}:${p.tryLine}`);
}
console.log(`  ${noCatchVar.length} catch clause(s) take no parameter (message falls back to a constant)`);
if (DRY) {
  for (const p of plan) console.log(`  · ${p.rel}  try:${p.tryLine} catch:${p.catchLine} id=${p.name} ${p.isConst ? '(const → let)' : '(already let)'}`);
  process.exit(0);
}

// Apply per file, back-to-front so earlier offsets stay valid.
const byFile = new Map();
for (const p of plan.filter((x) => x.name)) {
  if (!byFile.has(p.file)) byFile.set(p.file, []);
  byFile.get(p.file).push(p);
}
let edited = 0;
for (const [file, items] of byFile) {
  let src = fs.readFileSync(file, 'utf8');
  const edits = [];
  for (const p of items) {
    // 1 · close the bracket as the FIRST thing the catch does, before it returns.
    //     `?? undefined` because emitEventEnd takes `code?: string` — a null would be a type error.
    const msg = p.catchVar
      ? `${p.catchVar} instanceof Error ? ${p.catchVar}.message : String(${p.catchVar})`
      : `'handler threw'`;
    const body = `\n${p.indent}  if (${p.name}) {\n`
      + `${p.indent}    await emitEventEnd(${p.name}, { error: { message: ${msg}, code: 'HANDLER_THREW' } });\n`
      + `${p.indent}  }`;
    edits.push({ pos: p.catchBlockStart + 1, insert: body });

    // 2 · hoist the binding so the catch can see it.
    if (p.isConst) {
      edits.push({ pos: p.declStart, end: p.declKeywordEnd, insert: '' });               // drop `const`
      edits.push({ pos: p.declStart, insert: '' });                                       // (no-op anchor)
      edits.push({ pos: p.tryStart, insert: `let ${p.name}: string | null = null;\n${p.indent}` });
    }
  }
  // Back-to-front, and stable for equal positions.
  edits.sort((a, b) => b.pos - a.pos || (b.end ?? b.pos) - (a.end ?? a.pos));
  for (const e of edits) {
    src = src.slice(0, e.pos) + e.insert + src.slice(e.end ?? e.pos);
  }
  fs.writeFileSync(file, src);
  edited++;
}
console.log(DRY ? '' : `rewrote ${edited} file(s) — run tsc and the audit to confirm`);

#!/usr/bin/env node
/**
 * Do the harnesses parse and BIND?
 *
 * ── THE GAP THIS FILLS, MEASURED IN BOTH DIRECTIONS ──────────────────────────────────────────
 * `tsconfig.json` includes `**\/*.ts` and `**\/*.tsx`. **`.mts` matches neither**, so
 * `npx tsc --noEmit` — the first line of this repo's verification backbone — never checks a drive
 * except the 66 pulled in transitively as imports. Verified twice: `tsc --listFiles` does not load
 * `drive-project-lifecycle.mts`, and a duplicate `const` injected into it produces zero errors.
 *
 * The consequence is not theoretical. Twice in one sitting a duplicate `const` inside a drive's
 * `main()` passed `tsc` clean and then failed under esbuild at run time — after a full rebuild and
 * a server restart, to learn something a binder knows instantly.
 *
 * ── WHY NOT JUST ADD `.mts` TO THE INCLUDE ───────────────────────────────────────────────────
 * It surfaces **121 pre-existing type errors** across the harness tree, and a check that fails 121
 * times on its first run is one somebody turns off that afternoon. Fixing those is real work with
 * its own justification; this is the part that pays today.
 *
 * ── AND WHY IT IS NOT esbuild ────────────────────────────────────────────────────────────────
 * The first version of this file used `esbuild.transformSync`, on the reasoning that esbuild is
 * what reported the bug. Red-tested against the exact defect it was written for, **it did not
 * catch it**: a per-file transform does no cross-scope binding, and the duplicate only surfaced
 * when `tsx` built the module for execution. An instrument that cannot detect the thing it exists
 * for is worse than none, because it reports a clean run.
 *
 * So this uses the TypeScript binder and keeps ONLY the diagnostics about declaring the same thing
 * twice, plus every syntax error. The 121 type errors are deliberately not reported — this makes
 * no claim about types, and pretending otherwise is how the number gets ignored.
 *
 *   cd frontend && node scripts/check-harness-syntax.mjs
 * Exit 0 if every harness parses and binds; 1 otherwise.
 */
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const ROOTS = ['scripts', 'e2e'];

/** The binder's "you declared that twice" family. Everything else is a type opinion. */
const REDECLARATION = new Set([
  2300, // Duplicate identifier
  2393, // Duplicate function implementation
  2440, // Import declaration conflicts with local declaration
  2451, // Cannot redeclare block-scoped variable
  2567, // Enum declarations can only merge with…
]);

const files = [];
for (const root of ROOTS) {
  const walk = (dir) => {
    let entries;
    try { entries = readdirSync(dir); } catch { return; }
    for (const e of entries) {
      const p = path.join(dir, e);
      if (statSync(p).isDirectory()) { walk(p); continue; }
      if (/\.(mts|ts|tsx)$/.test(e) && !/\.d\.ts$/.test(e)) files.push(p);
    }
  };
  walk(root);
}

const program = ts.createProgram(files, {
  noEmit: true,
  allowJs: false,
  skipLibCheck: true,
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  // Unresolved imports would otherwise become semantic errors on every `@/…` path; they are not
  // what this asks about, and `skipLibCheck` + the code filter below keep them out anyway.
  noResolve: false,
});

const failures = [];
for (const file of files) {
  const source = program.getSourceFile(path.resolve(file));
  if (!source) continue;
  const diagnostics = [
    ...program.getSyntacticDiagnostics(source),
    ...program.getSemanticDiagnostics(source).filter((d) => REDECLARATION.has(d.code)),
  ];
  for (const d of diagnostics) {
    const where = d.file && d.start !== undefined
      ? `:${d.file.getLineAndCharacterOfPosition(d.start).line + 1}` : '';
    failures.push(`${file}${where} — TS${d.code}: ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`);
  }
}

console.log(`${files.length} harness file(s) parsed and bound`);
if (!failures.length) {
  console.log('\n✓ no syntax errors and nothing declared twice.');
  console.log('  (NOT a type check: tsconfig excludes .mts, and including it surfaces 121');
  console.log('   pre-existing errors — see docs/PROJECT_BUILD_LOG.md, H2.)');
  process.exit(0);
}
console.log(`\n✗ ${failures.length} problem(s) that will fail the moment the harness is run:`);
for (const f of failures) console.log(`  · ${f}`);
process.exit(1);

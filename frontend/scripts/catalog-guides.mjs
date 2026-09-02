#!/usr/bin/env node
/**
 * catalog-guides.mjs — the guide coverage registry. Which surfaces have a guide, what state each
 * one is in, and which ones nobody has written yet.
 *
 * ── THE ARCHITECTURE DECISION: STATE IS DERIVED, NEVER STORED ────────────────────────────────
 * The obvious design is a `guides` table with a status column and a "mark as done" button. It is
 * wrong for the reason every convention-flag in this repo has been wrong: a flag someone must
 * remember to set is a flag that lies, and it lies most confidently about the guides nobody has
 * looked at in a month.
 *
 * Every part of a guide's state is already a fact somewhere else:
 *
 *   is there a guide          a `*-guide.tsx` next to the page
 *   is it finished            whether it still renders `<Unwritten>` sections
 *   is it disputed            unresolved notes on its anchors, in `working_notes`
 *   is it out of date         git: did the SURFACE change after the GUIDE last did
 *
 * So nothing is stored. `stale` in particular is the whole point of the loop — "new features, spin
 * it up again" — and it cannot depend on anyone noticing. It is computed by asking git whether the
 * page moved more recently than the prose describing it. The guide file is EXCLUDED from the
 * surface's own timestamp, or editing the guide would mark it fresh by touching its own directory.
 *
 * ── WHY AN ARTIFACT AND NOT A RUNTIME WALK ───────────────────────────────────────────────────
 * The board at `/admin/guides` runs in a container that has neither the `.tsx` sources nor a git
 * history. So the derivable-from-the-repo half is computed here, at build time, into
 * `docs/guide-coverage.json`; the board joins it with the half that is only true at runtime — the
 * open notes. Same split as `ui-catalog.json`, for the same reason, and the board says which half
 * it is showing.
 *
 *   cd frontend && node scripts/catalog-guides.mjs
 *
 * Exit 0 · 2 as a HARNESS DEFECT if it cannot enumerate the surfaces it claims to cover.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const REPO = '/home/user/govwin';
const FE = path.join(REPO, 'frontend');
const ADMIN = path.join(FE, 'app/admin');
const OUT_JSON = path.join(REPO, 'docs/guide-coverage.json');
const OUT_MD = path.join(REPO, 'docs/GUIDE_COVERAGE.md');

/** Unix seconds of the last commit touching `paths`, or 0. */
function lastCommit(...args) {
  try {
    const out = execFileSync('git', ['log', '-1', '--format=%ct', '--', ...args], { cwd: REPO, encoding: 'utf8' });
    return Number(out.trim()) || 0;
  } catch { return 0; }
}

/** Every admin surface: a directory under app/admin holding a page.tsx. */
function surfaces(dir = ADMIN, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) surfaces(p, out);
    else if (e.name === 'page.tsx') {
      const relDir = path.relative(FE, dir);
      out.push({
        route: '/' + path.relative(path.join(FE, 'app'), dir),
        dir: relDir,
      });
    }
  }
  return out;
}

/** What a guide file declares about itself. */
function readGuide(file) {
  const src = fs.readFileSync(file, 'utf8');
  return {
    file: path.relative(FE, file),
    declaredRoute: src.match(/const R\s*=\s*'([^']+)'/)?.[1] ?? null,
    steps: [...src.matchAll(/<Step\s+id="([^"]+)"[\s\S]*?title="([^"]+)"/g)].map((m) => ({ id: m[1], title: m[2] })),
    controls: [...new Set([...src.matchAll(/<Ctl>([^<{]+)<\/Ctl>/g)].map((m) => m[1].trim()))],
    unwritten: (src.match(/<Unwritten>/g) ?? []).length,
    canon: src.match(/<Canon doc="([^"]+)"/)?.[1] ?? null,
  };
}

const found = surfaces();
if (!found.length) {
  console.error('✗ HARNESS DEFECT — no admin surfaces found. A coverage report over nothing is not coverage.');
  process.exit(2);
}

const rows = found.map((s) => {
  const abs = path.join(FE, s.dir);
  const guideFile = fs.readdirSync(abs).find((f) => /-guide\.tsx$/.test(f));
  const guide = guideFile ? readGuide(path.join(abs, guideFile)) : null;

  // The surface's own age, with the guide EXCLUDED — see the header.
  const surfaceAt = lastCommit(s.dir, `:(exclude)${s.dir}/*-guide.tsx`);
  const guideAt = guide ? lastCommit(guide.file) : 0;

  /**
   * The four states. `open` and `stale` are both "needs work" but for opposite reasons — one was
   * never finished, the other was finished and the ground moved — and a board that collapsed them
   * would hide the second, which is the one nobody goes looking for.
   */
  let state = 'none';
  if (guide) {
    if (guide.unwritten > 0) state = 'open';
    else if (surfaceAt && guideAt && surfaceAt > guideAt) state = 'stale';
    else state = 'ready';
  }

  return {
    route: s.route,
    dir: s.dir,
    guide: guide?.file ?? null,
    state,
    steps: guide?.steps ?? [],
    controls: guide?.controls ?? [],
    unwritten: guide?.unwritten ?? 0,
    canon: guide?.canon ?? null,
    surfaceChangedAt: surfaceAt || null,
    guideWrittenAt: guideAt || null,
  };
});

const by = (s) => rows.filter((r) => r.state === s).length;
const summary = { surfaces: rows.length, none: by('none'), open: by('open'), ready: by('ready'), stale: by('stale') };

fs.writeFileSync(OUT_JSON, JSON.stringify({ generatedAt: new Date().toISOString(), summary, rows }, null, 1));

// ── docs/GUIDE_COVERAGE.md ──────────────────────────────────────────────────────────────────
const L = [];
L.push('# GUIDE COVERAGE — which surfaces explain themselves');
L.push('');
L.push('> Generated by `frontend/scripts/catalog-guides.mjs`. Do not hand-edit — re-run it.');
L.push('>');
L.push('> **State is derived, never stored.** There is no table and no "mark as done" button: a flag');
L.push('> someone must remember to set is a flag that lies. `open` means the guide still renders');
L.push('> `<Unwritten>` sections; `ready` means it does not; `stale` means the SURFACE changed after');
L.push('> the guide last did, which is the "new features, spin it up again" signal and does not depend');
L.push('> on anyone noticing. Unresolved notes are live and shown on `/admin/guides`, not here.');
L.push('');
L.push(`**${summary.surfaces} admin surfaces · ${summary.ready} ready · ${summary.open} open · `
  + `${summary.stale} stale · ${summary.none} with no guide at all.**`);
L.push('');
L.push('Uncovered is not passing. The `none` rows are the queue.');
L.push('');
L.push('| state | route | guide | steps | unwritten | canonical doc |');
L.push('|---|---|---|---:|---:|---|');
const order = { stale: 0, open: 1, ready: 2, none: 3 };
for (const r of [...rows].sort((a, b) => order[a.state] - order[b.state] || a.route.localeCompare(b.route))) {
  L.push(`| \`${r.state}\` | \`${r.route}\` | ${r.guide ? `\`${path.basename(r.guide)}\`` : '—'} `
    + `| ${r.steps.length || ''} | ${r.unwritten || ''} | ${r.canon ? `\`${r.canon}\`` : ''} |`);
}
L.push('');
fs.writeFileSync(OUT_MD, `${L.join('\n')}\n`);

console.log(`✓ ${summary.surfaces} admin surface(s) — ${summary.ready} ready · ${summary.open} open · `
  + `${summary.stale} stale · ${summary.none} unguided`);
console.log('  wrote docs/guide-coverage.json + docs/GUIDE_COVERAGE.md');

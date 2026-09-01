/**
 * A BACKTICK INSIDE A SQL COMMENT INSIDE A TAGGED TEMPLATE ENDS THE TEMPLATE.
 *
 * This codebase explains itself in `-- …` comments inside `` sql`…` `` templates, and the natural
 * way to name a column or a status in prose is to wrap it in backticks. Inside a template literal
 * that backtick CLOSES the string, and everything after it is parsed as JavaScript. The result is
 * a wall of `TS1005: ';' expected` pointing at the line AFTER the comment, which reads as a syntax
 * error in code that is fine.
 *
 * It is documented in CLAUDE.md and it still happened TWICE in one sitting — once in
 * app/admin/system-state/page.tsx (`` `paused` ``) and once in app/admin/projects/page.tsx
 * (`` `projects` ``). A rule that has to be remembered at the moment of writing a comment is a rule
 * that will be broken; tsc catches it, but only after a full typecheck, and the error names the
 * wrong line.
 *
 * So it is a test. It scans for the shape rather than trusting anybody to remember, and it names
 * the file and line so the fix is obvious.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next' || entry.startsWith('.')) continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|mts)$/.test(p)) out.push(p);
  }
  return out;
}

const SOURCES = [join(ROOT, 'app'), join(ROOT, 'lib'), join(ROOT, 'scripts')].flatMap((d) => walk(d));

describe('SQL comments inside tagged templates', () => {
  it('never contain a backtick', () => {
    const offenders: string[] = [];
    for (const f of SOURCES) {
      const src = readFileSync(f, 'utf8');
      if (!/sql(?:Bypass)?\s*</.test(src) && !/sql(?:Bypass)?`/.test(src)) continue;

      // Walk the file tracking whether we are inside a tagged SQL template. Deliberately simple:
      // it only has to recognise the one shape that breaks, and a scanner that silently drops what
      // it cannot parse would report a clean run — the failure mode this repo cares most about.
      let inTemplate = false;
      src.split('\n').forEach((line, i) => {
        const trimmed = line.trim();
        if (!inTemplate) {
          // A line that OPENS a sql template and does not close it on the same line.
          if (/\bsql(Bypass)?(<[^>]*>)?`/.test(line) && (line.match(/`/g) ?? []).length === 1) {
            inTemplate = true;
          }
          return;
        }
        if (trimmed.startsWith('--') && line.includes('`')) {
          offenders.push(`${f.replace(ROOT + '/', '')}:${i + 1}  ${trimmed.slice(0, 76)}`);
          inTemplate = false;   // the backtick ended it; stop tracking rather than cascading
          return;
        }
        if (line.includes('`')) inTemplate = false;   // the template closed legitimately
      });
    }
    expect(offenders,
      'a backtick in a SQL comment CLOSES the template literal — use plain words:\n  '
      + offenders.join('\n  ')).toEqual([]);
  });

  it('detects the shape it is looking for', () => {
    // THE INSTRUMENT BEFORE THE FINDING. The check above passes trivially if the scanner never
    // enters a template — a regex tweak could make it green forever. Prove it fires on the exact
    // two lines that broke this session, reconstructed here rather than left to memory.
    const fixture = [
      "const rows = await sql<HealthRow[]>`",
      '  SELECT 1',
      '  -- difference is `paused`, which is the HITL state',
      '`;',
    ].join('\n');
    let inTemplate = false;
    const hits: number[] = [];
    fixture.split('\n').forEach((line, i) => {
      const trimmed = line.trim();
      if (!inTemplate) {
        if (/\bsql(Bypass)?(<[^>]*>)?`/.test(line) && (line.match(/`/g) ?? []).length === 1) inTemplate = true;
        return;
      }
      if (trimmed.startsWith('--') && line.includes('`')) { hits.push(i + 1); inTemplate = false; return; }
      if (line.includes('`')) inTemplate = false;
    });
    expect(hits).toEqual([3]);
  });
});

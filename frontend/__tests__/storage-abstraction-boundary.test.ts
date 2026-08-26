/**
 * THE STORAGE ABSTRACTION IS A BOUNDARY, and this test is what makes it one.
 *
 * `lib/storage/s3-client.ts` exists so the rest of the codebase never talks to S3 directly. Its own
 * header states the contract: with `STORAGE_DRIVER=local` the SAME helpers are backed by the
 * filesystem. That only holds if every caller goes through them — the local driver is implemented
 * in that file and NOWHERE ELSE, so a route that builds its own `ListObjectsV2Command` and calls
 * `s3.send` silently opts out of it.
 *
 * Two routes had done exactly that, and the consequences were live and different:
 *
 *   · `/admin/storage` — the Storage Manager answered HTTP 200 with a red
 *     "Failed to list storage objects" banner on every local/dev box, because the raw command went
 *     to AWS with no credentials (`InvalidAccessKeyId`).
 *   · `/api/portal/<t>/proposals/<p>/dropbox` — the CUSTOMER-facing dropbox, same shape, so a
 *     collaborator saw an empty error where their files were.
 *
 * Neither was caught by anything: both routes answered 200, both returned a well-formed
 * `{error, code}` envelope on the inner failure, and the page carried no text any error matcher
 * knows. It was found by looking at a screenshot.
 *
 * The gap in the abstraction is WHY callers went around it — there was no recursive listing, no
 * stat, and no bulk delete — so those were added rather than the callers being told off. This test
 * keeps the boundary closed now that it is closable.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const SKIP_DIRS = new Set(['node_modules', '.next', '__tests__', 'e2e', 'e2e-artifacts', 'public', 'scripts']);

/** Every .ts/.tsx under app/ and lib/, excluding lib/storage itself — the one legal importer. */
function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(full) && !full.includes(join('lib', 'storage'))) out.push(full);
    }
  };
  for (const d of ['app', 'lib']) {
    try { if (statSync(join(ROOT, d)).isDirectory()) walk(join(ROOT, d)); } catch { /* absent */ }
  }
  return out;
}

describe('storage abstraction boundary', () => {
  it('nothing outside lib/storage imports the AWS S3 SDK', () => {
    const offenders = sourceFiles().filter((f) => /@aws-sdk\/client-s3/.test(readFileSync(f, 'utf8')));
    expect(
      offenders.map((f) => f.replace(ROOT + '/', '')),
      'these files bypass lib/storage/s3-client.ts, so STORAGE_DRIVER=local does not apply to them',
    ).toEqual([]);
  });

  it('nothing outside lib/storage calls s3.send directly', () => {
    const offenders = sourceFiles().filter((f) => /\bs3\.send\s*\(/.test(readFileSync(f, 'utf8')));
    expect(
      offenders.map((f) => f.replace(ROOT + '/', '')),
      'these files issue raw S3 commands — use the helpers so the local driver keeps working',
    ).toEqual([]);
  });

  it('the walk actually found files — a green from an empty list is not a pass', () => {
    // The instrument before the finding: if `sourceFiles()` ever returns nothing (a moved cwd, a
    // renamed directory) both assertions above pass vacuously and this suite becomes decoration.
    expect(sourceFiles().length).toBeGreaterThan(300);
  });

  it('the abstraction still exports what the callers were reaching around it for', () => {
    const src = readFileSync(join(ROOT, 'lib/storage/s3-client.ts'), 'utf8');
    for (const fn of ['listObjects', 'listObjectsDeep', 'objectStat', 'deleteObjects', 'putObject', 'getObjectBuffer']) {
      expect(src, `lib/storage/s3-client.ts must export ${fn}`).toMatch(new RegExp(`export async function ${fn}\\b`));
    }
  });
});

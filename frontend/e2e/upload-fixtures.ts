/**
 * The ingest drives feed REAL solicitation PDFs through upload → shred → matrix → skeleton, which
 * is the only honest way to test that path: the whole point is what the extractor does with a
 * government document nobody wrote for the test.
 *
 * Those PDFs arrived as chat uploads and live under a per-session directory
 * (/root/.claude/uploads/<session-id>/). They are not in the repository and they do not survive a
 * container, so on any other machine four specs — dow-ingest, dow-full-ingest, ingest-coverage and
 * flex-midwindow — failed at their first `setInputFiles` with an error that read like a product
 * defect. It is not one. A missing input file means the test could not be run, and a suite that
 * reports "could not run" as "failed" buries the failures that matter.
 *
 * So: skip, and say exactly which file is missing and where to put it. A red line you have to
 * re-diagnose every run is worse than a skip that names its own fix.
 */
import { test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

/** Where the session-scoped chat uploads land. Override for a machine that keeps them elsewhere. */
export const UPLOADS =
  process.env.E2E_UPLOAD_DIR ||
  '/root/.claude/uploads/34d597b2-183f-5787-9057-fc7251e3f9ff';

/**
 * Resolve fixture files, skipping the whole suite if any is absent. Call at module scope inside a
 * `test.describe` or before the tests that need them.
 */
export function requireUploads(...names: string[]): string[] {
  const resolved = names.map((n) => path.join(UPLOADS, n));
  const missing = resolved.filter((p) => !fs.existsSync(p));
  test.skip(
    missing.length > 0,
    `source PDFs not on this machine — put ${missing.map((m) => path.basename(m)).join(', ')} in ` +
      `${UPLOADS} (or set E2E_UPLOAD_DIR). These are chat-uploaded solicitations, not repo fixtures.`,
  );
  return resolved;
}

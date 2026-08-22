#!/usr/bin/env node
/**
 * bug-log-status — say what is actually still open in the bug log.
 *
 * WHY THIS EXISTS. I reported "the bug log's open list is empty" and it was not. I had checked with
 * `grep '^## B[0-9]* — OPEN'`, which understands exactly one of the three heading conventions the
 * log has accumulated:
 *
 *     ## B44 — Every topic upload failed on an ON CONFLICT … · FIXED      trailing status
 *     ## B51 — FIXED. One application raises TWO ToDos …                  leading status
 *     ## B46 — `opportunities.solicitation_id` … · PARTLY PROVEN, OPEN    trailing, compound
 *
 * The grep matched the middle form only, so an open entry in either other form read as absent. That
 * is the same class the log itself is largely about — a check whose failure path is never exercised
 * — and it produced a confident, wrong "all clear".
 *
 * This reads the status from EITHER end of the heading and refuses to guess: a heading it cannot
 * classify is reported as UNKNOWN and counted against the exit code, so a new convention shows up
 * as something to fix rather than as silence.
 *
 * Run:  node frontend/scripts/bug-log-status.mjs [path]
 * Exit: 0 when nothing is open or unclassifiable, 1 otherwise (so it can gate a close-out claim).
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';

const FILE = resolve(process.argv[2] ?? 'docs/BUG_LOG_2026-08-19.md');

/** Statuses that mean "this needs no more work". Everything else is open or unknown. */
const CLOSED = [
  /\bFIXED\b/i, /\bNOT[- ]A[- ]BUG\b/i, /\bDOC FIX\b/i, /\bCORRECTED\b/i,
  /\bCAPABILITY BUILT\b/i, /\bnumber skipped\b/i, /\bRETRACT/i,
];
/** Statuses that mean "known, recorded, deliberately not done yet". Open, but not a surprise. */
const DEFERRED = [/\bLOGGED\b/i, /\bDEFERRED\b/i];
/** Explicitly still open. */
const OPEN = [/\bOPEN\b/i, /\bPARTLY PROVEN\b/i, /\bUNRESOLVED\b/i];

const lines = readFileSync(FILE, 'utf8').split('\n');
const rows = [];
// SKIP FENCED BLOCKS. Entries quote example headings to explain a convention — B67 quotes three —
// and a line-by-line scan reads those illustrations as data. It did: the quoted
// `## B46 … PARTLY PROVEN, OPEN` superseded the real, fixed B46 and the script reported it open
// again, one commit after it was closed. A parser that cannot tell an example from a record is the
// same failure it exists to catch, so it now tracks fence state.
let inFence = false;
for (const line of lines) {
  if (/^\s*(```|~~~)/.test(line)) { inFence = !inFence; continue; }
  if (inFence) continue;
  const m = /^##\s+(B\d+)\s+—\s+(.*)$/.exec(line.trim());
  if (!m) continue;
  const [, id, rest] = m;
  // A reserved-but-unused number is a placeholder, not a defect — don't count it either way.
  if (/^\(number skipped\)$/i.test(rest.trim())) continue;
  // THE STATUS LIVES AT AN END OF THE HEADING, NOT ANYWHERE IN IT. Testing the whole remainder
  // read B67's own title — `FIXED. "The open list is empty" …` — as OPEN, because the word appears
  // in the prose. So take only the two places a status is ever written: the leading clause up to
  // the first sentence break, and the trailing clause after the last `·`. Both may carry a
  // parenthetical (`FIXED (mig 198)`), and the trailing one may be compound
  // (`PARTLY PROVEN, OPEN`), which is why each candidate is matched rather than split further.
  const lead = (/^([^.]{0,40}?)\s*\.\s/.exec(rest)?.[1] ?? '').trim();
  const trail = rest.includes('·') ? rest.slice(rest.lastIndexOf('·') + 1).trim() : '';
  const candidates = [lead, trail].filter(Boolean);
  const any = (vocab) => candidates.some((c) => vocab.some((r) => r.test(c)));
  const status =
    any(OPEN) ? 'OPEN'
    : any(DEFERRED) ? 'DEFERRED'
    : any(CLOSED) ? 'closed'
    : 'UNKNOWN';
  rows.push({ id, status, title: rest.replace(/\s+/g, ' ').slice(0, 96) });
}

// A later entry supersedes an earlier one with the same id (B39 and B41 are each logged twice —
// once as found, once CORRECTED). Keep the last word on each.
const latest = new Map();
for (const r of rows) latest.set(r.id, r);
const all = [...latest.values()];

const by = (s) => all.filter((r) => r.status === s);
const open = by('OPEN'), deferred = by('DEFERRED'), unknown = by('UNKNOWN'), closed = by('closed');

console.log(`${FILE}\n${all.length} entries — ${closed.length} closed · ${open.length} open · `
  + `${deferred.length} deferred · ${unknown.length} unclassifiable\n`);

const show = (label, list) => {
  if (!list.length) return;
  console.log(label);
  for (const r of list) console.log(`  ${r.id.padEnd(5)} ${r.title}`);
  console.log('');
};
show('STILL OPEN', open);
show('DEFERRED — recorded, deliberately not done', deferred);
show('UNCLASSIFIABLE — heading uses a convention this script does not know', unknown);

if (!open.length && !unknown.length) {
  console.log(deferred.length
    ? `✓ nothing open. ${deferred.length} deferred entries remain by choice — name them rather than calling the log clear.`
    : '✓ nothing open, nothing deferred.');
  process.exit(0);
}
process.exit(1);

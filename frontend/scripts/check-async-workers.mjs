#!/usr/bin/env node
/**
 * Are the two ASYNCHRONOUS dependencies up — the pipeline worker and the Claude emulator?
 *
 * ── THE FAILURE THIS CATCHES ─────────────────────────────────────────────────────────────────
 * Five of the thirty-two drives in a 2026-09-02 run reported FAIL. Every failing assertion named
 * the same absent thing:
 *
 *   real-solicitation   ✗ the shred rolled it up onto the solicitation — 0 chars
 *   curate-baa          ✗ governing passages marked — 0 of 8
 *   end-to-end          ✗ nothing reached a tenant card   (assist 409, status stuck at `new`)
 *   opp-scout           ✗ worker ran opportunity_scout on the emulator (agent.invoked) — 8 → 8
 *   project-lifecycle   ✗ timed out after 45s waiting for a process_instance for OnContractStarted
 *
 * The product was fine. The worker was not running — a container restart had taken it, and nothing
 * noticed. `run-branch-drives.sh` states the requirement in two comments ("Needs the worker and the
 * Claude emulator up") and then never checks it, so an absent process is reported as five product
 * defects and the summary line still prints a count. That is the exact shape this runner already
 * guards against for LibreOffice and for RLS posture: a dependency whose absence is indistinguishable
 * from a finding must be checked BEFORE the drives, and the affected drives marked CANT-RUN —
 * uncovered, not passing, and not a finding either.
 *
 * ── WHAT IT CHECKS, AND WHY EACH ONE ─────────────────────────────────────────────────────────
 *
 * 1. **The worker answers /healthz, not just /health.** `/health` is a shallow liveness check that
 *    returns `{"status":"ok"}` from a process that has not successfully talked to anything.
 *    `/healthz` is the composite — it opens the database. This is the same lesson as `soffice`
 *    exiting 0 while converting nothing: the cheap signal is available and it is the wrong one.
 *
 * 2. **The worker is on the SAME DATABASE the drives write to.** This is the check that earns the
 *    file. A worker holding a stale `DATABASE_URL` is alive, answers `/healthz` with `db.ok: true`,
 *    and consumes events out of a database no drive is writing to — so every drive times out
 *    exactly as if the worker were dead, while every liveness check is green. The connection is
 *    read from `/proc/<pid>/environ`, which is what the worker is ACTUALLY connected to rather than
 *    what a launch script intended. Only host/port/database are compared: the worker legitimately
 *    connects as the owner role and the drives as `govtech_app`.
 *
 * 3. **There is exactly one worker.** `sandbox-up.sh` documents why: two workers are two CHECKOUT
 *    MOMENTS, and a drive reading "the latest invocation" gets whichever answered last. That is a
 *    nondeterministic suite, which is worse than a red one.
 *
 * 4. **The emulator returns a well-formed Anthropic message**, not merely a listening socket. A
 *    POST it must actually answer, with the response shape the SDK destructures.
 *
 * ── WHAT IT DELIBERATELY DOES NOT CLAIM ──────────────────────────────────────────────────────
 * It does not prove the worker will process any PARTICULAR event, and it writes nothing to do so —
 * a preflight that enqueues work mutates the box it is measuring. It proves the worker is present,
 * healthy, singular and pointed at the right database. A drive that then fails is a finding.
 *
 *   node scripts/check-async-workers.mjs   → exit 0 both up · 1 something is wrong · 2 cannot tell
 */
import { readFileSync, readdirSync } from 'node:fs';

const HEALTH = process.env.WORKER_HEALTH_URL || 'http://127.0.0.1:8080';
const EMU = process.env.ANTHROPIC_BASE_URL || 'http://127.0.0.1:8787';
const SUITE_DB = process.env.DATABASE_URL_OWNER || process.env.DATABASE_URL || '';

const problems = [];
const say = (m) => console.error(m);

/** host:port/database — the part that must match. The ROLE legitimately differs between the two. */
function target(url) {
  try {
    const u = new URL(url);
    return `${u.hostname}:${u.port || 5432}${u.pathname}`;
  } catch {
    return null;
  }
}

/**
 * Every running pipeline worker, by reading /proc rather than shelling out to pgrep.
 *
 * `pgrep -f "python3 src/main.py"` MATCHES THE SHELL THAT RAN IT — the command line of the wrapper
 * contains the pattern, so the count is always at least one and "is a worker running" is always
 * yes. That self-match is documented in CONTINUATION.md as a trap that hung a wait-loop, and it
 * fired again while writing this file. Reading /proc and excluding our own pid avoids the whole
 * class rather than escaping around it.
 */
function workers() {
  const out = [];
  for (const e of readdirSync('/proc')) {
    if (!/^\d+$/.test(e)) continue;
    const pid = Number(e);
    if (pid === process.pid || pid === process.ppid) continue;
    let cmd = '';
    try {
      cmd = readFileSync(`/proc/${e}/cmdline`, 'utf8').replace(/\0/g, ' ').trim();
    } catch {
      continue; // exited between readdir and read, or not ours to look at
    }
    // The worker is `python3 src/main.py`, argv[0] being an interpreter. A shell wrapper carries
    // the same text but its argv[0] is bash/sh, which is what separates the two.
    if (!/(^|\/)python3?\b/.test(cmd)) continue;
    if (!/\bsrc\/main\.py\b/.test(cmd)) continue;
    let env = '';
    try {
      env = readFileSync(`/proc/${e}/environ`, 'utf8');
    } catch { /* readable pid, unreadable environ — still a worker, just opaque */ }
    const db = env.split('\0').find((v) => v.startsWith('DATABASE_URL='))?.slice(13) ?? null;
    out.push({ pid, db });
  }
  return out;
}

// ── 1 · the worker answers its COMPOSITE health check ────────────────────────────────────────
let health = null;
try {
  const r = await fetch(`${HEALTH}/healthz`, { signal: AbortSignal.timeout(10_000) });
  health = await r.json();
} catch (e) {
  say(`worker: nothing is serving ${HEALTH}/healthz — ${e instanceof Error ? e.message : e}`);
  say('  The pipeline worker is not running. Every workflow step, shred and agent invocation');
  say('  the drives wait on will time out, and each one reads as a product failure.');
  say('    source scripts/sandbox-env.sh && scripts/sandbox-up.sh');
  process.exit(1);
}

if (!health?.ok) {
  say(`worker: /healthz reports NOT ok — ${JSON.stringify(health).slice(0, 200)}`);
  problems.push('worker unhealthy');
} else if (health?.db?.ok !== true) {
  // Alive, listening, and unable to reach the database. Every drive would time out identically.
  say(`worker: alive but its DATABASE is not reachable — ${JSON.stringify(health.db).slice(0, 160)}`);
  problems.push('worker cannot reach its database');
}

// ── 2 & 3 · one worker, on the database the suite is driving ─────────────────────────────────
const found = workers();
if (found.length === 0) {
  // /healthz answered, so something is serving :8080. That is not nothing — it means the port is
  // held by a process this check could not identify, which is a different problem from absence.
  say(`worker: ${HEALTH}/healthz answers but no \`python3 src/main.py\` process is visible.`);
  say('  Something else is holding that port, or the worker runs elsewhere. Either way this');
  say('  check cannot say which database it consumes from.');
  process.exit(2);
}
if (found.length > 1) {
  say(`worker: ${found.length} workers are running (pids ${found.map((w) => w.pid).join(', ')}).`);
  say('  They are two checkout moments. A drive reading "the latest invocation" gets whichever');
  say('  answered last, so the suite becomes nondeterministic. Kill all but one.');
  problems.push('more than one worker');
}

const suiteTarget = target(SUITE_DB);
if (!suiteTarget) {
  say('cannot tell which database the suite drives — DATABASE_URL_OWNER/DATABASE_URL is unset or unparseable.');
  say('    source scripts/sandbox-env.sh');
  process.exit(2);
}
for (const w of found) {
  const wt = target(w.db ?? '');
  if (!wt) {
    say(`worker pid ${w.pid}: its DATABASE_URL could not be read — cannot confirm it consumes from ${suiteTarget}.`);
    process.exit(2);
  }
  if (wt !== suiteTarget) {
    say(`worker pid ${w.pid} consumes from ${wt}, the suite drives ${suiteTarget}.`);
    say('  The worker is healthy and working on a different database. Every drive will time out');
    say('  waiting for a step that is being processed somewhere else — which is indistinguishable');
    say('  from the worker being dead, and from the product being broken.');
    problems.push('worker on the wrong database');
  }
}

// ── 4 · the emulator ANSWERS, in the shape the SDK destructures ──────────────────────────────
//
// A listening socket is not an emulator. The agent code reads `content[0].text`; a health page, a
// proxy error or a half-written stub all accept the connection and then fail inside the agent,
// where it surfaces as an agent defect rather than a missing dependency.
try {
  const r = await fetch(`${EMU}/v1/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': 'preflight' },
    body: JSON.stringify({
      model: 'claude-opus-5',
      max_tokens: 16,
      messages: [{ role: 'user', content: 'preflight' }],
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!r.ok) {
    say(`emulator: ${EMU}/v1/messages answered ${r.status}`);
    problems.push('emulator error response');
  } else {
    const body = await r.json();
    const text = body?.content?.[0]?.text;
    if (body?.type !== 'message' || typeof text !== 'string' || !text.length) {
      say(`emulator: answered, but not with a message the SDK can read — ${JSON.stringify(body).slice(0, 160)}`);
      problems.push('emulator response shape');
    }
  }
} catch (e) {
  say(`emulator: nothing is serving ${EMU}/v1/messages — ${e instanceof Error ? e.message : e}`);
  say('  Every AI-gated flow (section_drafter, the scout, the project agents) will report that no');
  say('  agent fired, which reads as the agent workforce being inert.');
  say('    source scripts/sandbox-env.sh && scripts/sandbox-up.sh');
  problems.push('emulator absent');
}

if (problems.length) {
  say(`\n${problems.length} problem(s): ${problems.join(' · ')}`);
  process.exit(1);
}

say(`worker: healthy, singular (pid ${found[0].pid}), consuming from ${suiteTarget}`);
say(`emulator: answering on ${EMU} with a well-formed message`);
process.exit(0);

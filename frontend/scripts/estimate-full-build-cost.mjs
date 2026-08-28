#!/usr/bin/env node
/**
 * estimate-full-build-cost — what a full proposal build COSTS, and whether the caps that bound it
 * actually see the spend.
 *
 * ── Why this exists ────────────────────────────────────────────────────────────────────────────
 * The emulator (`scripts/test-harness/emulated-claude.mjs`) returns a CONSTANT usage block —
 * `input_tokens: 64` (96 on a tool turn) and an output count derived from the length of its own
 * canned text. It has to: a fabricated response has no real prompt behind it. So the `cost_usd`
 * that lands in `agent_task_log` after an emulated run measures the CALL COUNT and the per-model
 * RATE TABLE. It does not measure spend, and reading it as a forecast overstates the guardrails'
 * headroom by whatever the real prompt would have been — which is most of it.
 *
 * Two numbers, reported side by side and never blended (the same rule the project rollup follows):
 *
 *   LEDGER      what `agent_task_log` recorded. This is the number every cap acts on, so it is the
 *               right number for "does aggregation work" and the wrong one for "what will this
 *               cost". Under the emulator it is a plumbing measurement.
 *   LIVE-RATE   a forecast. Its INPUT side is measured — the real bytes the product assembled and
 *               sent, recorded untruncated by the emulator as `chars.total`. Its OUTPUT side is an
 *               ASSUMPTION, and the assumption is sourced: the observed length of sections already
 *               drafted on the source proposal, not a number invented here. Reported as a band.
 *
 * ── Why it builds its own fixture ──────────────────────────────────────────────────────────────
 * `draft_v0` selects `WHERE s.status IN ('empty','ai_drafted')`. Every proposal in this sandbox is
 * `approved` or `in_progress`, so a full-draft fired at any of them returns
 * `{"reason":"no_authorable_sections","drafted":0}` — the manager and the review cohort run, the
 * DRAFTING cohort does not, and the run reports a cost for the cheap half of the work. That is not
 * a hypothetical: it is what the first attempt at this measurement did. So this script clones the
 * structure of a real proposal into a throwaway with authorable sections, measures, and removes it.
 *
 * It REFUSES A VERDICT it cannot earn: if the run drafts zero sections it exits 2 as CANNOT RUN
 * rather than printing the review cohort's cost under the heading "full build".
 *
 * ⚠️ NOT READ-ONLY. It inserts a proposal and its sections, fires a real workflow, and deletes what
 * it inserted. Every run prints its mutation footprint and re-counts the tables afterwards.
 * Sandbox only, never production.
 *
 *   node scripts/estimate-full-build-cost.mjs [--source <proposalId>] [--mode c] [--keep]
 */
import postgres from 'postgres';
import { chromium } from '@playwright/test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
// The actor/login seam every other drive already uses. Resolving an actor here instead would be a
// third spelling of the same question, and the credential drift that follows is documented four
// times over in CLAUDE.md (B146/B147).
import { CannotRun, resolveActor, loginOrDie, dieWell } from './lib/drive-actor.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const EMU_LOG = join(HERE, 'test-harness', 'emulated-claude.log.jsonl');
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const DB = process.env.DATABASE_URL_OWNER || process.env.DATABASE_URL;

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const MODE = arg('--mode', 'c');
const KEEP = argv.includes('--keep');
const SOURCE_ARG = arg('--source', null);

// Anthropic tokenisation is ~3.5 chars/token for English prose and denser for the JSON that tool
// schemas and tool_results are made of. A single divisor would be false precision, so every figure
// below is a BAND across these two, and the band is printed rather than a midpoint.
const CPT_LOW = 3.0;   // denser — more tokens per character (the expensive end)
const CPT_HIGH = 4.0;  // sparser — fewer tokens (the cheap end)

// Per-model USD per 1M tokens. Copied from pipeline/src/agents/fabric.py::MODEL_PRICING rather
// than re-derived — a rate table retyped from memory is how two costing paths disagree.
const PRICING = {
  'claude-sonnet-4-20250514': [3.0, 15.0],
  'claude-haiku-4-5-20251001': [1.0, 5.0],
};
const DEFAULT_MODEL = 'claude-sonnet-4-20250514';

/** Which model an archetype declares, read off the archetype source — not a hand-kept list. */
function archetypeModels() {
  const dir = join(HERE, '..', '..', 'pipeline', 'src', 'agents', 'archetypes');
  const out = {};
  let names = [];
  try { names = readdirSync(dir).filter((f) => f.endsWith('.py') && f !== '__init__.py'); }
  catch (e) { throw new CannotRun(`cannot read archetype sources at ${dir}: ${e.message}`); }
  for (const f of names) {
    const src = readFileSync(join(dir, f), 'utf8');
    // The `model` property's return, with comments and docstrings out of the way — this repo
    // documents each model choice in prose right beside it, and a text search that reads prose as
    // code finds the explanation instead of the value.
    const body = src.replace(/#[^\n]*/g, '').replace(/"""[\s\S]*?"""/g, '');
    const m = body.match(/def\s+model\s*\([^)]*\)[^:]*:\s*return\s*"([^"]+)"/);
    out[f.replace(/\.py$/, '')] = m ? m[1] : DEFAULT_MODEL;
  }
  return out;
}

const money = (n) => `$${n.toFixed(4)}`;
const band = (lo, hi) => (lo === hi ? money(lo) : `${money(lo)} – ${money(hi)}`);

async function main() {
  if (!DB) throw new CannotRun('DATABASE_URL_OWNER is unset — source scripts/sandbox-env.sh first.');
  const sql = postgres(DB, { max: 2, transform: { column: { from: postgres.toCamel, to: postgres.fromCamel } } });
  const models = archetypeModels();
  let cloneId = null;

  try {
    // ── 1 · The source ─────────────────────────────────────────────────────────────────────────
    const [src] = SOURCE_ARG
      ? await sql`SELECT p.id, p.tenant_id, p.title, p.opportunity_id, p.solicitation_id, t.slug
                  FROM proposals p JOIN tenants t ON t.id = p.tenant_id WHERE p.id = ${SOURCE_ARG}`
      : await sql`SELECT p.id, p.tenant_id, p.title, p.opportunity_id, p.solicitation_id, t.slug,
                         count(s.id)::int AS n
                  FROM proposals p JOIN tenants t ON t.id = p.tenant_id
                  JOIN proposal_sections s ON s.proposal_id = p.id
                  WHERE p.archived_at IS NULL
                  GROUP BY p.id, t.slug ORDER BY n DESC LIMIT 1`;
    if (!src) throw new CannotRun('no proposal to clone the structure of.');

    // Every alias here is snake_case, deliberately. Postgres folds an unquoted alias to lower
    // case, so a camelCase alias arrives lower-cased, toCamel leaves it alone (it only produces
    // camelCase from an underscore), and every read of the camelCase property is undefined —
    // the CLAUDE.md toCamel trap arriving from the alias side. This cost one run: the guard fired
    // and correctly reported "no drafted sections" for a proposal with 68,701 characters of prose.
    const sections = await sql`
      SELECT section_number, title, volume_name, volume_number, section_type, sort_index,
             page_allocation, character_allocation, meta, length(coalesce(content, '')) AS content_len
      FROM proposal_sections WHERE proposal_id = ${src.id} ORDER BY sort_index`;
    if (!sections.length) throw new CannotRun(`source proposal ${src.id} has no sections.`);

    // The output assumption, sourced. These are the lengths of the sections AS THEY STAND on the
    // source proposal — real drafted prose for this solicitation, not a guess about how long a
    // section "should" be. A source whose sections are empty cannot fund the assumption, and the
    // script says so instead of substituting a number.
    const drafted = sections.filter((s) => s.contentLen > 0).map((s) => s.contentLen);
    if (!drafted.length) {
      throw new CannotRun(
        `source proposal ${src.id} has no drafted sections, so there is nothing to base the OUTPUT ` +
        `side of the estimate on. Point --source at a proposal that has been written.`);
    }
    const avgSectionChars = Math.round(drafted.reduce((a, b) => a + b, 0) / drafted.length);

    // ── 2 · The actor ──────────────────────────────────────────────────────────────────────────
    const actor = await resolveActor(sql, { role: 'tenant_admin', tenantSlug: src.slug });

    // ── 3 · The fixture ────────────────────────────────────────────────────────────────────────
    const before = {
      proposals: Number((await sql`SELECT count(*)::int AS n FROM proposals`)[0].n),
      sections: Number((await sql`SELECT count(*)::int AS n FROM proposal_sections`)[0].n),
      log: Number((await sql`SELECT count(*)::int AS n FROM agent_task_log`)[0].n),
    };
    const emuOffset = statSync(EMU_LOG).size;

    const [clone] = await sql`
      INSERT INTO proposals (tenant_id, opportunity_id, solicitation_id, title, stage)
      VALUES (${src.tenantId}, ${src.opportunityId}, ${src.solicitationId},
              ${`[cost-probe] ${src.title}`.slice(0, 240)}, 'draft')
      RETURNING id`;
    cloneId = clone.id;
    for (const s of sections) {
      await sql`
        INSERT INTO proposal_sections
          (proposal_id, section_number, title, volume_name, volume_number, section_type,
           sort_index, page_allocation, character_allocation, meta, status, content)
        VALUES (${cloneId}, ${s.sectionNumber}, ${s.title}, ${s.volumeName}, ${s.volumeNumber},
                ${s.sectionType}, ${s.sortIndex}, ${s.pageAllocation}, ${s.characterAllocation},
                ${sql.json(s.meta ?? {})}, 'empty', NULL)`;
    }
    console.log(`\n⚠️  MUTATION FOOTPRINT — inserted proposal ${cloneId} + ${sections.length} sections ` +
                `(cloned from ${src.id}). ${KEEP ? 'WILL BE KEPT (--keep).' : 'Removed at the end.'}`);

    // ── 4 · The build ──────────────────────────────────────────────────────────────────────────
    const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
    const ctx = await browser.newContext({ baseURL: BASE });
    const page = await loginOrDie(ctx, BASE, actor);

    const t0 = Date.now();
    const route = `/api/portal/${src.slug}/proposals/${cloneId}/full-draft`;
    const fired = await page.request.post(route, { data: { mode: MODE }, timeout: 300_000 });
    const firedBody = await fired.text();
    console.log(`[full-draft] POST ${route} → ${fired.status()} ${firedBody.slice(0, 200)}`);
    if (fired.status() >= 300) { await browser.close(); throw new CannotRun(`full-draft refused: ${firedBody.slice(0, 300)}`); }

    // Poll the product's OWN readiness endpoint rather than a predicate invented here.
    let settled = null;
    for (let i = 0; i < 150; i++) {
      await page.waitForTimeout(2000);
      const r = await page.request.get(route);
      const j = await r.json().catch(() => ({}));
      const st = j?.data ?? j;
      if (st?.done || st?.failed) { settled = st; break; }
    }
    const elapsedMs = Date.now() - t0;
    await browser.close();
    if (!settled) throw new CannotRun(`the full-draft run never reported done after ${Math.round(elapsedMs / 1000)}s.`);

    // ── 5 · What actually happened ─────────────────────────────────────────────────────────────
    const [inst] = await sql`
      SELECT id, status, step_results FROM process_instances
      WHERE (payload->>'proposal_id') = ${cloneId} OR (payload->>'proposalId') = ${cloneId}
      ORDER BY created_at DESC LIMIT 1`;
    const draftStep = inst?.stepResults?.draft_sections?.result ?? {};
    const draftedCount = Number(draftStep.drafted ?? 0);

    const calls = await sql`
      SELECT agent_role, count(*)::int AS calls, sum(input_tokens)::int AS in_tok,
             sum(output_tokens)::int AS out_tok, sum(cost_usd)::numeric AS cost
      FROM agent_task_log WHERE proposal_id = ${cloneId}
      GROUP BY agent_role ORDER BY calls DESC, agent_role`;

    // The real bytes, from the emulator's untruncated `chars` record, for records appended since
    // this run started. An older log with no `chars` key is UNMEASURED and says so — a missing
    // field silently counted as zero is how an instrument reports a clean run.
    const tail = readFileSync(EMU_LOG, 'utf8').slice(emuOffset).trim();
    const recs = tail ? tail.split('\n').map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : [];
    const withChars = recs.filter((r) => r.chars && Number.isFinite(r.chars.total));
    const unmeasured = recs.length - withChars.length;
    const realInputChars = withChars.reduce((a, r) => a + r.chars.total, 0);

    // ── 6 · The two numbers ────────────────────────────────────────────────────────────────────
    const totalCalls = calls.reduce((a, r) => a + r.calls, 0);
    const ledgerCost = calls.reduce((a, r) => a + Number(r.cost), 0);

    console.log(`\n╔═ FULL BUILD — ${src.slug} · ${sections.length} sections · mode ${MODE} · ${Math.round(elapsedMs / 1000)}s`);
    console.log(`║  workflow ${inst?.status ?? 'unknown'} · sections drafted: ${draftedCount}` +
                (draftStep.reason ? ` (${draftStep.reason})` : ''));
    console.log('╚═\n');

    console.table(calls.map((r) => ({
      archetype: r.agentRole, model: (models[r.agentRole] ?? DEFAULT_MODEL).replace(/^claude-|-\d{8}$/g, ''),
      calls: r.calls, 'in(emu)': r.inTok, 'out(emu)': r.outTok, 'ledger $': Number(r.cost).toFixed(5),
      // r.inTok / r.outTok come from the snake_case aliases above via toCamel — see the note there.
    })));

    console.log(`\nLEDGER   ${totalCalls} calls · ${money(ledgerCost)}`);
    console.log(`         ↳ what agent_task_log recorded, and what every cap acts on. Under the`);
    console.log(`           emulator the token counts are constants, so this is a measurement of`);
    console.log(`           the call count and the rate table — NOT of spend.`);

    let liveLo = null, liveHi = null;
    if (!withChars.length) {
      console.log(`\nLIVE-RATE  UNMEASURED — ${recs.length} emulator records carried no \`chars\` field.`);
      console.log(`           Restart the emulator so it records untruncated prompt sizes.`);
    } else {
      // INPUT: measured bytes → tokens. Priced at the model of the archetype that sent them; the
      // emulator log does not name the archetype, so input is apportioned by each archetype's
      // share of the run's calls. Stated because it is an approximation, not a measurement.
      const sonnetShare = calls.filter((r) => (models[r.agentRole] ?? DEFAULT_MODEL).includes('sonnet'))
        .reduce((a, r) => a + r.calls, 0) / Math.max(1, totalCalls);
      const blendedIn = sonnetShare * PRICING[DEFAULT_MODEL][0] + (1 - sonnetShare) * PRICING['claude-haiku-4-5-20251001'][0];
      const blendedOut = sonnetShare * PRICING[DEFAULT_MODEL][1] + (1 - sonnetShare) * PRICING['claude-haiku-4-5-20251001'][1];

      const inTokHi = realInputChars / CPT_LOW;   // denser tokenisation → more tokens
      const inTokLo = realInputChars / CPT_HIGH;
      const inLo = inTokLo * blendedIn / 1e6, inHi = inTokHi * blendedIn / 1e6;

      // OUTPUT: the assumption. Drafting calls produce a section; everything else produces a short
      // advisory. Both figures are named so a reader can disagree with them specifically.
      const ADVISORY_OUT_CHARS = 1500;
      const draftingCalls = calls.filter((r) => r.agentRole === 'section_drafter').reduce((a, r) => a + r.calls, 0);
      const advisoryCalls = totalCalls - draftingCalls;
      const outChars = draftingCalls * avgSectionChars + advisoryCalls * ADVISORY_OUT_CHARS;
      const outLo = (outChars / CPT_HIGH) * blendedOut / 1e6, outHi = (outChars / CPT_LOW) * blendedOut / 1e6;

      liveLo = inLo + outLo; liveHi = inHi + outHi;
      console.log(`\nLIVE-RATE  ${band(inLo + outLo, inHi + outHi)}  per full build of ${sections.length} sections`);
      console.log(`         ├ input   ${band(inLo, inHi)}  ← MEASURED: ${realInputChars.toLocaleString()} real chars the`);
      console.log(`         │                       product assembled and sent across ${withChars.length} requests`);
      console.log(`         └ output  ${band(outLo, outHi)}  ← ASSUMED: ${draftingCalls} drafting calls × ${avgSectionChars} chars`);
      console.log(`                                 (the observed mean of ${drafted.length} drafted sections on the`);
      console.log(`                                 source proposal) + ${advisoryCalls} advisory calls × ${ADVISORY_OUT_CHARS} chars`);
      console.log(`         Band spans ${CPT_HIGH} → ${CPT_LOW} chars/token. Blended rate: ` +
                  `$${blendedIn.toFixed(2)}/$${blendedOut.toFixed(2)} per M (${Math.round(sonnetShare * 100)}% Sonnet).`);
      if (unmeasured) console.log(`         ⚠ ${unmeasured} record(s) carried no \`chars\` field and are EXCLUDED, not zeroed.`);

      // The PER-CALL ceiling is checked mid-loop against one invocation, not the run, so the run
      // total says nothing about it. An agent call is several requests (a tool loop), so the
      // per-call input is the run's chars divided by its agent calls — an average, and named as
      // one. The single largest REQUEST is reported beside it because a ceiling is tripped by the
      // worst case, not the mean.
      const maxReq = Math.max(...withChars.map((r) => r.chars.total));
      const reqsPerCall = withChars.length / Math.max(1, totalCalls);
      const meanCallChars = realInputChars / Math.max(1, totalCalls);
      const costOf = (inChars, outChars) => (inChars / CPT_LOW) * blendedIn / 1e6 + (outChars / CPT_LOW) * blendedOut / 1e6;
      const meanCall = costOf(meanCallChars, avgSectionChars);
      // A bound, not an observation: the largest request seen, repeated for every round of a call.
      // No call was measured at this size — it is the shape of the worst one the run could contain.
      const boundCall = costOf(maxReq * reqsPerCall, avgSectionChars);
      console.log(`         per agent call: ~${Math.round(meanCallChars).toLocaleString()} input chars ` +
                  `(MEAN over ${totalCalls} calls, ${reqsPerCall.toFixed(1)} requests each);`);
      console.log(`                         largest single request ${maxReq.toLocaleString()} chars.`);
      console.log(`                         mean call ${money(meanCall)} · bound ${money(boundCall)} ` +
                  `against the $0.50 PER_CALL_CEILING_USD`);
      console.log(`                         → ${boundCall > 0.5 ? '⚠ THE BOUND IS OVER THE CEILING' : `${(0.5 / boundCall).toFixed(1)}× headroom even at the bound`}.`);
    }

    // ── 7 · Where that lands against the caps ──────────────────────────────────────────────────
    // The effective budget, resolved exactly as fabric.py::_check_budget resolves it — tenant
    // override → platform default → DEFAULT_MONTHLY_BUDGET_USD, then capped at the framework
    // ceiling. Copied from the source rather than re-derived: a headroom figure computed from a
    // predicate I believed equivalent is the kind of confident wrong number this repo has been
    // bitten by before.
    const [cfg] = await sql`SELECT monthly_budget, rate_limit_per_hour FROM tenant_agent_config WHERE tenant_id = ${src.tenantId}`;
    const [plat] = await sql`SELECT default_monthly_budget, platform_monthly_cap, ai_enabled FROM platform_agent_config WHERE id = TRUE`
      .catch(() => [null]);
    const [fw] = await sql`SELECT agent_monthly_budget_ceiling_usd FROM automation_framework WHERE id = 1`
      .catch(() => [null]);

    const platDefault = plat?.defaultMonthlyBudget == null ? 50.0 : Number(plat.defaultMonthlyBudget);
    let budget = cfg?.monthlyBudget == null ? platDefault : Number(cfg.monthlyBudget);
    const ceiling = fw?.agentMonthlyBudgetCeilingUsd == null ? null : Number(fw.agentMonthlyBudgetCeilingUsd);
    const capped = ceiling != null && budget > ceiling;
    if (capped) budget = ceiling;

    const [used] = await sql`
      SELECT COALESCE(SUM(cost_usd), 0)::numeric AS total FROM agent_task_log
      WHERE tenant_id = ${src.tenantId} AND created_at >= date_trunc('month', now())`;

    console.log(`\nAGAINST THE CAP`);
    console.log(`  effective monthly budget  ${money(budget)}  ` +
                `(${cfg?.monthlyBudget == null ? 'platform default, no tenant row' : 'tenant-set'}` +
                `${capped ? `, CAPPED at the framework ceiling ${money(ceiling)}` : ''})`);
    console.log(`  spent this month          ${money(Number(used.total))}  ← the sum every refusal reads`);
    console.log(`  builds/month at LEDGER    ${Math.floor(budget / Math.max(ledgerCost, 1e-9))}  ` +
                `← the emulated figure. Do not plan on this.`);
    if (liveHi != null) {
      console.log(`  builds/month at LIVE-RATE ${Math.floor(budget / liveHi)} – ${Math.floor(budget / liveLo)}  ` +
                  `← what the same cap actually buys`);
      console.log(`  ⚠ the live estimate is ${(liveHi / Math.max(ledgerCost, 1e-9)).toFixed(0)}× the ledger figure. A budget ` +
                  `sized against an emulated\n    run would be exhausted after ~${Math.floor(budget / liveHi)} builds, not ` +
                  `${Math.floor(budget / Math.max(ledgerCost, 1e-9))}.`);
    }

    // ── 8 · Clean up, and prove it ─────────────────────────────────────────────────────────────
    if (!KEEP) {
      await sql`DELETE FROM proposal_sections WHERE proposal_id = ${cloneId}`;
      await sql`DELETE FROM proposals WHERE id = ${cloneId}`;
      const after = {
        proposals: Number((await sql`SELECT count(*)::int AS n FROM proposals`)[0].n),
        sections: Number((await sql`SELECT count(*)::int AS n FROM proposal_sections`)[0].n),
      };
      const clean = after.proposals === before.proposals && after.sections === before.sections;
      console.log(`\n${clean ? '✓' : '✗'} fixture removed — proposals ${before.proposals}→${after.proposals}, ` +
                  `sections ${before.sections}→${after.sections}` +
                  (clean ? '' : '  ⚠ COUNTS DID NOT RETURN; inspect before re-running'));
      console.log(`  agent_task_log rows are a LEDGER and are kept (${before.log} → ` +
                  `${Number((await sql`SELECT count(*)::int AS n FROM agent_task_log`)[0].n)}).`);
      if (!clean) process.exitCode = 1;
      cloneId = null;
    }

    // ── 9 · Refuse a verdict this run cannot earn ───────────────────────────────────────────────
    if (draftedCount === 0) {
      throw new CannotRun(
        `the run drafted ZERO sections (${draftStep.reason ?? 'no reason given'}), so the figures above ` +
        `cover the manager and the review cohort only — the drafting cohort, which is the expensive ` +
        `half of a build, did not run. Printing that as "full build cost" is the exact error this ` +
        `script exists to prevent.`);
    }
  } finally {
    if (cloneId && !KEEP) {
      await sql`DELETE FROM proposal_sections WHERE proposal_id = ${cloneId}`.catch(() => {});
      await sql`DELETE FROM proposals WHERE id = ${cloneId}`.catch(() => {});
    }
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  if (err?.name === 'CannotRun') {
    console.error(`\n⛔ CANNOT RUN — this is not a finding and not a pass.\n   ${err.message}\n`);
    process.exit(2);
  }
  console.error(err);
  process.exit(1);
});

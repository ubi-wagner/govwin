/**
 * WHICH FUNCTION DOES EACH DRIVE ACTUALLY COVER, AND AS WHOM?
 *
 * A coverage claim assembled from memory is the thing this repo keeps catching itself doing. So
 * this reads every drive, lens, probe and audit in `frontend/scripts/`, and classifies it by the
 * SIGNALS IN THE FILE — the tables it touches, the routes it drives, the credentials it signs in
 * with — rather than by its name or by what anyone remembers it being for.
 *
 * ── THE FIVE FUNCTIONS ─────────────────────────────────────────────────────────────────────────
 * Named by the operator, in the order a customer meets them:
 *   1 discovery   scouts · opportunity analysis · ingestion
 *   2 curation    RFP-admin administration, curation, build-out and first release
 *   3 pipeline    the OPP list itself — fan-out, ranking, pinning, ageing out
 *   4 library     tenant workspace: upload → atomize → foundational doc → section → atom
 *   5 build       requisition, setup, templating, and the multi-stage assisted proposal
 * plus the cross-cutting concerns that sit on top of all five:
 *   automation · audit · isolation · bridges (partner descent, collaborator share)
 *
 * ── WHAT IT REFUSES TO DO ──────────────────────────────────────────────────────────────────────
 * A file whose signals do not clear the threshold is reported UNCLASSIFIED, never assigned to the
 * nearest-looking bucket. A coverage map that quietly files everything is the same failure as a
 * scanner that silently drops what it cannot parse: it reports a clean run.
 *
 * Nor does it claim a drive PASSES — that is the suite's job, and the two are joined by name in the
 * report. This says what a drive is ABOUT; only running it says whether it holds.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FRONTEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPTS = path.join(FRONTEND, 'scripts');

/**
 * Signals per function. Weighted: a table name or a route PATH is stronger evidence than a word.
 *
 * ⚠️ THE ROUTE SIGNALS ARE NOT DECORATION. The first version scored tables and vocabulary only,
 * so `drive-bucket-authoring` and `drive-vault-isolation` — which do their whole job through the
 * HTTP API and never name a table — matched NO strong signal and fell out as unclassified. They
 * are not marginal cases: bucket authoring is the whole of function 3's customer half. A drive
 * that never names a table is the NORMAL shape for an actor-driven harness, which is exactly the
 * kind this map exists to find.
 *
 * `drive-pin` stays unclassified and is RIGHT to: despite the name it is about the singular
 * session — one identity, several companies, one pinned at a time — and has nothing to do with
 * pinning an opportunity for updates. Which is why `/pin/` is not a strong signal here: the word
 * carries two unrelated meanings in this tree, and a signal that cannot tell them apart would file
 * an identity drive under the OPP list and make function 3 look better covered than it is.
 */
const FUNCTIONS = {
  discovery: {
    label: '1 · Scouts, OPP analysis & ingestion',
    strong: [/scout_findings/, /curated_solicitations/, /stageIntake/, /\/admin\/scouts/, /\/admin\/sources/, /\/admin\/intake/, /source_profiles/, /shred/i, /pattern-extract/, /field_provenance/,
      /\/scouts\b/, /\/sources\b/, /\/intake\b/, /\/assess-ingest/],
    weak: [/\bintake\b/i, /\bscout/i, /\bingest/i, /solicitation/i, /opportunit(y|ies)\.detected/],
  },
  curation: {
    label: '2 · RFP-admin curation, build-out & first release',
    strong: [/rfp-curation/, /completeBuildOut/, /build_complete/, /\/admin\/provisioning/, /provisionAndReleasePortal/, /solicitation\.push/, /triage/i,
      /\/provisioning\b/, /\/release\b/, /\/approve\b/, /\/force-release/],
    weak: [/curat/i, /\brelease\b/i, /build-?out/i, /approve/i],
  },
  pipeline: {
    label: '3 · OPP list — fan-out, ranking, pinning, ageing out',
    strong: [/tenant_opportunity_cards/, /opportunity_bridge/, /tenant_spotlight_buckets/, /tenant_bucket_scores/, /\/cards/, /bridge_version/, /scoreCard/, /closeDate|close_date/,
      /\/buckets\b/, /\/rescore\b/, /pin-for-updates|pin_for_updates|\/cards\/[^/]*\/pin/, /\/opportunities\b/],
    weak: [/\bbucket/i, /\brank/i, /\bpin\b/i, /\bcard\b/i, /fan-?out/i],
  },
  library: {
    label: '4 · Tenant library — upload, atomize, foundational docs → atoms',
    // ⚠️ `/foundation/` and `/templates/` are BOTH ambiguous in this tree and both were wrong
    // here. The busiest fixture tenant is *named* `foundation`, so `/\/foundation\b/` matched the
    // portal URL of every drive on the box and made this function look like the best-covered one
    // in the product — 77 instruments, most of which never touch a library. And
    // `/api/admin/workflows/templates` is a WORKFLOW template, a different thing from the document
    // templates this function means. Both are now spelled so they can only mean the library.
    strong: [/library_atoms/, /atom_tags/, /atom_embeddings/, /\/atoms/, /atomiz/i, /library\/foundation/, /document_templates/, /template_bridge/, /system_starter/,
      /\/vaults?\b/, /\/library\b/, /template-stable/],
    weak: [/\blibrary\b/i, /\batom\b/i, /foundational/i, /document template/i],
  },
  build: {
    // Post-award project management is the SECOND HALF of this function, not a sixth one — the
    // operator's own wording puts "project management" inside the customer's build life. It keeps
    // its own concern tag below so the two halves stay separable in the report.
    label: '5 · Proposal build + post-award projects — requisition → draft → lock → deliver',
    strong: [/proposal_sections/, /canvas_versions/, /studio_phase/, /full-?draft/i, /color_team/, /proposal_compliance_matrix/, /\/proposals\//, /lock-section/, /package\?format/, /guardrail_config/,
      /project_milestones/, /project_deliverables/, /project_clins/, /\/projects\//, /\/milestones\b/, /\/deliverables\b/, /baselined_at/],
    weak: [/\bproposal\b/i, /\bcanvas\b/i, /\bsection\b/i, /\bvolume\b/i, /\bdraft\b/i, /\bmilestone/i],
  },
};

/** Cross-cutting concerns, reported alongside rather than instead of a function. */
const CONCERNS = {
  automation: [/process_instances/, /process_templates/, /workflow/i, /trigger_key/, /agent_task_queue/, /AI_INVOKE/],
  audit: [/system_events/, /emitEvent/, /audit/i, /\.refused\b/, /notification\.requested/],
  isolation: [/RLS|row.level.security/i, /tenant_isolation/, /app\.tenant_id/, /sqlBypass/, /cross-?tenant/i, /withTenant/],
  bridge: [/shadow/i, /partner/i, /descen[dt]/i, /collaborat/i, /space_presence/, /manager-?request/i],
  projects: [/project_milestones/, /project_deliverables/, /project_clins/, /\/projects\//, /baselined_at/],
};

/**
 * ⚠️ AN ACTOR HERE IS THE CREDENTIAL A DRIVE REACHES FOR, NOT THE ROLE IT ENDS UP AS.
 *
 * `SANDBOX_PASSWORD` is shared by `master_admin` and `rfp_admin` (see `passwordFor` in
 * lib/drive-actor.mjs), so this column cannot tell them apart — and on this fixture they are not
 * the same thing at all: the box holds two master_admins and ZERO rfp_admins, so every drive in
 * this column signs in as the role that outranks every gate. That is a finding about the FIXTURE,
 * which a static scan cannot see; it is recorded in docs/VERIFICATION_COVERAGE_MAP.md and driven
 * by `drive-rfp-admin-role.mts`. The label is spelled with both names so nobody reads this column
 * as evidence that an rfp_admin was ever exercised.
 */
const ACTORS = [
  [/SANDBOX_PASSWORD|ADMIN_PW|RFP_ADMIN_PW|DRIVE_ADMIN_PW/, 'platform admin (master_admin|rfp_admin — indistinguishable here)'],
  [/TENANT_PW|LIGHTHOUSE_PW/, 'tenant'],
  [/BUYER_PW/, 'buyer'],
  [/PARTNER_PW|partner@|pjackson|sgaffney/, 'partner admin'],
  [/collaborator|partner_user/i, 'collaborator / partner_user'],
];

/** Does the file drive a BROWSER (UI) or only the database / API? */
const DRIVES_UI = /from 'playwright'|chromium\.launch|page\.goto|page\.click/;
const DRIVES_API = /\.fetch\(|request\.(get|post|patch|put|delete)\(|api\.(get|fetch)\(/;
const DRIVES_DB = /from '@\/lib\/db'|postgres\(|sqlBypass|await sql`/;

const files = readdirSync(SCRIPTS)
  .filter((f) => /\.(mts|mjs)$/.test(f) && !f.startsWith('.'))
  .filter((f) => /^(drive|probe|verify|audit|capture|reconcile|crosscheck)/.test(f));

/** Registered in the branch suite? The runner is the authority on what actually runs. */
const runner = readFileSync(path.join(SCRIPTS, 'run-branch-drives.sh'), 'utf8');
const registered = new Set(
  [...runner.matchAll(/"[a-z0-9-]+\|(scripts\/[A-Za-z0-9._-]+)"/g)].map((m) => path.basename(m[1])),
);

const rows = [];
const unclassified = [];
for (const f of files) {
  const src = readFileSync(path.join(SCRIPTS, f), 'utf8');
  const score = {};
  for (const [key, { strong, weak }] of Object.entries(FUNCTIONS)) {
    const s = strong.filter((re) => re.test(src)).length;
    const w = weak.filter((re) => re.test(src)).length;
    const total = s * 3 + w;
    if (total > 0) score[key] = total;
  }
  const ranked = Object.entries(score).sort((a, b) => b[1] - a[1]);
  // ── VOCABULARY ALONE NEVER CLAIMS A FUNCTION ────────────────────────────────────────────────
  // The threshold used to be `strong*3 + weak >= 3`, which three weak words satisfy on their own —
  // and the weak lists are ordinary English ("draft", "section", "template", "release"). That is
  // how a drive whose only connection to the library was the word "template" was counted as
  // covering it. Requiring at least one STRONG signal is the rule that matches what this map
  // claims to measure: a drive covers a function when it touches that function's tables or routes,
  // not when it happens to use its words. A close second is still claimed — a drive that walks
  // release→card genuinely touches two functions and naming one would understate it.
  const strongHits = Object.fromEntries(
    Object.entries(FUNCTIONS).map(([k, { strong }]) => [k, strong.filter((re) => re.test(src)).length]),
  );
  const top = ranked[0]?.[1] ?? 0;
  const claimed = ranked
    .filter(([k, v]) => strongHits[k] >= 1 && v >= Math.max(3, top * 0.5))
    .map(([k]) => k);

  const row = {
    file: f,
    registered: registered.has(f),
    functions: claimed,
    concerns: Object.entries(CONCERNS).filter(([, res]) => res.some((re) => re.test(src))).map(([k]) => k),
    actors: ACTORS.filter(([re]) => re.test(src)).map(([, name]) => name),
    layers: [DRIVES_UI.test(src) && 'UI', DRIVES_API.test(src) && 'API', DRIVES_DB.test(src) && 'DB'].filter(Boolean),
  };
  // ⚠️ A file with no FUNCTION still has its CONCERNS, and the first version dropped them with it:
  // `continue` skipped the push, so `drive-space-presence`, `verify-project-isolation` and
  // `drive-milestone-construct` vanished from the report entirely rather than appearing under
  // bridge, isolation and projects. A coverage map that loses a whole instrument is worse than one
  // that files it loosely — the concern columns silently under-counted by a quarter.
  rows.push(row);
  if (!claimed.length) unclassified.push(f);
}

// ── report ────────────────────────────────────────────────────────────────────────────────────
const classified = rows.filter((r) => r.functions.length).length;
console.log(`${files.length} instrument(s) read · ${classified} carry a function · ${unclassified.length} do not`);
console.log(`(all ${files.length} are still scored for the cross-cutting concerns below — see the note at the push.)\n`);

for (const [key, { label }] of Object.entries(FUNCTIONS)) {
  const mine = rows.filter((r) => r.functions.includes(key));
  const suite = mine.filter((r) => r.registered);
  const ui = mine.filter((r) => r.layers.includes('UI'));
  const actors = [...new Set(mine.flatMap((r) => r.actors))];
  console.log(`── ${label}`);
  console.log(`   ${mine.length} instrument(s) · ${suite.length} in the branch suite · ${ui.length} drive a BROWSER`);
  console.log(`   actors exercised: ${actors.length ? actors.join(' · ') : '⚠ NONE DETECTED'}`);
  for (const r of mine.sort((a, b) => Number(b.registered) - Number(a.registered)).slice(0, 10)) {
    console.log(`     ${r.registered ? '✓suite' : '      '} ${r.file.padEnd(40)} [${r.layers.join('+') || 'none'}] ${r.actors.join(', ')}`);
  }
  if (mine.length > 10) console.log(`     … and ${mine.length - 10} more`);
  console.log('');
}

console.log('── cross-cutting concerns (reported alongside, not instead of, a function) ──');
for (const key of Object.keys(CONCERNS)) {
  const mine = rows.filter((r) => r.concerns.includes(key));
  const suite = mine.filter((r) => r.registered).length;
  console.log(`   ${key.padEnd(12)} ${String(mine.length).padStart(3)} instrument(s) · ${suite} in the suite`);
}

if (unclassified.length) {
  console.log(`\n── ${unclassified.length} UNCLASSIFIED (reported, never filed under the nearest-looking bucket) ──`);
  console.log('   ' + unclassified.join(' '));
}

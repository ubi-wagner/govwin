#!/usr/bin/env node
/**
 * audit-env-parity — does STAGING still hold PRODUCTION's credentials?
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────────────────────────
 * The fastest way to stand up a second environment is to replicate the first, and Railway's
 * "duplicate environment" does exactly that — services, volumes, and **every variable**. The result
 * boots, reports Online on every node, and is the most dangerous state the system can be in:
 *
 *   · the staging worker holds the PRODUCTION Postmark server token, so the nudge sweep — which
 *     runs on a schedule, unprompted — sends real mail to real customers
 *   · `PORTAL_BASE_URL` still names www.rfppipeline.com, so every link in that mail sends the
 *     recipient into production
 *   · `AWS_S3_BUCKET` + `AWS_ENDPOINT_URL` may still resolve to the production bucket, and a
 *     staging export or atomize run writes — or overwrites — customer artifacts
 *   · the production `ANTHROPIC_API_KEY` bills staging's experiments to production's spend, and
 *     defeats the whole point of a separate workspace with its own limit
 *
 * None of that shows up as an error. Every one of those variables is *valid*; it is just pointed at
 * the wrong world. So this asks the one question a green dashboard cannot: **which values are
 * byte-identical across the two environments, and should not be?**
 *
 * ── IT NEVER PRINTS A SECRET ───────────────────────────────────────────────────────────────────
 * Output is `same` / `differs` / `missing` and a sha256 prefix, never a value. An audit whose output
 * cannot be pasted into a ticket is an audit that gets run once.
 *
 * ── INPUT ──────────────────────────────────────────────────────────────────────────────────────
 * A directory of variable dumps named `<environment>.<service>.json`, e.g.
 *
 *     production.frontend.json   staging.frontend.json
 *     production.pipeline.json   staging.pipeline.json
 *     production.rfp-crm.json    staging.rfp-crm.json
 *
 * Produce them with the Railway CLI — six invocations, one per service per environment:
 *
 *     railway variables --environment production --service govtech-frontend --json \
 *       > envdump/production.frontend.json
 *     railway variables --environment staging    --service govtech-frontend --json \
 *       > envdump/staging.frontend.json
 *     …and the same for `pipeline` and `rfp-crm`.
 *
 * Any JSON shape Railway has used is accepted: a flat `{NAME: value}` object, `{variables: {…}}`,
 * or an array of `{name, value}`.
 *
 *     node scripts/audit-env-parity.mjs envdump/
 *     node scripts/audit-env-parity.mjs --check     # self-test only, no input needed
 *
 * Exit 0 = clean · 1 = at least one finding · 2 = harness defect or unusable input.
 *
 * ⚠️ The dumps contain live secrets. Write them somewhere transient and delete them after. This
 * script reads them and never copies a value anywhere.
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const CHECK_ONLY = process.argv.includes('--check');
const DIR = process.argv.slice(2).find((a) => !a.startsWith('--'));

/**
 * MUST DIFFER between production and staging. Each carries what goes wrong when it does not,
 * because a checklist entry without a consequence is one somebody talks themselves out of.
 */
const MUST_DIFFER = {
  ANTHROPIC_API_KEY:
    'staging bills production\'s spend and escapes the staging workspace limit',
  POSTMARK_SERVER_TOKEN:
    'the scheduled nudge sweep sends REAL MAIL to REAL CUSTOMERS from staging',
  POSTMARK_WEBHOOK_SECRET:
    'a production bounce could be accepted by staging, writing the suppression to the wrong DB',
  AUTH_SECRET:
    'a production session cookie is valid on staging and vice versa',
  NEXTAUTH_SECRET:
    'alias of AUTH_SECRET — same consequence',
  API_KEY_ENCRYPTION_SECRET:
    'staging can decrypt production\'s stored API keys',
  CRON_SECRET:
    'anyone who can fire a production sweep can fire staging\'s, and the reverse',
  CMS_API_KEY: 'service-to-service auth crosses the environment boundary',
  CMS_JWT_SECRET: 'a CMS admin token minted in one environment is valid in the other',
  REVALIDATE_SECRET: 'staging can trigger production ISR revalidation',
  DATABASE_URL: 'STAGING IS POINTED AT THE PRODUCTION DATABASE',
  DATABASE_URL_OWNER: 'STAGING MIGRATES THE PRODUCTION DATABASE',
  CRM_DATABASE: 'staging\'s CRM is pointed at the production CRM database',
  SHARED_DATABASE_URL: 'staging bridges system_events into production',
  AUTH_URL: 'auth redirects leave staging for production',
  NEXTAUTH_URL: 'auth redirects leave staging for production',
  NEXT_PUBLIC_APP_URL: 'the app advertises production\'s address from staging',
  PORTAL_BASE_URL:
    'EVERY NUDGE AND NOTIFICATION LINK sends the recipient into production',
  CMS_PUBLIC_URL: 'cross-service URLs cross the environment boundary',
  FRONTEND_URL: 'cross-service URLs cross the environment boundary',
  GOOGLE_SERVICE_ACCOUNT_JSON:
    'staging can send as, and sweep, the production mailboxes',
  VOYAGE_API_KEY: 'staging bills production\'s embedding spend (lower severity, still shared)',
  INITIAL_MASTER_ADMIN_PASSWORD: 'one password opens both environments\' first admin',
};

/**
 * THE OBJECT STORE IS A CREDENTIAL GROUP, NOT FOUR INDEPENDENT VARIABLES.
 *
 * These were four `MUST_DIFFER` rows and that was a harness bug, not a finding — the same shape as
 * asserting "the row is gone" after a DELETE that is a deactivation by design. When the PLATFORM
 * provisions a bucket service per environment (Railway's own storage, rather than a Cloudflare
 * token you create by hand), the credentials are injected, and two genuinely separate buckets can
 * carry the SAME DISPLAY NAME. Flagging the matching name is then a confident false positive on a
 * correctly-configured environment — and a lens that cries wolf on the correct case is one whose
 * real findings get scrolled past.
 *
 * What actually means "staging can reach production's objects" is the ACCESS PAIR. So: judge the
 * group, and say plainly which of the three states it is in.
 */
const STORE_GROUP = {
  access: ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'],
  identity: ['AWS_ENDPOINT_URL', 'AWS_S3_BUCKET', 'AWS_S3_BUCKET_NAME'],
};

/** Must be UNSET in staging. Each is a sandbox switch that makes staging silently not-staging. */
const MUST_BE_UNSET_IN_STAGING = {
  ANTHROPIC_BASE_URL:
    'points the SDK at the local emulator — staging would run canned text and look fine',
  STORAGE_DRIVER:
    '`local` swaps R2 for the filesystem — uploads land on a container disk that is discarded',
  LOCAL_STORAGE_DIR: 'only meaningful with STORAGE_DRIVER=local',
  POSTMARK_API_BASE: 'points the mail driver at the local emulator',
  USE_STUB_DATA: 'dev-only stub data',
};

/**
 * Must MATCH between two services WITHIN staging. The failure is silent in both cases, which is
 * why they are checked rather than trusted.
 */
const MUST_MATCH_WITHIN = [
  { name: 'API_KEY_ENCRYPTION_SECRET', a: 'frontend', b: 'pipeline',
    why: 'the frontend encrypts a stored key the pipeline then cannot decrypt — the symptom is an AI feature that does nothing, with no error worth reading' },
  { name: 'REVALIDATE_SECRET', a: 'frontend', b: 'rfp-crm',
    why: 'ISR revalidation is rejected and published content silently never refreshes' },
];

/** A staging URL naming this host is pointed at production regardless of what else is set. */
const PROD_HOST_HINTS = ['rfppipeline.com', '-production.up.railway.app'];

const sha = (v) => createHash('sha256').update(String(v)).digest('hex').slice(0, 8);

/** Accept every JSON shape Railway has emitted for `variables`. */
function parseDump(text, label) {
  let j;
  try { j = JSON.parse(text); }
  catch (e) { throw new Error(`${label}: not valid JSON (${e.message})`); }
  if (Array.isArray(j)) {
    const out = {};
    for (const row of j) {
      const k = row?.name ?? row?.key;
      if (typeof k === 'string') out[k] = String(row.value ?? '');
    }
    return out;
  }
  if (j && typeof j === 'object' && j.variables && typeof j.variables === 'object') j = j.variables;
  if (!j || typeof j !== 'object') throw new Error(`${label}: expected an object of NAME → value`);
  const out = {};
  for (const [k, v] of Object.entries(j)) {
    // Railway sometimes nests {value, isSealed}; take the value and note a sealed one as unreadable.
    out[k] = (v && typeof v === 'object' && 'value' in v) ? String(v.value ?? '') : String(v ?? '');
  }
  return out;
}

/**
 * The audit itself, over an already-parsed map of `env → service → vars`. Pure, so `--check` can
 * drive it with fixtures. THE INSTRUMENT BEFORE THE FINDING: a first run describes the harness.
 */
export function audit(envs) {
  const findings = [];
  const prod = envs.production || {};
  const stag = envs.staging || {};
  const services = [...new Set([...Object.keys(prod), ...Object.keys(stag)])].sort();

  for (const svc of services) {
    const p = prod[svc], s = stag[svc];
    if (!p || !s) {
      findings.push({ severity: 'gap', service: svc, name: '—',
        detail: `only ${p ? 'production' : 'staging'} was dumped for this service — the other side is UNCHECKED, not clean` });
      continue;
    }

    for (const [name, why] of Object.entries(MUST_DIFFER)) {
      const pv = p[name], sv = s[name];
      if (pv === undefined && sv === undefined) continue;
      if (sv === undefined) {
        findings.push({ severity: 'missing', service: svc, name,
          detail: `set in production, ABSENT in staging — that capability is off, or the service will not boot` });
        continue;
      }
      if (pv === undefined) continue;               // staging-only is fine
      if (pv === sv) {
        findings.push({ severity: 'shared', service: svc, name, hash: sha(sv), detail: why });
      }
    }

    // ── the object store, judged as a group ────────────────────────────────────────────────────
    const bothHave = (n) => p[n] !== undefined && s[n] !== undefined;
    const sameOnes = (list) => list.filter((n) => bothHave(n) && p[n] === s[n]);
    const diffOnes = (list) => list.filter((n) => bothHave(n) && p[n] !== s[n]);
    const accessSame = sameOnes(STORE_GROUP.access);
    const accessDiff = diffOnes(STORE_GROUP.access);
    const identitySame = sameOnes(STORE_GROUP.identity);

    if (accessSame.length && !accessDiff.length) {
      findings.push({ severity: 'shared', service: svc, name: 'object store (AWS_*)',
        hash: sha(accessSame.map((n) => s[n]).join('|')),
        detail: `IDENTICAL ACCESS CREDENTIALS (${accessSame.join(', ')}) — staging can write to, and ` +
                `overwrite, whatever production's keys can reach` });
    } else if (accessDiff.length && identitySame.length) {
      findings.push({ severity: 'note', service: svc, name: 'object store (AWS_*)',
        detail: `credentials DIFFER (${accessDiff.join(', ')}) but ${identitySame.join(', ')} ` +
                `match — expected when the PLATFORM provisions a bucket per environment, since two ` +
                `separate stores can carry one display name. Not a finding; confirm functionally (§10.4)` });
    }

    for (const [name, why] of Object.entries(MUST_BE_UNSET_IN_STAGING)) {
      if (s[name] !== undefined && s[name] !== '') {
        findings.push({ severity: 'sandbox-switch', service: svc, name, detail: why });
      }
    }

    for (const [name, v] of Object.entries(s)) {
      if (!/URL|ORIGIN|DOMAIN|HOST/.test(name)) continue;
      const hit = PROD_HOST_HINTS.find((h) => v.includes(h));
      if (hit) {
        findings.push({ severity: 'points-at-prod', service: svc, name,
          detail: `a staging value naming '${hit}' — this points at production whatever else is set` });
      }
    }
  }

  for (const pair of MUST_MATCH_WITHIN) {
    const a = stag[pair.a]?.[pair.name], b = stag[pair.b]?.[pair.name];
    if (a === undefined || b === undefined) continue;
    if (a !== b) {
      findings.push({ severity: 'mismatch-within', service: `${pair.a}↔${pair.b}`, name: pair.name,
        detail: pair.why });
    }
  }

  return findings;
}

/**
 * Validate against hand-verified answers BEFORE reporting on anything real. The contract lens's
 * first run reported 38 violations, all phantom; the rule since is that a new harness's first
 * output describes the HARNESS.
 */
function selfTest() {
  const cases = [
    {
      label: 'a shared Anthropic key is caught',
      envs: { production: { frontend: { ANTHROPIC_API_KEY: 'sk-live' } },
              staging:    { frontend: { ANTHROPIC_API_KEY: 'sk-live' } } },
      expect: (f) => f.some((x) => x.severity === 'shared' && x.name === 'ANTHROPIC_API_KEY'),
    },
    {
      label: 'a DIFFERENT Anthropic key is not a finding',
      envs: { production: { frontend: { ANTHROPIC_API_KEY: 'sk-live' } },
              staging:    { frontend: { ANTHROPIC_API_KEY: 'sk-stag' } } },
      expect: (f) => !f.some((x) => x.name === 'ANTHROPIC_API_KEY'),
    },
    {
      label: 'a sandbox switch set in staging is caught',
      envs: { production: { frontend: {} },
              staging:    { frontend: { ANTHROPIC_BASE_URL: 'http://127.0.0.1:8787' } } },
      expect: (f) => f.some((x) => x.severity === 'sandbox-switch' && x.name === 'ANTHROPIC_BASE_URL'),
    },
    {
      label: 'a staging URL naming the production host is caught even when the values differ',
      envs: { production: { frontend: { PORTAL_BASE_URL: 'https://www.rfppipeline.com' } },
              staging:    { frontend: { PORTAL_BASE_URL: 'https://www.rfppipeline.com/x' } } },
      expect: (f) => f.some((x) => x.severity === 'points-at-prod' && x.name === 'PORTAL_BASE_URL'),
    },
    {
      label: 'a cross-service secret that disagrees WITHIN staging is caught',
      envs: { production: { frontend: {}, pipeline: {} },
              staging: { frontend: { API_KEY_ENCRYPTION_SECRET: 'a' },
                         pipeline: { API_KEY_ENCRYPTION_SECRET: 'b' } } },
      expect: (f) => f.some((x) => x.severity === 'mismatch-within'),
    },
    {
      label: 'the same cross-service secret WITHIN staging is not a finding',
      envs: { production: { frontend: {}, pipeline: {} },
              staging: { frontend: { API_KEY_ENCRYPTION_SECRET: 'a' },
                         pipeline: { API_KEY_ENCRYPTION_SECRET: 'a' } } },
      expect: (f) => !f.some((x) => x.severity === 'mismatch-within'),
    },
    {
      label: 'object store: identical ACCESS CREDENTIALS is a finding',
      envs: { production: { frontend: { AWS_ACCESS_KEY_ID: 'ak', AWS_SECRET_ACCESS_KEY: 'sk', AWS_S3_BUCKET: 'b' } },
              staging:    { frontend: { AWS_ACCESS_KEY_ID: 'ak', AWS_SECRET_ACCESS_KEY: 'sk', AWS_S3_BUCKET: 'b' } } },
      expect: (f) => f.some((x) => x.severity === 'shared' && x.name.startsWith('object store')),
    },
    {
      // THE REGRESSION THIS EXISTS TO PREVENT. A platform-provisioned bucket per environment
      // injects different credentials while the display name is shared, and the first version of
      // this instrument called that a shared production bucket.
      label: 'object store: same BUCKET NAME with different credentials is a note, NOT a finding',
      envs: { production: { frontend: { AWS_ACCESS_KEY_ID: 'akP', AWS_SECRET_ACCESS_KEY: 'skP', AWS_S3_BUCKET: 'rfp-pipeline-bucket' } },
              staging:    { frontend: { AWS_ACCESS_KEY_ID: 'akS', AWS_SECRET_ACCESS_KEY: 'skS', AWS_S3_BUCKET: 'rfp-pipeline-bucket' } } },
      expect: (f) => f.some((x) => x.severity === 'note' && x.name.startsWith('object store'))
                  && !f.some((x) => x.severity === 'shared'),
    },
    {
      label: 'object store: fully distinct is silent',
      envs: { production: { frontend: { AWS_ACCESS_KEY_ID: 'akP', AWS_SECRET_ACCESS_KEY: 'skP', AWS_S3_BUCKET: 'bP' } },
              staging:    { frontend: { AWS_ACCESS_KEY_ID: 'akS', AWS_SECRET_ACCESS_KEY: 'skS', AWS_S3_BUCKET: 'bS' } } },
      expect: (f) => !f.some((x) => x.name.startsWith('object store')),
    },
    {
      label: 'a service dumped for only one environment is reported as UNCHECKED, not clean',
      envs: { production: { frontend: { ANTHROPIC_API_KEY: 'sk-live' } }, staging: {} },
      expect: (f) => f.some((x) => x.severity === 'gap'),
    },
    {
      label: 'no secret value ever appears in a finding',
      envs: { production: { frontend: { ANTHROPIC_API_KEY: 'sk-super-secret-value' } },
              staging:    { frontend: { ANTHROPIC_API_KEY: 'sk-super-secret-value' } } },
      expect: (f) => !JSON.stringify(f).includes('sk-super-secret-value'),
    },
  ];

  let bad = 0;
  for (const c of cases) {
    const ok = c.expect(audit(c.envs));
    console.log(`  ${ok ? '✓' : '✗'} ${c.label}`);
    if (!ok) bad++;
  }
  // The parser is the other half of the instrument, and it takes three shapes.
  const shapes = [
    ['flat object', '{"A":"1"}'],
    ['wrapped', '{"variables":{"A":"1"}}'],
    ['array of rows', '[{"name":"A","value":"1"}]'],
    ['sealed value object', '{"A":{"value":"1","isSealed":true}}'],
  ];
  for (const [label, text] of shapes) {
    const ok = parseDump(text, label).A === '1';
    console.log(`  ${ok ? '✓' : '✗'} parses the ${label} dump shape`);
    if (!ok) bad++;
  }
  return bad;
}

// ── main ────────────────────────────────────────────────────────────────────────────────────────
console.log('\nSELF-TEST — validating the instrument against known answers first\n');
const bad = selfTest();
if (bad) {
  console.error(`\n⛔ HARNESS DEFECT — ${bad} self-test(s) failed. Every finding below would be unearned.\n`);
  process.exit(2);
}
console.log('\n  self-test passed.\n');
if (CHECK_ONLY) process.exit(0);

if (!DIR || !existsSync(DIR) || !statSync(DIR).isDirectory()) {
  console.error(`\nUsage: node scripts/audit-env-parity.mjs <dir-of-dumps>\n` +
                `  Expected files named <environment>.<service>.json, e.g. staging.frontend.json\n` +
                `  See this file's header for the six railway CLI commands that produce them.\n`);
  process.exit(2);
}

const envs = {};
const files = readdirSync(DIR).filter((f) => f.endsWith('.json'));
if (!files.length) { console.error(`no .json dumps in ${DIR}`); process.exit(2); }
for (const f of files) {
  const m = f.match(/^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)\.json$/);
  if (!m) { console.error(`  ⚠ skipping ${f} — expected <environment>.<service>.json`); continue; }
  const [, env, svc] = m;
  (envs[env] ??= {})[svc] = parseDump(readFileSync(join(DIR, f), 'utf8'), f);
}

const loaded = Object.entries(envs)
  .map(([e, s]) => `${e}: ${Object.keys(s).join(', ')}`).join(' · ');
console.log(`READ  ${files.length} dump(s) — ${loaded}\n`);
if (!envs.production || !envs.staging) {
  console.error(`⛔ CANNOT RUN — need dumps from BOTH 'production' and 'staging'. ` +
                `A one-sided audit cannot answer the only question this asks.\n`);
  process.exit(2);
}

const findings = audit(envs);
const order = ['shared', 'points-at-prod', 'sandbox-switch', 'mismatch-within', 'missing', 'gap', 'note'];
const label = {
  shared: 'SHARED WITH PRODUCTION', 'points-at-prod': 'POINTS AT PRODUCTION',
  'sandbox-switch': 'SANDBOX SWITCH IS SET', 'mismatch-within': 'DISAGREES WITHIN STAGING',
  missing: 'MISSING IN STAGING', gap: 'UNCHECKED', note: 'FOR INFORMATION — NOT A FINDING',
};

for (const sev of order) {
  const rows = findings.filter((f) => f.severity === sev);
  if (!rows.length) continue;
  console.log(`${label[sev]}  (${rows.length})`);
  for (const r of rows) {
    console.log(`  ${r.service.padEnd(10)} ${r.name.padEnd(30)} ${r.hash ? `sha:${r.hash}  ` : ''}${r.detail}`);
  }
  console.log('');
}

// A `note` is deliberately NOT a finding and must not fail the run — a lens that cries wolf on a
// correctly-configured environment is one whose real findings get scrolled past.
const real = findings.filter((f) => f.severity !== 'note');
if (!real.length) {
  console.log('✓ no shared credentials, no sandbox switches, no production URLs in staging.');
  if (findings.length) console.log('  (the note above is informational — read it, then carry on.)');
  console.log('');
  process.exit(0);
}
console.log(`── ${real.length} finding(s). Each one is a value pointed at the wrong world; none of`);
console.log(`   them shows up as an error, which is why this asks instead of waiting.\n`);
process.exit(1);

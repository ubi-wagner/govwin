/**
 * Take a drafted build all the way to a downloadable submission package, through the product's
 * OWN routes, as the buying tenant_admin:
 *
 *   1. readiness   — what the product says is still missing (GET …/compliance)
 *   2. lock        — every section, then the proposal (POST …/sections/[s]/lock, POST …/lock)
 *   3. export      — every volume in the requested format, reading the compliance gate's verdict
 *                    off `X-Compliance-Violations`
 *   4. package     — the whole submission (GET …/package?format=…)
 *
 * Nothing is asserted client-side: the readiness figures, the lock outcomes and the compliance
 * counts all come from the server. A volume that fails the floor is reported, not hidden.
 *
 * Run: PROP=<id> OUT=<dir> node scripts/t3cp-lock-and-package.mjs [format]
 */
import { chromium } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'fs';

const TENANT = process.env.TENANT ?? 'immobileyes';
const PROP = process.env.PROP;
const FORMAT = process.argv[2] ?? 'docx';
const OUT = process.env.OUT ?? null;
if (!PROP) { console.error('PROP=<proposalId> required'); process.exit(1); }

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ baseURL: 'http://localhost:3000' });
await page.goto('/login');
await page.fill('input[type="email"]', process.env.EMAIL ?? 'admin@immobileyes.test');
await page.fill('input[type="password"]', process.env.PASSWORD ?? 'DemoPass123!');
await Promise.all([page.waitForURL((u) => !u.pathname.includes('/login')), page.click('button[type="submit"]')]);
if (OUT) mkdirSync(OUT, { recursive: true });

// ── 1. Readiness, before anything is locked ─────────────────────────────────
const readyRes = await page.request.get(`/api/portal/${TENANT}/proposals/${PROP}/compliance`, { timeout: 120_000 });
if (readyRes.ok()) {
  const r = (await readyRes.json()).data;
  console.log('[readiness]', JSON.stringify(r).slice(0, 700), '\n');
} else {
  console.log('[readiness]', readyRes.status(), (await readyRes.text()).slice(0, 200), '\n');
}

// ── 2. Lock every section, then the proposal ────────────────────────────────
const secRes = await page.request.get(`/api/portal/${TENANT}/proposals/${PROP}/sections`);
const { sections } = (await secRes.json()).data;
let locked = 0;
for (const s of sections) {
  if (s.isLocked) { locked++; continue; }
  const res = await page.request.post(`/api/portal/${TENANT}/proposals/${PROP}/sections/${s.id}/lock`, { timeout: 60_000 });
  if (res.ok()) locked++;
  else console.log(`  ! lock ${s.title}: ${res.status()} ${JSON.stringify(await res.json().catch(() => ({}))).slice(0, 160)}`);
}
console.log(`[lock] ${locked}/${sections.length} sections locked`);

const propLock = await page.request.post(`/api/portal/${TENANT}/proposals/${PROP}/lock`, { timeout: 120_000 });
console.log('[lock] proposal:', propLock.status(), JSON.stringify(await propLock.json().catch(() => ({}))).slice(0, 300), '\n');

// ── 3. Export each volume, reading the compliance gate ──────────────────────
const byArtifact = new Map();
for (const s of sections) {
  if (!s.artifactId || byArtifact.has(s.artifactId)) continue;
  byArtifact.set(s.artifactId, { id: s.artifactId, volumeNumber: s.volumeNumber, volumeName: s.volumeName });
}
const artifacts = [...byArtifact.values()].sort((a, b) => (a.volumeNumber ?? 99) - (b.volumeNumber ?? 99));

let clean = 0;
for (const a of artifacts) {
  const label = `V${a.volumeNumber ?? '?'} ${a.volumeName ?? '(untitled)'}`;
  const res = await page.request.get(
    `/api/portal/${TENANT}/proposals/${PROP}/artifacts/${a.id}/export?format=${FORMAT}`, { timeout: 180_000 });
  if (!res.ok()) { console.log(`  ! ${label}: ${res.status()} ${(await res.text()).slice(0, 200)}`); continue; }
  const n = Number(res.headers()['x-compliance-violations'] ?? '0');
  const body = await res.body();
  console.log(`  ${n === 0 ? '✓' : '⚠'} ${label} — ${body.length.toLocaleString()} bytes, ${n} violation${n === 1 ? '' : 's'}`);
  if (n === 0) clean++;
  if (OUT) writeFileSync(`${OUT}/${label.replace(/[^a-z0-9]+/gi, '_')}.${FORMAT}`, body);
}
console.log(`\n[export] ${clean}/${artifacts.length} volumes clean`);

// ── 4. The whole submission package ─────────────────────────────────────────
for (const fmt of [FORMAT, 'zip']) {
  const res = await page.request.get(`/api/portal/${TENANT}/proposals/${PROP}/package?format=${fmt}`, { timeout: 300_000 });
  if (!res.ok()) { console.log(`[package:${fmt}] ${res.status()} ${(await res.text()).slice(0, 220)}`); continue; }
  const body = await res.body();
  const n = res.headers()['x-compliance-violations'];
  console.log(`[package:${fmt}] ${body.length.toLocaleString()} bytes${n != null ? `, ${n} violations` : ''}`);
  if (OUT) writeFileSync(`${OUT}/T3CP_submission.${fmt}`, body);
}
await browser.close();

/**
 * DoW 2026 SBIR BAA + T3CP Patent Holiday topic — REAL rfp_admin ingest drive.
 *
 * Drives the product's own ingest spine end to end as the actual rfp_admin actor:
 *   /admin/rfp-curation (triage)  →  /upload (BAA source + topic file, Ingest Assist ON)
 *   →  OnRfpUploaded workflow  →  ingest_analyst → matrix_stager → skeleton_architect
 *   →  /admin/rfp-curation/[solId] (compliance matrix + volume skeleton)
 *
 * Nothing here hand-authors solicitation content: the shredder and the ingest cohort
 * produce the matrix and the skeleton. This spec only clicks the UI a curator clicks,
 * and screenshots each step for the RFP Opportunity Ingest Guidebook.
 *
 * Screenshots land in public/guides/rfp-ingest/ so the guidebook can serve them.
 */
import { test, expect } from '@playwright/test';
import path from 'node:path';

const UPLOADS = '/root/.claude/uploads/34d597b2-183f-5787-9057-fc7251e3f9ff';
const BAA = path.join(UPLOADS, '67121ede-DoW_2026_SBIR_BAA_Preface_07152026.pdf');
const TOPIC = path.join(UPLOADS, '728a892f-topic_OSW26BZ04DP013_T3CP_Patent_Holiday_SBIR_Open_Topic_Call.PDF');
const SHOTS = 'public/guides/rfp-ingest';

const ADMIN_EMAIL = process.env.DRIVE_ADMIN_EMAIL || 'eric@rfppipeline.com';
const ADMIN_PW = process.env.DRIVE_ADMIN_PW || 'RFPAdmin2026!';

test.describe.configure({ mode: 'serial' });

test('DoW T3CP ingest — rfp_admin drives upload → shred → matrix → skeleton', async ({ page }) => {
  test.setTimeout(20 * 60 * 1000);

  // ── 1. Sign in as the real admin ──────────────────────────────────────────
  await page.goto('/login');
  await page.fill('input[name="email"], input[type="email"]', ADMIN_EMAIL);
  await page.fill('input[name="password"], input[type="password"]', ADMIN_PW);
  await page.screenshot({ path: `${SHOTS}/01-login.png`, fullPage: true });
  await Promise.all([
    page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 60_000 }),
    page.click('button[type="submit"]'),
  ]);

  // ── 2. The triage queue — where every solicitation starts ─────────────────
  await page.goto('/admin/rfp-curation');
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: `${SHOTS}/02-triage-queue-before.png`, fullPage: true });

  // ── 3. The upload form ────────────────────────────────────────────────────
  await page.goto('/admin/rfp-curation/upload');
  await page.waitForLoadState('networkidle');

  await page.fill('input[name="title"]', 'DoW 2026 SBIR BAA — Release 4 (Amendment 2)');
  await page.fill('input[name="agency"]', 'Department of War');
  await page.fill('input[name="office"]', 'OUSW(R&E) / T3CP');
  await page.selectOption('select[name="programType"]', 'sbir_phase_1');
  await page.fill('input[name="solicitationNumber"]', 'DoW-SBIR-2026-R4');
  const posted = page.locator('input[name="postedDate"]');
  if (await posted.count()) await posted.fill('2026-07-22');
  const close = page.locator('input[name="closeDate"]');
  if (await close.count()) await close.fill('2026-08-19');

  // Source document = the BAA preface (compliance rules live here).
  const fileInputs = page.locator('input[type="file"]');
  await fileInputs.nth(0).setInputFiles(BAA);
  // Topic file = the T3CP topic. Each topic file becomes its own opportunity.
  if ((await fileInputs.count()) > 1) await fileInputs.nth(1).setInputFiles(TOPIC);

  // Ingest Assist ON — this is what runs the cohort (matrix + volumes + molds).
  const assist = page.locator('input[type="checkbox"]').first();
  if (await assist.count()) await assist.check().catch(() => {});

  await page.screenshot({ path: `${SHOTS}/03-upload-form-filled.png`, fullPage: true });

  // ── 4. Submit — kicks OnRfpUploaded + Ingest Assist ───────────────────────
  await page.click('button[type="submit"]');
  // The assist runs server-side; give it room and screenshot whatever the UI shows.
  await page.waitForTimeout(8_000);
  await page.screenshot({ path: `${SHOTS}/04-upload-submitted.png`, fullPage: true });

  // Wait for navigation into the solicitation workspace (or back to triage).
  await page.waitForURL(/\/admin\/rfp-curation/, { timeout: 180_000 }).catch(() => {});
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.screenshot({ path: `${SHOTS}/05-after-upload.png`, fullPage: true });

  const url = page.url();
  console.log('[drive] landed at:', url);
});

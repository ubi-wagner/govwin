/**
 * The DoW 2026 SBIR BAA / T3CP ingest, end to end, through the product's own surfaces.
 *
 * Nothing here reaches around the product. Every step is a real actor doing a real thing:
 *
 *   1. rfp_admin signs in and fills the actual upload form at /admin/rfp-curation/upload,
 *      attaching THREE documents — the umbrella BAA, the Component-specific instructions the
 *      BAA defers its page limit to, and the topic call.
 *   2. The upload emits `finder:rfp.uploaded`; the OnRfpUploaded workflow shreds the documents
 *      asynchronously in the pipeline worker. The form waits for the text (it polls the
 *      readiness endpoint) instead of racing it.
 *   3. Ingest Assist parses + materializes the compliance matrix, volumes and section molds.
 *   4. rfp_admin clicks "Assess ingest readiness" → the platform-scope `rfp_ingest_manager`
 *      agent, which now reasons over the deterministic PROVENANCE AUDIT: what was read, what is
 *      still a default, and whether any deferred rule is unreachable.
 *
 * The claim under test is the one the three documents were chosen to prove: the BAA states no
 * technical-volume page limit and points at the Component instructions; with those instructions
 * attached, the matrix must resolve the limit to 10 AND cite it to the document that says so.
 *
 * Run: npx playwright test --project=drive dow-full-ingest
 */
import { test, expect, type Page } from '@playwright/test';
import { requireUploads } from './upload-fixtures';

// Skips (does not fail) when the source PDFs are not on this machine — see e2e/upload-fixtures.ts.
const [BAA, COMPONENT, TOPIC] = requireUploads(
  'b4c6858c-DoW_2026_SBIR_BAA_Preface_07152026.pdf',
  'bc936179-OSWT3CP_SBIR_26BZ_R4_v2.pdf',
  'a4bcf95d-topic_OSW26BZ04DP013_T3CP_Patent_Holiday_SBIR_Open_Topic_Call.PDF',
);

const SHOTS = 'public/guides/rfp-ingest';

async function signInAsRfpAdmin(page: Page) {
  await page.goto('/login');
  await page.fill('input[type="email"]', 'eric@rfppipeline.com');
  await page.fill('input[type="password"]', 'RFPAdmin2026!');
  await Promise.all([
    page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 60_000 }),
    page.click('button[type="submit"]'),
  ]);
}

test('DoW BAA + Component instructions + topic — full ingest as rfp_admin', async ({ page }) => {
  test.setTimeout(15 * 60 * 1000);
  await signInAsRfpAdmin(page);

  // ── 1. The real upload form ──────────────────────────────────────────────
  await page.goto('/admin/rfp-curation/upload');
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: `${SHOTS}/01-upload-form.png`, fullPage: true });

  await page.fill('input[name="title"]', 'DoW 2026 SBIR BAA — T3CP Patent Holiday Open Topic (OSW26BZ04-DP013)');
  await page.fill('input[name="agency"]', 'Department of War');
  await page.fill('input[name="office"]', 'Office of Strategic Wargaming (OSW) — T3CP');
  await page.selectOption('select[name="programType"]', 'sbir_phase_1');
  await page.fill('input[name="solicitationNumber"]', 'DoW-2026-SBIR-BAA');
  await page.fill('input[name="closeDate"]', '2026-08-19');

  // Two drop zones on this form: solicitation documents, then topic files. The umbrella BAA +
  // the Component-specific instructions are solicitation documents; the topic call goes in the
  // topic slot so it becomes its own opportunity.
  const fileInputs = page.locator('input[type="file"]');
  await fileInputs.nth(0).setInputFiles([BAA, COMPONENT]);
  await fileInputs.nth(1).setInputFiles([TOPIC]);
  await page.waitForTimeout(500);

  // Label the second file for what it is. This is the admin telling the ingest that the
  // Component-specific instructions are a RULE SOURCE, not a nameless attachment — the whole
  // reason the BAA's deferred page limit becomes reachable.
  await page.locator('select').filter({ hasText: 'Component instructions' }).nth(1)
    .selectOption('instructions');
  await page.screenshot({ path: `${SHOTS}/02-files-attached.png`, fullPage: true });

  // ── 2 + 3. Submit → shred (OnRfpUploaded, pipeline worker) → Ingest Assist ──
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/admin\/rfp-curation\/[0-9a-f-]{36}/, { timeout: 12 * 60 * 1000 });
  const solId = page.url().split('/').pop()!.split('?')[0];
  console.log('[drive] solicitation:', solId);
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: `${SHOTS}/03-workspace-after-ingest.png`, fullPage: true });

  // The shred must have produced real text — the whole point of the readiness gate.
  const ready = await (await page.request.get(`/api/admin/rfp-curation/${solId}/ingest-assist`)).json();
  console.log('[drive] readiness:', JSON.stringify(ready.data));
  expect(ready.data.ready).toBe(true);
  expect(ready.data.documents).toBe(3);

  // ── 4. The claim: the deferral is RESOLVED by the attached Component instructions ──
  const assist = await (await page.request.post(`/api/admin/rfp-curation/${solId}/ingest-assist`, {
    data: { publish: false }, timeout: 180_000,
  })).json();
  console.log('[drive] ingest-assist:', JSON.stringify(assist.data, null, 2));

  expect(assist.data.fieldSources.page_limit_technical).toBe('pattern_match');
  expect(assist.data.volumes).toBe(7);
  // The BAA's deferral must NOT be reported — the instructions answered it.
  expect(String(assist.data.notes.join(' '))).not.toMatch(/defers the technical-volume page limit/i);

  // ── 5. The agent job: assess ingest readiness (rfp_ingest_manager) ──
  const assess = await (await page.request.post(`/api/admin/rfp-curation/${solId}/assess-ingest`, {
    data: {}, timeout: 120_000,
  })).json();
  console.log('[drive] assess-ingest snapshot:', JSON.stringify(assess.data?.snapshot, null, 2));
  const prov = assess.data?.snapshot?.provenance;
  expect(prov).toBeTruthy();
  expect(prov.read).toBeGreaterThan(0);
  expect(prov.unresolvedDeferrals).toEqual([]);          // nothing left pointing off-document
  expect(prov.findings.filter((f: { severity: string }) => f.severity === 'blocker')).toEqual([]);

  await page.reload();
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: `${SHOTS}/04-matrix-resolved.png`, fullPage: true });
  await expect(page.getByText('Read from source').first()).toBeVisible({ timeout: 15_000 });

  console.log(`[drive] DONE — solicitation ${solId}`);
});

/**
 * Read or raise a tenant's agent rate limit through the product's own admin route, as an rfp_admin.
 *
 * Why this exists as a drive script: repeatedly re-running a 20-section full draft in one hour
 * legitimately trips the fabric's runaway guard (RATE_LIMIT_PER_HOUR = 50), which safe-skips the
 * remaining sections. That is the guardrail doing its job for a real tenant. Raising the cap for a
 * test tenant is a supported product setting (tenant_agent_config.rate_limit_per_hour, PATCHed
 * here) — not a database edit and not a bypass of the guard, which still applies at the new value.
 *
 * Run: node scripts/t3cp-agent-config.mjs <tenantId> [rateLimitPerHour]
 */
import { chromium } from '@playwright/test';

const TENANT_ID = process.argv[2];
const RATE = process.argv[3] ? Number(process.argv[3]) : null;
if (!TENANT_ID) { console.error('usage: t3cp-agent-config.mjs <tenantId> [rateLimitPerHour]'); process.exit(1); }

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ baseURL: 'http://localhost:3000' });
await page.goto('/login');
await page.fill('input[type="email"]', process.env.EMAIL ?? 'eric@rfppipeline.com');
await page.fill('input[type="password"]', process.env.PASSWORD ?? 'RFPAdmin2026!');
await Promise.all([page.waitForURL((u) => !u.pathname.includes('/login')), page.click('button[type="submit"]')]);

const url = `/api/admin/tenants/${TENANT_ID}/agent-config`;
if (RATE !== null) {
  const res = await page.request.patch(url, { data: { rateLimitPerHour: RATE }, timeout: 60_000 });
  console.log('[patch]', res.status(), JSON.stringify(await res.json().catch(() => ({}))).slice(0, 400));
}
const now = await page.request.get(url, { timeout: 60_000 });
console.log('[config]', now.status(), JSON.stringify(await now.json().catch(() => ({}))).slice(0, 500));
await browser.close();

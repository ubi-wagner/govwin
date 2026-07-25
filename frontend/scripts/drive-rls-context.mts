/**
 * Prove the context-aware `sql` Proxy (lib/db.ts + lib/tenant-context.ts) enforces tenant
 * isolation when the app connects as govtech_app (NOBYPASSRLS). Run with:
 *   DATABASE_URL=<govtech_app conn>  OWNER_URL=<owner conn>  npx tsx scripts/drive-rls-context.mts
 * `sql` (app) = govtech_app + Proxy; `owner` = a separate owner connection for setup reads.
 */
import postgres from 'postgres';
import { sql } from '@/lib/db';
import { runInTenant } from '@/lib/tenant-context';

const owner = postgres(process.env.OWNER_URL!, { max: 2 });
const n = (r: Array<{ n: number }>) => r[0]?.n ?? -1;

async function main() {
  // setup via the owner connection (bypasses RLS)
  const [{ ptid }] = await owner<Array<{ ptid: string }>>`SELECT tenant_id AS ptid FROM purchases WHERE tenant_id IS NOT NULL LIMIT 1`;
  const [{ other }] = await owner<Array<{ other: string }>>`SELECT id AS other FROM tenants WHERE id <> ${ptid}::uuid LIMIT 1`;

  // as govtech_app through the Proxy:
  const noCtx  = n(await sql<Array<{ n: number }>>`SELECT count(*)::int AS n FROM purchases`);                                  // no context → DENY-ALL
  const right  = n(await runInTenant(ptid,  () => sql<Array<{ n: number }>>`SELECT count(*)::int AS n FROM purchases`));         // correct tenant → sees it
  const wrong  = n(await runInTenant(other, () => sql<Array<{ n: number }>>`SELECT count(*)::int AS n FROM purchases`));         // other tenant → 0
  const forged = n(await runInTenant(other, () => sql<Array<{ n: number }>>`SELECT count(*)::int AS n FROM purchases WHERE tenant_id = ${ptid}::uuid`)); // forged by-id → 0
  const ownerN = n(await owner<Array<{ n: number }>>`SELECT count(*)::int AS n FROM purchases`);                                 // owner bypass → all

  const results: Array<[string, boolean]> = [
    ['app · no tenant context → DENY-ALL (0)', noCtx === 0],
    ['app · correct tenant context → sees row (>=1)', right >= 1],
    ['app · other-tenant context → 0 (RLS isolates)', wrong === 0],
    ['app · forged by-id cross-tenant → 0 (RLS backstop)', forged === 0],
    ['owner bypass → sees all (>=1)', ownerN >= 1],
  ];
  for (const [m, ok] of results) console.log(`${ok ? '✅' : '❌'} ${m}`);
  console.log(`   (noCtx=${noCtx} right=${right} wrong=${wrong} forged=${forged} owner=${ownerN})`);
  const pass = results.every(([, ok]) => ok);
  console.log(pass ? '\n✅ RLS CONTEXT-PROXY PROOF PASS (5/5)' : '\n❌ FAIL');
  if (!pass) process.exit(1);
}
main().then(async () => { await sql.end(); await owner.end(); }).catch(async (e) => { console.error(String(e).slice(0, 300)); await owner.end().catch(() => {}); process.exit(1); });

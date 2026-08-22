/**
 * A new customer must not land with an empty template shelf (bug log B34).
 *
 * The chain is TEMPLATE_CATALOG (TypeScript) → syncTemplateStableFromCatalog → master_templates →
 * template_bridge → backfillTenantTemplates → tenant_template_cards. The sync was reachable only
 * from an admin clicking a button, so on a database nobody had clicked it on every link downstream
 * was empty. `backfillTenantTemplates` read zero heads, applied zero, returned 0, and every
 * caller's best-effort try/catch treated that as success. Live on a box built from migration 001:
 * `master_templates=0  template_bridge=0  tenant_template_cards=0` — on every tenant, including
 * ours. Each customer's proposal molds were invisible to them, with nothing saying so.
 *
 * The catalog is the contract these lock. The self-heal itself is proven against the live
 * database (39/39 seeded, 7 tenants × 39 cards); what a unit test can hold still is that the
 * catalog stays coherent, because the self-heal seeds exactly what the catalog declares — a
 * catalog entry with no body would seed as an `error` and silently shrink the shelf.
 */
import { describe, it, expect } from 'vitest';
import { TEMPLATE_CATALOG, getTemplate } from '@/lib/templates';

describe('template catalog — what the stable self-heal seeds', () => {
  it('is not empty, or a customer has nothing to start from', () => {
    expect(TEMPLATE_CATALOG.length).toBeGreaterThan(0);
  });

  it('every entry resolves to a real template body', () => {
    // `syncTemplateStableFromCatalog` records `action: 'error'` and skips an entry whose body is
    // missing. That failure is logged, but the shelf just comes out shorter — so the catalog is
    // checked here, where it is cheap, instead of being discovered as an absence later.
    const bodyless = TEMPLATE_CATALOG.filter((e) => !getTemplate(e.key));
    expect(bodyless.map((e) => e.key)).toEqual([]);
  });

  it('has no duplicate keys — template_key is uniquely indexed', () => {
    // A duplicate would insert once and then collide on `master_templates_template_key_key`,
    // turning one catalog entry into a logged error for reasons no reader would connect to the
    // catalog. Cheaper to refuse it here.
    const keys = TEMPLATE_CATALOG.map((e) => e.key);
    expect(keys).toHaveLength(new Set(keys).size);
  });

  it('declares a format the exporters can actually render', () => {
    const formats = new Set(TEMPLATE_CATALOG.map((e) => e.format));
    for (const f of formats) expect(['document', 'deck', 'spreadsheet']).toContain(f);
  });

  it('gives every entry a title and a category, since both reach the customer', () => {
    for (const e of TEMPLATE_CATALOG) {
      expect(e.title?.trim(), `${e.key} title`).toBeTruthy();
      expect(e.category?.trim(), `${e.key} category`).toBeTruthy();
    }
  });
});

/**
 * Template bridge — the L0→L1 spine for the pristine-template stable (mig 177),
 * a 1:1 mirror of the opportunity-card bridge (lib/opportunity-bridge.ts, mig 094).
 *
 * The bridge is the SOLE admin→customer coupling for templates: an admin publishes a
 * forward-only template VERSION to `template_bridge` (global, append-only); the consumer
 * fans that version out to a denormalized `tenant_template_cards` row for EVERY tenant
 * (all-templates replication). Tenant cards carry no FK to the master, so every tenant
 * OWNS a copy of every template — a customer's shelf can never change/break under them,
 * and an admin can only push a NEW version forward that they opt into. Once a template is
 * instantiated into a doc, that doc is the artifact; the template stays skeleton-only.
 *
 * Design: docs/TEMPLATE_BRIDGE_DESIGN.md.
 */

import { sql } from '@/lib/db';
import { withTenant } from '@/lib/rls';
import { emitEventSingle, systemActor } from '@/lib/events';

const jsonParam = (v: unknown) => sql.json(v as Parameters<typeof sql.json>[0]);

export type TemplateBridgeEventType = 'published' | 'updated' | 'deprecated' | 'republished';

/** The full customer-visible template snapshot copied at a bridge version. */
export interface TemplateSnapshot {
  templateKey: string;
  title: string;
  category: string;
  agency: string | null;
  format: string;
  version: number;
  status: string;
  /** the pristine CanvasDocument body ({anchor}-only). */
  canvasDocument: unknown;
}

export interface TemplateBridgeEvent {
  id: string;
  templateId: string;
  version: number;
  eventType: TemplateBridgeEventType;
  snapshot: TemplateSnapshot;
}

/** Build the copy payload from a master template row. */
export async function buildTemplateSnapshot(templateId: string): Promise<TemplateSnapshot | null> {
  const [m] = await sql<Array<{
    templateKey: string; title: string; category: string; agency: string | null;
    format: string; version: number; status: string; canvasDocument: unknown;
  }>>`
    SELECT template_key, title, category, agency, format, version, status, canvas_document
    FROM master_templates WHERE id = ${templateId}::uuid
  `;
  if (!m) return null;
  return {
    templateKey: m.templateKey, title: m.title, category: m.category, agency: m.agency,
    format: m.format, version: m.version, status: m.status, canvasDocument: m.canvasDocument,
  };
}

/** Publish a forward-only template version to the bridge (admin push / version-up). */
export async function publishTemplate(
  templateId: string,
  eventType: TemplateBridgeEventType,
  postedBy: string | null,
): Promise<TemplateBridgeEvent | null> {
  const snapshot = await buildTemplateSnapshot(templateId);
  if (!snapshot) return null;
  // Race-safe monotonic version — UNIQUE(template_id, version) lets exactly one concurrent
  // publish win; the loser's empty RETURNING triggers a recompute-and-retry (mirrors the OPP bridge).
  try {
    for (let attempt = 0; attempt < 6; attempt++) {
      const [row] = await sql<Array<{ id: string; version: number }>>`
        INSERT INTO template_bridge (template_id, version, event_type, template, posted_by)
        SELECT ${templateId}::uuid,
               COALESCE((SELECT max(version) FROM template_bridge WHERE template_id = ${templateId}::uuid), 0) + 1,
               ${eventType}, ${jsonParam(snapshot)}, ${postedBy}
        ON CONFLICT (template_id, version) DO NOTHING
        RETURNING id, version
      `;
      if (row) return { id: row.id, templateId, version: row.version, eventType, snapshot };
    }
    console.error('[tpl-bridge] publishTemplate exhausted version-allocation retries', templateId);
    return null;
  } catch (e) {
    console.error('[tpl-bridge] publishTemplate failed', e);
    return null;
  }
}

/** Upsert one tenant's owned copy from a bridge event (tenant-scoped via RLS GUC). */
async function applyTemplateToTenant(tenantId: string, ev: TemplateBridgeEvent): Promise<void> {
  const s = ev.snapshot;
  // Forward-only apply: a stale (lower-or-equal bridge_version) event must NOT overwrite a newer
  // card. `WHERE EXCLUDED.bridge_version > current` makes a stale apply a no-op; a newer version on
  // an EXISTING card raises update_available so the tenant can resync the skeleton (instances untouched).
  const applied = await withTenant(tenantId, async (tx) => {
    const rows = await tx`
      INSERT INTO tenant_template_cards
        (tenant_id, template_id, template, bridge_version, template_key, title, category, agency, format)
      VALUES (${tenantId}::uuid, ${ev.templateId}::uuid, ${jsonParam(s)}, ${ev.version},
              ${s.templateKey}, ${s.title}, ${s.category}, ${s.agency}, ${s.format})
      ON CONFLICT (tenant_id, template_id) DO UPDATE SET
        template = EXCLUDED.template,
        bridge_version = EXCLUDED.bridge_version,
        template_key = EXCLUDED.template_key,
        title = EXCLUDED.title,
        category = EXCLUDED.category,
        agency = EXCLUDED.agency,
        format = EXCLUDED.format,
        update_available = CASE
          WHEN EXCLUDED.bridge_version > tenant_template_cards.bridge_version THEN true
          ELSE tenant_template_cards.update_available END,
        updated_at = now()
      WHERE EXCLUDED.bridge_version > tenant_template_cards.bridge_version
      RETURNING tenant_id
    `;
    return rows.length > 0;
  });
  if (!applied) return;
  // Announce the template landed in the tenant's owned shelf (best-effort — never fails the fan-out).
  try {
    await emitEventSingle({
      namespace: 'library',
      type: 'template.applied',
      actor: systemActor('template-bridge'),
      tenantId,
      payload: { tenantId, templateId: ev.templateId, templateKey: s.templateKey, version: ev.version },
    });
  } catch (emitErr) {
    console.error('[tpl-bridge] template.applied emit failed (non-fatal)', tenantId, emitErr);
  }
}

/** Fan a published template version out to every subscribed tenant (all-templates replication). */
export async function fanOutTemplate(ev: TemplateBridgeEvent): Promise<number> {
  let tenants: Array<{ id: string }> = [];
  try {
    tenants = await sql<Array<{ id: string }>>`SELECT id FROM tenants WHERE status IN ('active','trial')`;
  } catch (e) {
    console.error('[tpl-bridge] fan-out tenant list failed', e);
    return 0;
  }
  let applied = 0;
  for (const t of tenants) {
    try { await applyTemplateToTenant(t.id, ev); applied++; }
    catch (e) { console.error('[tpl-bridge] fan-out to tenant failed', t.id, e); }
  }
  return applied;
}

/** Publish + fan out in one call (the admin push / version-up path). */
export async function publishAndFanOutTemplate(
  templateId: string,
  eventType: TemplateBridgeEventType,
  postedBy: string | null,
): Promise<{ event: TemplateBridgeEvent; tenantsApplied: number } | null> {
  const event = await publishTemplate(templateId, eventType, postedBy);
  if (!event) return null;
  const tenantsApplied = await fanOutTemplate(event);
  return { event, tenantsApplied };
}

/** New-tenant backfill: apply the latest bridge version of EVERY template to a tenant (100% copy on creation). */
export async function backfillTenantTemplates(tenantId: string): Promise<number> {
  const readHeads = async () => sql`
      SELECT DISTINCT ON (template_id)
             id, template_id AS "templateId", version, event_type AS "eventType", template AS snapshot
      FROM template_bridge
      ORDER BY template_id, version DESC
    ` as Promise<Array<{ id: string; templateId: string; version: number; eventType: TemplateBridgeEventType; snapshot: TemplateSnapshot }>>;

  let heads: Awaited<ReturnType<typeof readHeads>> = [];
  try {
    heads = await readHeads();
  } catch (e) {
    console.error('[tpl-bridge] backfill head query failed', e);
    return 0;
  }

  // AN EMPTY STABLE IS AN ANOMALY, NOT AN ANSWER (bug log B34).
  //
  // The chain is TEMPLATE_CATALOG (39 entries, in TypeScript) → syncTemplateStableFromCatalog →
  // master_templates → template_bridge → here. The sync was reachable ONLY from an admin clicking
  // /admin/template-stable/sync, so on a database nobody had clicked it on, every link downstream
  // was empty — and this function read zero heads, applied zero, returned 0, and every caller's
  // best-effort try/catch treated that as success. Confirmed live on a box built from migration
  // 001: `master_templates=0  template_bridge=0  tenant_template_cards=0`, on every tenant
  // including our own. The customer lands and every proposal mold the product ships is invisible
  // to them, with nothing anywhere saying so.
  //
  // Seeding the catalog in SQL would duplicate 39 canvas bodies that live in TypeScript and let
  // the two drift. Self-healing here keeps ONE source of truth and repairs whatever provisions
  // next: the sync is idempotent (it change-detects against the stored body), `template_key` is
  // uniquely indexed so a concurrent double-run cannot double-insert, and it costs one pass — the
  // moment master is populated the check below short-circuits forever. `publishAndFanOutTemplate`
  // inside the sync also fans to tenants that already exist, so this repairs the ones provisioned
  // while the stable was empty, not only the one being provisioned now.
  if (heads.length === 0) {
    try {
      const [{ n }] = await sql<Array<{ n: number }>>`SELECT count(*)::int AS n FROM master_templates`;
      if (n === 0) {
        console.error('[tpl-bridge] template stable is EMPTY — seeding from TEMPLATE_CATALOG before backfill (B34)');
        const { syncTemplateStableFromCatalog } = await import('@/lib/template-stable-sync');
        const results = await syncTemplateStableFromCatalog(null);
        const failed = results.filter((r) => r.action === 'error');
        console.error(`[tpl-bridge] stable seeded: ${results.length - failed.length}/${results.length} templates`
          + (failed.length ? ` — ${failed.length} FAILED: ${failed.map((f) => f.key).join(', ')}` : ''));
        heads = await readHeads();
      }
    } catch (e) {
      // Never fail a provision over this — the tenant is still usable, just template-less, and the
      // line below makes that visible rather than silent.
      console.error('[tpl-bridge] stable self-heal failed', e);
    }
  }

  let applied = 0;
  for (const h of heads) {
    try { await applyTemplateToTenant(tenantId, h); applied++; }
    catch (e) { console.error('[tpl-bridge] backfill apply failed', h.templateId, e); }
  }
  // Say so when a tenant ends up with nothing. "Found nothing and succeeded" is the shape this bug
  // hid inside for as long as it existed.
  if (applied === 0) {
    console.error('[tpl-bridge] backfill applied 0 templates to tenant', tenantId,
      `— ${heads.length} bridge head(s) available. This tenant has an EMPTY template shelf.`);
  }
  return applied;
}

/** Forward-only catch-up: apply only the template heads this tenant is BEHIND on (self-healing read-repair). */
export async function reconcileTenantTemplates(tenantId: string): Promise<number> {
  let behind: Array<{ id: string; templateId: string; version: number; eventType: TemplateBridgeEventType; snapshot: TemplateSnapshot }> = [];
  try {
    behind = await withTenant(tenantId, async (tx) => tx`
      SELECT DISTINCT ON (b.template_id)
             b.id, b.template_id AS "templateId", b.version, b.event_type AS "eventType", b.template AS snapshot
      FROM template_bridge b
      LEFT JOIN tenant_template_cards c
        ON c.tenant_id = ${tenantId}::uuid AND c.template_id = b.template_id
      WHERE c.template_id IS NULL OR b.version > c.bridge_version
      ORDER BY b.template_id, b.version DESC
    `) as typeof behind;
  } catch (e) {
    console.error('[tpl-bridge] reconcile head query failed', tenantId, e);
    return 0;
  }
  let applied = 0;
  for (const h of behind) {
    try { await applyTemplateToTenant(tenantId, h); applied++; }
    catch (e) { console.error('[tpl-bridge] reconcile apply failed', h.templateId, e); }
  }
  if (applied > 0) console.info('[tpl-bridge] reconciled tenant %s: %d template(s) caught up', tenantId, applied);
  return applied;
}

/**
 * Template-stable sync — the productized seed (template bridge Phase 3,
 * docs/TEMPLATE_BRIDGE_DESIGN.md). Materializes the lib/templates code catalog
 * into master_templates, then publishes NEW-or-CHANGED masters to the bridge and
 * fans them out to every tenant. Unchanged masters are skipped (no version churn).
 *
 * This is the admin "push new / version-up old" mechanism: adding or editing a
 * catalog entry and syncing lands it on every tenant's owned shelf as a forward
 * version (existing instances untouched — the skeleton is reusable, the artifact
 * is frozen).
 *
 * Admin/platform-scope: cross-tenant writes via the owner pool.
 */
import { sqlBypass as sql } from '@/lib/db';
import { TEMPLATE_CATALOG, getTemplate } from '@/lib/templates';
import { publishAndFanOutTemplate } from '@/lib/template-bridge';

const jsonParam = (v: unknown) => sql.json(v as Parameters<typeof sql.json>[0]);

// Catalog category → agency label (mirrors scripts/seed-template-masters.mts).
const AGENCY: Record<string, string | null> = {
  dod_dow: 'DoD/DoW', nsf: 'NSF', doe: 'DOE',
  marketing: null, commercialization: null, investment: null,
  tech: null, company: null, grants: null,
};

export type SyncAction = 'created' | 'updated' | 'unchanged' | 'error';

export interface TemplateSyncResult {
  key: string;
  title: string;
  action: SyncAction;
  version?: number;        // the new bridge version (created/updated)
  tenantsApplied?: number; // fan-out reach (created/updated)
  error?: string;
}

/**
 * Sync every catalog entry into master_templates + the bridge. NEW masters publish
 * as 'published'; CHANGED masters bump the master version and publish as 'updated';
 * UNCHANGED masters are a no-op. Best-effort per entry — one failure never aborts the rest.
 */
export async function syncTemplateStableFromCatalog(postedBy: string | null): Promise<TemplateSyncResult[]> {
  const results: TemplateSyncResult[] = [];
  for (const entry of TEMPLATE_CATALOG) {
    const doc = getTemplate(entry.key);
    if (!doc) { results.push({ key: entry.key, title: entry.title, action: 'error', error: 'no template body' }); continue; }
    try {
      // Change-detect against the stored master body so a re-sync doesn't churn versions.
      const [existing] = await sql<Array<{ id: string; changed: boolean }>>`
        SELECT id, (canvas_document IS DISTINCT FROM ${jsonParam(doc)}) AS changed
        FROM master_templates WHERE template_key = ${entry.key}
      `;

      let templateId: string;
      let action: Exclude<SyncAction, 'unchanged' | 'error'>;
      if (!existing) {
        const [row] = await sql<Array<{ id: string }>>`
          INSERT INTO master_templates (template_key, title, category, agency, format, canvas_document, version, status)
          VALUES (${entry.key}, ${entry.title}, ${entry.category}, ${AGENCY[entry.category] ?? null},
                  ${entry.format}, ${jsonParam(doc)}, 1, 'active')
          RETURNING id
        `;
        templateId = row.id;
        action = 'created';
      } else if (existing.changed) {
        await sql`
          UPDATE master_templates SET
            title = ${entry.title}, category = ${entry.category}, agency = ${AGENCY[entry.category] ?? null},
            format = ${entry.format}, canvas_document = ${jsonParam(doc)},
            version = version + 1, updated_at = now()
          WHERE id = ${existing.id}::uuid
        `;
        templateId = existing.id;
        action = 'updated';
      } else {
        results.push({ key: entry.key, title: entry.title, action: 'unchanged' });
        continue;
      }

      const res = await publishAndFanOutTemplate(templateId, action === 'created' ? 'published' : 'updated', postedBy);
      results.push({ key: entry.key, title: entry.title, action, version: res?.event.version, tenantsApplied: res?.tenantsApplied ?? 0 });
    } catch (e) {
      console.error('[template-stable-sync] failed for', entry.key, e);
      results.push({ key: entry.key, title: entry.title, action: 'error', error: e instanceof Error ? e.message : 'sync failed' });
    }
  }
  return results;
}

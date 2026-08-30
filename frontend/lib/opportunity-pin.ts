/**
 * Pin = full copy (greenfield, mig 094/095). Pinning a card copies the global
 * read-only opportunity folder into the tenant's own space and records the manifest
 * on the card, so the customer owns a local, shard-safe copy. A pushed update sets
 * pin_update_available; resync re-copies and clears the flag.
 */

import { sql } from '@/lib/db';
import { withTenant } from '@/lib/rls';
import { copyObject } from '@/lib/storage/s3-client';
import { customerPinnedPath } from '@/lib/storage/paths';
import { copyCorpusInward, type BridgeEvent } from '@/lib/opportunity-bridge';

/**
 * Copy the solicitation TEXT into the tenant's own rows, alongside the object copy (mig 239).
 *
 * Pin already meant "make me a local copy of the folder". The text is the other half of that: the
 * objects are what a person opens, the extracted text is what the product can search, quote and
 * draft from. Until mig 239 the text was copied at fan-out for every holder whether or not anyone
 * opened it; here it arrives because someone asked.
 *
 * Best-effort. A corpus failure must not fail the pin — the files are already copied and the
 * manifest on the card still says what exists, so a resync re-drives it.
 */
async function copyPinnedText(tenantId: string, opportunityId: string): Promise<number> {
  try {
    // The corpus copier is keyed on a bridge event because it stamps `bridge_version`, which is
    // what makes a resync after an amendment REPLACE the text rather than layer it. Read the head
    // version rather than inventing one: a copy stamped 0 would look permanently stale.
    const [head] = await sql<Array<{ id: string; version: number }>>`
      SELECT id, version FROM opportunity_bridge
      WHERE opportunity_id = ${opportunityId}::uuid ORDER BY version DESC LIMIT 1`;
    if (!head) return 0;
    const ev = { id: head.id, opportunityId, version: head.version, eventType: 'updated', card: null } as unknown as BridgeEvent;
    return await copyCorpusInward(tenantId, ev);
  } catch (e) {
    console.error('[pin] text copy failed (non-fatal)', tenantId, opportunityId, e);
    return 0;
  }
}

export interface PinnedDoc {
  filename: string;
  key: string;          // destination key in the tenant's pinned folder
  documentType: string;
  sourceKey: string;
}

/** Copy the opportunity's global docs into the tenant's pinned folder. Best-effort per file. */
async function copyOppFolder(tenantSlug: string, opportunityId: string): Promise<PinnedDoc[]> {
  let docs: Array<{ storageKey: string; originalFilename: string; documentType: string }> = [];
  try {
    docs = await sql<Array<{ storageKey: string; originalFilename: string; documentType: string }>>`
      SELECT sd.storage_key, sd.original_filename, sd.document_type
      FROM solicitation_documents sd
      JOIN opportunities o ON o.solicitation_id = sd.solicitation_id
      WHERE o.id = ${opportunityId}::uuid
      ORDER BY (sd.document_type = 'source') DESC, sd.created_at ASC
    `;
  } catch (e) {
    console.error('[pin] doc list failed', e);
    return [];
  }
  const copied: PinnedDoc[] = [];
  for (const d of docs) {
    try {
      const destKey = customerPinnedPath(tenantSlug, opportunityId, d.originalFilename);
      await copyObject({ sourceKey: d.storageKey, destKey });
      copied.push({ filename: d.originalFilename, key: destKey, documentType: d.documentType, sourceKey: d.storageKey });
    } catch (e) {
      console.error('[pin] copy failed for', d.storageKey, e);
    }
  }
  return copied;
}

/** Pin a card: flip is_pinned, copy the opp folder, record the manifest, clear the update flag. */
export async function pinCard(tenantId: string, tenantSlug: string, opportunityId: string): Promise<{ pinned: boolean; docs: PinnedDoc[] }> {
  // Confirm the card exists for this tenant (RLS-scoped).
  const exists = await withTenant(tenantId, async (tx) => {
    const rows = await tx<Array<{ id: string }>>`
      SELECT id FROM tenant_opportunity_cards
      WHERE tenant_id = ${tenantId}::uuid AND opportunity_id = ${opportunityId}::uuid LIMIT 1
    `;
    return rows.length > 0;
  });
  if (!exists) return { pinned: false, docs: [] };

  const docs = await copyOppFolder(tenantSlug, opportunityId);
  // The other half of the copy: the extracted TEXT, into the tenant's own rows (mig 239).
  await copyPinnedText(tenantId, opportunityId);

  await withTenant(tenantId, async (tx) => {
    await tx`
      UPDATE tenant_opportunity_cards
      SET is_pinned = true, pinned_at = COALESCE(pinned_at, now()),
          pin_update_available = false, pinned_docs = ${sql.json(docs as unknown as Parameters<typeof sql.json>[0])}
      WHERE tenant_id = ${tenantId}::uuid AND opportunity_id = ${opportunityId}::uuid
    `;
  });
  return { pinned: true, docs };
}

/** Resync a pinned card after a pushed update: re-copy the folder + clear the flag. */
export async function resyncPinnedCard(tenantId: string, tenantSlug: string, opportunityId: string): Promise<{ docs: PinnedDoc[] }> {
  const docs = await copyOppFolder(tenantSlug, opportunityId);
  // Re-copy the text too, forward-only against the new bridge version — an amendment that replaced
  // a document must replace the tenant's copy of its text, not leave the superseded one in place.
  await copyPinnedText(tenantId, opportunityId);
  await withTenant(tenantId, async (tx) => {
    await tx`
      UPDATE tenant_opportunity_cards
      SET pin_update_available = false, pinned_docs = ${sql.json(docs as unknown as Parameters<typeof sql.json>[0])}, updated_at = now()
      WHERE tenant_id = ${tenantId}::uuid AND opportunity_id = ${opportunityId}::uuid AND is_pinned = true
    `;
  });
  return { docs };
}

/** Unpin (forward-looking): flip the flag. The already-copied folder is retained (audited, cleaned on archive). */
export async function unpinCard(tenantId: string, opportunityId: string): Promise<void> {
  await withTenant(tenantId, async (tx) => {
    await tx`
      UPDATE tenant_opportunity_cards
      SET is_pinned = false, pin_update_available = false
      WHERE tenant_id = ${tenantId}::uuid AND opportunity_id = ${opportunityId}::uuid
    `;
  });
}

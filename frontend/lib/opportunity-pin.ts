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

/**
 * A pointer to something the tenant ACTUALLY HOLDS.
 *
 * ── THE RULE ─────────────────────────────────────────────────────────────────────────────────
 * An entry exists here only when the copy landed. Never a pointer to a copy that was going to be
 * made, or that failed — a card that lists a local file it does not have sends a customer to an
 * empty folder and calls it their copy.
 *
 * It lives in the `pinned_docs` COLUMN and not inside the `card` jsonb, and that is not incidental:
 * the fan-out replaces `card` wholesale on every revision, so anything tenant-owned written into it
 * is destroyed the next time the organization publishes. The row is the mirrorable item; `card` is
 * the part of it that mirrors, and `pinned_docs` / `is_pinned` / `pinned_at` / `pursuit_status` are
 * the parts that are the tenant's own and survive.
 */
export interface PinnedDoc {
  filename: string;
  key: string;          // destination key in the tenant's pinned folder
  documentType: string;
  sourceKey: string;
  /** True when the extracted TEXT also landed, in tenant_opportunity_documents (mig 239). */
  hasText?: boolean;
}

export type PinRefusal = 'not_found' | 'copy_failed';

export interface PinResult {
  pinned: boolean;
  docs: PinnedDoc[];
  /** How many documents the ORGANIZATION publishes — what a complete copy would hold. */
  expected: number;
  reason?: PinRefusal;
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

/** How many documents does the organization publish for this opportunity? */
async function publishedDocCount(opportunityId: string): Promise<number> {
  try {
    const [r] = await sql<Array<{ n: number }>>`
      SELECT count(*)::int AS n FROM solicitation_documents sd
      JOIN opportunities o ON o.solicitation_id = sd.solicitation_id
      WHERE o.id = ${opportunityId}::uuid`;
    return Number(r?.n ?? 0);
  } catch (e) {
    console.error('[pin] published doc count failed', opportunityId, e);
    return 0;
  }
}

/**
 * Pin a card: copy the opp folder AND its text, record what actually landed, clear the update flag.
 *
 * ── IT REFUSES RATHER THAN CLAIMING A COPY IT DOES NOT HAVE ──────────────────────────────────
 * It used to flip `is_pinned` unconditionally. Measured: pinning an opportunity whose objects are
 * missing from storage returned `{pinned: true, docs: []}` and set `pinned_at`, leaving a card that
 * says the tenant holds a local copy of nothing.
 *
 * The distinction that matters is between an EMPTY publication and a FAILED copy, and they look
 * identical from the outside:
 *
 *   the organization publishes nothing   →  pin succeeds, holds nothing, honestly. Pinning is
 *                                           still meaningful: the tenant is tracking the opp.
 *   it publishes N and some landed       →  pin succeeds, and pinned_docs lists exactly those.
 *   it publishes N and NONE landed       →  REFUSE. A retryable failure must not become a
 *                                           permanent pin pointing at an empty folder.
 */
export async function pinCard(tenantId: string, tenantSlug: string, opportunityId: string): Promise<PinResult> {
  // Confirm the card exists for this tenant (RLS-scoped).
  const exists = await withTenant(tenantId, async (tx) => {
    const rows = await tx<Array<{ id: string }>>`
      SELECT id FROM tenant_opportunity_cards
      WHERE tenant_id = ${tenantId}::uuid AND opportunity_id = ${opportunityId}::uuid LIMIT 1
    `;
    return rows.length > 0;
  });
  if (!exists) return { pinned: false, docs: [], expected: 0, reason: 'not_found' };

  const expected = await publishedDocCount(opportunityId);
  const docs = await copyOppFolder(tenantSlug, opportunityId);
  // The other half of the copy: the extracted TEXT, into the tenant's own rows (mig 239).
  const textRows = await copyPinnedText(tenantId, opportunityId);

  // Nothing landed where something was published. Do not record a pin.
  if (expected > 0 && docs.length === 0 && textRows === 0) {
    console.error('[pin] refusing to pin: %d document(s) published, none copied', expected, opportunityId);
    return { pinned: false, docs: [], expected, reason: 'copy_failed' };
  }

  // Which of the copied files also have their text locally — so ONE tenant-owned field answers
  // "what do I actually hold", without a join.
  const withText = await withTenant(tenantId, async (tx) => {
    const rows = await tx<Array<{ originalFilename: string }>>`
      SELECT original_filename FROM tenant_opportunity_documents
      WHERE tenant_id = ${tenantId}::uuid AND opportunity_id = ${opportunityId}::uuid`;
    return new Set(rows.map((r: { originalFilename: string }) => r.originalFilename));
  });
  const recorded: PinnedDoc[] = docs.map((d) => ({ ...d, hasText: withText.has(d.filename) }));

  await withTenant(tenantId, async (tx) => {
    await tx`
      UPDATE tenant_opportunity_cards
      SET is_pinned = true, pinned_at = COALESCE(pinned_at, now()),
          pin_update_available = false, pinned_docs = ${sql.json(recorded as unknown as Parameters<typeof sql.json>[0])}
      WHERE tenant_id = ${tenantId}::uuid AND opportunity_id = ${opportunityId}::uuid
    `;
  });
  return { pinned: true, docs: recorded, expected };
}

/** Resync a pinned card after a pushed update: re-copy the folder + clear the flag. */
export async function resyncPinnedCard(
  tenantId: string, tenantSlug: string, opportunityId: string,
): Promise<{ docs: PinnedDoc[]; expected: number; rewrote: boolean }> {
  const expected = await publishedDocCount(opportunityId);
  const docs = await copyOppFolder(tenantSlug, opportunityId);
  // Re-copy the text too, forward-only against the new bridge version — an amendment that replaced
  // a document must replace the tenant's copy of its text, not leave the superseded one in place.
  await copyPinnedText(tenantId, opportunityId);

  /**
   * A WITHDRAWAL and a FAILED COPY produce the same empty result, and they need opposite handling.
   *
   *   expected === 0            the organization withdrew everything. Clearing pinned_docs is
   *                             correct — the tenant's record should stop listing files that are
   *                             no longer published.
   *   expected > 0, none landed a transient copy failure. Overwriting with [] would erase the
   *                             record of files the tenant STILL HAS on disk, turning a retryable
   *                             failure into permanent data loss from the customer's point of view.
   *
   * So the write happens only when it is one of those two, and never on the third.
   */
  const rewrote = expected === 0 || docs.length > 0;
  if (!rewrote) {
    console.error('[pin] resync copied nothing though %d published — LEAVING pinned_docs intact', expected, opportunityId);
    // The update flag stays SET: the tenant is still behind, and telling them they are current
    // when the resync failed is the same lie in a different field.
    return { docs: [], expected, rewrote: false };
  }

  const withText = await withTenant(tenantId, async (tx) => {
    const rows = await tx<Array<{ originalFilename: string }>>`
      SELECT original_filename FROM tenant_opportunity_documents
      WHERE tenant_id = ${tenantId}::uuid AND opportunity_id = ${opportunityId}::uuid`;
    return new Set(rows.map((r: { originalFilename: string }) => r.originalFilename));
  });
  const recorded: PinnedDoc[] = docs.map((d) => ({ ...d, hasText: withText.has(d.filename) }));

  await withTenant(tenantId, async (tx) => {
    await tx`
      UPDATE tenant_opportunity_cards
      SET pin_update_available = false, pinned_docs = ${sql.json(recorded as unknown as Parameters<typeof sql.json>[0])}, updated_at = now()
      WHERE tenant_id = ${tenantId}::uuid AND opportunity_id = ${opportunityId}::uuid AND is_pinned = true
    `;
  });
  return { docs: recorded, expected, rewrote: true };
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

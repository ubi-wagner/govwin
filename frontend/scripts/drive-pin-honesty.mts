/**
 * drive-pin-honesty — a local-copy pointer exists only when the local copy does.
 *
 * The OPP card is a mirrorable row. `card` is the half that mirrors and is replaced wholesale on
 * every fan-out; `pinned_docs` / `is_pinned` / `pinned_at` / `pursuit_status` are the tenant's own
 * and survive it. This drives the invariant that binds the two halves:
 *
 *     A POINTER TO A LOCAL COPY EXISTS ONLY WHEN THAT COPY DOES.
 *
 * It exists because the opposite shipped. Measured before the fix: pinning an opportunity whose
 * objects are missing from storage returned `{pinned: true, docs: []}` and set `pinned_at` — a card
 * claiming a local copy of nothing, and a customer sent to an empty folder.
 *
 * The hard part is that a WITHDRAWAL and a FAILED COPY look identical from outside — both produce
 * zero files — and they need opposite handling. Both are asserted here.
 *
 * ⚠️ NOT read-only: it pins and unpins, and stages one document row. Sandbox only; it restores.
 *
 * Usage:  node --import tsx frontend/scripts/drive-pin-honesty.mts
 */

import postgres from 'postgres';

const OWNER = process.env.DATABASE_URL_OWNER ?? 'postgresql://govtech:changeme@localhost:5432/govtech_intel';
const owner = postgres(OWNER, { transform: { column: { from: postgres.toCamel, to: postgres.fromCamel } }, max: 4 });

let failures = 0;
const ok = (label: string, pass: boolean, detail = '') => {
  console.log(`${pass ? '  ✓' : '  ✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!pass) failures++;
};

async function main() {
  console.log('\ndrive-pin-honesty — a pointer exists only when the copy does\n');
  const { pinCard, resyncPinnedCard, unpinCard } = await import('../lib/opportunity-pin.ts');

  const [card] = await owner<Array<{ tenantId: string; opportunityId: string; slug: string; solId: string | null }>>`
    SELECT c.tenant_id, c.opportunity_id, t.slug, o.solicitation_id AS sol_id
    FROM tenant_opportunity_cards c
    JOIN tenants t ON t.id = c.tenant_id
    JOIN opportunities o ON o.id = c.opportunity_id
    WHERE c.archived_at IS NULL AND NOT c.is_pinned AND o.solicitation_id IS NOT NULL
    ORDER BY c.created_at LIMIT 1`;
  if (!card) { console.error('HARNESS CANNOT RUN: no unpinned card with a solicitation'); process.exit(2); }

  const held = async () => (await owner<Array<{ isPinned: boolean; pinnedAt: Date | null; docs: unknown[]; text: number }>>`
    SELECT c.is_pinned, c.pinned_at, c.pinned_docs AS docs,
           (SELECT count(*)::int FROM tenant_opportunity_documents d
             WHERE d.tenant_id = c.tenant_id AND d.opportunity_id = c.opportunity_id) AS text
    FROM tenant_opportunity_cards c
    WHERE c.tenant_id = ${card.tenantId}::uuid AND c.opportunity_id = ${card.opportunityId}::uuid`)[0];

  // ── 1 · Nothing published — a pin is honest and holds nothing ───────────────────────────────
  console.log('1 · the organization publishes NOTHING');
  const [pubCount] = await owner<Array<{ n: number }>>`
    SELECT count(*)::int AS n FROM solicitation_documents WHERE solicitation_id = ${card.solId}::uuid`;
  ok('fixture: this solicitation publishes no documents', Number(pubCount.n) === 0, `${pubCount.n}`);

  const empty = await pinCard(card.tenantId, card.slug, card.opportunityId);
  const s1 = await held();
  ok('the pin SUCCEEDS — tracking an opportunity is meaningful with no files', empty.pinned);
  ok('and it holds nothing, honestly', Array.isArray(s1.docs) && s1.docs.length === 0 && Number(s1.text) === 0,
    `${(s1.docs as unknown[]).length} doc(s) · ${s1.text} text row(s)`);
  await unpinCard(card.tenantId, card.opportunityId);
  await owner`UPDATE tenant_opportunity_cards SET pinned_at = NULL, pinned_docs = '[]'::jsonb
              WHERE tenant_id = ${card.tenantId}::uuid AND opportunity_id = ${card.opportunityId}::uuid`;

  // ── 2 · RED — something published, nothing copyable ─────────────────────────────────────────
  console.log('\n2 · RED — a document IS published, and its object is missing from storage');
  const [staged] = await owner<Array<{ id: string }>>`
    INSERT INTO solicitation_documents
      (solicitation_id, document_type, original_filename, storage_key, extracted_text, extracted_at, content_hash)
    VALUES (${card.solId}::uuid, 'source', 'phantom.pdf', ${'drive/pin-honesty/absent.pdf'}, NULL, NULL, 'deadbeef')
    RETURNING id`;
  try {
    const refused = await pinCard(card.tenantId, card.slug, card.opportunityId);
    const s2 = await held();
    ok('the pin is REFUSED, not silently claimed', refused.pinned === false, `reason=${refused.reason}`);
    ok('the reason distinguishes a failed copy from a missing card',
      refused.reason === 'copy_failed', `${refused.reason}`);
    ok('it reports what a complete copy WOULD have held', Number(refused.expected) === 1, `${refused.expected}`);
    ok('is_pinned was NOT set', s2.isPinned === false);
    ok('pinned_at was NOT stamped', s2.pinnedAt === null);
    ok('no pointer was written', Array.isArray(s2.docs) && s2.docs.length === 0);

    // ── 3 · A resync that fails must not erase what the tenant already holds ──────────────────
    console.log('\n3 · a resync whose copies fail — the existing record survives');
    // Give the card a pin with a recorded pointer, as if an earlier copy had worked.
    await owner`
      UPDATE tenant_opportunity_cards
      SET is_pinned = true, pinned_at = now(), pin_update_available = true,
          pinned_docs = ${owner.json([{ filename: 'earlier.pdf', key: 'tenant/earlier.pdf', documentType: 'source', sourceKey: 'x', hasText: false }] as never)}
      WHERE tenant_id = ${card.tenantId}::uuid AND opportunity_id = ${card.opportunityId}::uuid`;
    const r = await resyncPinnedCard(card.tenantId, card.slug, card.opportunityId);
    const s3 = await held();
    ok('the resync reports it did NOT rewrite', r.rewrote === false);
    ok('the earlier pointer is still there — a retryable failure is not data loss',
      (s3.docs as Array<{ filename?: string }>)[0]?.filename === 'earlier.pdf',
      `${(s3.docs as unknown[]).length} pointer(s)`);
    const [flag] = await owner<Array<{ f: boolean }>>`
      SELECT pin_update_available AS f FROM tenant_opportunity_cards
      WHERE tenant_id = ${card.tenantId}::uuid AND opportunity_id = ${card.opportunityId}::uuid`;
    ok('and they are still told they are behind', flag.f === true);

    // ── 4 · A WITHDRAWAL looks identical and must behave oppositely ───────────────────────────
    console.log('\n4 · a WITHDRAWAL — same empty result, opposite handling');
    await owner`DELETE FROM solicitation_documents WHERE id = ${staged.id}::uuid`;
    const w = await resyncPinnedCard(card.tenantId, card.slug, card.opportunityId);
    const s4 = await held();
    ok('the resync DOES rewrite when nothing is published any more', w.rewrote === true, `expected=${w.expected}`);
    ok('and the stale pointer is cleared', Array.isArray(s4.docs) && s4.docs.length === 0,
      `${(s4.docs as unknown[]).length} pointer(s)`);
  } finally {
    await owner`DELETE FROM solicitation_documents WHERE id = ${staged.id}::uuid`;
    await owner`UPDATE tenant_opportunity_cards
                SET is_pinned = false, pinned_at = NULL, pin_update_available = false, pinned_docs = '[]'::jsonb
                WHERE tenant_id = ${card.tenantId}::uuid AND opportunity_id = ${card.opportunityId}::uuid`;
    await owner`DELETE FROM tenant_opportunity_documents
                WHERE tenant_id = ${card.tenantId}::uuid AND opportunity_id = ${card.opportunityId}::uuid`;
  }

  console.log(`\n${failures === 0 ? '✓ all checks passed' : `✗ ${failures} check(s) failed`}\n`);
  await owner.end();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error(e); await owner.end(); process.exit(1); });

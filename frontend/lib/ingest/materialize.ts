/**
 * Ingest Assist — the deterministic MATERIALIZER (DB).
 *
 * Given a PARSED solicitation (from AI parse, the default skeleton, or an admin's
 * reviewed override), write the full skeleton the rest of the product runs on —
 *   solicitation_compliance (the format contract)
 *   solicitation_volumes + volume_required_items (the section molds → matrix)
 *   opportunities + cards (one card per topic; a suite for a multi-topic solicitation)
 * — driving the product's own publish→fan-out so cards land ranked on the tenants.
 * Provisioning (provision-proposal.ts) reads exactly what this writes, so a
 * released card yields the full canvas build.
 *
 * Kept separate from the pure parse contract (skeleton.ts) so that module — and
 * the AI parser — stay DB-free and unit-testable.
 */
import { sql } from '@/lib/db';
import { publishAndFanOut } from '@/lib/opportunity-bridge';
import { DEFAULT_SBIR_CSO_SKELETON, type ParsedSolicitation } from './skeleton';

// ── CHECK-constrained enums (must match the migrations) ─────────────
const ITEM_TYPES = new Set(['word_doc', 'slide_deck', 'spreadsheet', 'pdf', 'text', 'form_sf424', 'form_sbir_certs', 'form_other', 'other']);
const VOLUME_FORMATS = new Set(['dsip_standard', 'l_and_m', 'custom']);
const PHASE_TYPES = new Set(['phase_1', 'phase_2', 'direct_to_phase_2', 'phase_3', 'cso', 'ota', 'baa', 'other']);
const coerceItemType = (t?: string) => (t && ITEM_TYPES.has(t) ? t : 'word_doc');
const coerceVolFormat = (t?: string) => (t && VOLUME_FORMATS.has(t) ? t : 'dsip_standard');
const coercePhase = (t?: string | null) => (t && PHASE_TYPES.has(t) ? t : 'phase_1');

export interface MaterializeResult {
  volumes: number; items: number; topics: number; cards: number;
}

/**
 * Materialize a parsed solicitation into the live schema for `solicitationId`
 * (a curated_solicitations.id). Idempotent: replaces the volumes/items/compliance
 * for this solicitation, upserts topic opportunities, and (optionally) publishes
 * each as a card.
 */
export async function materializeSkeleton(
  solicitationId: string,
  parsed: ParsedSolicitation,
  opts: { publish?: boolean; nowIso: string },
): Promise<MaterializeResult> {
  const publish = opts.publish ?? true;

  const [sol] = await sql<{ id: string; opportunityId: string | null; namespace: string | null }[]>`
    SELECT id, opportunity_id AS "opportunityId", namespace FROM curated_solicitations WHERE id = ${solicitationId}::uuid LIMIT 1`;
  if (!sol) throw new Error('solicitation not found');

  // ── Compliance ──
  const c = parsed.compliance ?? {};
  await sql`DELETE FROM solicitation_compliance WHERE solicitation_id = ${solicitationId}::uuid`;
  await sql`INSERT INTO solicitation_compliance
    (solicitation_id, page_limit_technical, font_family, font_size, min_font_size, margins,
     submission_format, itar_required, images_tables_allowed, required_sections, required_documents)
    VALUES (${solicitationId}::uuid, ${c.pageLimitTechnical ?? null}, ${c.fontFamily ?? null}, ${c.fontSize ?? null},
            ${c.minFontSize ?? null}, ${c.margins ?? null}, ${c.submissionFormat ?? null},
            ${c.itarRequired ?? false}, ${c.imagesTablesAllowed ?? true},
            ${sql.json(c.requiredSections ?? [])}, ${sql.json(c.requiredDocuments ?? [])})`;

  // ── Volumes + required items ──
  await sql`DELETE FROM volume_required_items WHERE volume_id IN (SELECT id FROM solicitation_volumes WHERE solicitation_id = ${solicitationId}::uuid)`;
  await sql`DELETE FROM solicitation_volumes WHERE solicitation_id = ${solicitationId}::uuid`;
  let itemCount = 0;
  const volumes = parsed.volumes?.length ? parsed.volumes : DEFAULT_SBIR_CSO_SKELETON.volumes;
  for (let v = 0; v < volumes.length; v++) {
    const vol = volumes[v];
    const [row] = await sql<{ id: string }[]>`
      INSERT INTO solicitation_volumes (solicitation_id, volume_number, volume_name, volume_format, expert_notes)
      VALUES (${solicitationId}::uuid, ${v + 1}, ${vol.name}, ${coerceVolFormat(vol.format)}, ${vol.notes ?? null}) RETURNING id`;
    let n = 0;
    for (const item of vol.items ?? []) {
      n++; itemCount++;
      await sql`INSERT INTO volume_required_items (volume_id, item_number, item_name, item_type, required, page_limit, expert_notes)
                VALUES (${row.id}::uuid, ${String(n)}, ${item.name}, ${coerceItemType(item.type)}, true, ${item.pageLimit ?? null}, ${item.notes ?? null})`;
    }
  }

  // ── Topics → opportunities → cards ──
  // No topics parsed ⇒ the solicitation's own umbrella opportunity is the single card.
  let cards = 0;
  const topics = parsed.topics ?? [];
  if (topics.length === 0) {
    if (sol.opportunityId) {
      // Review-gated: a BUILD never flips the customer-visible gate. is_active/submission_stage
      // advance to live ONLY when publish=true (the reviewed push path). A build (publish=false)
      // leaves them staged; a re-ingest never downgrades an already-live opp (OR-preserve).
      await sql`UPDATE opportunities SET solicitation_id = ${solicitationId}::uuid,
                  is_active = (is_active OR ${publish}),
                  submission_stage = CASE WHEN (is_active OR ${publish}) THEN 'open' ELSE submission_stage END
                WHERE id = ${sol.opportunityId}::uuid`;
      if (publish) { const r = await publishAndFanOut(sol.opportunityId, 'published', null, opts.nowIso); cards += r?.tenantsApplied ? 1 : 0; }
    }
  } else {
    for (const t of topics) {
      const [opp] = await sql<{ id: string }[]>`
        INSERT INTO opportunities
          (source, source_id, title, agency, office, org_unit, solicitation_number, program_type,
           topic_number, phase_type, tech_focus_areas, submission_stage, lifecycle_status,
           open_date, close_date, pre_release_date, description, solicitation_id, is_active)
        VALUES ('ingest', ${t.code}, ${t.title}, ${t.agency ?? null}, ${t.office ?? null}, ${t.office ?? null},
                ${sol.namespace ?? null}, ${t.programType ?? 'sbir_phase_1'}, ${t.code}, ${coercePhase(t.phaseType)},
                ${sql.array(t.techFocusAreas ?? [])}, ${publish ? 'open' : 'pre_release'}, 'open',
                ${t.openDate ?? null}, ${t.closeDate ?? null}, ${t.preReleaseDate ?? null},
                ${t.description ?? t.summary ?? null}, ${solicitationId}::uuid, ${publish})
        ON CONFLICT (source, source_id) DO UPDATE SET
          title = EXCLUDED.title, description = EXCLUDED.description, tech_focus_areas = EXCLUDED.tech_focus_areas,
          solicitation_id = EXCLUDED.solicitation_id,
          submission_stage = CASE WHEN (opportunities.is_active OR ${publish}) THEN 'open' ELSE opportunities.submission_stage END,
          is_active = (opportunities.is_active OR ${publish}), updated_at = now()
        RETURNING id`;
      if (publish) { const r = await publishAndFanOut(opp.id, 'published', null, opts.nowIso); cards += r?.tenantsApplied ? 1 : 0; }
    }
  }

  return { volumes: volumes.length, items: itemCount, topics: topics.length, cards };
}

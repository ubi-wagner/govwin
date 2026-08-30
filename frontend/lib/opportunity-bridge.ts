/**
 * Opportunity-card bridge — the L0→L1 spine (mig 094).
 *
 * The bridge is the SOLE admin→customer coupling: admin approval publishes a
 * forward-only card VERSION to `opportunity_bridge` (global, append-only); the
 * consumer fans that version out to a denormalized `tenant_opportunity_cards` row
 * for every subscribed tenant (all-opps replication). Tenant cards carry no FK to
 * global opportunities, so a tenant's pipeline is self-sufficient (shard-ready).
 *
 * Design: docs/OPPORTUNITY_CARD_LIFECYCLE_AND_BRIDGE_DESIGN_2026-07-01.md.
 */

import { sql, sqlBypass } from '@/lib/db';
import { withTenant } from '@/lib/rls';
import { coarseStatus, isSubmissionStage, type SubmissionStage, type BridgeEventType } from '@/lib/lifecycle';
import { emitEventSingle, emitEventStart, emitEventEnd, systemActor } from '@/lib/events';
import { scoreCardForTenant } from '@/lib/bucket-ranking';

// Re-exported so existing `import { BridgeEventType } from '@/lib/opportunity-bridge'` keeps working.
export type { BridgeEventType };

/**
 * One document of the solicitation as it reaches a tenant — the MANIFEST entry.
 *
 * The bytes are NOT here, and as of mig 239 they do not arrive at fan-out either. The manifest says
 * WHAT the organization published so a tenant can see it before deciding; `copyCorpusInward` copies
 * the text into their own `tenant_opportunity_documents` rows when they PIN.
 *
 * The documents are REFERENCE. They are not what ranks — see the header of mig 239 for the
 * measurement that settled it.
 */
export interface OppCardDoc {
  sourceDocumentId: string;
  documentType: string;
  documentLabel: string | null;
  filename: string;
  isPrimary: boolean;
  contentHash: string | null;
  pageCount: number | null;
  charCount: number;
}

/** The customer-visible face of the card (the only part that reaches a tenant). */
export interface OppCard {
  opportunityId: string;
  title: string | null;
  agency: string | null;
  office: string | null;
  orgUnit: string | null;
  solicitationNumber: string | null;
  naicsCodes: string[] | null;
  setAsideType: string | null;
  programType: string | null;
  /** Phase I vs Direct-to-Phase-II — a real discriminator for a small business, dropped until mig 238. */
  phaseType: string | null;
  /** The technology signal. Extracted by the AI shred, edited by the rfp_admin on the topic route,
   *  read by `capture_strategist` — and carried by neither the bridge nor either scorer until now. */
  techFocusAreas: string[] | null;
  /** Topic identity, on a card that IS a topic (11 of 22 opportunities carry a topic_number). */
  topicNumber: string | null;
  topicBranch: string | null;
  topicStatus: string | null;
  /** Who to ask. */
  pocName: string | null;
  pocEmail: string | null;
  classificationCode: string | null;
  /**
   * Were these dates READ from the solicitation, or inferred? (mig 240)
   *
   * `opportunities.dates_estimated` is populated on every master row and reached the card on none
   * of them. It is the dates' provenance, and this project's own rule is that *a value the product
   * did not read from the solicitation must never look like one it did* — which a close date
   * cannot honour if the flag saying it was estimated stops at the master.
   *
   * It matters most where it is least visible: a bucket's timeline factor scores a card by how
   * soon it closes, so an inferred date moves a customer's ranking exactly like a real one.
   */
  datesEstimated: boolean;
  postedDate: string | null;
  preReleaseDate: string | null;
  openDate: string | null;
  closeDate: string | null;
  awardDate: string | null;
  awardAmount: number | null;
  awardee: string | null;
  estimatedValueMin: number | null;
  estimatedValueMax: number | null;
  description: string | null;
  spotlightSummary: string | null;
  expertNotes: string | null;
  lifecycleStatus: string | null;
  submissionStage: SubmissionStage;
  /** The master OPP is fully built out (mig 182 curated_solicitations.build_complete) → provision-ready.
   *  Drives the mirror card's "ready to build" badge; refreshed to all tenants on the completion re-publish. */
  provisionReady: boolean;
  namespace: string | null;
  builtBy: string | null;
  builtByEmail: string | null;
  releasedBy: string | null;
  releasedByEmail: string | null;
  releasedAt: string | null;
  complianceSummary: {
    pageLimitTechnical: number | null;
    pageLimitCost: number | null;
    submissionFormat: string | null;
    volumeCount: number;
  } | null;
  /** What the organization published, as published. Manifest only — see OppCardDoc. */
  documents: OppCardDoc[];
  /**
   * The curated build-out — "volumes and skeletons" (mig 239).
   *
   * What the admin decided this proposal is MADE OF: the volume names and the required items inside
   * them. Small, specific, and every entry exists because a person decided it belonged. This is a
   * ranking signal in a way the solicitation text is not — "Technical Volume", "Commercialization
   * Plan", "Phase I Work Plan" says what the work IS, where 330 pages of BAA says only that the
   * document is long.
   */
  volumes: string[];
  requiredItems: string[];
  /**
   * What the curator MARKED while reading (mig 239). The residue of a reading that otherwise
   * evaporates into a 103-character blurb. Bounded at the bridge — a card is read on every list
   * render, so the cap belongs here rather than in the input.
   */
  highlights: OppCardHighlight[];
  frozenAt: string;
}

/** One admin highlight as it reaches a tenant. */
export interface OppCardHighlight {
  text: string;
  kind: string;
  page: number | null;
  /** The compliance variable it anchors, when it was made to justify one. */
  variable: string | null;
}

/** Bounds for what rides the card. A card is read on every list render. */
const MAX_HIGHLIGHTS = 24;
const MAX_HIGHLIGHT_CHARS = 400;
const MAX_VOLUME_ENTRIES = 40;

const jsonParam = (v: unknown) => sql.json(v as Parameters<typeof sql.json>[0]);

/** Build the customer-visible card snapshot from the master (opportunity + curation + matrix summary). */
export async function buildCardSnapshot(opportunityId: string, frozenAt: string): Promise<OppCard | null> {
  try {
    const [o] = await sql<Array<Record<string, unknown>>>`
      SELECT o.title, o.agency, o.office, o.org_unit, o.solicitation_number, o.naics_codes,
             o.set_aside_type, o.program_type, o.classification_code, o.posted_date,
             o.pre_release_date, o.open_date, o.close_date, o.award_date, o.award_amount, o.awardee,
             o.estimated_value_min, o.estimated_value_max, o.description, o.expert_notes,
             o.lifecycle_status, o.submission_stage,
             o.phase_type, o.tech_focus_areas, o.topic_number, o.topic_branch, o.topic_status,
             o.poc_name, o.poc_email, o.dates_estimated,
             o.built_by, o.released_by, o.released_at,
             ub.email AS built_by_email, ur.email AS released_by_email,
             cs.namespace, cs.spotlight_summary, cs.build_complete,
             sc.page_limit_technical, sc.page_limit_cost, sc.submission_format,
             (SELECT count(*)::int FROM solicitation_volumes sv
                WHERE sv.solicitation_id = cs.id AND sv.topic_id IS NULL) AS volume_count,
             -- The document MANIFEST (mig 238). Aliased camelCase because lib/db.ts applies
             -- postgres.toCamel to every column — but a jsonb_build_object's KEYS are values, not
             -- column names, so they pass through untouched and must be written camelCase here.
             -- char_count is computed from the master text so the manifest can state the corpus
             -- size without carrying it.
             -- The curated build-out (mig 239): volume names and the required items inside them.
             -- Umbrella-level only (topic_id IS NULL) so a topic card is not handed another
             -- topic's skeleton. DISTINCT because one volume name can carry many items.
             (SELECT COALESCE(jsonb_agg(DISTINCT sv.volume_name ORDER BY sv.volume_name), '[]'::jsonb)
                FROM solicitation_volumes sv
               WHERE sv.solicitation_id = cs.id AND sv.topic_id IS NULL
                 AND COALESCE(sv.volume_name, '') <> '') AS volumes,
             (SELECT COALESCE(jsonb_agg(DISTINCT vri.item_name ORDER BY vri.item_name), '[]'::jsonb)
                FROM volume_required_items vri
                JOIN solicitation_volumes sv2 ON sv2.id = vri.volume_id
               WHERE sv2.solicitation_id = cs.id AND sv2.topic_id IS NULL
                 AND COALESCE(vri.item_name, '') <> '') AS required_items,
             -- What the curator MARKED. Bounded in SQL as well as in TS, so a pathological
             -- annotation set cannot make one card payload enormous before it reaches the cap.
             (SELECT COALESCE(jsonb_agg(h ORDER BY h->>'page'), '[]'::jsonb) FROM (
                SELECT jsonb_build_object(
                         'text', left(sa.excerpt, 400),
                         'kind', sa.kind,
                         'page', (sa.source_location->>'page')::int,
                         'variable', sa.compliance_variable_name) AS h
                  FROM solicitation_annotations sa
                 WHERE sa.solicitation_id = cs.id AND COALESCE(sa.excerpt, '') <> ''
                 ORDER BY sa.created_at
                 LIMIT 24) q) AS highlights,
             (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                        'sourceDocumentId', sd.id,
                        'documentType',     sd.document_type,
                        'documentLabel',    sd.document_label,
                        'filename',         sd.original_filename,
                        'isPrimary',        sd.is_primary,
                        'contentHash',      sd.content_hash,
                        'pageCount',        sd.page_count,
                        'charCount',        length(COALESCE(sd.extracted_text, ''))
                      ) ORDER BY sd.is_primary DESC, (sd.document_type = 'source') DESC, sd.created_at),
                      '[]'::jsonb)
                FROM solicitation_documents sd WHERE sd.solicitation_id = cs.id) AS documents
      FROM opportunities o
      -- Resolve the solicitation for BOTH the umbrella (cs.opportunity_id = o.id)
      -- and its topics (o.solicitation_id = cs.id). Without the topic arm, a topic
      -- card came out with null namespace/compliance/volume_count once multi-topic
      -- fan-out started publishing topics as cards.
      LEFT JOIN curated_solicitations cs ON cs.id = o.solicitation_id OR cs.opportunity_id = o.id
      LEFT JOIN solicitation_compliance sc ON sc.solicitation_id = cs.id AND sc.topic_id IS NULL
      LEFT JOIN users ub ON ub.id = o.built_by
      LEFT JOIN users ur ON ur.id = o.released_by
      WHERE o.id = ${opportunityId}::uuid
      -- Deterministic tiebreak if an opportunity matches TWO curated_solicitations (one via each
      -- join arm): prefer the direct solicitation_id (topic) arm, then stable by cs.id, so the
      -- snapshot's namespace/compliance/volume_count can't flip between runs (sweep F6).
      ORDER BY (cs.id = o.solicitation_id) DESC NULLS LAST, cs.id
      LIMIT 1
    `;
    if (!o) return null;
    const num = (v: unknown): number | null => (v == null ? null : Number(v));
    /**
     * Stringify a card field, ISO for dates.
     *
     * postgres.js hands back date/timestamp columns as JS `Date` objects, and a bare `String(date)`
     * calls Date.prototype.toString() — "Fri Aug 28 2026 00:00:00 GMT+0000 (Coordinated Universal
     * Time)". That is locale- and timezone-shaped prose, not a date format, and it went straight
     * into the card jsonb that both scorers read.
     *
     * The consequence was a dead ranking dimension. `new Date(...)` in the TS scorer happens to
     * parse V8's own toString output, but the Python scorer's `_close_ms` does
     * `datetime.fromisoformat(...)` and returns None — so it SKIPS the timeline signal entirely.
     * Across 3,486 stored bucket scores, not one carried a `timeline` factor: every card was ranked
     * on keywords alone, and "closes in 9 days" counted for nothing. Worse, the two scorers
     * disagreed on the same card, which bucket-ranking.ts explicitly claims they must not
     * ("parity with the Python scorer's `_close_ms is None` skip").
     */
    const str = (v: unknown): string | null =>
      v == null ? null : v instanceof Date ? v.toISOString() : String(v);
    /** A jsonb string array, cleaned and bounded. */
    const strList = (v: unknown, cap: number): string[] =>
      (Array.isArray(v) ? v : [])
        .filter((x): x is string => typeof x === 'string' && x.trim() !== '')
        .map((x) => x.trim())
        .slice(0, cap);
    const hasMatrix = o.pageLimitTechnical != null || o.pageLimitCost != null || (num(o.volumeCount) ?? 0) > 0;
    return {
      opportunityId,
      title: (o.title as string) ?? null,
      agency: (o.agency as string) ?? null,
      office: (o.office as string) ?? null,
      orgUnit: (o.orgUnit as string) ?? null,
      solicitationNumber: (o.solicitationNumber as string) ?? null,
      naicsCodes: (o.naicsCodes as string[]) ?? null,
      setAsideType: (o.setAsideType as string) ?? null,
      programType: (o.programType as string) ?? null,
      phaseType: (o.phaseType as string) ?? null,
      techFocusAreas: (o.techFocusAreas as string[]) ?? null,
      topicNumber: (o.topicNumber as string) ?? null,
      topicBranch: (o.topicBranch as string) ?? null,
      topicStatus: (o.topicStatus as string) ?? null,
      pocName: (o.pocName as string) ?? null,
      pocEmail: (o.pocEmail as string) ?? null,
      classificationCode: (o.classificationCode as string) ?? null,
      datesEstimated: o.datesEstimated === true,
      postedDate: str(o.postedDate),
      preReleaseDate: str(o.preReleaseDate),
      openDate: str(o.openDate),
      closeDate: str(o.closeDate),
      awardDate: str(o.awardDate),
      awardAmount: num(o.awardAmount),
      awardee: (o.awardee as string) ?? null,
      estimatedValueMin: num(o.estimatedValueMin),
      estimatedValueMax: num(o.estimatedValueMax),
      description: (o.description as string) ?? null,
      spotlightSummary: (o.spotlightSummary as string) ?? null,
      expertNotes: (o.expertNotes as string) ?? null,
      lifecycleStatus: (o.lifecycleStatus as string) ?? null,
      submissionStage: isSubmissionStage(o.submissionStage) ? o.submissionStage : 'open',
      provisionReady: o.buildComplete === true,
      namespace: (o.namespace as string) ?? null,
      builtBy: str(o.builtBy),
      builtByEmail: (o.builtByEmail as string) ?? null,
      releasedBy: str(o.releasedBy),
      releasedByEmail: (o.releasedByEmail as string) ?? null,
      releasedAt: str(o.releasedAt),
      documents: Array.isArray(o.documents) ? (o.documents as OppCardDoc[]) : [],
      volumes: strList(o.volumes, MAX_VOLUME_ENTRIES),
      requiredItems: strList(o.requiredItems, MAX_VOLUME_ENTRIES),
      highlights: (Array.isArray(o.highlights) ? (o.highlights as OppCardHighlight[]) : [])
        .filter((h) => typeof h?.text === 'string' && h.text.trim() !== '')
        .slice(0, MAX_HIGHLIGHTS)
        .map((h) => ({
          text: h.text.trim().slice(0, MAX_HIGHLIGHT_CHARS),
          kind: typeof h.kind === 'string' ? h.kind : 'highlight',
          page: Number.isFinite(Number(h.page)) ? Number(h.page) : null,
          variable: typeof h.variable === 'string' ? h.variable : null,
        })),
      frozenAt,
      complianceSummary: hasMatrix
        ? {
            pageLimitTechnical: num(o.pageLimitTechnical),
            pageLimitCost: num(o.pageLimitCost),
            submissionFormat: (o.submissionFormat as string) ?? null,
            volumeCount: num(o.volumeCount) ?? 0,
          }
        : null,
    };
  } catch (e) {
    console.error('[bridge] buildCardSnapshot failed', e);
    return null;
  }
}

export interface BridgeEvent {
  id: string;
  opportunityId: string;
  version: number;
  eventType: BridgeEventType;
  card: OppCard;
}

/**
 * Normalize a card read back out of stored jsonb.
 *
 * `OppCard` is the contract for a card this build PUBLISHES. A card read from `opportunity_bridge`
 * was written by whatever build was deployed at the time, so the fields mig 238 added are simply
 * absent on every row published before it — and a TS cast over stored jsonb asserts a shape the
 * bytes do not have. That is the same class as the `sql<T>` trap the data-layer SOP documents: it
 * compiles, and then `card.documents.map(...)` throws on a legacy row.
 *
 * Backfill and reconcile both replay historical bridge rows, so both go through here.
 */
export function normalizeCard(raw: unknown): OppCard {
  const c = (raw ?? {}) as Partial<OppCard>;
  return {
    ...(c as OppCard),
    datesEstimated: c.datesEstimated === true,
    phaseType: c.phaseType ?? null,
    techFocusAreas: Array.isArray(c.techFocusAreas) ? c.techFocusAreas : null,
    topicNumber: c.topicNumber ?? null,
    topicBranch: c.topicBranch ?? null,
    topicStatus: c.topicStatus ?? null,
    pocName: c.pocName ?? null,
    pocEmail: c.pocEmail ?? null,
    documents: Array.isArray(c.documents) ? c.documents : [],
  };
}

/** Publish a forward-only card version to the bridge (admin approve / update / close). */
export async function publishToBridge(
  opportunityId: string,
  eventType: BridgeEventType,
  postedBy: string | null,
  now: string,
): Promise<BridgeEvent | null> {
  // Race-safe version allocation. Two concurrent publishes for the SAME opportunity can both
  // read max(version)=N and compute N+1; the UNIQUE(opportunity_id,version) index lets exactly
  // one win. `ON CONFLICT DO NOTHING` turns the loser into a no-op (empty RETURNING) instead of
  // a duplicate-key throw — so we recompute the now-higher max and retry, rather than nulling
  // out (and never fanning out) a real lifecycle transition. Bounded so a pathological hot opp
  // can't spin forever.
  //
  // The snapshot is (re)built INSIDE the loop: a conflict means someone else just published,
  // i.e. the master may have moved since we read it — retrying with the ORIGINAL snapshot
  // would land pre-conflict content at the HIGHEST version, and the forward-only apply would
  // then settle every tenant mirror on stale data (adversarially proven: two admins editing
  // one pushed opp, the loser's retry erased the winner's edit from all customer cards).
  try {
    for (let attempt = 0; attempt < 6; attempt++) {
      const card = await buildCardSnapshot(opportunityId, now);
      if (!card) return null;
      const [row] = await sql<Array<{ id: string; version: number }>>`
        INSERT INTO opportunity_bridge (opportunity_id, version, event_type, card, posted_by)
        SELECT ${opportunityId}::uuid,
               COALESCE((SELECT max(version) FROM opportunity_bridge WHERE opportunity_id = ${opportunityId}::uuid), 0) + 1,
               ${eventType}, ${jsonParam(card)}, ${postedBy}
        ON CONFLICT (opportunity_id, version) DO NOTHING
        RETURNING id, version
      `;
      if (row) return { id: row.id, opportunityId, version: row.version, eventType, card };
    }
    console.error('[bridge] publishToBridge exhausted version-allocation retries', opportunityId);
    return null;
  } catch (e) {
    console.error('[bridge] publishToBridge failed', e);
    return null;
  }
}

/**
 * Copy the solicitation corpus INWARD — the bytes the manifest describes (mig 238).
 *
 * ⚠️ CALLED AT PIN, NOT AT FAN-OUT (mig 239). It ran on every apply, for every holder, whether or
 * not any of them ever opened the document — 21 MB per opportunity across seven tenants on this
 * box. The documents are REFERENCE: the card's manifest says what exists, and the bytes arrive
 * when a tenant pins. What ranks is the curated record on the card, not this.
 *
 * The master (`solicitation_documents`) is RLS-off platform scope, so it is read on the bypass
 * pool; the write lands in the tenant's FORCE-RLS `tenant_opportunity_documents` under `withTenant`.
 *
 * Three properties worth stating, because each is load-bearing:
 *
 *  · **Forward-only, like the card.** A stale event must not overwrite a newer copy, or an
 *    out-of-order fan-out would restore a superseded amendment's text under a current card.
 *  · **Hash short-circuit.** Documents rarely change; lifecycle republishes are frequent. Rewriting
 *    375,000 characters per tenant because an opp reopened is real money for no information. When
 *    the content hash matches what we already hold we advance `bridge_version` and leave the text.
 *  · **Prune to the manifest, but only on success.** The mirror states what the organization has
 *    published NOW; a document the admin withdrew must not linger. But an empty manifest from a
 *    FAILED read would wipe a tenant's corpus, so the prune is inside the same try as the read and
 *    an exception leaves the mirror exactly as it was.
 *
 * Best-effort throughout: a corpus failure must never fail the fan-out. The card still lands, the
 * card's own curated record still ranks, and `reconcileTenant` re-drives the copy on the next pass.
 * (Not `card_tsv` — the scorer matches literally, and that index is not a scoring input today.)
 *
 * ── RETURNS THE NUMBER OF DOCUMENTS WHOSE TEXT ACTUALLY LANDED ───────────────────────────────
 * Not the number of ROWS written. A document that exists but has not been shredded yet upserts a
 * row with an empty `extracted_text` — a legitimate state, and not a copy of anything. Counting it
 * let `pinCard` believe a copy had succeeded when nothing readable had arrived, so a pin that
 * should have been refused went through. Absent is not zero, one layer down.
 */
export async function copyCorpusInward(tenantId: string, ev: BridgeEvent): Promise<number> {
  try {
    // The master's own rows — the manifest on the card says WHICH, this reads the bytes.
    const docs = await sqlBypass<Array<{
      id: string; documentType: string; documentLabel: string | null; originalFilename: string;
      isPrimary: boolean; contentHash: string | null; pageCount: number | null;
      storageKey: string; extractedText: string | null;
    }>>`
      SELECT sd.id, sd.document_type, sd.document_label, sd.original_filename, sd.is_primary,
             sd.content_hash, sd.page_count, sd.storage_key, sd.extracted_text
      FROM solicitation_documents sd
      JOIN opportunities o ON o.solicitation_id = sd.solicitation_id
      WHERE o.id = ${ev.opportunityId}::uuid
    `;
    return await withTenant(tenantId, async (tx) => {
      let written = 0;
      for (const d of docs) {
        const text = d.extractedText ?? '';
        // The text is written only when the hash CHANGED (or we hold nothing). Otherwise this is a
        // version bump on the row we already have. `EXCLUDED.bridge_version > current` keeps the
        // whole thing forward-only; a stale event is a no-op with an empty RETURNING.
        const rows = await tx`
          INSERT INTO tenant_opportunity_documents (
            tenant_id, opportunity_id, source_document_id, document_type, document_label,
            original_filename, is_primary, content_hash, page_count, char_count,
            storage_key, extracted_text, bridge_version)
          VALUES (
            ${tenantId}::uuid, ${ev.opportunityId}::uuid, ${d.id}::uuid, ${d.documentType},
            ${d.documentLabel}, ${d.originalFilename}, ${d.isPrimary}, ${d.contentHash},
            ${d.pageCount}, ${text.length}, ${d.storageKey}, ${text}, ${ev.version})
          ON CONFLICT (tenant_id, opportunity_id, source_document_id) DO UPDATE SET
            document_type     = EXCLUDED.document_type,
            document_label    = EXCLUDED.document_label,
            original_filename = EXCLUDED.original_filename,
            is_primary        = EXCLUDED.is_primary,
            page_count        = EXCLUDED.page_count,
            storage_key       = EXCLUDED.storage_key,
            bridge_version    = EXCLUDED.bridge_version,
            -- Hash short-circuit: same content, keep the bytes we already TOASTed.
            content_hash      = EXCLUDED.content_hash,
            extracted_text    = CASE
              WHEN tenant_opportunity_documents.content_hash IS NOT NULL
               AND tenant_opportunity_documents.content_hash = EXCLUDED.content_hash
              THEN tenant_opportunity_documents.extracted_text
              ELSE EXCLUDED.extracted_text END,
            char_count        = CASE
              WHEN tenant_opportunity_documents.content_hash IS NOT NULL
               AND tenant_opportunity_documents.content_hash = EXCLUDED.content_hash
              THEN tenant_opportunity_documents.char_count
              ELSE EXCLUDED.char_count END,
            updated_at        = now()
          WHERE EXCLUDED.bridge_version > tenant_opportunity_documents.bridge_version
          RETURNING id
        `;
        // Only a row carrying TEXT counts as a copy — see the note on the return value above.
        if (rows.length > 0 && text.length > 0) written++;
      }
      // Prune to the manifest — inside the same try, so a failed read never wipes a corpus.
      const keep = docs.map((d) => d.id);
      if (keep.length > 0) {
        await tx`
          DELETE FROM tenant_opportunity_documents
          WHERE tenant_id = ${tenantId}::uuid AND opportunity_id = ${ev.opportunityId}::uuid
            AND source_document_id <> ALL(${keep}::uuid[])`;
      } else {
        await tx`
          DELETE FROM tenant_opportunity_documents
          WHERE tenant_id = ${tenantId}::uuid AND opportunity_id = ${ev.opportunityId}::uuid`;
      }
      return written;
    });
  } catch (e) {
    console.error('[bridge] corpus copy-inward failed (non-fatal)', tenantId, ev.opportunityId, e);
    return 0;
  }
}

/** Upsert one tenant's denormalized card from a bridge event (tenant-scoped via RLS GUC).
 *  `watched` (RANK-8) = this master opp is admin-pinned for updates, so a newer version landing on an
 *  EXISTING mirror card fans an elevated update notification to this holder (pre-purchase reach). */
async function applyToTenant(tenantId: string, ev: BridgeEvent, watched = false): Promise<boolean> {
  // Canonical stage from the card drives the coarse lifecycle_status the feed uses.
  // Fall back to the event type / coarse lifecycleStatus for LEGACY cards whose JSON
  // predates submission_stage — otherwise a re-fanned/backfilled closed or archived
  // opp would resurface as 'open' in the customer feed.
  const stage: SubmissionStage = isSubmissionStage(ev.card.submissionStage)
    ? ev.card.submissionStage
    : ev.eventType === 'closed' ? 'closed'
    : ev.eventType === 'archived' ? 'archived'
    : ev.eventType === 'reopened' ? 'open'
    : ev.card.lifecycleStatus === 'archived' ? 'archived'
    : ev.card.lifecycleStatus === 'closed' ? 'closed'
    : 'open';
  const lifecycle = coarseStatus(stage);
  // Forward-only apply. A stale (lower-or-equal bridge_version) event must NOT overwrite a
  // newer card — otherwise an out-of-order fan-out (v_N applied after v_{N+1}, e.g. two
  // overlapping lifecycle changes) would resurface a closed opp as 'open' in the customer
  // feed. The `WHERE EXCLUDED.bridge_version > current` makes a stale apply a no-op; RETURNING
  // tells us whether the card actually advanced, so we skip the cursor bump AND the rescore
  // emit for a no-op (the mirror already holds newer state).
  const { applied, existedBefore } = await withTenant(tenantId, async (tx) => {
    // Was the card already in this tenant's mirror? Distinguishes a first-sight apply (a new/backfilled
    // holder) from a genuine UPDATE — only the latter fans a watched-opp update notification (RANK-8).
    const [prior] = await tx<Array<{ bridgeVersion: number }>>`
      SELECT bridge_version FROM tenant_opportunity_cards
      WHERE tenant_id = ${tenantId}::uuid AND opportunity_id = ${ev.opportunityId}::uuid`;
    const rows = await tx`
      INSERT INTO tenant_opportunity_cards (tenant_id, opportunity_id, card, bridge_version, lifecycle_status, submission_stage)
      VALUES (${tenantId}::uuid, ${ev.opportunityId}::uuid, ${jsonParam(ev.card)}, ${ev.version}, ${lifecycle}, ${stage})
      ON CONFLICT (tenant_id, opportunity_id) DO UPDATE SET
        card = EXCLUDED.card,
        bridge_version = EXCLUDED.bridge_version,
        lifecycle_status = EXCLUDED.lifecycle_status,
        submission_stage = EXCLUDED.submission_stage,
        docs_update_available = CASE
          WHEN tenant_opportunity_cards.docs_copied AND EXCLUDED.bridge_version > tenant_opportunity_cards.bridge_version
          THEN true ELSE tenant_opportunity_cards.docs_update_available END,
        updated_at = now()
      WHERE EXCLUDED.bridge_version > tenant_opportunity_cards.bridge_version
      RETURNING tenant_id
    `;
    return { applied: rows.length > 0, existedBefore: !!prior };
  });
  if (!applied) return false;
  // NO corpus copy here (mig 239). It used to run on every apply for every holder; the documents
  // are reference material and now arrive at PIN. A tenant who has already pinned gets
  // `docs_update_available` set by the upsert above, and resyncing re-copies against the new
  // version — so an amendment still reaches the people who asked for the document.
  // System cursor (not tenant-RLS'd) — records forward-only progress. Only advances when the
  // card advanced above, so a stale apply can't regress last_event_id either.
  await sql`
    INSERT INTO tenant_bridge_cursor (tenant_id, last_posted_at, last_event_id, last_applied_at)
    VALUES (${tenantId}::uuid, now(), ${ev.id}::uuid, now())
    ON CONFLICT (tenant_id) DO UPDATE SET last_event_id = EXCLUDED.last_event_id, last_applied_at = now()
  `;
  // Scoring is TENANT-SIDE + EVENT-DRIVEN now — NOT baked into this admin-push fan-out.
  // Announce the card landed/updated in the tenant's mirror; the pipeline OnCardApplied
  // workflow deterministically rescores it against the tenant's buckets (the
  // scoring_strategist agent overlays this later, with memory + pin/purchase levers).
  // "One brain, two spines, a bridge": the bridge DELIVERS, the tenant spine SCORES.
  // Best-effort — an emit failure must not fail the fan-out (the rescore can be re-driven).
  try {
    await emitEventSingle({
      namespace: 'capture',
      type: 'card.applied',
      actor: systemActor('bridge'),
      tenantId,
      payload: { tenantId, opportunityId: ev.opportunityId, version: ev.version },
    });
  } catch (emitErr) {
    console.error('[bridge] card.applied emit failed (non-fatal)', tenantId, emitErr);
  }
  // Synchronous scoring FALLBACK (RANK-6): rank the just-applied card against all active buckets HERE,
  // so it ranks the instant it lands even if the pipeline OnCardApplied worker is down. Idempotent with
  // that async path (same upsert), closing the one gap provisioning + bucket-create already cover inline.
  // Best-effort — a scoring failure must never fail the fan-out (the async rescore still re-drives it).
  try {
    await scoreCardForTenant(tenantId, ev.opportunityId, Date.now());
  } catch (scoreErr) {
    console.error('[bridge] sync score fallback failed (non-fatal)', tenantId, scoreErr);
  }
  // Admin pin-for-updates (RANK-8): a WATCHED master opp getting a newer version on an EXISTING mirror
  // card is an update the holder should hear about NOW — pre-purchase (today's amendment engine only
  // reaches opps that already have a proposal). Elevated notification the customer bell + CC surface.
  // Best-effort; first-sight applies (existedBefore=false) are skipped so a new holder isn't "updated".
  if (watched && existedBefore) {
    const title = (ev.card as unknown as { title?: unknown }).title;
    try {
      await emitEventSingle({
        namespace: 'capture',
        type: 'opportunity.updated',
        actor: systemActor('bridge'),
        tenantId,
        payload: { tenantId, opportunityId: ev.opportunityId, version: ev.version, title: typeof title === 'string' ? title : null },
      });
    } catch (e) {
      console.error('[bridge] opportunity.updated emit failed (non-fatal)', tenantId, e);
    }
  }
  // Return whether THIS holder got an update notification, so the fan-out can bracket + count them (RANK-8).
  return watched && existedBefore;
}

/** Fan a published card version out to every subscribed tenant (all-opps replication). */
export async function fanOutBridgeEvent(ev: BridgeEvent): Promise<number> {
  let tenants: Array<{ id: string }> = [];
  try {
    tenants = await sql<Array<{ id: string }>>`SELECT id FROM tenants WHERE status IN ('active','trial')`;
  } catch (e) {
    console.error('[bridge] fan-out tenant list failed', e);
    return 0;
  }
  // Admin pin-for-updates (RANK-8): is this master opp watched? If so, each holder that already had the
  // card gets an elevated update notification. opportunities is the platform catalog (RLS-off) → sqlBypass;
  // one lookup for the whole fan-out. Best-effort — a miss just means no elevated notification this round.
  let watched = false;
  try {
    const [w] = await sqlBypass<Array<{ updateWatch: boolean }>>`
      SELECT update_watch FROM opportunities WHERE id = ${ev.opportunityId}::uuid`;
    watched = w?.updateWatch === true;
  } catch (e) {
    console.error('[bridge] watch lookup failed (non-fatal)', ev.opportunityId, e);
  }
  // A WATCHED opp's holder fan-out is an automation PROCESS → bracket it start/end with the holder count
  // (RANK-8). Unwatched routine pushes are not bracketed. The per-holder capture:opportunity.updated
  // events are the fine-grained audit; this is the process-level one. Best-effort; paired start/end.
  let notifStart = '';
  if (watched) {
    try {
      notifStart = await emitEventStart({
        namespace: 'finder', type: 'opportunity.update_fanned', actor: systemActor('bridge'),
        tenantId: null, payload: { opportunityId: ev.opportunityId, version: ev.version },
      });
    } catch (e) { console.error('[bridge] update fan-out start emit failed (non-fatal)', e); }
  }
  let applied = 0;
  let holdersNotified = 0;
  for (const t of tenants) {
    try {
      const notified = await applyToTenant(t.id, ev, watched);
      applied++;
      if (notified) holdersNotified++;
    } catch (e) {
      console.error('[bridge] fan-out to tenant failed', t.id, e);
    }
  }
  if (watched && notifStart) {
    try {
      await emitEventEnd(notifStart, { result: { opportunityId: ev.opportunityId, holdersNotified, tenantsReached: applied } });
    } catch (e) { console.error('[bridge] update fan-out end emit failed (non-fatal)', e); }
  }
  return applied;
}

/** Publish + fan out in one call (the approve→publish→replicate path). */
export async function publishAndFanOut(
  opportunityId: string,
  eventType: BridgeEventType,
  postedBy: string | null,
  now: string,
): Promise<{ event: BridgeEvent; tenantsApplied: number } | null> {
  const event = await publishToBridge(opportunityId, eventType, postedBy, now);
  if (!event) return null;
  const tenantsApplied = await fanOutBridgeEvent(event);
  return { event, tenantsApplied };
}

/**
 * Re-publish a RELEASED opportunity to the bridge + re-fan-out — the propagation
 * path for lifecycle transitions and card content edits (Tranche 1). No-op if the
 * opp was never released (no bridge version yet): pre-release/NOFO stage changes
 * don't reach customers until the first publish.
 */
export async function republishIfReleased(
  opportunityId: string,
  eventType: BridgeEventType,
  postedBy: string | null,
  now: string,
): Promise<{ event: BridgeEvent; tenantsApplied: number } | null> {
  let released = false;
  try {
    const [row] = await sql<Array<{ v: number | null }>>`
      SELECT max(version) AS v FROM opportunity_bridge WHERE opportunity_id = ${opportunityId}::uuid
    `;
    released = !!row && row.v != null;
  } catch (e) {
    console.error('[bridge] republishIfReleased head check failed', e);
    return null;
  }
  if (!released) return null;
  return publishAndFanOut(opportunityId, eventType, postedBy, now);
}

/** New-customer backfill: apply the latest bridge version of every opportunity to a tenant. */
export async function backfillTenant(tenantId: string): Promise<number> {
  let heads: Array<{ id: string; opportunityId: string; version: number; eventType: BridgeEventType; card: OppCard }> = [];
  try {
    heads = await sql`
      SELECT DISTINCT ON (opportunity_id)
             id, opportunity_id, version, event_type, card
      FROM opportunity_bridge
      ORDER BY opportunity_id, version DESC
    ` as typeof heads;
  } catch (e) {
    console.error('[bridge] backfill head query failed', e);
    return 0;
  }
  let applied = 0;
  for (const h of heads) {
    try {
      await applyToTenant(tenantId, { id: h.id, opportunityId: h.opportunityId, version: h.version, eventType: h.eventType, card: normalizeCard(h.card) });
      applied++;
    } catch (e) {
      console.error('[bridge] backfill apply failed', h.opportunityId, e);
    }
  }
  return applied;
}

/**
 * Forward-only CATCH-UP: apply only the bridge heads this tenant is BEHIND on — i.e. an opp with
 * no card yet, or a card older than the opp's current bridge version. This is the self-healing
 * consumer the forward-only bridge was missing: a tenant that missed a push (created after it, was
 * suspended, or whose creation-time backfill silently failed) can never be permanently stale/empty
 * — its mirror reconciles to the bridge head. Idempotent + cheap (usually zero missed heads → a
 * near-no-op), and it reuses applyToTenant so scoring re-fires via capture:card.applied.
 * Returns the number of cards advanced.
 */
export async function reconcileTenant(tenantId: string): Promise<number> {
  let behind: Array<{ id: string; opportunityId: string; version: number; eventType: BridgeEventType; card: OppCard }> = [];
  try {
    // Per opp, the head bridge version — kept only when the tenant has no card or a stale one.
    // WHERE runs before DISTINCT ON, so this narrows to opps the tenant is behind on, then picks
    // each opp's newest missed version.
    // Run the behind-detection under the tenant's OWN RLS scope so it reads real state regardless of
    // the caller's ambient context (the /cards read-repair calls this before its own withTenant block;
    // the admin sweep on the bypass pool). Under govtech_app a context-less read of the force-RLS
    // tenant_opportunity_cards would DENY-ALL → the LEFT JOIN would treat every bridge head as "behind"
    // and re-apply on every call (self-correcting via the forward-only guard, but wasteful). Self-scope.
    behind = await withTenant(tenantId, async (tx) => tx`
      SELECT DISTINCT ON (b.opportunity_id)
             b.id, b.opportunity_id AS "opportunityId", b.version, b.event_type AS "eventType", b.card
      FROM opportunity_bridge b
      LEFT JOIN tenant_opportunity_cards c
        ON c.tenant_id = ${tenantId}::uuid AND c.opportunity_id = b.opportunity_id
      WHERE c.opportunity_id IS NULL OR b.version > c.bridge_version
      ORDER BY b.opportunity_id, b.version DESC
    `) as typeof behind;
  } catch (e) {
    console.error('[bridge] reconcile head query failed', tenantId, e);
    return 0;
  }
  let applied = 0;
  for (const h of behind) {
    try {
      await applyToTenant(tenantId, { id: h.id, opportunityId: h.opportunityId, version: h.version, eventType: h.eventType, card: normalizeCard(h.card) });
      applied++;
    } catch (e) {
      console.error('[bridge] reconcile apply failed', h.opportunityId, e);
    }
  }
  if (applied > 0) console.info('[bridge] reconciled tenant %s: %d card(s) caught up to head', tenantId, applied);
  return applied;
}

/**
 * Reconcile EVERY active/trial tenant to the bridge head — the scheduled/manual sweep that heals
 * tenants which never load their feed (so the digest + admin views are accurate too). Same set the
 * fan-out targets. Returns per-tenant applied counts.
 */
export async function reconcileActiveTenants(): Promise<{ tenantId: string; applied: number }[]> {
  let tenants: Array<{ id: string }> = [];
  try {
    tenants = await sql<Array<{ id: string }>>`SELECT id FROM tenants WHERE status IN ('active','trial')`;
  } catch (e) {
    console.error('[bridge] reconcileActiveTenants tenant list failed', e);
    return [];
  }
  const out: { tenantId: string; applied: number }[] = [];
  for (const t of tenants) {
    out.push({ tenantId: t.id, applied: await reconcileTenant(t.id) });
  }
  return out;
}

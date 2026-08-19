import { sql } from '@/lib/db';

/**
 * Resolved compliance data for a topic, after merging:
 *   topic override -> solicitation baseline -> system defaults.
 */
export interface ResolvedCompliance {
  compliance: Record<string, unknown>;
  volumes: Array<{
    volumeName: string;
    volumeNumber: number;
    /** Completed in DSIP (webform / agency-generated report) — not authored in this workspace. */
    dsipOnly?: boolean;
    items: Array<Record<string, unknown>>;
  }>;
  /** Set when resolution ERRORED and fell back to SYSTEM_DEFAULTS + no volumes. A provision
   *  built off a degraded resolve is a default skeleton, not the authored master — callers
   *  must surface it (the silent fallback used to be indistinguishable from an empty build). */
  degraded?: boolean;
}

/**
 * System defaults applied when neither topic nor solicitation specifies a value.
 * These are conservative fallbacks — the real rules should come from the
 * solicitation or topic level.
 */
const SYSTEM_DEFAULTS: Record<string, unknown> = {
  page_limit_technical: null,
  page_limit_cost: null,
  font_family: 'Times New Roman',
  font_size: '12pt',
  min_font_size: null,
  margins: '1 inch all sides',
  line_spacing: '1.0',
  header_required: false,
  footer_required: false,
  submission_format: null,
  images_tables_allowed: true,
  slides_allowed: false,
  taba_allowed: null,
  cost_sharing_required: false,
  pi_must_be_employee: null,
  itar_required: false,
};

/**
 * Resolves the full compliance + volumes for a topic by merging:
 *   1. Topic-level override (solicitation_compliance WHERE topic_id = topicId)
 *   2. Solicitation baseline (solicitation_compliance WHERE topic_id IS NULL)
 *   3. System defaults (hardcoded above)
 *
 * For volumes, topic-specific volumes fully replace solicitation-level volumes.
 * If no topic-specific volumes exist, solicitation-level volumes are used.
 *
 * @param topicId - The opportunities.id for the topic
 * @returns Merged compliance record and resolved volume list
 */
export async function resolveTopicCompliance(topicId: string): Promise<ResolvedCompliance> {
  try {
  // ── 1. Get the topic's solicitation_id ──────────────────────────────
  const [topic] = await sql<{ solicitationId: string | null }[]>`
    SELECT solicitation_id FROM opportunities WHERE id = ${topicId}
  `;

  let solicitationId = topic?.solicitationId ?? null;
  if (topic && !solicitationId) {
    // Umbrella arm: the live intake paths create the umbrella opportunity WITHOUT
    // opportunities.solicitation_id (only topics get it stamped) — but the curated master
    // points back via curated_solicitations.opportunity_id. Without this fallback an
    // umbrella purchase resolves to a NON-degraded empty result and the buyer is
    // provisioned a default skeleton while the fully-authored master sits unread.
    const [cs] = await sql<{ id: string }[]>`
      SELECT id FROM curated_solicitations WHERE opportunity_id = ${topicId} LIMIT 1
    `;
    solicitationId = cs?.id ?? null;
  }

  if (!solicitationId) {
    return { compliance: { ...SYSTEM_DEFAULTS }, volumes: [] };
  }

  // ── 2. Fetch compliance rows (baseline + topic override) ────────────
  // Returns 0-2 rows: one with topic_id IS NULL (baseline), one with topic_id = topicId (override)
  const complianceRows = await sql<Array<Record<string, unknown>>>`
    SELECT *
    FROM solicitation_compliance
    WHERE solicitation_id = ${solicitationId}
      AND (topic_id IS NULL OR topic_id = ${topicId})
    ORDER BY topic_id NULLS FIRST
  `;

  const baselineRow = complianceRows.find((r: Record<string, unknown>) => r.topicId === null) ?? null;
  const topicRow = complianceRows.find((r: Record<string, unknown>) => r.topicId === topicId) ?? null;

  // ── 3. Merge compliance: topic -> baseline -> defaults ──────────────
  // Fields where the topic row has a non-null value override the baseline.
  // Fields where the baseline has a non-null value override system defaults.
  const compliance = mergeCompliance(SYSTEM_DEFAULTS, baselineRow, topicRow);

  // ── 4. Fetch volumes (topic-specific first, fall back to solicitation) ─
  const volumes = await resolveVolumes(solicitationId, topicId);

  return { compliance, volumes };
  } catch (err) {
    console.error('[compliance-resolver] resolveTopicCompliance failed:', err);
    return { compliance: { ...SYSTEM_DEFAULTS }, volumes: [], degraded: true };
  }
}

/**
 * Three-layer merge for compliance fields.
 * The merge only considers "known" compliance columns from solicitation_compliance.
 * Topic fields win over baseline; baseline wins over defaults.
 * A null/undefined value in a higher layer means "inherit from parent".
 */
function mergeCompliance(
  defaults: Record<string, unknown>,
  baseline: Record<string, unknown> | null,
  topicOverride: Record<string, unknown> | null,
): Record<string, unknown> {
  // Columns from solicitation_compliance that participate in the merge.
  // Excludes meta-columns like id, solicitation_id, topic_id, verified_by, etc.
  const mergeableKeys = [
    'pageLimitTechnical',
    'pageLimitCost',
    'pageLimitOther',
    'fontFamily',
    'fontSize',
    'minFontSize',
    'margins',
    'lineSpacing',
    'headerRequired',
    'headerFormat',
    'footerRequired',
    'footerFormat',
    'submissionFormat',
    'imagesTablesAllowed',
    'slidesAllowed',
    'slideLimit',
    'slideOrder',
    'requiredSections',
    'requiredDocuments',
    'evaluationCriteria',
    'tabaAllowed',
    'indirectRateCap',
    'partnerMaxPct',
    'costSharingRequired',
    'costVolumeFormat',
    'piMustBeEmployee',
    'piUniversityAllowed',
    'clearanceRequired',
    'itarRequired',
    'farClauses',
    'customVariables',
  ];

  // Map from camelCase to snake_case for system defaults lookup
  const camelToSnake: Record<string, string> = {
    pageLimitTechnical: 'page_limit_technical',
    pageLimitCost: 'page_limit_cost',
    fontFamily: 'font_family',
    fontSize: 'font_size',
    minFontSize: 'min_font_size',
    margins: 'margins',
    lineSpacing: 'line_spacing',
    headerRequired: 'header_required',
    headerFormat: 'header_format',
    footerRequired: 'footer_required',
    footerFormat: 'footer_format',
    submissionFormat: 'submission_format',
    imagesTablesAllowed: 'images_tables_allowed',
    slidesAllowed: 'slides_allowed',
    tabaAllowed: 'taba_allowed',
    costSharingRequired: 'cost_sharing_required',
    piMustBeEmployee: 'pi_must_be_employee',
    itarRequired: 'itar_required',
  };

  const result: Record<string, unknown> = {};

  for (const key of mergeableKeys) {
    // Topic override wins if present and non-null
    if (topicOverride && topicOverride[key] !== null && topicOverride[key] !== undefined) {
      result[key] = topicOverride[key];
      continue;
    }

    // Baseline wins if present and non-null
    if (baseline && baseline[key] !== null && baseline[key] !== undefined) {
      result[key] = baseline[key];
      continue;
    }

    // System default (keyed by snake_case)
    const snakeKey = camelToSnake[key];
    if (snakeKey && snakeKey in defaults) {
      result[key] = defaults[snakeKey];
    }
  }

  // Merge custom_variables deeply: topic custom vars overlay baseline custom vars
  if (baseline?.customVariables || topicOverride?.customVariables) {
    const baseCustom = (baseline?.customVariables ?? {}) as Record<string, unknown>;
    const topicCustom = (topicOverride?.customVariables ?? {}) as Record<string, unknown>;
    result.customVariables = { ...baseCustom, ...topicCustom };
  }

  return result;
}

/**
 * Resolve volumes for a topic.
 *
 * Strategy: if topic-specific volumes exist (topic_id = topicId), use those exclusively.
 * Otherwise fall back to solicitation-level volumes (topic_id IS NULL).
 *
 * Within each level, volumes are ordered by volume_number, and each volume
 * includes its required items.
 */
async function resolveVolumes(
  solicitationId: string,
  topicId: string,
): Promise<ResolvedCompliance['volumes']> {
  try {
  // Check for topic-specific volumes first
  const [topicVolumeCount] = await sql<{ count: string }[]>`
    SELECT COUNT(*)::text AS count
    FROM solicitation_volumes
    WHERE solicitation_id = ${solicitationId}
      AND topic_id = ${topicId}
  `;

  const hasTopicVolumes = parseInt(topicVolumeCount.count, 10) > 0;

  // Fetch the applicable volumes
  const volumeRows = hasTopicVolumes
    ? await sql<{
        id: string;
        volumeNumber: number;
        volumeName: string;
        metadata: Record<string, unknown> | null;
      }[]>`
        SELECT id, volume_number, volume_name, metadata
        FROM solicitation_volumes
        WHERE solicitation_id = ${solicitationId}
          AND topic_id = ${topicId}
        ORDER BY volume_number ASC
      `
    : await sql<{
        id: string;
        volumeNumber: number;
        volumeName: string;
        metadata: Record<string, unknown> | null;
      }[]>`
        SELECT id, volume_number, volume_name, metadata
        FROM solicitation_volumes
        WHERE solicitation_id = ${solicitationId}
          AND topic_id IS NULL
        ORDER BY volume_number ASC
      `;

  if (volumeRows.length === 0) {
    return [];
  }

  // Fetch all required items for these volumes in one query
  const volumeIds = volumeRows.map((v: { id: string; volumeNumber: number; volumeName: string }) => v.id);
  const itemRows = await sql<{
    volumeId: string;
    itemNumber: number;
    itemName: string;
    itemType: string;
    required: boolean;
    pageLimit: number | null;
    slideLimit: number | null;
    characterLimit: number | null;
    fontFamily: string | null;
    fontSize: string | null;
    minFontSize: number | null;
    margins: string | null;
    lineSpacing: string | null;
    headerFormat: string | null;
    footerFormat: string | null;
    requiredSections: unknown;
    formatRules: unknown;
    customFields: unknown;
    templateId: string | null;
    expertNotes: string | null;
    metadata: Record<string, unknown> | null;
  }[]>`
    SELECT volume_id, item_number, item_name, item_type, required,
           page_limit, slide_limit, character_limit, font_family, font_size, min_font_size, margins,
           line_spacing, header_format, footer_format,
           required_sections, format_rules, custom_fields,
           template_id, expert_notes, metadata
    FROM volume_required_items
    WHERE volume_id = ANY(${volumeIds})
    ORDER BY item_number ASC
  `;

  // Group items by volume
  type ItemRow = (typeof itemRows)[number];
  const itemsByVolume = new Map<string, ItemRow[]>();
  for (const item of itemRows) {
    const existing = itemsByVolume.get(item.volumeId) ?? [];
    existing.push(item);
    itemsByVolume.set(item.volumeId, existing);
  }

  return volumeRows.map((vol: { id: string; volumeNumber: number; volumeName: string; metadata?: Record<string, unknown> | null }) => ({
    volumeName: vol.volumeName,
    volumeNumber: vol.volumeNumber,
    // A DSIP-ONLY volume is completed inside the agency's own submission portal (a DSIP webform or
    // a report pulled from SBIR.gov) — the company never authors a document for it here. Carrying
    // the flag lets provision list it as a submission checklist item instead of standing up an
    // authoring artifact nobody can fill, which would then block readiness forever.
    dsipOnly: (vol.metadata as { dsipOnly?: boolean } | null)?.dsipOnly === true,
    items: (itemsByVolume.get(vol.id) ?? []).map((item: { itemNumber: number; itemName: string; itemType: string; required: boolean; pageLimit: number | null; slideLimit: number | null; characterLimit: number | null; fontFamily: string | null; fontSize: string | null; minFontSize: number | null; margins: string | null; lineSpacing: string | null; headerFormat: string | null; footerFormat: string | null; requiredSections: unknown; formatRules: unknown; customFields: unknown; templateId: string | null; expertNotes: string | null; metadata?: Record<string, unknown> | null }) => ({
      itemNumber: item.itemNumber,
      itemName: item.itemName,
      itemType: item.itemType,
      required: item.required,
      pageLimit: item.pageLimit,
      slideLimit: item.slideLimit,
      characterLimit: item.characterLimit,
      // Per-ITEM DSIP-only, the finer grain of the volume flag above: a volume can MIX the two.
      // The DoW Volume 1 is a DSIP cover-sheet webform PLUS two authored narrative documents —
      // flagging the whole volume would drop the narratives, flagging none would stand up an
      // authoring artifact for a webform that can never be filled here.
      dsipOnly: (item.metadata as { dsipOnly?: boolean } | null)?.dsipOnly === true,
      fontFamily: item.fontFamily,
      fontSize: item.fontSize,
      minFontSize: item.minFontSize,
      margins: item.margins,
      lineSpacing: item.lineSpacing,
      headerFormat: item.headerFormat,
      footerFormat: item.footerFormat,
      requiredSections: item.requiredSections,
      formatRules: item.formatRules,
      customFields: item.customFields,
      templateId: item.templateId,
      expertNotes: item.expertNotes,
    })),
  }));
  } catch (err) {
    console.error('[compliance-resolver] resolveVolumes failed:', err);
    return [];
  }
}

/**
 * Provision a real proposal build for a greenfield portal — the V0→V1 substrate.
 *
 * Reuses the legacy create-route provisioning (resolveTopicCompliance → artifacts →
 * sections → template seed) but GREENFIELD-shaped:
 *   • UNLOCKED — accept-guardrails IS the launch approval (not a 72h admin review),
 *     so the customer can immediately run V1 in the canvas editor.
 *   • MULTI-PROPOSAL-safe — no per-opportunity dup-check; the portal label
 *     disambiguates (two techs against one opp = two proposals).
 * Emits `proposal:proposal.created:end` with proposalId+tenantId so OnProposalCreated
 * → draft_v0 fires (V0 strawman, if the pipeline ANTHROPIC_API_KEY is set).
 *
 * Best-effort: returns {error} on failure; the portal launch itself is unaffected.
 */

import { sql } from '@/lib/db';
import { withTenant } from '@/lib/rls';
import { runInTenant } from '@/lib/tenant-context';
import { emitEventStart, emitEventEnd } from '@/lib/events';
import { preStageProposalReviewTodos } from '@/lib/automation/prestage-todos';
import { resolveTopicCompliance } from '@/lib/compliance-resolver';
import { buildArtifactSpecs } from '@/lib/artifact-spec';
import { inferSectionType, type SectionStandard } from '@/lib/section-standards';
import { resolveTemplateKey, getTemplate, interpolateTemplate } from '@/lib/templates';
import { resolveCostForm, buildCostVolume } from '@/lib/proposal/cost-forms';
import { pickCostWorkbookItems } from '@/lib/proposal/cost-workbook-item';
import { coerceJsonb } from '@/lib/jsonb';
import { requestAgentTask } from '@/lib/agent-client';
import type { CanvasDocument } from '@/lib/types/canvas-document';

export interface ProvisionResult { proposalId: string; sectionCount: number }

interface TopicRow {
  title: string;
  agency: string | null;
  programType: string | null;
  topicNumber: string | null;
  solicitationNumber: string | null;
  solicitationId: string | null;
}

export async function provisionProposalForPortal(opts: {
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  opportunityId: string;
  label: string;
  actorId: string;
  actorEmail: string | null;
}): Promise<ProvisionResult | { error: string }> {
  const { tenantId, tenantName, tenantSlug, opportunityId, label, actorId, actorEmail } = opts;

  let topic: TopicRow | undefined;
  try {
    [topic] = await sql<TopicRow[]>`
      SELECT title, agency, program_type AS "programType", topic_number AS "topicNumber",
             solicitation_number AS "solicitationNumber", solicitation_id AS "solicitationId"
      FROM opportunities WHERE id = ${opportunityId}::uuid LIMIT 1
    `;
  } catch (e) {
    console.error('[provision-proposal] topic load failed', e);
    return { error: 'topic load failed' };
  }
  if (!topic) return { error: 'opportunity not found' };
  const t = topic;
  if (!t.solicitationId) {
    // Umbrella purchase: live intake creates the umbrella opportunity WITHOUT
    // opportunities.solicitation_id — the curated master points back via
    // curated_solicitations.opportunity_id. Resolve it so the proposal is stamped with
    // its solicitation (amendment fan-out + replay key on proposals.solicitation_id).
    try {
      const [cs] = await sql<{ id: string }[]>`
        SELECT id FROM curated_solicitations WHERE opportunity_id = ${opportunityId}::uuid LIMIT 1`;
      if (cs) t.solicitationId = cs.id;
    } catch (e) { console.error('[provision-proposal] umbrella solicitation lookup failed (non-fatal)', e); }
  }

  const baseTitle = t.topicNumber ? `${t.topicNumber}: ${t.title}` : t.title;
  const proposalTitle = label && label !== 'primary' ? `${baseTitle} [${label}]` : baseTitle;

  const resolved = await resolveTopicCompliance(opportunityId);
  if (resolved.degraded) {
    // A degraded resolve means the buyer would be provisioned a DEFAULT skeleton while the
    // authored master sits unread — a silent divergence worse than a failed release. Refuse
    // loudly; the release path surfaces the error and the admin retries.
    console.error('[provision-proposal] compliance resolution DEGRADED for', opportunityId, '— refusing to provision a default skeleton');
    return { error: 'Compliance resolution failed (degraded to defaults) — retry the release; the master was not read.' };
  }
  /**
   * The AUTHORED set — the one rule every provision loop below applies, so they can never
   * disagree about which volumes and items get an artifact, a section and a matrix row.
   *
   * DSIP-only work is completed inside the agency's submission portal (a webform, a report pulled
   * from SBIR.gov, training taken there), so the company authors no document for it here. It is
   * flagged at either grain: a whole VOLUME (the CCR, FWA training, Foreign Affiliations) or a
   * single ITEM inside an otherwise authored volume (the DoW Volume 1 cover-sheet webform, which
   * sits beside two authored narrative documents). A volume whose items are ALL DSIP-only is
   * therefore not authored either — giving it an artifact with no sections would recreate the
   * invisible no-op volume the placeholder rule below exists to prevent.
   */
  const isAuthoredItem = (item: Record<string, unknown>) => (item as { dsipOnly?: boolean }).dsipOnly !== true;
  const authoredItems = (vol: Record<string, unknown>): Array<Record<string, unknown>> =>
    ((vol.items as Array<Record<string, unknown>>) ?? []).filter(isAuthoredItem);
  const isAuthoredVolume = (vol: Record<string, unknown>) =>
    (vol as { dsipOnly?: boolean }).dsipOnly !== true
    && !(((vol.items as unknown[]) ?? []).length > 0 && authoredItems(vol).length === 0);

  const requiredItems: Array<{ itemNumber: number; itemName: string; itemType: string; pageLimit: number | null; slideLimit: number | null; characterLimit: number | null; volumeName: string | null; volumeNumber: number | null; templateId: string | null; expertNotes: string | null }> = [];
  let gi = 0;
  for (const vol of resolved.volumes) {
    // DSIP-only volumes contribute no authored items — they are completed in the agency portal and
    // tracked as compliance-matrix checklist entries, not built here.
    if (!isAuthoredVolume(vol as unknown as Record<string, unknown>)) continue;
    for (const item of authoredItems(vol as unknown as Record<string, unknown>)) {
      gi++;
      requiredItems.push({
        itemNumber: gi, itemName: item.itemName as string, itemType: item.itemType as string,
        pageLimit: (item.pageLimit as number) ?? null, slideLimit: (item.slideLimit as number) ?? null,
        characterLimit: (item.characterLimit as number) ?? null,
        volumeName: (vol.volumeName as string) ?? null,
        volumeNumber: (vol.volumeNumber as number) ?? null, templateId: (item.templateId as string) ?? null,
        expertNotes: (item.expertNotes as string) ?? null,
      });
    }
  }

  const templateVariables: Record<string, string> = {
    company_name: tenantName, project_title: proposalTitle, topic_number: t.topicNumber ?? '', topic_title: t.title,
    solicitation_number: t.solicitationNumber ?? '', pi_name: '{pi_name}', pi_email: '{pi_email}', cage_code: '{cage_code}', uei: '{uei}',
  };

  let sectionStandards: SectionStandard[] = [];
  try { sectionStandards = await sql<SectionStandard[]>`SELECT key, label FROM section_standards WHERE is_active = true`; } catch { /* untagged */ }

  const originCard = {
    opportunity: { id: opportunityId, title: t.title, agency: t.agency, programType: t.programType, topicNumber: t.topicNumber, solicitationNumber: t.solicitationNumber },
    bucket: null, frozenAt: new Date().toISOString(),
  };
  const gateConfig = ['draft', 'final'];

  const eventId = await emitEventStart({
    namespace: 'proposal', type: 'proposal.created', actor: { type: 'user', id: actorId, email: actorEmail ?? undefined },
    tenantId, payload: { tenantId, tenantSlug, topicId: opportunityId, solicitationId: t.solicitationId, source: 'portal' },
  });

  try {
    // RLS cutover: withTenant (not sql.begin) so the provision transaction runs with SET LOCAL
    // app.tenant_id under govtech_app (the Proxy does not route `.begin` through context). Works
    // from both the portal self-provision and the admin release-for-tenant callers. (RLS_CUTOVER)
    const out = await withTenant(tenantId, async (tx: any) => {
      const [p] = await tx<{ id: string }[]>`
        INSERT INTO proposals (tenant_id, opportunity_id, solicitation_id, title, stage, gate_config, is_locked, origin_card, source_bucket)
        VALUES (${tenantId}, ${opportunityId}, ${t.solicitationId}, ${proposalTitle}, 'draft', ${sql.json(gateConfig)}, false, ${sql.json(originCard)}, ${null})
        RETURNING id
      `;
      let count = 0;
      const artifactByVolKey = new Map<string, string>();
      const artifactTypeByVolKey = new Map<string, string>();
      const volumeCapByVolKey = new Map<string, number | null>();
      const volKey = (num: number | null, name: string | null) => `${num ?? ''}|${name ?? ''}`;
      const programType = t.programType ?? '';
      // Normalize to the work-share program family: sbir_phase_1/2 → 'sbir', sttr* / d2p2 → 'sttr',
      // everything else (BAA, OTA, CSO, NSF, DOE, …) → null (no SBIR/STTR work-share floor shown).
      const workshareProgram = /sttr|d2p2/i.test(programType) ? 'sttr' : /sbir/i.test(programType) ? 'sbir' : null;

      if (requiredItems.length > 0) {
        for (const vol of resolved.volumes) {
          const volName = (vol.volumeName as string) ?? null;
          const volNum = (vol.volumeNumber as number) ?? null;
          // DSIP-ONLY volumes are completed in the agency's submission portal — a DSIP webform
          // (Cover Sheet, Foreign Affiliations) or an agency-generated report (the CCR pulled from
          // SBIR.gov), or training taken inside DSIP (FWA). The company authors NO document here, so
          // standing up an artifact + empty sections for one creates work that can never be done and
          // a readiness blocker that can never clear. The requirement still reaches the customer as a
          // compliance-matrix checklist item — it is tracked, just not authored.
          if (!isAuthoredVolume(vol as unknown as Record<string, unknown>)) continue;
          // Map the volume to its artifact_type (CHECK: narrative|cost|form|matrix|other). Cost/budget
          // volumes → 'cost'; supporting-document / letter / form / attachment / certification volumes →
          // 'form' (previously mis-typed as 'narrative'); everything else is a narrative volume.
          const artifactType = /cost|budget|price/i.test(volName ?? '') ? 'cost'
            // 'commercialization report|CCR' — NOT bare 'commercial': a "Commercialization Plan/
            // Strategy" volume is a PROSE volume with a hard page limit; typing it 'form' would
            // exempt it from the readiness page gate and the font floor.
            : /support|letter|\bform\b|cover\s*sheet|attach|appendix|certif|commercialization\s+report|\bccr\b|training|fraud|waste|abuse/i.test(volName ?? '') ? 'form'
            : 'narrative';
          // The solicitation's own identifiers travel onto every artifact's frozen spec, so the
          // compliance floor can tell THIS topic number from a past proposal's. Without them the
          // check stays off and behaviour is unchanged.
          const { formatSpec, complianceSpec } = buildArtifactSpecs({ artifactType, items: (vol.items as Array<Record<string, unknown>>) ?? [], compliance: resolved.compliance, ownIdentifiers: [t.topicNumber, t.solicitationNumber] });
          const [art] = await tx<{ id: string }[]>`
            INSERT INTO proposal_artifacts (proposal_id, volume_number, volume_name, artifact_type, format_spec, compliance_spec)
            VALUES (${p.id}, ${volNum}, ${volName}, ${artifactType}, ${sql.json((formatSpec) as unknown as Parameters<typeof sql.json>[0])}, ${sql.json((complianceSpec) as unknown as Parameters<typeof sql.json>[0])})
            RETURNING id
          `;
          artifactByVolKey.set(volKey(volNum, volName), art.id);
          artifactTypeByVolKey.set(volKey(volNum, volName), artifactType);
          // The VOLUME's page cap, kept so each section's canvas envelope can carry it (see the
          // canvas.max_pages note in the section loop). Distinct from an item's page_allocation.
          volumeCapByVolKey.set(volKey(volNum, volName), (complianceSpec as { max_pages?: number | null } | null)?.max_pages ?? null);
        }
        // Which item in each COST volume receives the computed workbook. The rule lives in
        // lib/proposal/cost-workbook-item so the MOLD BUILDER can use the same one to decide what
        // not to mold — when the two disagreed, a mold displaced the computed workbook entirely.
        const costWorkbookItem = pickCostWorkbookItems(
          requiredItems,
          (vkey) => artifactTypeByVolKey.get(vkey) === 'cost',
        );
        // OTF / state-grant budget caps (used by the otf_state_budget cost form), from the preset's
        // custom variables. Absent → the form's own defaults apply.
        const cvars = ((resolved.compliance as Record<string, unknown>)?.customVariables ?? {}) as Record<string, unknown>;
        const cvVal = (k: string): string | null => {
          const raw = cvars[k];
          if (raw == null) return null;
          if (typeof raw === 'object' && raw !== null && 'value' in (raw as Record<string, unknown>)) return String((raw as { value?: unknown }).value ?? '');
          return String(raw);
        };
        const cvNum = (k: string): number | null => { const s = cvVal(k); if (s == null) return null; const n = Number(s.replace(/[^0-9.]/g, '')); return Number.isFinite(n) && n > 0 ? n : null; };
        const costCeiling = cvNum('budget_cap_usd');
        const persRaw = cvNum('personnel_max_pct');
        const personnelMax = persRaw != null ? (persRaw > 1 ? persRaw / 100 : persRaw) : null;
        const costShareAllowed = (cvVal('cost_share_allowed') ?? '').toLowerCase() === 'true';
        for (const item of requiredItems) {
          const artifactId = artifactByVolKey.get(volKey(item.volumeNumber, item.volumeName)) ?? null;
          const [section] = await tx<{ id: string }[]>`
            INSERT INTO proposal_sections (proposal_id, artifact_id, section_number, sort_index, title, content, status, page_allocation, character_allocation, volume_name, volume_number, section_type, meta)
            VALUES (${p.id}, ${artifactId}, ${String(item.itemNumber)}, ${item.itemNumber}, ${item.itemName}, ${null}, 'empty', ${item.pageLimit}, ${item.characterLimit}, ${item.volumeName}, ${item.volumeNumber}, ${inferSectionType(item.itemName, sectionStandards)}, ${tx.json({ itemType: item.itemType ?? null, volumeName: item.volumeName ?? null, expertNotes: item.expertNotes ?? null })})
            RETURNING id
          `;
          // Compliance matrix: one requirement row per required item, linked to the
          // section that addresses it. This is what the card's percentComplete + the
          // workspace compliance tab read; the greenfield portal-launch path previously
          // skipped it (card stuck at 0%). Rows start 'not_addressed' → 'satisfied' on lock.
          await tx`
            INSERT INTO proposal_compliance_matrix
              (proposal_id, requirement_text, requirement_source, is_mandatory, status, section_id)
            VALUES (${p.id}, ${item.itemName}, ${item.volumeName ?? 'RFP'}, true, 'not_addressed', ${section.id})
          `;
          const vkey = volKey(item.volumeNumber, item.volumeName);
          const isCostVolume = artifactTypeByVolKey.get(vkey) === 'cost';
          const isChosenCostItem = isCostVolume && costWorkbookItem.get(vkey) === item.itemNumber;
          let templateDoc: CanvasDocument | null = null;
          if (item.templateId) {
            const [tpl] = await tx<{ canvasDocument: CanvasDocument | null; templateType: string | null }[]>`
              SELECT canvas_document, template_type FROM document_templates WHERE id = ${item.templateId}::uuid LIMIT 1`;
            if (tpl?.canvasDocument && Array.isArray((tpl.canvasDocument as { nodes?: unknown }).nodes)) {
              // The COMPUTED workbook must not be silently displaced on the data-bearing cost
              // item by a non-cost mold (a slide deck linked by mistake would drop the priced
              // roll-up for the whole volume). A cost-typed mold is an explicit admin override.
              if (isChosenCostItem && !/cost|budget|spreadsheet|price/i.test(tpl.templateType ?? '')) {
                console.error('[provision-proposal] linked mold on the cost data item is not cost-typed — using the computed workbook', { itemName: item.itemName, templateId: item.templateId, templateType: tpl.templateType });
              } else {
                templateDoc = tpl.canvasDocument;
              }
            } else {
              // Linked but unusable (missing/RLS-invisible/empty body): fall through — but LOUDLY,
              // this is an authored mold the buyer will not receive.
              console.error('[provision-proposal] linked mold unusable (missing, invisible, or empty) — falling back', { itemName: item.itemName, templateId: item.templateId });
            }
          }
          // Universal cost volume: the cost item (DoW / NSF / DOE / BAA / OTA — not just DoD SBIR) gets a
          // COMPUTED workbook, rendered in the common budget FORM the opportunity requires (DoD burden
          // waterfall · SF-424A federal grant · OTF state budget), taking precedence over the narrative
          // templates. Exactly the data-bearing item per cost volume (picked above); prose siblings stay empty.
          if (!templateDoc && isChosenCostItem) {
            const form = resolveCostForm({
              agency: t.agency, program: programType, volumeName: item.volumeName,
              volumeFormat: ((resolved.compliance as Record<string, unknown>)?.costVolumeFormat as string) ?? null,
            });
            templateDoc = buildCostVolume(form, {
              title: item.itemName, agency: t.agency, program: workshareProgram,
              companyName: tenantName, solicitationNumber: t.solicitationNumber, topicNumber: t.topicNumber,
              proposalId: p.id, solicitationId: t.solicitationId ?? '', actorId,
              ceiling: costCeiling, personnelMaxPct: personnelMax, costShareAllowed,
            });
          }
          // Registry fallback — but never hand a SECOND, statically-seeded cost sheet to a
          // non-chosen spreadsheet item in a cost volume (two inconsistent cost sheets in one xlsx).
          if (!templateDoc && !(isCostVolume && !isChosenCostItem && item.itemType === 'spreadsheet')) {
            const k = resolveTemplateKey(programType, item.itemType, item.itemName); if (k) templateDoc = getTemplate(k);
          }
          if (templateDoc) {
            // Older/API-created molds may lack a metadata object — stamping into undefined
            // would throw inside the provision transaction and fail the whole release.
            templateDoc.metadata = { ...(templateDoc.metadata ?? {}) } as CanvasDocument['metadata'];
            templateDoc.metadata.proposal_id = p.id;
            templateDoc.metadata.solicitation_id = t.solicitationId ?? '';
            templateDoc.metadata.created_at = new Date().toISOString();
            templateDoc.metadata.last_modified_at = new Date().toISOString();
            templateDoc.metadata.last_modified_by = actorId;
            templateDoc.document_id = section.id;
            // `canvas.max_pages` is the VOLUME's cap, not this item's share of it.
            //
            // Sections of one volume assemble into ONE document (assembleArtifactCanvas), and the
            // first section's canvas becomes that document's envelope — so stamping the item's own
            // limit here declares the whole volume to be as long as its shortest item. With the
            // Technical Volume's ten pages correctly split one page per item, the assembled volume
            // reported "6 of 1 pages" and the export floor would have refused it. The item's share
            // is carried separately and correctly, as `proposal_sections.page_allocation` →
            // `layout.page_budget`, which is what the per-section over-budget check reads.
            //
            // Slide limits are per-DECK and a deck item is its own document, so those still take
            // the item's number.
            const canv = (templateDoc as unknown as { canvas?: { format?: string; max_pages?: number | null; max_slides?: number | null } }).canvas;
            if (canv) {
              const isSlideCanvas = /slide/i.test(canv.format ?? '');
              const volumeCap = volumeCapByVolKey.get(vkey) ?? null;
              if (!isSlideCanvas && volumeCap != null) canv.max_pages = volumeCap;
              if (item.slideLimit != null && isSlideCanvas) canv.max_slides = item.slideLimit;
            }
            const interpolated = interpolateTemplate(templateDoc, templateVariables);
            // content_source='template': marks the canvas as PROVISIONED (mold/workbook/registry)
            // so the async V0 drafter treats it like human content and never clobbers it.
            await tx`UPDATE proposal_sections SET content = ${JSON.stringify(interpolated)}, status = 'ai_drafted', content_source = 'template' WHERE id = ${section.id}`;
          } else if (item.itemType === 'slide_deck') {
            // Blank slide item (no mold, no registry deck): provision an EMPTY slide-family
            // envelope so the editor and the async drafter author it as a deck, not a letter
            // doc. Status stays 'empty' — this is geometry, not content.
            const nowIso = new Date().toISOString();
            const envelope = {
              document_id: section.id, nodes: [],
              canvas: {
                format: 'slide_16_9', width: 960, height: 540,
                margins: { top: 36, right: 36, bottom: 36, left: 36 },
                header: null, footer: null,
                font_default: { family: 'Arial', size: 18 }, line_spacing: 1.1,
                max_pages: null, max_slides: item.slideLimit ?? null,
              },
              metadata: {
                title: item.itemName, proposal_id: p.id, solicitation_id: t.solicitationId ?? '',
                created_at: nowIso, last_modified_at: nowIso, last_modified_by: actorId,
              },
            };
            await tx`UPDATE proposal_sections SET content = ${JSON.stringify(envelope)} WHERE id = ${section.id}`;
          }
          count++;
        }
        // SPINE-T4 gap fix: a REQUIRED volume with ZERO required items still got an artifact above but
        // NO section — an invisible no-op volume (never locks, never blocks advance, invisible to
        // readiness, skipped by the zip), so a build could be "submission-ready" with a whole required
        // volume missing. Give every such volume a placeholder section + matrix row so it must be
        // authored + locked like any other.
        for (const vol of resolved.volumes) {
          if (authoredItems(vol as unknown as Record<string, unknown>).length > 0) continue;
          // …but NOT for a DSIP-only volume. It has no artifact (skipped above), so a placeholder
          // here would be an orphan section that can never be authored or locked — the exact
          // permanent readiness blocker this whole flag exists to prevent.
          if (!isAuthoredVolume(vol as unknown as Record<string, unknown>)) continue;
          const volName = (vol.volumeName as string) ?? null;
          const volNum = (vol.volumeNumber as number) ?? null;
          const artifactId = artifactByVolKey.get(volKey(volNum, volName)) ?? null;
          const [phSection] = await tx<{ id: string }[]>`
            INSERT INTO proposal_sections (proposal_id, artifact_id, section_number, sort_index, title, content, status, page_allocation, volume_name, volume_number)
            VALUES (${p.id}, ${artifactId}, '1', 1, ${volName ?? 'Volume content'}, ${null}, 'empty', ${null}, ${volName}, ${volNum})
            RETURNING id
          `;
          await tx`
            INSERT INTO proposal_compliance_matrix
              (proposal_id, requirement_text, requirement_source, is_mandatory, status, section_id)
            VALUES (${p.id}, ${volName ?? 'Volume content'}, ${volName ?? 'RFP'}, true, 'not_addressed', ${phSection.id})
          `;
          count++;
        }
      } else {
        const { formatSpec, complianceSpec } = buildArtifactSpecs({ artifactType: 'narrative', items: [], compliance: resolved.compliance, ownIdentifiers: [t.topicNumber, t.solicitationNumber] });
        const [defArt] = await tx<{ id: string }[]>`
          INSERT INTO proposal_artifacts (proposal_id, volume_number, volume_name, artifact_type, format_spec, compliance_spec)
          VALUES (${p.id}, 1, 'Technical Volume', 'narrative', ${sql.json((formatSpec) as unknown as Parameters<typeof sql.json>[0])}, ${sql.json((complianceSpec) as unknown as Parameters<typeof sql.json>[0])})
          RETURNING id
        `;
        const [defSection] = await tx<{ id: string }[]>`
          INSERT INTO proposal_sections (proposal_id, artifact_id, section_number, sort_index, title, content, status, page_allocation)
          VALUES (${p.id}, ${defArt.id}, '1', 1, 'Technical Volume', ${null}, 'empty', ${null})
          RETURNING id
        `;
        // Matrix: at least one requirement so the card burden isn't an empty 0% shell.
        await tx`
          INSERT INTO proposal_compliance_matrix
            (proposal_id, requirement_text, requirement_source, is_mandatory, status, section_id)
          VALUES (${p.id}, 'Technical Volume', 'RFP', true, 'not_addressed', ${defSection.id})
        `;
        count = 1;
      }

      // SPINE-T4 gap fix: seed the required SUPPORTING DOCUMENTS from the solicitation compliance, exactly
      // as the legacy manual-create route does. Without this the portal-provision path left
      // proposal_supporting_docs empty, so the `missing_document` submission blocker could NEVER fire for a
      // portal-built proposal — the #1 avoidable administrative DQ was silently unguarded.
      try {
        if (t.solicitationId) {
          const [comp] = await tx<Array<{ requiredDocuments: unknown; fieldProvenance: unknown }>>`
            SELECT required_documents AS "requiredDocuments", field_provenance AS "fieldProvenance"
            FROM solicitation_compliance
            WHERE solicitation_id = ${t.solicitationId}::uuid LIMIT 1`;
          const reqDocs = comp?.requiredDocuments;
          // Where the LIST came from. A value the product did not read from the solicitation must
          // never look like one it did (docs/INGEST_PROVENANCE.md) — and a hard submission blocker
          // is the strongest way of looking like one. The T3CP skeleton's default list carries
          // "CMMC Reps & Certs", which that BAA does not require as an attachment at all: it is a
          // DSIP representation. Provisioned as a blocker, it made the build unsubmittable for a
          // document that does not exist. Carried through here, readiness downgrades a defaulted
          // requirement to a warning — still on the checklist, no longer a wall.
          const prov = coerceJsonb<Record<string, { source?: string }>>(comp?.fieldProvenance, {});
          const listProvenance = prov?.required_documents?.source ?? null;
          if (Array.isArray(reqDocs)) {
            for (const doc of reqDocs) {
              const d = doc as { name?: string; label?: string; source?: string; reference?: string; required?: boolean } | string;
              const label = typeof d === 'string' ? d : (d.name || d.label || String(d));
              const perDoc = typeof d === 'object' && d !== null ? (d.source || d.reference || null) : null;
              // Prefer the item's own citation; fall back to how the LIST was obtained.
              const source = perDoc ?? (listProvenance ? `provenance:${listProvenance}` : null);
              const required = typeof d === 'object' && d !== null ? (d.required !== false) : true;
              await tx`
                INSERT INTO proposal_supporting_docs
                  (proposal_id, tenant_id, requirement_label, requirement_source, category, is_required, status)
                VALUES (${p.id}::uuid, ${tenantId}::uuid, ${label}, ${source}, 'supporting_document', ${required}, 'missing')`;
            }
          }
        }
        // The user-upload placeholder categories (mirrors the legacy create route).
        await tx`
          INSERT INTO proposal_supporting_docs
            (proposal_id, tenant_id, requirement_label, category, is_required, status)
          VALUES
            (${p.id}::uuid, ${tenantId}::uuid, 'Proposal Input Materials', 'proposal_input', false, 'missing'),
            (${p.id}::uuid, ${tenantId}::uuid, 'Other Documents', 'other', false, 'missing')`;
      } catch (docErr) {
        console.error('[provisionProposalForPortal] supporting-doc seed failed (non-fatal):', docErr);
      }

      return { proposalId: p.id as string, sectionCount: count };
    });

    await emitEventEnd(eventId, { result: { tenantId, tenantSlug, proposalId: out.proposalId, sectionCount: out.sectionCount, title: proposalTitle } });

    // The best-effort tail writes to RLS-forced tables (tasks, library_seed_jobs, the agent
    // queue) via the context-aware `sql`, but runs OUTSIDE the withTenant block above — so it
    // needs its OWN tenant context, else a caller without an ambient one (the admin cockpit's
    // cross-tenant "Complete & Release", provisionAndReleasePortal) trips RLS and silently drops
    // the buyer's review ToDos + reuse suggester. Scope the whole tail to the buyer tenant. Still
    // best-effort — a failure inside never fails the provision.
    await runInTenant(tenantId, async () => {
      // #190 C3: pre-stage the review-gate ToDos (agent drafts V0 → human reviews),
      // policy-parameterized + agent-first aware.
      try {
        await preStageProposalReviewTodos({ tenantId, proposalId: out.proposalId, opportunityId, label, actorId, actorEmail });
      } catch (e) {
        console.error('[provision-proposal] prestage review todos failed (non-fatal)', e);
      }

      // Create library seed job + enqueue suggester (non-blocking). The suggester scans existing
      // library atoms for prior-proposal content that matches the new compliance matrix, surfacing
      // ranked candidates to the admin.
      try {
        // ON CONFLICT restates the partial-unique predicate of idx_library_seed_jobs_active
        // (one active job per proposal): a re-provision no-ops instead of throwing a
        // duplicate-key error. On conflict RETURNING yields no row, so the suggester
        // isn't re-enqueued — the existing active job already owns that work.
        const [seedJob] = await sql<{ id: string }[]>`
          INSERT INTO library_seed_jobs (tenant_id, proposal_id, status)
          VALUES (${tenantId}, ${out.proposalId}, 'analyzing')
          ON CONFLICT (proposal_id) WHERE status <> ALL (ARRAY['applied', 'skipped'])
          DO NOTHING
          RETURNING id
        `;
        if (seedJob?.id) {
          await requestAgentTask({
            tenantId,
            agentRole: 'library_seed_suggester',
            taskType: 'seed_suggest',
            input: { proposal_id: out.proposalId, tenant_id: tenantId, seed_job_id: seedJob.id },
            proposalId: out.proposalId,
          });
        }
      } catch (e) {
        // Non-blocking — provision succeeds even if seed job creation fails
        console.error('[provision-proposal] seed job init failed (non-blocking)', e);
      }
    });
    return out;
  } catch (e) {
    console.error('[provision-proposal] transaction failed', e);
    try { await emitEventEnd(eventId, { error: { message: e instanceof Error ? e.message : String(e), code: 'DB_ERROR' } }); } catch { /* best-effort */ }
    return { error: 'provisioning failed' };
  }
}

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
import { emitEventStart, emitEventEnd } from '@/lib/events';
import { preStageProposalReviewTodos } from '@/lib/automation/prestage-todos';
import { resolveTopicCompliance } from '@/lib/compliance-resolver';
import { buildArtifactSpecs } from '@/lib/artifact-spec';
import { inferSectionType, type SectionStandard } from '@/lib/section-standards';
import { resolveTemplateKey, getTemplate, interpolateTemplate } from '@/lib/templates';
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

  const baseTitle = t.topicNumber ? `${t.topicNumber}: ${t.title}` : t.title;
  const proposalTitle = label && label !== 'primary' ? `${baseTitle} [${label}]` : baseTitle;

  const resolved = await resolveTopicCompliance(opportunityId);
  const requiredItems: Array<{ itemNumber: number; itemName: string; itemType: string; pageLimit: number | null; volumeName: string | null; volumeNumber: number | null; templateId: string | null; expertNotes: string | null }> = [];
  let gi = 0;
  for (const vol of resolved.volumes) {
    for (const item of vol.items) {
      gi++;
      requiredItems.push({
        itemNumber: gi, itemName: item.itemName as string, itemType: item.itemType as string,
        pageLimit: (item.pageLimit as number) ?? null, volumeName: (vol.volumeName as string) ?? null,
        volumeNumber: (vol.volumeNumber as number) ?? null, templateId: (item.templateId as string) ?? null,
        expertNotes: (item.expertNotes as string) ?? null,
      });
    }
  }

  const templateVariables: Record<string, string> = {
    company_name: tenantName, topic_number: t.topicNumber ?? '', topic_title: t.title,
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
      const volKey = (num: number | null, name: string | null) => `${num ?? ''}|${name ?? ''}`;
      const programType = t.programType ?? '';

      if (requiredItems.length > 0) {
        for (const vol of resolved.volumes) {
          const volName = (vol.volumeName as string) ?? null;
          const volNum = (vol.volumeNumber as number) ?? null;
          const artifactType = /cost|budget|price/i.test(volName ?? '') ? 'cost' : 'narrative';
          const { formatSpec, complianceSpec } = buildArtifactSpecs({ artifactType, items: (vol.items as Array<Record<string, unknown>>) ?? [], compliance: resolved.compliance });
          const [art] = await tx<{ id: string }[]>`
            INSERT INTO proposal_artifacts (proposal_id, volume_number, volume_name, artifact_type, format_spec, compliance_spec)
            VALUES (${p.id}, ${volNum}, ${volName}, ${artifactType}, ${sql.json((formatSpec) as unknown as Parameters<typeof sql.json>[0])}, ${sql.json((complianceSpec) as unknown as Parameters<typeof sql.json>[0])})
            RETURNING id
          `;
          artifactByVolKey.set(volKey(volNum, volName), art.id);
        }
        for (const item of requiredItems) {
          const artifactId = artifactByVolKey.get(volKey(item.volumeNumber, item.volumeName)) ?? null;
          const [section] = await tx<{ id: string }[]>`
            INSERT INTO proposal_sections (proposal_id, artifact_id, section_number, title, content, status, page_allocation, volume_name, volume_number, section_type, meta)
            VALUES (${p.id}, ${artifactId}, ${String(item.itemNumber)}, ${item.itemName}, ${null}, 'empty', ${item.pageLimit}, ${item.volumeName}, ${item.volumeNumber}, ${inferSectionType(item.itemName, sectionStandards)}, ${tx.json({ itemType: item.itemType ?? null, volumeName: item.volumeName ?? null, expertNotes: item.expertNotes ?? null })})
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
          let templateDoc: CanvasDocument | null = null;
          if (item.templateId) {
            const [tpl] = await tx<{ canvasDocument: CanvasDocument | null }[]>`SELECT canvas_document FROM document_templates WHERE id = ${item.templateId}::uuid LIMIT 1`;
            if (tpl?.canvasDocument && Array.isArray((tpl.canvasDocument as { nodes?: unknown }).nodes)) templateDoc = tpl.canvasDocument;
          }
          if (!templateDoc) { const k = resolveTemplateKey(programType, item.itemType); if (k) templateDoc = getTemplate(k); }
          if (templateDoc) {
            templateDoc.metadata.proposal_id = p.id;
            templateDoc.metadata.solicitation_id = t.solicitationId ?? '';
            templateDoc.metadata.created_at = new Date().toISOString();
            templateDoc.metadata.last_modified_at = new Date().toISOString();
            templateDoc.metadata.last_modified_by = actorId;
            templateDoc.document_id = section.id;
            const interpolated = interpolateTemplate(templateDoc, templateVariables);
            await tx`UPDATE proposal_sections SET content = ${JSON.stringify(interpolated)}, status = 'ai_drafted' WHERE id = ${section.id}`;
          }
          count++;
        }
      } else {
        const { formatSpec, complianceSpec } = buildArtifactSpecs({ artifactType: 'narrative', items: [], compliance: resolved.compliance });
        const [defArt] = await tx<{ id: string }[]>`
          INSERT INTO proposal_artifacts (proposal_id, volume_number, volume_name, artifact_type, format_spec, compliance_spec)
          VALUES (${p.id}, 1, 'Technical Volume', 'narrative', ${sql.json((formatSpec) as unknown as Parameters<typeof sql.json>[0])}, ${sql.json((complianceSpec) as unknown as Parameters<typeof sql.json>[0])})
          RETURNING id
        `;
        const [defSection] = await tx<{ id: string }[]>`
          INSERT INTO proposal_sections (proposal_id, artifact_id, section_number, title, content, status, page_allocation)
          VALUES (${p.id}, ${defArt.id}, '1', 'Technical Volume', ${null}, 'empty', ${null})
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
      return { proposalId: p.id as string, sectionCount: count };
    });

    await emitEventEnd(eventId, { result: { tenantId, tenantSlug, proposalId: out.proposalId, sectionCount: out.sectionCount, title: proposalTitle } });
    // #190 C3: pre-stage the review-gate ToDos (agent drafts V0 → human reviews),
    // policy-parameterized + agent-first aware. Best-effort: never fails provisioning.
    try {
      await preStageProposalReviewTodos({ tenantId, proposalId: out.proposalId, opportunityId, label, actorId, actorEmail });
    } catch (e) {
      console.error('[provision-proposal] prestage review todos failed (non-fatal)', e);
    }

    // Create library seed job + enqueue suggester (best-effort, non-blocking).
    // The suggester scans existing library atoms for prior-proposal content that
    // matches the new compliance matrix, surfaces ranked candidates to the admin.
    try {
      const [seedJob] = await sql<{ id: string }[]>`
        INSERT INTO library_seed_jobs (tenant_id, proposal_id, status)
        VALUES (${tenantId}, ${out.proposalId}, 'analyzing')
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
    return out;
  } catch (e) {
    console.error('[provision-proposal] transaction failed', e);
    try { await emitEventEnd(eventId, { error: { message: e instanceof Error ? e.message : String(e), code: 'DB_ERROR' } }); } catch { /* best-effort */ }
    return { error: 'provisioning failed' };
  }
}

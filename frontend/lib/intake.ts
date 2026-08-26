/**
 * RFP intake staging (greenfield-adjacent; the head of the RFP river). Stages a
 * found/uploaded opportunity NOTICE into the review queue: creates an opportunity
 * (is_active = false — not yet in the live master list) + a curated_solicitation
 * (status 'new') carrying Scout-shaped intake_meta (POC, source, downloadable?). The
 * RFP admin then claims → curates → approves → releases (push), which flips is_active
 * and publishes the card to the bridge.
 *
 * Notice-first + files-optional: matches "for now, Scouts find and alert if they
 * cannot download directly". Today the admin calls this; Scout calls the same entry.
 */

import { sql } from '@/lib/db';
import { randomUUID } from 'crypto';

export interface IntakeInput {
  title: string;
  agency: string;
  office?: string | null;
  orgUnit?: string | null;              // 3rd org level (department:org:unit)
  solicitationNumber?: string | null;
  programType?: string | null;
  closeDate?: string | null;
  postedDate?: string | null;
  preReleaseDate?: string | null;
  description?: string | null;
  expertNotes?: string | null;          // RFP Expert Notes at the opp level
  submissionStage?: 'nofo' | 'pre_release'; // initial pre-release stage (default pre_release)
  namespace?: string | null;
  // Scout-shaped metadata (the "and other meta-data, etc." the notice carries).
  intakeMeta?: {
    poc?: string;
    pocEmail?: string;
    sourceUrl?: string;
    foundBy?: string;          // 'scout' | 'admin' | source profile id
    docsDownloadable?: boolean;
    noticeType?: string;
    raw?: Record<string, unknown>;
  };
}

export interface StagedIntake {
  opportunityId: string;
  solicitationId: string;
  status: 'new';
}

/** Stage a notice into the RFP review queue. Idempotent-ish via a stable source_id. */
export async function stageIntake(input: IntakeInput, actorId: string | null): Promise<StagedIntake | { error: string }> {
  const title = input.title?.trim();
  const agency = input.agency?.trim();
  if (!title) return { error: 'title is required' };
  if (!agency) return { error: 'agency is required' };

  const oppId = randomUUID();
  const foundBy = input.intakeMeta?.foundBy ?? 'admin';
  const sourceId = `intake-${oppId}`;
  // Ingested (not yet released) opps sit in the pre-release band; push moves them to 'open'.
  const stage = input.submissionStage === 'nofo' ? 'nofo' : 'pre_release';
  // built_by is a users FK — only set it when the actor is a real user id.
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const builtBy = actorId && UUID_RE.test(actorId) ? actorId : null;

  try {
    const result = await sql.begin(async (tx: any) => {
      const [opp] = await tx<Array<{ id: string }>>`
        INSERT INTO opportunities
          (id, source, source_id, title, agency, office, org_unit, program_type,
           solicitation_number, close_date, posted_date, pre_release_date, description, expert_notes,
           submission_stage, lifecycle_status, built_by, content_hash, is_active)
        VALUES
          (${oppId}::uuid, ${'intake:' + foundBy}, ${sourceId},
           ${title}, ${agency}, ${input.office ?? null}, ${input.orgUnit ?? null}, ${input.programType ?? null},
           ${input.solicitationNumber ?? null}, ${input.closeDate ?? null}, ${input.postedDate ?? null},
           ${input.preReleaseDate ?? null}, ${input.description ?? null}, ${input.expertNotes ?? null},
           ${stage}, 'open', ${builtBy}, md5(${title} || ${input.description ?? ''}),
           false)
        RETURNING id
      `;
      const [csol] = await tx<Array<{ id: string }>>`
        INSERT INTO curated_solicitations (opportunity_id, namespace, status, intake_meta)
        VALUES (${opp.id}::uuid, ${input.namespace ?? 'pending'}, 'new',
                ${sql.json((input.intakeMeta ?? {}) as Parameters<typeof sql.json>[0])})
        RETURNING id
      `;
      // STAMP THE BACK-LINK TOO (bug log B46). Writing only the forward link left this path — the
      // head of the river, used by admin intake AND the #176 scout release — creating opportunities
      // whose `solicitation_id` is NULL, while every topic path stamps it. The result was a column
      // that is populated for some rows and not others for no reason a reader can infer, so each
      // reader either learns the fallback or is silently wrong: `compliance-resolver` carries an
      // explicit umbrella arm precisely because without it "an umbrella purchase resolves to a
      // NON-degraded empty result and the buyer is provisioned a default skeleton while the fully-
      // authored master sits unread", and `drive-baa-forward.mjs` reported "nothing reached a tenant
      // card" against a push that had just created seventeen.
      //
      // Safe to stamp on an umbrella: every topic-only query filters on `topic_number` as well
      // (extract-topics, ingest-topic-files, opportunity-add-topic, bulk-add-topics), and the two
      // that want both arms already union them explicitly (solicitation-push, curation/republish),
      // so no existing query changes its result set. Same transaction as both inserts, so the pair
      // is never half-written.
      await tx`
        UPDATE opportunities SET solicitation_id = ${csol.id}::uuid, updated_at = now()
        WHERE id = ${opp.id}::uuid
      `;
      return { opportunityId: opp.id, solicitationId: csol.id };
    });

    // Head-of-river events (finder namespace, platform-scope). Two consumers, best-effort:
    //   opportunity.staged     — the intake-queue UI picks up the new row.
    //   opportunities.detected — wakes OnOpportunitiesDetected: opportunity_scout AI prioritization
    //     of the triage backlog + the rfp_admin "new to triage" email + a triage ToDo. One new triage
    //     row = one detection (bounded; the processor dedups by trigger_event_id). This is the single
    //     live producer for that chain — both the admin intake form and the scout releaseAsNew path
    //     funnel through stageIntake, so both now announce themselves.
    try {
      const { emitEventSingle } = await import('@/lib/events');
      const actor = { type: (actorId ? 'user' : 'system') as 'user' | 'system', id: actorId ?? 'scout' };
      await emitEventSingle({
        namespace: 'finder',
        type: 'opportunity.staged',
        actor,
        tenantId: null,
        payload: { correlationId: randomUUID(), opportunityId: result.opportunityId, solicitationId: result.solicitationId, foundBy },
      });
      await emitEventSingle({
        namespace: 'finder',
        type: 'opportunities.detected',
        actor,
        tenantId: null,
        payload: {
          correlationId: randomUUID(),
          source: 'intake:' + foundBy,
          newSolicitations: 1,
          newTopics: 0,
          sampleTitles: [title],
          runId: result.solicitationId,
          // The triage ToDo's identity. It used to carry a STATIC title and an entity_ref of
          // `source` — a string like "intake:admin", which tasks.entity_id (uuid) silently
          // dropped. So every intake raised a row reading "Triage new opportunities from source"
          // with no link: 21 open, 1 distinct title, entity_id NULL on all of them. The intakes
          // were real; the rows just could not be told apart or opened. These two fields name the
          // solicitation and point at it (entity_type 'solicitation' → /admin/rfp-curation/<id>).
          solicitationId: result.solicitationId,
          triageTitle: `Triage new opportunity: ${title}`.slice(0, 300),
        },
      });
    } catch {
      // best-effort
    }

    return { opportunityId: result.opportunityId, solicitationId: result.solicitationId, status: 'new' };
  } catch (e) {
    console.error('[intake] stageIntake failed', e);
    return { error: 'Failed to stage intake' };
  }
}

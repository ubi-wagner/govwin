/**
 * ingest-topic-files — the "N topic files → N topic opportunities" ingest.
 *
 * The umbrella model (013): a topic IS an `opportunities` row with
 * solicitation_id → its umbrella curated_solicitation + a topic_number. A
 * topic file lands as solicitation_documents(document_type='topic', 015).
 * Historically `upload-topic-files` stored the files but did NOT create the
 * opportunities (the admin then hand-clicked a bulk-add modal). This closes
 * that gap: for each uploaded topic file we
 *   dedupe → store → extract text → create the topic document → create the
 *   topic opportunity (canonical INSERT shape, linked via origin_document_id).
 *
 * Activation stays with the existing `solicitation.push` fan-out, whose
 * WHERE clause (`solicitation_id = <sol> OR id = <landing>`) already publishes
 * umbrella + every topic to the bridge — so no downstream change is needed:
 * uploading 20 topic files then pushing fans 21 cards to every tenant.
 *
 * Storage is injected (`store`, default `putObject`) so the flow is testable
 * and drive-verifiable without live object storage.
 */

import { capSourceText } from '@/lib/ingest/source-text-cap';
import { createHash } from 'crypto';
import { sql } from '@/lib/db';
import { putObject } from '@/lib/storage/s3-client';
import { emitEventSingle } from '@/lib/events';
import { activateLateTopicIfReady } from '@/lib/curation/republish';
import { randomUUID } from 'crypto';

export interface TopicFileInput {
  name: string;
  type: string;
  size: number;
  buffer: Buffer;
}

export type StoreFn = (args: {
  key: string;
  body: Buffer;
  contentType: string;
  metadata?: Record<string, string>;
}) => Promise<unknown>;

export interface IngestedTopic {
  opportunityId: string;
  documentId: string;
  topicNumber: string;
  title: string;
  textExtracted: boolean;
}

export interface TopicFileIngestResult {
  solicitationId: string;
  created: IngestedTopic[];
  skipped: Array<{ filename: string; reason: 'duplicate_file' | 'duplicate_topic' }>;
  failed: Array<{ filename: string; error: string }>;
  /** Pushed-umbrella late additions: released to the bridge now / parked for a close date. */
  lateReleased?: number;
  needsCloseDate?: number;
}

export class SolicitationNotFoundError extends Error {
  constructor(id: string) {
    super(`solicitation not found: ${id}`);
    this.name = 'SolicitationNotFoundError';
  }
}

// Common topic-number patterns in filenames (e.g. "AF241-0001", "N251_012").
const TOPIC_RE = /([A-Z]{1,5}\d{2,3}[._-]\w{1,10})/i;

function parseTopicFromFilename(filename: string): { topicNumber: string | null; title: string } {
  const base = filename.replace(/\.[^.]+$/, '').replace(/[_-]/g, ' ').trim();
  const m = filename.match(TOPIC_RE);
  const topicNumber = m ? m[1].replace(/_/g, '-') : null;
  const title = topicNumber
    ? base.replace(m![0].replace(/_/g, ' '), '').replace(/^\s*[-_:]\s*/, '').trim() || topicNumber
    : base;
  return { topicNumber, title };
}

function slugify(name: string): string {
  return (
    name
      .replace(/\.[^.]+$/, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60) || 'topic'
  );
}

function extFromName(name: string): string {
  return (name.match(/\.([a-zA-Z0-9]+)$/)?.[1] ?? 'pdf').toLowerCase();
}

/** Best-effort text extraction. Plain text/markdown read directly; PDFs via
 *  the shared pdf-parse loader. Anything else (docx, unknown) returns null —
 *  the topic opportunity is still created, just without body text. */
async function extractText(buffer: Buffer, filename: string): Promise<string | null> {
  const ext = extFromName(filename);
  try {
    if (ext === 'txt' || ext === 'md') {
      const t = capSourceText(buffer.toString('utf8')).text;
      return t.trim().length > 0 ? t : null;
    }
    if (ext === 'pdf') {
      const { loadPdfParse } = await import('@/lib/pdf-parse-quiet');
      const { PDFParse } = await loadPdfParse();
      const parser = new PDFParse({ data: new Uint8Array(buffer) });
      const textResult = await parser.getText();
      const raw = capSourceText(textResult.text).text;
      try { await parser.destroy(); } catch { /* ignore cleanup */ }
      return raw.length > 40 ? raw : null;
    }
  } catch (err) {
    console.error('[ingest-topic-files] text extraction failed (non-fatal):', filename, err);
  }
  return null;
}

/** Condense extracted text into a one-paragraph topic description. */
function deriveDescription(text: string | null): string | null {
  if (!text) return null;
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (cleaned.length < 20) return null;
  return cleaned.slice(0, 800);
}

export async function ingestTopicFilesForSolicitation(params: {
  solicitationId: string;
  files: TopicFileInput[];
  userId: string | null;
  store?: StoreFn;
}): Promise<TopicFileIngestResult> {
  const { solicitationId, files, userId } = params;
  const store = params.store ?? putObject;

  // Resolve the umbrella + landing opportunity (for path + inherited metadata).
  const solRows = await sql<
    {
      id: string;
      opportunityId: string | null;
      inheritSource: string | null;
      inheritAgency: string | null;
      inheritOffice: string | null;
      inheritProgramType: string | null;
    }[]
  >`
    SELECT cs.id, cs.opportunity_id,
           o.source AS inherit_source, o.agency AS inherit_agency,
           o.office AS inherit_office, o.program_type AS inherit_program_type
    FROM curated_solicitations cs
    LEFT JOIN opportunities o ON o.id = cs.opportunity_id
    WHERE cs.id = ${solicitationId}::uuid
  `;
  if (solRows.length === 0) throw new SolicitationNotFoundError(solicitationId);
  const parent = solRows[0];
  const pathOppId = parent.opportunityId ?? solicitationId;

  const result: TopicFileIngestResult = {
    solicitationId,
    created: [],
    skipped: [],
    failed: [],
  };
  // Topic numbers claimed within THIS batch, so two files that parse to the
  // same token don't both try to insert (the second is skipped as a dup).
  const claimed = new Set<string>();

  for (const file of files) {
    const displayName = (file.name.replace(/\\/g, '/').split('/').pop() ?? file.name).slice(0, 255);
    try {
      const hash = createHash('sha256').update(file.buffer).digest('hex');

      // Global file dedup (same physical file already ingested anywhere).
      const dupe = await sql<{ id: string }[]>`
        SELECT id FROM solicitation_documents WHERE content_hash = ${hash} LIMIT 1
      `;
      if (dupe.length > 0) {
        result.skipped.push({ filename: displayName, reason: 'duplicate_file' });
        continue;
      }

      // Topic number: parsed from the filename, else a slug-derived token, else
      // a hash token. This is both the human label and the (sol, topic_number)
      // dedup key + the source_id component (UNIQUE(source, source_id)).
      const slug = slugify(displayName);
      const parsed = parseTopicFromFilename(displayName);
      const topicNumber =
        parsed.topicNumber ??
        (slug !== 'topic' ? slug.toUpperCase().slice(0, 24) : `T-${hash.slice(0, 8).toUpperCase()}`);
      const title = parsed.title || topicNumber;

      // Dedup on (solicitation_id, topic_number): same topic under the same
      // umbrella is the same topic. Also guard within-batch collisions.
      if (claimed.has(topicNumber)) {
        result.skipped.push({ filename: displayName, reason: 'duplicate_topic' });
        continue;
      }
      const existingTopic = await sql<{ id: string }[]>`
        SELECT id FROM opportunities
        WHERE solicitation_id = ${solicitationId}::uuid AND topic_number = ${topicNumber}
        LIMIT 1
      `;
      if (existingTopic.length > 0) {
        result.skipped.push({ filename: displayName, reason: 'duplicate_topic' });
        continue;
      }
      claimed.add(topicNumber);

      // Store the file (injected; default R2/S3).
      const ext = extFromName(displayName);
      const storageKey = `rfp-pipeline/${pathOppId}/topics/${slug}-${hash.slice(0, 8)}.${ext}`;
      await store({
        key: storageKey,
        body: file.buffer,
        contentType: file.type || 'application/pdf',
        metadata: { 'original-filename': displayName, 'topic-number': topicNumber },
      });

      const extractedText = await extractText(file.buffer, displayName);

      /* Create the topic document (document_type='topic').
       *
       * THE ON CONFLICT MUST NAME THE INDEX'S OWN COLUMN LIST. The unique index it arbitrates is
       * two columns, not one:
       *
       *   CREATE UNIQUE INDEX idx_sol_docs_hash_per_solicitation
       *     ON solicitation_documents (solicitation_id, content_hash)
       *     WHERE content_hash IS NOT NULL
       *
       * This named only (content_hash), which matches no index, so Postgres raised "there is no
       * unique or exclusion constraint matching the ON CONFLICT specification" and EVERY topic
       * upload failed. The route returned 201 with an empty created list and the error tucked into
       * a per-file failed entry, so it read as a document that would not parse rather than SQL that
       * never ran. It stayed invisible because the only spec exercising this path was skipping for
       * two unrelated fixtures. (CLAUDE.md data-layer rule: restate the index's columns AND its
       * WHERE predicate.)
       *
       * Per-solicitation is also the semantics the index name states and the one we want: the same
       * PDF attached to two different solicitations is two legitimate documents; only a re-upload
       * to the SAME solicitation is a duplicate.
       */
      const docRows = await sql<{ id: string }[]>`
        INSERT INTO solicitation_documents
          (solicitation_id, document_type, original_filename, storage_key,
           file_size, content_type, content_hash, extracted_text, uploaded_by, metadata)
        VALUES
          (${solicitationId}::uuid, 'topic', ${displayName}, ${storageKey},
           ${file.size}, ${file.type || null}, ${hash}, ${extractedText},
           ${userId ?? null}::uuid,
           ${sql.json({ parsed_topic_number: parsed.topicNumber, parsed_title: title } as Parameters<typeof sql.json>[0])})
        ON CONFLICT (solicitation_id, content_hash) WHERE content_hash IS NOT NULL DO NOTHING
        RETURNING id
      `;
      if (docRows.length === 0) {
        // Lost a concurrent dedup race — treat as duplicate.
        result.skipped.push({ filename: displayName, reason: 'duplicate_file' });
        continue;
      }
      const documentId = docRows[0].id;

      // Create the topic opportunity (canonical shape + origin_document_id).
      const source = parent.inheritSource ?? 'manual_upload';
      const sourceId = `${solicitationId.slice(0, 8)}-${topicNumber}`;
      const oppRows = await sql<{ id: string }[]>`
        INSERT INTO opportunities
          (source, source_id, title, agency, office, program_type,
           description, content_hash, is_active,
           solicitation_id, topic_number, topic_status,
           tech_focus_areas, naics_codes, origin_document_id)
        VALUES
          (${source}, ${sourceId}, ${title},
           ${parent.inheritAgency ?? null}, ${parent.inheritOffice ?? null},
           ${parent.inheritProgramType ?? null},
           ${deriveDescription(extractedText)},
           md5(${solicitationId} || ${topicNumber} || ${title}), true,
           ${solicitationId}::uuid, ${topicNumber}, 'open',
           ${'{}'}::text[], ${'{}'}::text[], ${documentId}::uuid)
        ON CONFLICT (source, source_id) DO NOTHING
        RETURNING id
      `;
      if (oppRows.length === 0) {
        // A topic opportunity with this source_id already exists — the file is
        // recorded but the OPP wasn't (re)created. Treat as a topic dup.
        result.skipped.push({ filename: displayName, reason: 'duplicate_topic' });
        continue;
      }

      result.created.push({
        opportunityId: oppRows[0].id,
        documentId,
        topicNumber,
        title,
        textExtracted: extractedText !== null,
      });
    } catch (err) {
      console.error('[ingest-topic-files] file failed:', displayName, err);
      result.failed.push({
        filename: displayName,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (result.created.length > 0) {
    // The umbrella now has real topics under it.
    await sql`
      UPDATE curated_solicitations
      SET solicitation_type = 'multi_topic', updated_at = now()
      WHERE id = ${solicitationId}::uuid AND solicitation_type = 'single'
    `;
    try {
      await emitEventSingle({
        namespace: 'finder',
        type: 'topic.imported',
        actor: { type: 'user', id: userId ?? 'unknown' },
        tenantId: null,
        payload: {
          correlationId: randomUUID(),
          solicitationId,
          topicCount: result.created.length,
          opportunityIds: result.created.map((c) => c.opportunityId),
          via: 'topic_file_ingest',
        },
      });
    } catch (evtErr) {
      console.error('[ingest-topic-files] event emission failed (non-fatal):', evtErr);
    }
    // Topic files dropped on an ALREADY-PUSHED umbrella are late additions — release
    // each to the bridge now if date-complete (extracted topics usually lack a close
    // date, so most park at needs_close_date until the admin sets one; date guard).
    for (const c of result.created) {
      const late = await activateLateTopicIfReady(c.opportunityId, { id: userId ?? null });
      if (late.released) result.lateReleased = (result.lateReleased ?? 0) + 1;
      else if (late.reason === 'needs_close_date') result.needsCloseDate = (result.needsCloseDate ?? 0) + 1;
    }
  }

  return result;
}

/**
 * POST /api/admin/sources/[profileId]/paste-import
 *
 * Parse pasted content (from a web table copy, pipe-separated text, or
 * CSV) and create topic records under a solicitation. Detects format
 * automatically, extracts header + data rows, and bulk-inserts topics.
 *
 * Auth: master_admin or rfp_admin
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql } from '@/lib/db';
import { emitEventStart, emitEventEnd, userActor } from '@/lib/events';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface RouteContext {
  params: Promise<{ profileId: string }>;
}

// ─── Types ──────────────────────────────────────────────────────────

interface ParsedTopic {
  topicNumber: string;
  title: string;
  openDate: string | null;
  closeDate: string | null;
  branch: string | null;
  release: string | null;
}

type DetectedFormat = 'tab' | 'pipe' | 'comma' | 'html';

// ─── Format detection ───────────────────────────────────────────────

function detectFormat(content: string): DetectedFormat {
  const trimmed = content.trim();

  // HTML table detection
  if (/<table[\s>]/i.test(trimmed) || /<tr[\s>]/i.test(trimmed)) {
    return 'html';
  }

  // Take the first few non-empty lines to sample delimiters
  const sampleLines = trimmed.split('\n').filter((l) => l.trim()).slice(0, 5);

  let tabCount = 0;
  let pipeCount = 0;
  let commaCount = 0;

  for (const line of sampleLines) {
    tabCount += (line.match(/\t/g) || []).length;
    pipeCount += (line.match(/\|/g) || []).length;
    commaCount += (line.match(/,/g) || []).length;
  }

  // Tab-separated is the most common when copying from web tables
  if (tabCount >= sampleLines.length) return 'tab';
  if (pipeCount >= sampleLines.length) return 'pipe';
  if (commaCount >= sampleLines.length) return 'comma';

  // Default to tab (most likely from browser copy)
  return 'tab';
}

// ─── Delimiter-based parser ─────────────────────────────────────────

function splitRow(line: string, format: DetectedFormat): string[] {
  switch (format) {
    case 'tab':
      return line.split('\t').map((c) => c.trim());
    case 'pipe':
      return line.split('|').map((c) => c.trim()).filter((c) => c !== '');
    case 'comma':
      return line.split(',').map((c) => c.trim());
    default:
      return line.split('\t').map((c) => c.trim());
  }
}

// ─── HTML table parser ──────────────────────────────────────────────

function parseHtmlTable(html: string): string[][] {
  const rows: string[][] = [];
  // Match each <tr>...</tr> block
  const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let trMatch: RegExpExecArray | null;

  while ((trMatch = trRegex.exec(html)) !== null) {
    const rowHtml = trMatch[1];
    const cells: string[] = [];
    const cellRegex = /<(?:td|th)[^>]*>([\s\S]*?)<\/(?:td|th)>/gi;
    let cellMatch: RegExpExecArray | null;

    while ((cellMatch = cellRegex.exec(rowHtml)) !== null) {
      // Strip inner HTML tags, decode common entities, trim
      const text = cellMatch[1]
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, ' ')
        .trim();
      cells.push(text);
    }

    if (cells.length > 0) {
      rows.push(cells);
    }
  }

  return rows;
}

// ─── Header detection ───────────────────────────────────────────────

interface ColumnMap {
  topicNumber: number;
  title: number;
  openDate: number;
  closeDate: number;
  branch: number;
  release: number;
}

const HEADER_PATTERNS: { field: keyof ColumnMap; patterns: RegExp[] }[] = [
  {
    field: 'topicNumber',
    patterns: [/topic\s*#/i, /topic\s*num/i, /^#$/i, /^number$/i, /topic$/i],
  },
  {
    field: 'title',
    patterns: [/^title$/i, /topic\s*title/i, /^name$/i, /^description$/i],
  },
  {
    field: 'openDate',
    patterns: [/open\s*date/i, /^open$/i, /start\s*date/i, /^posted$/i],
  },
  {
    field: 'closeDate',
    patterns: [/close\s*date/i, /^close$/i, /end\s*date/i, /due\s*date/i, /deadline/i],
  },
  {
    field: 'branch',
    patterns: [/^branch$/i, /^service$/i, /^component$/i, /^agency$/i],
  },
  {
    field: 'release',
    patterns: [/release\s*#/i, /^release$/i, /release\s*num/i, /^cycle$/i],
  },
];

function detectHeaderRow(cells: string[]): ColumnMap | null {
  // A row is a header if it contains "Topic" or "#" in any column
  const lowerCells = cells.map((c) => c.toLowerCase());
  const looksLikeHeader = lowerCells.some(
    (c) => c.includes('topic') || c === '#' || c.includes('title'),
  );
  if (!looksLikeHeader) return null;

  const map: ColumnMap = {
    topicNumber: -1,
    title: -1,
    openDate: -1,
    closeDate: -1,
    branch: -1,
    release: -1,
  };

  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    for (const { field, patterns } of HEADER_PATTERNS) {
      if (map[field] === -1 && patterns.some((p) => p.test(cell))) {
        map[field] = i;
        break;
      }
    }
  }

  // Must at least have topicNumber or title mapped to be useful
  if (map.topicNumber === -1 && map.title === -1) return null;

  return map;
}

// ─── Row → ParsedTopic ─────────────────────────────────────────────

function rowToTopic(cells: string[], colMap: ColumnMap): ParsedTopic | null {
  const topicNumber = colMap.topicNumber >= 0 && colMap.topicNumber < cells.length
    ? cells[colMap.topicNumber]
    : '';
  const title = colMap.title >= 0 && colMap.title < cells.length
    ? cells[colMap.title]
    : '';

  // Skip rows with no meaningful data
  if (!topicNumber && !title) return null;
  // Skip rows that look like repeated headers
  if (/^topic\s*#?$/i.test(topicNumber) || /^title$/i.test(title)) return null;

  const openDate = colMap.openDate >= 0 && colMap.openDate < cells.length
    ? cells[colMap.openDate] || null
    : null;
  const closeDate = colMap.closeDate >= 0 && colMap.closeDate < cells.length
    ? cells[colMap.closeDate] || null
    : null;
  const branch = colMap.branch >= 0 && colMap.branch < cells.length
    ? cells[colMap.branch] || null
    : null;
  const release = colMap.release >= 0 && colMap.release < cells.length
    ? cells[colMap.release] || null
    : null;

  return {
    topicNumber: topicNumber || title.slice(0, 64),
    title: title || topicNumber,
    openDate,
    closeDate,
    branch,
    release,
  };
}

// ─── Main parse function ────────────────────────────────────────────

function parseContent(content: string): { topics: ParsedTopic[]; format: DetectedFormat } {
  const format = detectFormat(content);
  let allRows: string[][];

  if (format === 'html') {
    allRows = parseHtmlTable(content);
  } else {
    const lines = content.split('\n').filter((l) => l.trim());
    allRows = lines.map((line) => splitRow(line, format));
  }

  if (allRows.length === 0) {
    return { topics: [], format };
  }

  // Try to find the header row — scan the first few rows
  let headerIdx = -1;
  let colMap: ColumnMap | null = null;

  for (let i = 0; i < Math.min(allRows.length, 5); i++) {
    colMap = detectHeaderRow(allRows[i]);
    if (colMap) {
      headerIdx = i;
      break;
    }
  }

  // If no header detected, use positional defaults:
  // col 0 = topicNumber, col 1 = title, col 2 = openDate, col 3 = closeDate, col 4 = branch, col 5 = release
  if (!colMap) {
    colMap = {
      topicNumber: 0,
      title: allRows[0].length > 1 ? 1 : 0,
      openDate: allRows[0].length > 2 ? 2 : -1,
      closeDate: allRows[0].length > 3 ? 3 : -1,
      branch: allRows[0].length > 4 ? 4 : -1,
      release: allRows[0].length > 5 ? 5 : -1,
    };
    headerIdx = -1; // no header row to skip
  }

  const dataRows = allRows.slice(headerIdx + 1);
  const topics: ParsedTopic[] = [];

  for (const row of dataRows) {
    const topic = rowToTopic(row, colMap);
    if (topic) {
      topics.push(topic);
    }
  }

  return { topics, format };
}

// ─── Endpoint ───────────────────────────────────────────────────────

export async function POST(request: Request, ctx: RouteContext) {
  try {
    // ── Auth ──────────────────────────────────────────────────────
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthenticated', code: 'UNAUTHENTICATED' }, { status: 401 });
    }
    const role = (session.user as { role?: string }).role;
    if (role !== 'master_admin' && role !== 'rfp_admin') {
      return NextResponse.json({ error: 'Admin role required', code: 'FORBIDDEN' }, { status: 403 });
    }

    const userId = (session.user as { id?: string }).id;
    if (!userId) {
      return NextResponse.json({ error: 'Missing user id in session', code: 'UNAUTHENTICATED' }, { status: 401 });
    }

    // ── Params ────────────────────────────────────────────────────
    const { profileId } = await ctx.params;
    if (!UUID_RE.test(profileId)) {
      return NextResponse.json({ error: 'Invalid profileId format', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    // ── Body ──────────────────────────────────────────────────────
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    const pastedContent = typeof body.pastedContent === 'string' ? body.pastedContent : '';
    const solicitationId = typeof body.solicitationId === 'string' ? body.solicitationId.trim() : '';

    if (!pastedContent.trim()) {
      return NextResponse.json({ error: 'pastedContent is required', code: 'VALIDATION_ERROR' }, { status: 422 });
    }
    if (pastedContent.length > 500000) {
      return NextResponse.json({ error: 'pastedContent exceeds 500KB size limit', code: 'VALIDATION_ERROR' }, { status: 413 });
    }
    if (!solicitationId || !UUID_RE.test(solicitationId)) {
      return NextResponse.json({ error: 'Valid solicitationId (UUID) is required', code: 'VALIDATION_ERROR' }, { status: 422 });
    }

    // ── Verify profile exists ─────────────────────────────────────
    const [profile] = await sql<{ id: string; name: string }[]>`
      SELECT id, name FROM source_profiles
      WHERE id = ${profileId}::uuid AND is_active = true
      LIMIT 1
    `;
    if (!profile) {
      return NextResponse.json({ error: 'Source profile not found', code: 'NOT_FOUND' }, { status: 404 });
    }

    // ── Verify solicitation exists ────────────────────────────────
    const solRows = await sql<{
      id: string;
      inheritSource: string | null;
      inheritAgency: string | null;
      inheritOffice: string | null;
    }[]>`
      SELECT cs.id,
             o.source AS inherit_source,
             o.agency AS inherit_agency,
             o.office AS inherit_office
      FROM curated_solicitations cs
      LEFT JOIN opportunities o ON o.id = cs.opportunity_id
      WHERE cs.id = ${solicitationId}::uuid
    `;
    if (solRows.length === 0) {
      return NextResponse.json({ error: 'Solicitation not found', code: 'NOT_FOUND' }, { status: 404 });
    }
    const parent = solRows[0];

    // ── Parse pasted content ──────────────────────────────────────
    const { topics: parsedTopics, format } = parseContent(pastedContent);

    if (parsedTopics.length === 0) {
      return NextResponse.json(
        { error: 'No topics could be parsed from the pasted content', code: 'VALIDATION_ERROR' },
        { status: 422 },
      );
    }

    // ── Find existing topic numbers to dedupe ─────────────────────
    const existingRows = await sql<{ topicNumber: string }[]>`
      SELECT topic_number FROM opportunities
      WHERE solicitation_id = ${solicitationId}::uuid
        AND topic_number IS NOT NULL
    `;
    const existingSet = new Set(existingRows.map((r) => r.topicNumber));

    // ── Start event for multi-step paste-import ───────────────────
    const eventId = await emitEventStart({
      namespace: 'finder',
      type: 'topic.imported',
      actor: userActor(userId, (session.user as { email?: string }).email),
      tenantId: null,
      payload: {
        sourceId: profileId,
        sourceName: profile.name,
        solicitationId,
        parsedTopicCount: parsedTopics.length,
        format,
      },
    });

    // ── Dedupe within input ───────────────────────────────────────
    const seenInput = new Set<string>();
    const source = parent.inheritSource ?? 'manual_upload';
    const inserted: { id: string; topicNumber: string; title: string }[] = [];
    const skipped: string[] = [];

    for (const t of parsedTopics) {
      if (existingSet.has(t.topicNumber) || seenInput.has(t.topicNumber)) {
        skipped.push(t.topicNumber);
        continue;
      }
      seenInput.add(t.topicNumber);

      const sourceIdDerived = `${solicitationId.slice(0, 8)}-${t.topicNumber}`;
      const branch = t.branch ?? parent.inheritOffice ?? null;

      // Parse dates if provided
      let closeDt: Date | null = null;
      let postedDt: Date | null = null;
      if (t.closeDate) {
        const parsed = new Date(t.closeDate);
        if (!isNaN(parsed.getTime())) closeDt = parsed;
      }
      if (t.openDate) {
        const parsed = new Date(t.openDate);
        if (!isNaN(parsed.getTime())) postedDt = parsed;
      }

      try {
        const rows = await sql<{ id: string }[]>`
          INSERT INTO opportunities
            (source, source_id, title, agency, office,
             close_date, posted_date, description,
             content_hash, is_active,
             solicitation_id, topic_number, topic_branch,
             topic_status, tech_focus_areas, naics_codes)
          VALUES
            (${source}, ${sourceIdDerived}, ${t.title},
             ${parent.inheritAgency ?? null},
             ${branch},
             ${closeDt}, ${postedDt},
             ${null},
             md5(${solicitationId} || ${t.topicNumber} || ${t.title}), true,
             ${solicitationId}::uuid,
             ${t.topicNumber},
             ${branch},
             'open',
             '{}'::text[],
             '{}'::text[])
          RETURNING id
        `;
        inserted.push({ id: rows[0].id, topicNumber: t.topicNumber, title: t.title });
      } catch (err) {
        console.error('[paste-import] row insert failed:', t.topicNumber, err);
        skipped.push(t.topicNumber);
      }
    }

    // ── Flip solicitation_type to multi_topic if we added any ─────
    if (inserted.length > 0) {
      await sql`
        UPDATE curated_solicitations
        SET solicitation_type = 'multi_topic', updated_at = now()
        WHERE id = ${solicitationId}::uuid
          AND solicitation_type = 'single'
      `;
    }

    // ── Log the import as a source_visit ──────────────────────────
    await sql`
      INSERT INTO source_visits (
        profile_id, visited_by, action, notes,
        topics_count, metadata
      ) VALUES (
        ${profileId}::uuid, ${userId}::uuid, 'import_topics',
        ${'Parsed ' + inserted.length + ' topics from pasted ' + format + ' content'},
        ${inserted.length},
        ${JSON.stringify({ format, skippedCount: skipped.length, solicitationId })}::jsonb
      )
    `;

    // ── Update profile last-visited ───────────────────────────────
    await sql`
      UPDATE source_profiles
      SET last_visited_at = now(),
          last_visited_by = ${userId}::uuid,
          updated_at = now()
      WHERE id = ${profileId}::uuid
    `;

    // ── End event ─────────────────────────────────────────────────
    await emitEventEnd(eventId, {
      result: {
        importedCount: inserted.length,
        skippedCount: skipped.length,
      },
    });

    return NextResponse.json({
      data: {
        imported: inserted.length,
        skipped: skipped.length,
        format,
        topics: inserted,
      },
    });
  } catch (e) {
    console.error('[api/admin/sources/[profileId]/paste-import POST] error:', e);
    return NextResponse.json({ error: 'Internal server error', code: 'DB_ERROR' }, { status: 500 });
  }
}

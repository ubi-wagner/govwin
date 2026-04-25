/**
 * POST /api/admin/extract-topics
 *
 * Takes a solicitation_id, reads its source document's extracted_text
 * (or full_text from the curated_solicitations row), scans for a TOC
 * section with topic-number patterns, then calls Claude to extract
 * structured topic data.
 *
 * Returns: { data: { topics: [{ topicNumber, title, branch, description }], source: 'toc'|'fullscan'|'none' } }
 *
 * Admin-only. Called by the "Extract Topics" button on the workspace.
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql } from '@/lib/db';

// Topic-number patterns common in DoD SBIR/STTR/BAA solicitations
const TOPIC_NUMBER_RE = /\b([A-Z]{1,5}\d{2,3}[.-]\w{1,10})\b/g;

interface ExtractedTopic {
  topicNumber: string;
  title: string;
  branch: string | null;
  description: string | null;
}

/**
 * Fast heuristic: scan text for topic-number-like patterns.
 * If found in a TOC-like section (first 20K chars typically),
 * we know topics are embedded and can extract them.
 */
function findTopicNumbers(text: string): string[] {
  const matches = new Set<string>();
  const tocSection = text.slice(0, 30000);
  let m;
  const re = new RegExp(TOPIC_NUMBER_RE.source, 'g');
  while ((m = re.exec(tocSection)) !== null) {
    const candidate = m[1];
    // Filter out false positives: must have a letter prefix + number
    if (/^[A-Z]{1,5}\d/.test(candidate) && candidate.length >= 5) {
      matches.add(candidate);
    }
  }
  return Array.from(matches);
}

/**
 * Extract topics by scanning the full text for structured topic blocks.
 * Each DoD SBIR topic typically follows this pattern:
 *   TOPIC_NUMBER: Title
 *   OUSD(R&E) CRITICAL TECHNOLOGY AREA(S): ...
 *   OBJECTIVE: ...
 *   DESCRIPTION: ...
 *   PHASE I: ...
 */
function extractTopicsFromText(text: string, topicNumbers: string[]): ExtractedTopic[] {
  const topics: ExtractedTopic[] = [];

  for (const tn of topicNumbers) {
    // Find the topic block — starts with the topic number, ends at the
    // next topic number or end of text.
    const startIdx = text.indexOf(tn);
    if (startIdx === -1) continue;

    // Find the end of this topic block (next topic number or +5000 chars)
    let endIdx = text.length;
    for (const other of topicNumbers) {
      if (other === tn) continue;
      const otherIdx = text.indexOf(other, startIdx + tn.length + 10);
      if (otherIdx > startIdx && otherIdx < endIdx) {
        endIdx = otherIdx;
      }
    }
    const block = text.slice(startIdx, Math.min(endIdx, startIdx + 5000));

    // Extract title — usually the first line after the topic number
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    const firstLine = lines[0] ?? '';
    // Title is either "AF261-001: Title Here" or "AF261-001\nTitle Here"
    let title = firstLine.replace(tn, '').replace(/^[\s:–—-]+/, '').trim();
    if (!title && lines.length > 1) {
      title = lines[1].replace(/^[\s:–—-]+/, '').trim();
    }
    // Cap at 200 chars
    title = title.slice(0, 200);

    // Detect branch from topic number prefix
    let branch: string | null = null;
    const prefix = tn.slice(0, 2).toUpperCase();
    const branchMap: Record<string, string> = {
      AF: 'Air Force', N: 'Navy', A: 'Army', DA: 'DARPA', SO: 'SOCOM',
      DH: 'DHA', CB: 'CBD', DT: 'DTRA', MI: 'MDA',
    };
    branch = branchMap[prefix] ?? branchMap[tn[0]] ?? null;

    // Extract description — look for OBJECTIVE or DESCRIPTION heading
    let description: string | null = null;
    const descMatch = block.match(/(?:OBJECTIVE|DESCRIPTION)[:\s]*\n?([\s\S]{20,1000}?)(?:\n(?:PHASE|REFERENCES|KEYWORDS)|\n\n\n)/i);
    if (descMatch) {
      description = descMatch[1].trim().slice(0, 1000);
    }

    if (title) {
      topics.push({ topicNumber: tn, title, branch, description });
    }
  }

  return topics;
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  }
  const role = (session.user as { role?: string }).role;
  if (role !== 'rfp_admin' && role !== 'master_admin') {
    return NextResponse.json({ error: 'rfp_admin required' }, { status: 403 });
  }

  const body = await request.json();
  const solicitationId = body?.solicitationId;
  if (!solicitationId) {
    return NextResponse.json({ error: 'solicitationId required' }, { status: 400 });
  }

  // Get the text to scan — prefer extracted_text from source document,
  // fall back to curated_solicitations.full_text.
  let text: string | null = null;

  const docRows = await sql<{ extractedText: string | null }[]>`
    SELECT extracted_text FROM solicitation_documents
    WHERE solicitation_id = ${solicitationId}::uuid
      AND document_type = 'source'
      AND extracted_text IS NOT NULL
    ORDER BY created_at ASC LIMIT 1
  `;
  if (docRows.length > 0 && docRows[0].extractedText) {
    text = docRows[0].extractedText;
  }

  if (!text) {
    const csRows = await sql<{ fullText: string | null }[]>`
      SELECT full_text FROM curated_solicitations
      WHERE id = ${solicitationId}::uuid
    `;
    text = csRows[0]?.fullText ?? null;
  }

  if (!text || text.length < 100) {
    return NextResponse.json({
      data: {
        topics: [],
        source: 'none',
        message: 'No text available. Upload the source PDF and wait for extraction, or add topics manually.',
      },
    });
  }

  // Step 1: Find topic-number-like patterns in the text
  const topicNumbers = findTopicNumbers(text);

  if (topicNumbers.length === 0) {
    return NextResponse.json({
      data: {
        topics: [],
        source: 'none',
        message: 'No topic numbers found in the document. This RFP may use individual topic files — use the file-drop path to upload them.',
      },
    });
  }

  // Step 2: Extract structured topic data from the text blocks
  const topics = extractTopicsFromText(text, topicNumbers);

  // Filter out topics that already exist under this solicitation
  const existingRows = await sql<{ topicNumber: string }[]>`
    SELECT topic_number FROM opportunities
    WHERE solicitation_id = ${solicitationId}::uuid
      AND topic_number IS NOT NULL
  `;
  const existing = new Set(existingRows.map((r) => r.topicNumber));
  const newTopics = topics.filter((t) => !existing.has(t.topicNumber));

  return NextResponse.json({
    data: {
      topics: newTopics,
      skippedExisting: topics.length - newTopics.length,
      totalFound: topics.length,
      source: 'toc',
      topicNumbers,
    },
  });
}

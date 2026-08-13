/**
 * finder.scout_source — Source Scout tool.
 *
 * HITL-guided web monitoring: fetches a source page, compares content
 * against admin-annotated regions, and uses Claude to detect meaningful
 * changes (new opportunities, updated topics, deadline changes).
 *
 * Callable by:
 *   - Admin UI "Scout Now" button (manual trigger)
 *   - Pipeline worker (automated cron via pipeline_jobs kind='scout_source')
 *
 * V1 approach: plain HTTP fetch (no Playwright). Government sites
 * render server-side. If JS rendering is needed, the tool returns a
 * warning and the admin falls back to manual paste.
 */

import { z } from 'zod';
import { createHash, randomUUID } from 'crypto';
import { sql } from '@/lib/db';
import { emitEventSingle } from '@/lib/events';
import { NotFoundError } from '@/lib/errors';
import { ToolExternalError } from './errors';
import { defineTool } from './base';

// ─── Schema ──────────────────────────────────────────────────────────

const InputSchema = z.object({
  sourceId: z.string().uuid(),
});

type Input = z.infer<typeof InputSchema>;

interface RegionDiff {
  regionId: string;
  regionName: string;
  changed: boolean;
  summary: string | null;
  severity: string;
  extractedOpportunities: unknown[];
}

interface Output {
  sourceId: string;
  sourceName: string;
  snapshotsCreated: number;
  diffsFound: number;
  meaningfulChanges: number;
  regionResults: RegionDiff[];
  warnings: string[];
}

// ─── Helpers ─────────────────────────────────────────────────────────

function contentHash(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/**
 * Fetch page HTML via plain HTTP. Returns null + a warning string if
 * the fetch fails or the response looks like it requires JS rendering.
 */
async function fetchPageHtml(
  url: string,
): Promise<{ html: string; warning: string | null }> {
  const res = await fetch(url, {
    headers: {
      'User-Agent':
        'GovWin-SourceScout/1.0 (Federal opportunity monitoring; +https://govwin.io)',
      Accept: 'text/html,application/xhtml+xml',
    },
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    throw new ToolExternalError(
      `failed to fetch ${url}: HTTP ${res.status} ${res.statusText}`,
      { url, status: res.status },
    );
  }

  const html = await res.text();

  // Heuristic: if the body is tiny and contains only a JS bootstrap,
  // the site likely requires client-side rendering.
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const bodyText = bodyMatch?.[1]?.replace(/<[^>]+>/g, '').trim() ?? '';
  if (bodyText.length < 100 && html.includes('__NEXT_DATA__')) {
    return {
      html,
      warning:
        'This site appears to require JavaScript rendering. Content may be incomplete. Consider using manual paste for this source.',
    };
  }

  return { html, warning: null };
}

/**
 * Strip HTML tags to produce plain text for hashing and comparison.
 */
function htmlToText(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Ask Claude to analyze a page region for changes. Returns structured
 * analysis or null if Claude is unavailable.
 */
async function analyzeRegionWithClaude(
  sourceName: string,
  regionName: string,
  contentContext: string,
  previousText: string | null,
  currentText: string,
  currentHtml: string,
): Promise<{
  changed: boolean;
  summary: string;
  severity: string;
  extractedOpportunities: unknown[];
  model: string;
  tokensUsed: number;
} | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return null;
  }

  const previousSection = previousText
    ? `<previous_content>\n${previousText.slice(0, 8000)}\n</previous_content>`
    : '<previous_content>No previous snapshot available — this is the first scan.</previous_content>';

  const prompt = `You are analyzing a government opportunity website for changes.

Source: ${sourceName}
Region: "${regionName}"
Admin guidance: "${contentContext ?? 'No specific guidance provided.'}"

${previousSection}

<current_content>
${currentText.slice(0, 12000)}
</current_content>

Analyze the current content for this region. Respond in JSON only:

{
  "changed": true/false,
  "summary": "Brief description of what changed or 'No changes detected'",
  "severity": "info|low|medium|high|critical",
  "extracted_opportunities": [
    {
      "title": "...",
      "agency": "...",
      "deadline": "...",
      "url": "...",
      "description": "..."
    }
  ]
}

Severity guide:
- info: no meaningful change, cosmetic only
- low: minor text updates, no new opportunities
- medium: updated deadlines or modified requirements
- high: new opportunities or solicitations detected
- critical: imminent deadlines or major program changes

Only include extracted_opportunities if you identify specific, actionable opportunities.`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2048,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: AbortSignal.timeout(60_000),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => 'unknown');
      throw new Error(`Anthropic API error: ${res.status} — ${errText.slice(0, 200)}`);
    }

    const data = (await res.json()) as {
      content: { type: string; text: string }[];
      model: string;
      usage: { input_tokens: number; output_tokens: number };
    };
    const text = data.content?.[0]?.text ?? '';
    const tokensUsed =
      (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0);

    // Parse the JSON from Claude's response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return {
        changed: false,
        summary: 'Claude response did not contain valid JSON',
        severity: 'info',
        extractedOpportunities: [],
        model: data.model ?? 'unknown',
        tokensUsed,
      };
    }

    const parsed = JSON.parse(jsonMatch[0]) as {
      changed?: boolean;
      summary?: string;
      severity?: string;
      extracted_opportunities?: unknown[];
    };

    return {
      changed: parsed.changed ?? false,
      summary: parsed.summary ?? 'No summary provided',
      severity: parsed.severity ?? 'info',
      extractedOpportunities: parsed.extracted_opportunities ?? [],
      model: data.model ?? 'unknown',
      tokensUsed,
    };
  } catch (err) {
    // Claude analysis is best-effort — log and return null so the scout continues
    console.error('[source-scout] analyzeRegionWithClaude error:', err);
    return null;
  }
}

// ─── Tool definition ─────────────────────────────────────────────────

export const sourceScoutTool = defineTool<Input, Output>({
  name: 'finder.scout_source',
  namespace: 'finder',
  description:
    'Scout a source profile for changes. Fetches the page, compares against admin-annotated regions, and uses Claude to detect meaningful changes like new opportunities.',
  inputSchema: InputSchema,
  requiredRole: 'rfp_admin',
  tenantScoped: false,

  async handler(input, ctx) {
    const { sourceId } = input;
    const actorId = ctx.actor.id;
    const warnings: string[] = [];

    // ── 1. Load source profile ──────────────────────────────────────
    let profiles;
    try {
      profiles = await sql<
      {
        id: string;
        name: string;
        baseUrl: string;
        bookmarkUrl: string | null;
        isActive: boolean;
      }[]
    >`
      SELECT id, name, base_url, bookmark_url, is_active
      FROM source_profiles
      WHERE id = ${sourceId}::uuid
    `;
    } catch (err) {
      console.error('[finder.scout_source] profile query failed:', err);
      throw err;
    }

    if (profiles.length === 0) {
      throw new NotFoundError(`source profile not found: ${sourceId}`);
    }
    const profile = profiles[0];

    if (!profile.isActive) {
      warnings.push('Source profile is inactive');
    }

    // ── 2. Load active regions ──────────────────────────────────────
    let regions;
    try {
      regions = await sql<
      {
        id: string;
        name: string;
        selectorHint: string | null;
        contentContext: string | null;
        regionType: string;
        sampleText: string | null;
      }[]
    >`
      SELECT id, name, selector_hint, content_context, region_type, sample_text
      FROM source_regions
      WHERE profile_id = ${sourceId}::uuid
        AND is_active = true
      ORDER BY created_at
    `;
    } catch (err) {
      console.error('[finder.scout_source] regions query failed:', err);
      throw err;
    }

    if (regions.length === 0) {
      warnings.push(
        'No active regions defined for this source. Add regions with selector hints and content context to enable change detection.',
      );
      // Still fetch the page and create a whole-page snapshot
    }

    // ── 3. Fetch the page ───────────────────────────────────────────
    const fetchUrl = profile.bookmarkUrl ?? profile.baseUrl;
    let pageHtml: string;
    try {
      const result = await fetchPageHtml(fetchUrl);
      pageHtml = result.html;
      if (result.warning) {
        warnings.push(result.warning);
      }
    } catch (err) {
      if (err instanceof ToolExternalError) throw err;
      throw new ToolExternalError(
        `failed to fetch source page: ${err instanceof Error ? err.message : String(err)}`,
        { sourceId, url: fetchUrl },
      );
    }

    const fullPageText = htmlToText(pageHtml);

    // ── 4. Process each region ──────────────────────────────────────
    let snapshotsCreated = 0;
    let diffsFound = 0;
    let meaningfulChanges = 0;
    const regionResults: RegionDiff[] = [];
    const allExtractedOpps: unknown[] = []; // accumulated across regions → the candidate queue

    // If no regions, process the full page as a single implicit region
    const regionsToProcess =
      regions.length > 0
        ? regions
        : [
            {
              id: null as string | null,
              name: 'Full Page',
              selectorHint: null as string | null,
              contentContext: 'Full page content' as string | null,
              regionType: 'content',
              sampleText: null as string | null,
            },
          ];

    for (const region of regionsToProcess) {
      const regionText = fullPageText;
      const hash = contentHash(regionText);

      // Check last snapshot for this region
      let lastSnapshots;
      let newSnapshots;
      try {
        lastSnapshots = await sql<
          { id: string; contentHash: string; contentText: string | null }[]
        >`
          SELECT id, content_hash, content_text
          FROM source_snapshots
          WHERE profile_id = ${sourceId}::uuid
            AND (region_id = ${region.id}::uuid OR (region_id IS NULL AND ${region.id}::uuid IS NULL))
          ORDER BY captured_at DESC
          LIMIT 1
        `;
      } catch (err) {
        console.error('[finder.scout_source] snapshot lookup failed:', err);
        throw err;
      }

      const lastSnapshot = lastSnapshots[0] ?? null;
      const hashChanged = !lastSnapshot || lastSnapshot.contentHash !== hash;

      // Always create a new snapshot
      try {
        newSnapshots = await sql<{ id: string }[]>`
          INSERT INTO source_snapshots
            (profile_id, region_id, content_hash, content_text)
          VALUES
            (${sourceId}::uuid, ${region.id}::uuid, ${hash}, ${regionText.slice(0, 50000)})
          RETURNING id
        `;
      } catch (err) {
        console.error('[finder.scout_source] snapshot insert failed:', err);
        throw err;
      }
      snapshotsCreated++;
      const newSnapshotId = newSnapshots[0].id;

      // If hash unchanged, no diff needed
      if (!hashChanged) {
        regionResults.push({
          regionId: region.id ?? 'full-page',
          regionName: region.name,
          changed: false,
          summary: 'No changes detected (content hash match)',
          severity: 'info',
          extractedOpportunities: [],
        });
        continue;
      }

      // Hash changed — ask Claude to analyze
      const analysis = await analyzeRegionWithClaude(
        profile.name,
        region.name,
        region.contentContext ?? '',
        lastSnapshot?.contentText ?? region.sampleText,
        regionText,
        pageHtml,
      );

      const isMeaningful = analysis?.changed ?? hashChanged;
      const summary = analysis?.summary ?? 'Content hash changed but Claude analysis unavailable';
      const severity = analysis?.severity ?? 'low';
      const extractedOpps = analysis?.extractedOpportunities ?? [];

      // Create diff record
      try {
        await sql`
          INSERT INTO source_diffs
            (profile_id, region_id, prev_snapshot_id, next_snapshot_id,
             is_meaningful, summary, extracted_opportunities, severity,
             claude_model, claude_tokens_used)
          VALUES
            (${sourceId}::uuid, ${region.id}::uuid,
             ${lastSnapshot?.id ?? null}::uuid, ${newSnapshotId}::uuid,
             ${isMeaningful}, ${summary},
             ${sql.json((extractedOpps) as Parameters<typeof sql.json>[0])}, ${severity},
             ${analysis?.model ?? null}, ${analysis?.tokensUsed ?? null})
        `;
      } catch (err) {
        console.error('[finder.scout_source] diff insert failed:', err);
        throw err;
      }

      diffsFound++;
      if (isMeaningful) meaningfulChanges++;
      if (isMeaningful && extractedOpps.length > 0) allExtractedOpps.push(...extractedOpps);

      regionResults.push({
        regionId: region.id ?? 'full-page',
        regionName: region.name,
        changed: isMeaningful,
        summary,
        severity,
        extractedOpportunities: extractedOpps,
      });
    }

    // ── 5. Update source profile last_crawl_at ──────────────────────
    try {
      await sql`
        UPDATE source_profiles
        SET last_crawl_at = now(), updated_at = now()
        WHERE id = ${sourceId}::uuid
      `;
    } catch (err) {
      console.error('[finder.scout_source] profile update failed:', err);
      throw err;
    }

    // ── 6. Emit scout event ─────────────────────────────────────────
    await emitEventSingle({
      namespace: 'finder',
      type: 'source.scouted',
      actor: {
        type: ctx.actor.type,
        id: actorId,
        email: ctx.actor.email ?? undefined,
      },
      payload: {
        correlationId: randomUUID(),
        sourceId,
        sourceName: profile.name,
        snapshotsCreated,
        diffsFound,
        meaningfulChanges,
        warnings,
      },
    });

    // ── 7. If meaningful changes, emit change_detected ──────────────
    if (meaningfulChanges > 0) {
      await emitEventSingle({
        namespace: 'finder',
        type: 'source.change_detected',
        actor: {
          type: ctx.actor.type,
          id: actorId,
          email: ctx.actor.email ?? undefined,
        },
        payload: {
          correlationId: randomUUID(),
          sourceId,
          sourceName: profile.name,
          meaningfulChanges,
          regionResults: regionResults.filter((r) => r.changed),
        },
      });
    }

    // ── 8. Feed extracted opportunities into the candidate review queue ──
    // Materialize each Claude-extracted opportunity as a scout_findings row (classified NEW/UPDATE)
    // so the HITL scout and the crawler feed ONE review→release queue. Best-effort — a failure here
    // must never fail the scout run.
    let candidatesQueued = 0;
    if (allExtractedOpps.length > 0) {
      try {
        const { materializeExtractedOpportunities } = await import('@/lib/scout/candidates');
        candidatesQueued = await materializeExtractedOpportunities(
          sourceId,
          profile.name,
          allExtractedOpps,
          { actorId, actorEmail: ctx.actor.email ?? null },
        );
      } catch (err) {
        console.error('[finder.scout_source] materialize candidates failed:', err);
      }
    }

    ctx.log?.info?.({
      msg: 'finder.scout_source completed',
      sourceId,
      snapshotsCreated,
      diffsFound,
      meaningfulChanges,
      candidatesQueued,
    });

    return {
      sourceId,
      sourceName: profile.name,
      snapshotsCreated,
      diffsFound,
      meaningfulChanges,
      regionResults,
      warnings,
    };
  },
});

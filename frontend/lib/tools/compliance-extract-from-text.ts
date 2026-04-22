/**
 * compliance.extract_from_text (Phase 1 §E14).
 *
 * Curator highlights a text fragment in the PDF viewer, clicks
 * "extract," and this tool calls the pipeline's internal sync shred
 * endpoint (pipeline/src/shredder/sync_extract.py) to get a list of
 * {variable_name, value, source_excerpt, confidence} suggestions.
 *
 * Returns suggestions WITHOUT writing to the DB — the curator then
 * picks which ones to accept (triggering compliance.save_variable_value
 * per accept). This keeps the HITL flow explicit.
 *
 * Requires the pipeline service to expose `/internal/shred/sync` at
 * `PIPELINE_INTERNAL_URL` (set as a Railway env var on the frontend
 * service). If the URL isn't set, throws ExternalServiceError with
 * a clear message.
 */

import { z } from 'zod';
import { ExternalServiceError } from '@/lib/errors';
import { defineTool } from './base';

const InputSchema = z.object({
  /** Text fragment the curator selected. 40K char cap mirrors the
   *  pipeline-side cap (pipeline/src/shredder/sync_extract.py). */
  text: z.string().min(1).max(40_000),
  /** Optional filter to a subset of variable names. If omitted, the
   *  prompt is run against the full catalog. */
  variableNames: z.array(z.string()).optional(),
});

type Input = z.infer<typeof InputSchema>;

interface Suggestion {
  variableName: string;
  value: unknown;
  sourceExcerpt: string;
  page: number | null;
  confidence: number;
}

interface Output {
  suggestions: Suggestion[];
}

const PIPELINE_TIMEOUT_MS = 30_000;

export const complianceExtractFromTextTool = defineTool<Input, Output>({
  name: 'compliance.extract_from_text',
  namespace: 'compliance',
  description:
    'Extract compliance variable suggestions from a curator-highlighted text fragment via the pipeline shredder. Returns suggestions; does NOT write to DB.',
  inputSchema: InputSchema,
  requiredRole: 'rfp_admin',
  tenantScoped: false,
  async handler(input, ctx) {
    // Read at invoke time (not module load) so env var changes between
    // deploys are picked up without re-importing the tool.
    const PIPELINE_URL = process.env.PIPELINE_INTERNAL_URL;
    if (!PIPELINE_URL) {
      throw new ExternalServiceError(
        'pipeline internal URL not configured (PIPELINE_INTERNAL_URL env var)',
        { hint: 'set PIPELINE_INTERNAL_URL on the frontend Railway service' },
      );
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PIPELINE_TIMEOUT_MS);

    try {
      const resp = await fetch(`${PIPELINE_URL}/internal/shred/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: input.text,
          variable_names: input.variableNames ?? null,
        }),
        signal: controller.signal,
      });

      if (!resp.ok) {
        const body = await resp.text().catch(() => '<unreadable>');
        throw new ExternalServiceError(
          `pipeline returned HTTP ${resp.status}`,
          { status: resp.status, body: body.slice(0, 500) },
        );
      }

      const data = (await resp.json()) as {
        matches?: Array<{
          variable_name: string;
          value: unknown;
          source_excerpt: string;
          page: number | null;
          confidence: number;
        }>;
      };

      const suggestions: Suggestion[] = (data.matches ?? []).map((m) => ({
        variableName: m.variable_name,
        value: m.value,
        sourceExcerpt: m.source_excerpt,
        page: m.page,
        confidence: m.confidence,
      }));

      ctx.log?.info?.({
        msg: 'compliance.extract_from_text resolved',
        suggestionCount: suggestions.length,
      });

      return { suggestions };
    } catch (err) {
      if (err instanceof ExternalServiceError) throw err;
      if ((err as Error).name === 'AbortError') {
        throw new ExternalServiceError(
          'pipeline shredder timed out',
          { timeoutMs: PIPELINE_TIMEOUT_MS },
        );
      }
      throw new ExternalServiceError(
        `pipeline shredder call failed: ${(err as Error).message}`,
      );
    } finally {
      clearTimeout(timeout);
    }
  },
});

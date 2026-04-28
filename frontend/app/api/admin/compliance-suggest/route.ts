/**
 * GET /api/admin/compliance-suggest?namespace=...&variableName=...
 *
 * Returns suggested values for a compliance variable based on:
 *   1. Prior curator-verified values from episodic_memories with the
 *      same namespace prefix (cross-cycle pre-fill from §H)
 *   2. Common/known values for well-known variable names
 *
 * This IS the §H "memory read side" — the first place the HITL
 * flywheel pays off. Every prior curation decision that called
 * writeCurationMemory() is now surfaced as a suggestion.
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql } from '@/lib/db';

// Well-known variable defaults for common compliance fields.
// These show up as suggestions even when no memory exists (cold start).
const WELL_KNOWN: Record<string, string[]> = {
  font_family: ['Times New Roman', 'Arial', 'Calibri'],
  font_size: ['10', '11', '12'],
  margins: ['1 inch', '1 inch all sides', '0.5 inch'],
  line_spacing: ['single', '1.15', 'double'],
  submission_format: ['DSIP', 'Grants.gov', 'NSPIRES', 'email'],
  header_format: ['{topic_number} - {company_name}', '{solicitation_number}'],
  footer_format: ['{company_name} | Page {n} of {total}', 'Page {n}'],
  clearance_required: ['None', 'Secret', 'Top Secret', 'Top Secret/SCI'],
  cost_volume_format: ['SF-1411', 'SF-424A', 'Free-form'],
};

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthenticated', code: 'UNAUTHENTICATED' }, { status: 401 });
  }

  const url = new URL(request.url);
  const namespace = url.searchParams.get('namespace');
  const variableName = url.searchParams.get('variableName');

  if (!variableName) {
    return NextResponse.json(
      { error: 'variableName query param required', code: 'VALIDATION_ERROR' },
      { status: 400 },
    );
  }

  const suggestions: string[] = [];
  const seen = new Set<string>();

  // 1. Memory-based suggestions: prior verified values from the same
  //    namespace prefix (cross-cycle). This is the HITL payoff — every
  //    curator verify/correct action wrote a memory row tagged with
  //    the solicitation's namespace. Now we surface those values.
  if (namespace) {
    // Prefix match: "DOD:unknown:SBIR:" matches Phase1 and Phase2
    // cycles. Strip the last segment to get the prefix.
    const parts = namespace.split(':');
    const prefix = parts.length >= 3
      ? parts.slice(0, -1).join(':') + ':'
      : namespace;

    type MemRow = { value: string | null; createdAt: Date };
    const memRows = await sql<MemRow[]>`
      SELECT metadata->>'value' AS value, created_at
      FROM episodic_memories
      WHERE agent_role = 'curator'
        AND memory_type = 'decision'
        AND namespace LIKE ${prefix + '%'}
        AND metadata->>'variable_name' = ${variableName}
      ORDER BY created_at DESC
      LIMIT 10
    `;

    for (const row of memRows) {
      const v = row.value?.toString().trim();
      if (v && !seen.has(v.toLowerCase())) {
        suggestions.push(v);
        seen.add(v.toLowerCase());
      }
    }
  }

  // 2. Well-known defaults for common variables (cold-start fallback).
  const knownValues = WELL_KNOWN[variableName] ?? [];
  for (const v of knownValues) {
    if (!seen.has(v.toLowerCase())) {
      suggestions.push(v);
      seen.add(v.toLowerCase());
    }
  }

  return NextResponse.json({ data: { suggestions, variableName, namespace } });
}

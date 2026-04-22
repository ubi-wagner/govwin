/**
 * opportunity.get_by_id (Phase 1 §E16).
 *
 * Fetches one opportunities row by id. Worked example from
 * docs/TOOL_CONVENTIONS.md.
 *
 * Required role: `rfp_admin` for now — Phase 2 adds a separate
 * `opportunity.get_for_tenant` tool for customer-facing access
 * with tenant scoping.
 */

import { z } from 'zod';
import { sql } from '@/lib/db';
import { NotFoundError } from '@/lib/errors';
import { defineTool } from './base';

const InputSchema = z.object({
  opportunityId: z.string().uuid(),
});

type Input = z.infer<typeof InputSchema>;

interface Output {
  id: string;
  source: string;
  sourceId: string;
  title: string;
  agency: string | null;
  office: string | null;
  programType: string | null;
  solicitationNumber: string | null;
  naicsCodes: string[] | null;
  setAsideType: string | null;
  classificationCode: string | null;
  closeDate: string | null;
  postedDate: string | null;
  description: string | null;
  isActive: boolean;
  createdAt: string;
}

export const opportunityGetByIdTool = defineTool<Input, Output>({
  name: 'opportunity.get_by_id',
  namespace: 'opportunity',
  description:
    'Fetch one opportunities row by id. Used by the admin curation workspace and (later) the tenant portal via a separate tool.',
  inputSchema: InputSchema,
  requiredRole: 'rfp_admin',
  tenantScoped: false,
  async handler(input, ctx) {
    const rows = await sql`
      SELECT id, source, source_id, title, agency, office, program_type,
             solicitation_number, naics_codes, set_aside_type,
             classification_code, close_date, posted_date, description,
             is_active, created_at
      FROM opportunities
      WHERE id = ${input.opportunityId}::uuid
    `;

    if (rows.length === 0) {
      throw new NotFoundError(`opportunity not found: ${input.opportunityId}`);
    }

    const r = rows[0];
    ctx.log?.info?.({
      msg: 'opportunity.get_by_id resolved',
      opportunityId: r.id,
      source: r.source,
    });

    return {
      id: r.id,
      source: r.source,
      sourceId: r.sourceId,
      title: r.title,
      agency: r.agency ?? null,
      office: r.office ?? null,
      programType: r.programType ?? null,
      solicitationNumber: r.solicitationNumber ?? null,
      naicsCodes: r.naicsCodes ?? null,
      setAsideType: r.setAsideType ?? null,
      classificationCode: r.classificationCode ?? null,
      closeDate: r.closeDate ? (r.closeDate instanceof Date ? r.closeDate.toISOString() : r.closeDate) : null,
      postedDate: r.postedDate ? (r.postedDate instanceof Date ? r.postedDate.toISOString() : r.postedDate) : null,
      description: r.description ?? null,
      isActive: r.isActive,
      createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : r.createdAt,
    };
  },
});

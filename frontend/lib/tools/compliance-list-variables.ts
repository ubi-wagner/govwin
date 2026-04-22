/**
 * compliance.list_variables (Phase 1 §E12).
 *
 * Returns the full compliance variable catalog — system variables
 * (shipped in baseline seed) plus any admin-added variables. Used by
 * the curation workspace UI to render the compliance matrix.
 */

import { z } from 'zod';
import { sql } from '@/lib/db';
import { defineTool } from './base';

const InputSchema = z.object({
  category: z.string().optional(),
});

type Input = z.infer<typeof InputSchema>;

interface VariableRow {
  id: string;
  name: string;
  label: string;
  category: string;
  dataType: 'text' | 'number' | 'boolean' | 'select' | 'multiselect';
  options: unknown | null;
  isSystem: boolean;
}

interface Output {
  variables: VariableRow[];
}

export const complianceListVariablesTool = defineTool<Input, Output>({
  name: 'compliance.list_variables',
  namespace: 'compliance',
  description:
    'List the compliance variable catalog, optionally filtered by category.',
  inputSchema: InputSchema,
  requiredRole: 'rfp_admin',
  tenantScoped: false,
  async handler(input, ctx) {
    const categoryFilter = input.category ?? null;
    const rows = await sql<VariableRow[]>`
      SELECT id, name, label, category, data_type, options, is_system
      FROM compliance_variables
      WHERE (${categoryFilter}::text IS NULL OR category = ${categoryFilter})
      ORDER BY category, name
    `;
    ctx.log?.info?.({ msg: 'compliance.list_variables returned', count: rows.length });
    return { variables: rows };
  },
});

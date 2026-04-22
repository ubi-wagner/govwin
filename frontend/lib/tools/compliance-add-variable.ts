/**
 * compliance.add_variable (Phase 1 §E13).
 *
 * Add a new compliance variable to the catalog. System variables ship
 * in the baseline seed; this tool lets admins add agency-specific or
 * one-off variables that show up as columns in the compliance matrix.
 *
 * `isSystem` is always false for admin-created variables — system
 * variables can only be added via migrations. This tool is safe from
 * accidentally overwriting a system variable: the UNIQUE constraint
 * on `name` raises a ConflictError if the admin tries to add a name
 * that already exists.
 */

import { z } from 'zod';
import { sql } from '@/lib/db';
import { ConflictError } from '@/lib/errors';
import { defineTool } from './base';

const InputSchema = z.object({
  name: z.string().min(1).max(64).regex(/^[a-z][a-z0-9_]*$/, {
    message: 'must be snake_case, lowercase, starting with a letter',
  }),
  label: z.string().min(1).max(128),
  category: z.string().min(1).max(64),
  dataType: z.enum(['text', 'number', 'boolean', 'select', 'multiselect']),
  options: z.array(z.string()).optional(),
});

type Input = z.infer<typeof InputSchema>;

interface Output {
  id: string;
  name: string;
  isSystem: false;
}

export const complianceAddVariableTool = defineTool<Input, Output>({
  name: 'compliance.add_variable',
  namespace: 'compliance',
  description:
    'Add a new (non-system) compliance variable to the catalog. Unique on name; conflict → ConflictError.',
  inputSchema: InputSchema,
  requiredRole: 'rfp_admin',
  tenantScoped: false,
  async handler(input, ctx) {
    const { name, label, category, dataType, options } = input;

    try {
      const rows = await sql<{ id: string }[]>`
        INSERT INTO compliance_variables
          (name, label, category, data_type, options, is_system)
        VALUES
          (${name}, ${label}, ${category}, ${dataType},
           ${options ? JSON.stringify(options) : null}::jsonb,
           false)
        RETURNING id
      `;

      ctx.log?.info?.({
        msg: 'compliance.add_variable succeeded',
        name, category, dataType,
      });

      return { id: rows[0].id, name, isSystem: false };
    } catch (err) {
      // postgres.js raises a coded error on unique violation
      const code = (err as { code?: string })?.code;
      if (code === '23505') {
        throw new ConflictError(
          `compliance variable already exists: ${name}`,
          { name },
        );
      }
      throw err;
    }
  },
});

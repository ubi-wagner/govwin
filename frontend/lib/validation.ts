/**
 * Shared zod primitives. Imported by API route schemas + tool input
 * schemas so there's one canonical definition for UUIDs, tenant slugs,
 * email addresses, pagination cursors, etc.
 *
 * See docs/API_CONVENTIONS.md §"Input validation" and
 * docs/TOOL_CONVENTIONS.md §"Tool interface" for the contract that
 * mandates zod for all external input.
 */

import { z } from 'zod';

// ─── Primitives ─────────────────────────────────────────────────────

/** RFC-4122 UUID (any version). */
export const zUuid = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    'invalid uuid',
  );

/** Case-insensitive email, lowercased + trimmed on parse. */
export const zEmail = z
  .string()
  .trim()
  .toLowerCase()
  .email('invalid email');

/**
 * Tenant slug — must match the rules in lib/storage/paths.ts (kebab-
 * case, 3-64 chars, no leading/trailing dash). Duplicated here rather
 * than imported to keep this file edge-safe (no storage-client deps).
 */
export const zTenantSlug = z
  .string()
  .regex(
    /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/,
    'tenant slug must be kebab-case, 3-64 chars, no leading/trailing dash',
  );

/** A dotted identifier like 'memory.search' or 'finder.rfp.curated_and_pushed'. */
export const zDottedName = z
  .string()
  .regex(
    /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/,
    'must be dotted snake_case (e.g., memory.search)',
  );

/**
 * Password — enforced to match the change-password form minimum of
 * 12 characters. API routes that set passwords must use this schema
 * (not raw strings) so the contract is centrally enforced.
 */
export const zPassword = z
  .string()
  .min(12, 'password must be at least 12 characters')
  .max(256, 'password must be at most 256 characters');

/** Role enum — mirrors lib/rbac.ts ROLES. Kept in sync manually. */
export const zRole = z.enum([
  'master_admin',
  'rfp_admin',
  'tenant_admin',
  'tenant_user',
  'partner_user',
]);

// ─── Pagination ─────────────────────────────────────────────────────

/**
 * Cursor-based pagination request shape, per docs/API_CONVENTIONS.md
 * §"Pagination contract". List endpoints accept `{ cursor?, limit }`.
 */
export const zPaginationRequest = z.object({
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(200).default(50),
});

export type PaginationRequest = z.infer<typeof zPaginationRequest>;

/**
 * Cursor-based pagination response shape (goes INSIDE the `{ data: ... }`
 * envelope — the envelope itself is added by ok() in api-helpers.ts).
 */
export interface PaginatedResult<T> {
  items: T[];
  nextCursor: string | null;
}

/** Generic helper to type a paginated response envelope. */
export type PaginatedResponse<T> = { data: PaginatedResult<T> };

// ─── Common sort orders ─────────────────────────────────────────────

export const zSortOrder = z.enum(['asc', 'desc']).default('desc');

/**
 * The gate every delivery route runs first.
 *
 * One function rather than a copy in each route, because it does four things in an order that
 * matters and getting the order wrong is silent:
 *
 *   1. authenticate            — a session, with a role the registry recognises
 *   2. resolve the tenant      — by slug, so the URL cannot name a tenant that does not exist
 *   3. verifyTenantAccess      — membership, or a descended admin's derived shadow membership
 *   4. enterTenant             — pin the RLS context for the rest of the request
 *
 * ── STEP 4 MUST SCOPE THE HANDLER, AND `enterWith` FROM IN HERE DOES NOT ────────────────────
 * This file used to say step 4 "must happen in the ROUTE's own frame, which is why this returns
 * rather than wrapping" — and then called `enterTenant()` from inside `deliveryGate` anyway. The
 * comment was right and the code contradicted it.
 *
 * `AsyncLocalStorage.enterWith` sets the store for the remainder of the CURRENT execution. A route
 * that `await`s this gate resumes in a *different* microtask, in the context captured before the
 * await — so the store the gate entered was gone by the time the handler ran its first query. Every
 * delivery route therefore executed with `app.tenant_id` UNSET, RLS matched nothing, and:
 *
 *     GET  …/projects            → 200 {"data":{"projects":[]}}   for a tenant with two
 *     GET  …/projects/[id]/clins → 404 Project not found          for a project on screen
 *     PATCH …/deliverables/[id]  → 404 Deliverable not found      on a button the page renders
 *
 * The PAGES were fine — they call `enterTenant` in their own frame — so the workspace rendered
 * perfectly while its entire API returned nothing. And **every lens passed**: `verify-api-contract`
 * grades the ENVELOPE, and `{error, code}` with a 404 is textbook; `verify-write-contract` asserts a
 * client error answers 4xx with both fields, which is exactly what a blanket 404 does. Neither is
 * capable of noticing. It was found by looking at a screenshot of a red toast.
 *
 * So the gate WRAPS. `withDelivery` runs the handler inside `runInTenant`, which uses `store.run()`
 * — the primitive that actually scopes a callback — and there is no way to hold the actor without
 * being inside the context. `__tests__/delivery-gate-scoping.test.ts` fails if a route imports the
 * raw gate.
 *
 * ── WHAT THIS DELIBERATELY DOES NOT DO ───────────────────────────────────────────────────────
 * It does not check the ASSIGNMENT. That is a per-project question, RLS cannot express it, and it
 * lives in `lib/delivery/access.ts` where it has its own boundary test. Folding it in here would
 * make the two checks look like one thing and let a future route satisfy the gate while skipping
 * the part RLS does not cover.
 */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { runInTenant } from '@/lib/tenant-context';
import { isRole, type Role } from '@/lib/rbac';
import { deliveryScope, type DeliveryActor } from './access';

export type GateResult =
  | { error: NextResponse }
  | { actor: DeliveryActor & { role: Role }; tenantSlug: string; email: string | null };

export async function deliveryGate(tenantSlug: string): Promise<GateResult> {
  const session = await auth();
  if (!session?.user) {
    return { error: NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 }) };
  }
  const u = session.user as { id?: string; role?: unknown; email?: string };
  const role: Role | null = isRole(u.role) ? u.role : null;
  if (!role || !u.id) {
    return { error: NextResponse.json({ error: 'Invalid session', code: 'UNAUTHENTICATED' }, { status: 401 }) };
  }

  const tenant = await getTenantBySlug(tenantSlug);
  if (!tenant) {
    return { error: NextResponse.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, { status: 404 }) };
  }
  const tenantId = tenant.id as string;

  if (!(await verifyTenantAccess(u.id, role, tenantId))) {
    return { error: NextResponse.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 }) };
  }

  // A role with no delivery reach at all is refused HERE rather than returning an empty list from
  // every route below. An empty result and a refusal are different facts, and a partner_user
  // reading "no projects" would reasonably conclude there are none.
  if (deliveryScope({ role, userId: u.id }).kind === 'none') {
    return {
      error: NextResponse.json(
        { error: 'Delivery workspaces are not available to this role', code: 'FORBIDDEN' },
        { status: 403 },
      ),
    };
  }

  // NOT `enterTenant` here — see the header. `withDelivery` scopes the handler instead.
  return { actor: { userId: u.id, role, tenantId }, tenantSlug, email: u.email ?? null };
}

/**
 * The only correct way into a delivery route.
 *
 * Resolves the gate, then runs the handler **inside** the tenant context via `runInTenant`
 * (`store.run()`), so every query the handler makes — however deep — sees `app.tenant_id`.
 *
 * A wrapper rather than a returned `enterTenant()` the route is trusted to call: this module's
 * sibling says it plainly of the assignment predicate, and it is just as true here — *a boundary
 * applied by convention at N call sites is applied at N−1 of them the first time someone is in a
 * hurry.* Here it was applied at 0 of 20.
 */
export async function withDelivery(
  tenantSlug: string,
  handler: (gate: Extract<GateResult, { actor: unknown }>) => Promise<NextResponse>,
): Promise<NextResponse> {
  const gate = await deliveryGate(tenantSlug);
  if ('error' in gate) return gate.error;
  return runInTenant(gate.actor.tenantId, () => handler(gate));
}

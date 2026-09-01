import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql } from '@/lib/db';
import { emitEventStart, emitEventEnd, emitEventSingle, userActor } from '@/lib/events';
import { send } from '@/lib/email';
import { applicationAcceptedEmail } from '@/lib/email-templates';
import { isValidUUID } from '@/lib/validation';
import { backfillTenant } from '@/lib/opportunity-bridge';
import { scoreTenantCards } from '@/lib/cards/score-tenant';
import { offerStarterSet } from '@/lib/library/starter-offer';
import { copyStarterSetToTenant } from '@/lib/library/foundation';
import { backfillTenantTemplates } from '@/lib/template-bridge';
import { seedProfileFromApplication } from '@/lib/onboarding';
import { isRole, type Role } from '@/lib/rbac';
import { closeTasksForEntity } from '@/lib/tasks/tasks';
import bcrypt from 'bcryptjs';

interface RouteContext {
  params: Promise<{ id: string }>;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export async function POST(request: Request, ctx: RouteContext) {
  let eventId = '';
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthenticated', code: 'UNAUTHENTICATED' }, { status: 401 });
    }
    const role = (session.user as { role?: string }).role;
    if (role !== 'master_admin' && role !== 'rfp_admin') {
      return NextResponse.json({ error: 'Admin role required', code: 'FORBIDDEN' }, { status: 403 });
    }

    const { id } = await ctx.params;
    if (!isValidUUID(id)) {
      return NextResponse.json({ error: 'Invalid application ID format', code: 'VALIDATION_ERROR' }, { status: 400 });
    }
    const userId = (session.user as { id?: string }).id;
    if (!userId) {
      return NextResponse.json({ error: 'Missing user id in session', code: 'UNAUTHENTICATED' }, { status: 401 });
    }

    // Parse optional review notes from request body
    let reviewNotes = '';
    try {
      const body = await request.json();
      if (typeof body.reviewNotes === 'string') reviewNotes = body.reviewNotes.trim();
    } catch { }

    // Fetch application
    const [app] = await sql<{
      id: string;
      companyName: string;
      contactEmail: string;
      contactName: string;
      status: string;
      source: string;
      metadata: Record<string, unknown> | null;
    }[]>`
      SELECT id, company_name, contact_email, contact_name, status, source, metadata
      FROM applications
      WHERE id = ${id}
      LIMIT 1
    `;

    if (!app) {
      return NextResponse.json({ error: 'Application not found', code: 'NOT_FOUND' }, { status: 404 });
    }
    if (app.status !== 'pending' && app.status !== 'under_review') {
      return NextResponse.json(
        { error: `Application is already ${app.status}`, code: 'VALIDATION_ERROR' },
        { status: 409 },
      );
    }

    // Partner registration (docs/PARTNER_MANAGER_DESIGN.md §4): a source='partner' application
    // carries the submitting partner in metadata.partnerId. On accept we attribute ownership to
    // that partner so the provisioned company lands in their stable. Public accepts have no
    // partnerId and skip this path entirely.
    const partnerId =
      app.source === 'partner' && app.metadata && typeof app.metadata.partnerId === 'string'
        ? (app.metadata.partnerId as string)
        : null;

    // ── Start event for multi-step accept operation ────────────────
    eventId = await emitEventStart({
      namespace: 'capture',
      type: 'application.accepted',
      actor: userActor(userId, (session.user as { email?: string }).email),
      tenantId: null,
      payload: {
        applicationId: id,
        companyName: app.companyName,
        contactEmail: app.contactEmail,
      },
    });

    // Wrap tenant + user + application update in a transaction
    // so partial failures don't leave orphaned rows
    const tempPw = crypto.randomUUID().slice(0, 12);
    const hash = await bcrypt.hash(tempPw, 12);

    // eslint-disable-next-line
    const result = await sql.begin(async (tsql: any) => {
      // Create a tenant with a unique slug. A probe-then-insert loop races on
      // tenants_slug_key under concurrent accepts, so INSERT with ON CONFLICT and
      // bump the suffix until one lands — race-free (the loser of a race just
      // tries the next suffix instead of 500-ing on the unique violation).
      const baseSlug = slugify(app.companyName);
      let finalSlug = baseSlug;
      let tenantId: string | undefined;
      for (let suffix = 2; suffix < 1000; suffix++) {
        const inserted = await tsql`
          INSERT INTO tenants (name, slug, status)
          VALUES (${app.companyName}, ${finalSlug}, 'active')
          ON CONFLICT (slug) DO NOTHING
          RETURNING id
        `;
        if (inserted.length > 0) {
          tenantId = inserted[0].id;
          break;
        }
        finalSlug = `${baseSlug}-${suffix}`;
      }
      if (!tenantId) {
        throw new Error('could not allocate a unique tenant slug');
      }

      // Upsert the user (reset temp password for a re-acceptance). A
      // SELECT-then-INSERT races on users.email under concurrent accepts; ON
      // CONFLICT (email) collapses the existing-user reset and the new-user
      // insert into one race-free statement. Email is stored lowercased, so the
      // unique index on email aligns with the LOWER(email) lookups elsewhere.
      const [userRow] = await tsql`
        INSERT INTO users (email, name, role, tenant_id, password_hash, temp_password, is_active)
        VALUES (
          ${app.contactEmail.toLowerCase().trim()},
          ${app.contactName},
          'tenant_admin',
          ${tenantId},
          ${hash},
          true,
          true
        )
        ON CONFLICT (email) DO UPDATE
          SET password_hash = EXCLUDED.password_hash,
              temp_password = true,
              tenant_id = EXCLUDED.tenant_id,
              is_active = true
        RETURNING id
      `;
      const newUserId = userRow.id;

      // Materialize the owner's HOME membership (multi-membership identity) so the
      // account is membership-backed from creation, not only via legacy users.tenant_id.
      // In the tx: a new tenant owner always has a membership. ON CONFLICT reactivates a
      // prior deactivated one (never-delete).
      await tsql`
        INSERT INTO user_memberships (user_id, tenant_id, role, status, source, created_by)
        VALUES (${newUserId}, ${tenantId}, 'tenant_admin', 'active', 'home', ${userId})
        ON CONFLICT (user_id, tenant_id) DO UPDATE
          SET status = 'active', role = EXCLUDED.role
          WHERE user_memberships.status <> 'active'
      `;

      // Update application status AFTER tenant+user creation succeeds
      await tsql`
        UPDATE applications
        SET status = 'accepted',
            reviewed_by = ${userId},
            reviewed_at = now(),
            review_notes = ${reviewNotes || null},
            -- WHICH APPLICATION BECAME WHICH CUSTOMER. Without this the funnel loses its last
            -- step: a lead converted, and nothing recorded what it converted INTO, so no campaign
            -- could ever be credited with a customer. It is written in the same statement that
            -- records the decision, inside the same transaction that created the tenant, so the
            -- two can never disagree (migration 242).
            tenant_id = ${tenantId}
        WHERE id = ${id}
      `;

      // Partner attribution: set owner + a partner_manager membership so the company joins the
      // partner's stable. Validate the partner user exists first — tenants.owner_id has an FK, so
      // a bad id would throw and roll back an otherwise-good accept (FK-before-write, CLIFFNOTES §4b).
      let partnerAttributed = false;
      if (partnerId) {
        const [p] = await tsql`SELECT id FROM users WHERE id = ${partnerId}::uuid AND role = 'partner_admin' LIMIT 1`;
        if (p) {
          await tsql`UPDATE tenants SET owner_id = ${partnerId}::uuid WHERE id = ${tenantId}`;
          await tsql`
            INSERT INTO user_memberships (user_id, tenant_id, role, status, source, created_by)
            VALUES (${partnerId}::uuid, ${tenantId}, 'tenant_admin', 'active', 'partner_manager', ${userId})
            ON CONFLICT (user_id, tenant_id) DO UPDATE
              SET status = 'active', role = 'tenant_admin', source = 'partner_manager'`;
          partnerAttributed = true;
        }
      }

      return { tenantId, finalSlug, newUserId, partnerAttributed };
    });

    const { tenantId, finalSlug, newUserId, partnerAttributed } = result;

    // Audit the partner attribution (the company joined the partner's stable). Best-effort.
    if (partnerAttributed && partnerId) {
      try {
        await emitEventSingle({
          namespace: 'finder',
          type: 'partner.company_registered',
          actor: userActor(userId, (session.user as { email?: string }).email),
          tenantId,
          payload: { tenantId, tenantSlug: finalSlug, partnerId, applicationId: id },
        });
      } catch (e) {
        console.error('[api/admin/applications/accept] partner attribution event failed (non-fatal):', e);
      }
    }

    // Send welcome email with credentials. Post-commit + BEST-EFFORT: the tenant+user+membership
    // are already committed above, so an email-layer throw must NEVER 500 and swallow the temp
    // password — that would leave an approved customer with no way in (sweep F1). send() is
    // contractually no-throw today; this wrap keeps the guarantee even if that ever changes.
    let emailResult: Awaited<ReturnType<typeof send>> = {
      provider: 'skipped', messageId: null, accepted: false, error: 'not-sent',
      suppressed: false, duplicate: false, correlationId: '', sendId: null,
    };
    try {
      const loginUrl = `${(process.env.NEXTAUTH_URL || process.env.AUTH_URL) || process.env.NEXT_PUBLIC_APP_URL || ''}/login`;
      const emailContent = applicationAcceptedEmail({
        contactName: app.contactName,
        contactEmail: app.contactEmail,
        companyName: app.companyName,
        tempPassword: tempPw,
        tenantSlug: finalSlug,
        loginUrl,
      });
      emailResult = await send({
        to: app.contactEmail,
        subject: emailContent.subject,
        html: emailContent.html,
        kind: 'transactional',
        tenantId,
        template: 'application_accepted',
        // A natural key, so a replayed accept cannot mail a second temp password. The application
        // id is right and the tenant id is not: a retry that got further last time would produce a
        // different tenant and re-send under a fresh key.
        idempotencyKey: `application_accepted:${id}`,
        tags: ['onboarding'],
      });
    } catch (emailErr) {
      console.error('[applications/accept] welcome email failed (non-fatal, account already created):', emailErr);
      emailResult = {
        ...emailResult,
        error: emailErr instanceof Error ? emailErr.message : String(emailErr),
      };
    }

    // ── Carbon-copy mirror: clone the opportunity river onto the new tenant so a
    //    fresh customer lands with a populated /cards (not an empty pipeline).
    //    Post-commit + best-effort: a backfill failure must NEVER fail the accept.
    //    Awaited (not fire-and-forget) so serverless doesn't kill it mid-replay; if
    //    the river grows large, move this to an out-of-band job keyed on the event.
    // No spotlight buckets are seeded. A bucket is the CUSTOMER's own ranking lens — a 1:n
    // they open empty and fill — so the product imposes none, and the cap is a pure authoring
    // budget rather than `seeded + headroom` (the entanglement behind B62). Until they author
    // one, /cards falls back to docs_copied then updated_at DESC: recency-ordered, not blank.

    // The question this application asked has been answered, so the ToDos that asked it are moot
    // (bug log B51 — three accepted applications still carrying six open "review this" ToDos).
    // Closing at the moment of decision is what keeps the admin queue honest; best-effort, because
    // a stale row is a far smaller problem than a 500 on a customer's onboarding.
    try {
      const closed = await closeTasksForEntity({
        entityType: 'application', entityId: id,
        actor: { id: userId, email: (session.user as { email?: string }).email ?? null, role: role as Role, tenantId: null },
        result: { decision: 'accepted', tenantId, tenantSlug: finalSlug },
      });
      if (closed.failed) console.error('[api/admin/applications/accept] some triage ToDos did not close', closed);
    } catch (taskErr) {
      console.error('[api/admin/applications/accept] ToDo close failed (non-fatal):', taskErr);
    }

    // Carry the application's own answers into the company profile, so the bucket form's
    // "start from your company profile" button has something to copy. Without this the button
    // tells a brand-new customer to go and type, on the Profile page, what they typed on the
    // application ten minutes ago — and until they do, they author no bucket, /cards falls back to
    // recency, and the ranking engine is inert on day one. NON-DESTRUCTIVE and idempotent: it
    // fills only empty columns. It does NOT create buckets — those stay the customer's to author
    // (see the note above). Best-effort, like every other step in this tail.
    try {
      const seed = await seedProfileFromApplication(tenantId, id);
      if (!seed.seeded && seed.reason && seed.reason !== 'nothing_to_copy') {
        console.error(`[api/admin/applications/accept] profile seed skipped: ${seed.reason}`);
      }
    } catch (seedErr) {
      console.error('[api/admin/applications/accept] profile seed failed (non-fatal):', seedErr);
    }

    let cardsBackfilled = 0;
    try {
      cardsBackfilled = await backfillTenant(tenantId);
      await emitEventSingle({
        namespace: 'capture',
        type: 'tenant.cards_backfilled',
        actor: userActor(userId, (session.user as { email?: string }).email),
        tenantId,
        payload: { tenantId, tenantSlug: finalSlug, cardsBackfilled },
      });
    } catch (backfillErr) {
      console.error('[api/admin/applications/accept] card backfill failed (non-fatal):', backfillErr);
    }

    // Score the backfilled cards against the seeded buckets SYNCHRONOUSLY so the fresh customer
    // lands on a RANKED pipeline, not a flat list (the async OnCardApplied workflow also rescores,
    // but that depends on the pipeline running). Best-effort — never fail the accept.
    try { await scoreTenantCards(tenantId); } catch (scoreErr) {
      console.error('[api/admin/applications/accept] card scoring failed (non-fatal):', scoreErr);
    }

    // "Keep + copy": eager-materialize the shared system-starter library into the new tenant's OWN
    // space on accept — each foundation copied as a tenant-owned atom (derived_from lineage,
    // collection=my_library) so the customer lands with a populated library, not an empty one. The
    // shared masters stay shared; isolation is preserved (each copy carries this tenant's tenant_id).
    // Idempotent, best-effort — accept never fails on it.
    let starterCopied = 0;
    try {
      starterCopied = (await copyStarterSetToTenant(tenantId, { id: newUserId })).added;
    } catch (copyErr) {
      console.error('[api/admin/applications/accept] starter-set copy failed (non-fatal):', copyErr);
    }

    // Template stable: 100% copy-on-create of every pristine master into the tenant's OWN shelf via
    // the forward-only template bridge (mig 177) — skeleton-only, isolated per tenant. Best-effort.
    try { await backfillTenantTemplates(tenantId); }
    catch (tplErr) { console.error('[api/admin/applications/accept] template backfill failed (non-fatal):', tplErr); }

    // Fallback OFFER (P5.3) — a one-time dismissible ToDo routing them to the Library's one-click
    // bulk add. Only when the eager copy landed nothing (copy failed or the catalog is empty), so the
    // tenant is never left with an empty library. Best-effort: a failure must NEVER fail the accept.
    if (starterCopied === 0) {
      try {
        await offerStarterSet({
          tenantId, tenantSlug: finalSlug, adminUserId: newUserId,
          actor: { id: userId, email: (session.user as { email?: string }).email ?? null, role: (isRole(role) ? role : 'rfp_admin') as Role, tenantId: null },
        });
      } catch (offerErr) {
        console.error('[api/admin/applications/accept] starter-set offer failed (non-fatal):', offerErr);
      }
    }

    await emitEventEnd(eventId, {
      result: {
        tenantId,
        tenantSlug: finalSlug,
        userId: newUserId,
        emailSent: emailResult.accepted,
        cardsBackfilled,
      },
    });

    return NextResponse.json({
      data: {
        tenantId: tenantId,
        tenantSlug: finalSlug,
        userId: newUserId,
        contactEmail: app.contactEmail,
        contactName: app.contactName,
        companyName: app.companyName,
        emailSent: emailResult.accepted,
        emailProvider: emailResult.provider,
        emailFailed: !!emailResult.error,
        // The admin UI relays these to the customer when email delivery is
        // unconfigured/unverified — otherwise an approved customer has no way in.
        tempPassword: tempPw,
        emailError: emailResult.error ?? null,
        cardsBackfilled,
      },
    });
  } catch (e) {
    console.error('[api/admin/applications/accept] error:', e);
    if (eventId) {
      await emitEventEnd(eventId, {
        error: { message: e instanceof Error ? e.message : String(e), code: 'DB_ERROR' },
      });
    }
    return NextResponse.json(
      { error: 'Internal server error', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}

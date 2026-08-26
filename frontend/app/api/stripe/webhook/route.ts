import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { stripe } from '@/lib/stripe';
import { getAmountCents, type ProductType } from '@/lib/stripe';
// Signature-verified Stripe webhook (no user session) — a privileged system write on behalf of
// the paying tenant (purchases + tenants). Runs pre-context, so it uses the owner (BYPASSRLS)
// pool; the Stripe signature check is the authorization. (docs/RLS_CUTOVER.md)
import { sqlBypass as sql } from '@/lib/db';
import { randomUUID } from 'crypto';
import { emitEventSingle, systemActor } from '@/lib/events';
import { launchProjectCollaboration } from '@/lib/process/project-collaboration';
import { resolveGatePolicy } from '@/lib/automation/policy';

/**
 * Stripe webhook handler. Verifies the webhook signature and processes
 * billing events (checkout completion, invoice paid, subscription canceled).
 *
 * This route MUST NOT use auth() — Stripe calls it directly.
 */
export async function POST(request: Request) {
  // `DB_ERROR` was wrong twice over: nothing here touches a database, and the condition is a
  // DEPLOYMENT one — Stripe keys absent — not a fault. It also disagreed with the two sibling
  // routes (stripe/checkout, stripe/portal), which already answer `STRIPE_NOT_CONFIGURED` for
  // exactly this, so an operator grepping the code found two of three occurrences. 503 is the
  // honest status and keeps Stripe's retry behaviour, which is what you want for a config gap:
  // the events replay once the keys are set instead of being lost to a 200.
  if (!stripe) {
    return NextResponse.json({ error: 'Stripe not configured', code: 'STRIPE_NOT_CONFIGURED' }, { status: 503 });
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error('[stripe/webhook] STRIPE_WEBHOOK_SECRET not configured');
    return NextResponse.json({ error: 'Webhook secret not configured', code: 'STRIPE_NOT_CONFIGURED' }, { status: 503 });
  }

  // ── Verify signature ────────────────────────────────────────────
  const body = await request.text();
  const sig = request.headers.get('stripe-signature');
  if (!sig) {
    return NextResponse.json({ error: 'Missing stripe-signature header', code: 'VALIDATION_ERROR' }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, webhookSecret);
  } catch (err) {
    console.error('[stripe/webhook] Signature verification failed:', err);
    return NextResponse.json({ error: 'Invalid signature', code: 'VALIDATION_ERROR' }, { status: 400 });
  }

  // ── Handle events ───────────────────────────────────────────────
  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
        break;

      case 'invoice.paid':
        await handleInvoicePaid(event.data.object as Stripe.Invoice);
        break;

      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
        break;

      default:
        // Unhandled event type — acknowledge receipt
        break;
    }
  } catch (err) {
    console.error(`[stripe/webhook] Error handling ${event.type}:`, err);
    // Distinguish transient vs permanent errors:
    // - DB/network errors (transient): return 500 so Stripe retries
    // - Validation/data errors (permanent): return 200 to stop retries
    const isTransient = err instanceof Error && (
      err.message.includes('ECONNREFUSED') ||
      err.message.includes('ETIMEDOUT') ||
      err.message.includes('ECONNRESET') ||
      err.message.includes('connection') ||
      err.message.includes('timeout') ||
      err.message.includes('deadlock') ||
      err.message.includes('too many clients') ||
      err.message.includes('database') ||
      err.name === 'DatabaseError'
    );
    if (isTransient) {
      return NextResponse.json({ error: 'Transient error, please retry', code: 'DB_ERROR' }, { status: 500 });
    }
    // Permanent error — acknowledge so Stripe stops retrying
    return NextResponse.json({ received: true });
  }

  return NextResponse.json({ received: true });
}

// ─── Event handlers ───────────────────────────────────────────────

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  const sessionId = session.id;
  const tenantId = session.metadata?.tenant_id;
  const productType = session.metadata?.product_type as ProductType | undefined;
  const opportunityId = session.metadata?.opportunity_id ?? null;

  if (!tenantId || !productType) {
    console.error('[stripe/webhook] checkout.session.completed missing metadata', {
      sessionId,
      metadata: session.metadata,
    });
    return;
  }

  // Idempotency: skip if we already recorded this session
  try {
    const [existing] = await sql<{ id: string }[]>`
      SELECT id FROM purchases WHERE stripe_session_id = ${sessionId}
    `;
    if (existing) return;
  } catch (err) {
    console.error('[stripe/webhook] idempotency check failed:', err);
    throw err;
  }

  const quantity = parseInt(session.metadata?.quantity ?? '1', 10) || 1;
  const amountCents = getAmountCents(productType) * quantity;
  const paymentIntent = typeof session.payment_intent === 'string'
    ? session.payment_intent
    : session.payment_intent?.id ?? null;

  // Wrap purchase insert + tenant subscription update in transaction
  try {
    await sql.begin(async (tx: any) => {
      // Insert the purchase record
      await tx`
        INSERT INTO purchases (tenant_id, opportunity_id, stripe_session_id, stripe_payment_intent, product_type, amount_cents, status)
        VALUES (
          ${tenantId},
          ${opportunityId},
          ${sessionId},
          ${paymentIntent},
          ${productType},
          ${amountCents},
          'completed'
        )
      `;

      // For subscriptions, update the tenant's subscription status
      if (productType === 'finder_subscription') {
        await tx`
          UPDATE tenants SET subscription_status = 'active' WHERE id = ${tenantId}
        `;
      }
    });
  } catch (err) {
    console.error('[stripe/webhook] checkout purchase transaction failed:', err);
    throw err;
  }

  try {
    if (productType === 'finder_subscription') {
      await emitEventSingle({
        namespace: 'capture',
        type: 'subscription.started',
        actor: systemActor('stripe-webhook'),
        tenantId,
        payload: { correlationId: randomUUID(), sessionId, productType },
      });
    } else if (productType === 'expert_consulting') {
      await emitEventSingle({
        namespace: 'capture',
        type: 'consulting.purchased',
        actor: systemActor('stripe-webhook'),
        tenantId,
        payload: { correlationId: randomUUID(), sessionId, productType, hours: quantity },
      });
    } else {
      await emitEventSingle({
        namespace: 'capture',
        type: 'purchase.completed',
        actor: systemActor('stripe-webhook'),
        tenantId,
        payload: { correlationId: randomUUID(), sessionId, productType, opportunityId },
      });

      // R3.3: close the purchase.completed orphan. An opportunity purchase now
      // fires a REAL transient project reaction on the spine — a ProjectCollaboration
      // HITL gate parked in the rfp_admin queue to set up the proposal workspace for
      // this tenant + opportunity (scope='opp', entity = the opportunity). Previously
      // purchase.completed had no consumer at all. System-attributed launch.
      if (opportunityId) {
        try {
          // #190: resolve gate cadence via policy; curation SLA is framework-hard.
          const pol = await resolveGatePolicy({
            tenantId,
            scope: 'build',
            triggerKey: 'proposal_setup',
            gateDefaults: { assigneeRole: 'rfp_admin', nudgeDays: [1, 3], dueInMinutes: 4320 },
            pinnedToCurationSla: true,
          });
          if (pol.enabled) {
            await launchProjectCollaboration({
              actor: { id: 'stripe-webhook', email: null, tenantId },
              actorType: 'system',
              tenantId,
              scope: 'opp',
              opportunityId,
              taskType: 'proposal_setup',
              taskTitle: 'Set up the proposal workspace for this purchase',
              assigneeRole: pol.assigneeRole,
              // Stripe checkout is descoped (comp code stands in) and this path creates NO portal, so
              // the gate references the opportunity (→ generic curation queue). The live comp-code
              // purchase route references the portal → the provisioning cockpit (PV-4). When Stripe is
              // wired to provision a portal, switch this to entityType 'portal'/entityRef portalId too.
              entityType: 'opportunity',
              entityRef: opportunityId,
              nudgeDays: pol.nudgeDays,
              dueMinutes: pol.dueInMinutes,
            });
          }
        } catch (setupErr) {
          console.error('[stripe/webhook] workspace-setup launch failed (non-fatal):', setupErr);
        }
      }
    }
  } catch (evtErr) {
    console.error('[stripe/webhook] checkout event emission failed:', evtErr);
  }
}

async function handleInvoicePaid(invoice: Stripe.Invoice) {
  // For recurring subscription invoices, find the purchase by Stripe
  // customer and update status. The checkout.session.completed handler
  // already created the initial record; this covers renewals.
  const subscriptionId = typeof invoice.subscription === 'string'
    ? invoice.subscription
    : invoice.subscription?.id ?? null;

  if (!subscriptionId) return;

  const customerId = typeof invoice.customer === 'string'
    ? invoice.customer
    : invoice.customer?.id ?? null;

  if (!customerId) return;

  // Look up tenant by stripe_customer_id
  let tenant: { id: string } | undefined;
  try {
    const [row] = await sql<{ id: string }[]>`
      SELECT id FROM tenants WHERE stripe_customer_id = ${customerId}
    `;
    tenant = row;
  } catch (err) {
    console.error('[stripe/webhook] tenant lookup failed:', err);
    throw err;
  }
  if (!tenant) return;

  // Ensure subscription status is active on successful payment
  try {
    await sql`
      UPDATE tenants SET subscription_status = 'active' WHERE id = ${tenant.id}
    `;
  } catch (err) {
    console.error('[stripe/webhook] subscription status update failed:', err);
    throw err;
  }

  try {
    await emitEventSingle({
      namespace: 'capture',
      type: 'subscription.renewed',
      actor: systemActor('stripe-webhook'),
      tenantId: tenant.id,
      payload: { correlationId: randomUUID(), invoiceId: invoice.id, subscriptionId },
    });
  } catch (evtErr) {
    console.error('[stripe/webhook] invoice event emission failed:', evtErr);
  }
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  const customerId = typeof subscription.customer === 'string'
    ? subscription.customer
    : subscription.customer?.id ?? null;

  if (!customerId) return;

  let tenant: { id: string } | undefined;
  try {
    const [row] = await sql<{ id: string }[]>`
      SELECT id FROM tenants WHERE stripe_customer_id = ${customerId}
    `;
    tenant = row;
  } catch (err) {
    console.error('[stripe/webhook] tenant lookup for subscription delete failed:', err);
    throw err;
  }
  if (!tenant) return;

  try {
    await sql`
      UPDATE tenants SET subscription_status = 'canceled' WHERE id = ${tenant.id}
    `;
  } catch (err) {
    console.error('[stripe/webhook] subscription cancel update failed:', err);
    throw err;
  }

  try {
    await emitEventSingle({
      namespace: 'capture',
      type: 'subscription.canceled',
      actor: systemActor('stripe-webhook'),
      tenantId: tenant.id,
      payload: { correlationId: randomUUID(), subscriptionId: subscription.id },
    });
  } catch (evtErr) {
    console.error('[stripe/webhook] subscription cancel event emission failed:', evtErr);
  }
}

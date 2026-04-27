import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { stripe } from '@/lib/stripe';
import { getAmountCents, type ProductType } from '@/lib/stripe';
import { sql } from '@/lib/db';
import { emitEventSingle, systemActor } from '@/lib/events';

/**
 * Stripe webhook handler. Verifies the webhook signature and processes
 * billing events (checkout completion, invoice paid, subscription canceled).
 *
 * This route MUST NOT use auth() — Stripe calls it directly.
 */
export async function POST(request: Request) {
  if (!stripe) {
    return NextResponse.json({ error: 'Stripe not configured' }, { status: 500 });
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error('[stripe/webhook] STRIPE_WEBHOOK_SECRET not configured');
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 500 });
  }

  // ── Verify signature ────────────────────────────────────────────
  const body = await request.text();
  const sig = request.headers.get('stripe-signature');
  if (!sig) {
    return NextResponse.json({ error: 'Missing stripe-signature header' }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, webhookSecret);
  } catch (err) {
    console.error('[stripe/webhook] Signature verification failed:', err);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
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
    // Return 200 so Stripe does not retry — we logged the error
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
  const [existing] = await sql<{ id: string }[]>`
    SELECT id FROM purchases WHERE stripe_session_id = ${sessionId}
  `;
  if (existing) return;

  const amountCents = getAmountCents(productType);
  const paymentIntent = typeof session.payment_intent === 'string'
    ? session.payment_intent
    : session.payment_intent?.id ?? null;

  // Insert the purchase record
  await sql`
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
    await sql`
      UPDATE tenants SET subscription_status = 'active' WHERE id = ${tenantId}
    `;
    await emitEventSingle({
      namespace: 'identity',
      type: 'subscription.created',
      actor: systemActor('stripe-webhook'),
      tenantId,
      payload: { sessionId, productType },
    });
  } else {
    await emitEventSingle({
      namespace: 'capture',
      type: 'proposal.purchased',
      actor: systemActor('stripe-webhook'),
      tenantId,
      payload: { sessionId, productType, opportunityId },
    });
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
  const [tenant] = await sql<{ id: string }[]>`
    SELECT id FROM tenants WHERE stripe_customer_id = ${customerId}
  `;
  if (!tenant) return;

  // Ensure subscription status is active on successful payment
  await sql`
    UPDATE tenants SET subscription_status = 'active' WHERE id = ${tenant.id}
  `;

  await emitEventSingle({
    namespace: 'identity',
    type: 'subscription.renewed',
    actor: systemActor('stripe-webhook'),
    tenantId: tenant.id,
    payload: { invoiceId: invoice.id, subscriptionId },
  });
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  const customerId = typeof subscription.customer === 'string'
    ? subscription.customer
    : subscription.customer?.id ?? null;

  if (!customerId) return;

  const [tenant] = await sql<{ id: string }[]>`
    SELECT id FROM tenants WHERE stripe_customer_id = ${customerId}
  `;
  if (!tenant) return;

  await sql`
    UPDATE tenants SET subscription_status = 'canceled' WHERE id = ${tenant.id}
  `;

  await emitEventSingle({
    namespace: 'identity',
    type: 'subscription.canceled',
    actor: systemActor('stripe-webhook'),
    tenantId: tenant.id,
    payload: { subscriptionId: subscription.id },
  });
}

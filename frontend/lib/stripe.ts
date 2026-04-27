/**
 * Stripe SDK client and billing helpers.
 *
 * Provides a configured Stripe instance plus three helper functions
 * used by the checkout, webhook, and portal API routes:
 *
 *   - createCheckoutSession — builds a Checkout Session for subscriptions or one-time purchases
 *   - createCustomerPortalSession — opens the Stripe billing portal for self-service management
 *   - getOrCreateStripeCustomer — idempotent customer creation keyed to tenant_id
 *
 * The client is null when STRIPE_SECRET_KEY is not set (local dev without Stripe).
 */
import Stripe from 'stripe';
import { sql } from './db';

// ─── Client ─────────────────────────────────────────────────────────

if (!process.env.STRIPE_SECRET_KEY && process.env.NODE_ENV === 'production') {
  console.error('[stripe] STRIPE_SECRET_KEY not configured');
}

export const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : (null as Stripe | null);

// ─── Product types ──────────────────────────────────────────────────

export type ProductType = 'finder_subscription' | 'proposal_phase1' | 'proposal_phase2';

const PRICE_IDS: Record<ProductType, string | undefined> = {
  finder_subscription: process.env.STRIPE_SPOTLIGHT_PRICE_ID,
  proposal_phase1: process.env.STRIPE_PROPOSAL_P1_PRICE_ID,
  proposal_phase2: process.env.STRIPE_PROPOSAL_P2_PRICE_ID,
};

const AMOUNTS_CENTS: Record<ProductType, number> = {
  finder_subscription: 29900,
  proposal_phase1: 99900,
  proposal_phase2: 199900,
};

export function getAmountCents(productType: ProductType): number {
  return AMOUNTS_CENTS[productType];
}

// ─── Helpers ────────────────────────────────────────────────────────

/**
 * Look up or create a Stripe Customer for the given tenant, then
 * persist the stripe_customer_id on the tenants row so subsequent
 * calls are a no-op DB read.
 */
export async function getOrCreateStripeCustomer(
  tenantId: string,
  email: string,
  name: string,
): Promise<string> {
  if (!stripe) throw new Error('Stripe is not configured');

  // Check if tenant already has a Stripe customer
  const [tenant] = await sql<{ stripeCustomerId: string | null }[]>`
    SELECT stripe_customer_id FROM tenants WHERE id = ${tenantId}
  `;

  if (tenant?.stripeCustomerId) {
    return tenant.stripeCustomerId;
  }

  // Create a new customer in Stripe
  const customer = await stripe.customers.create({
    email,
    name,
    metadata: { tenant_id: tenantId },
  });

  // Persist the mapping
  await sql`
    UPDATE tenants SET stripe_customer_id = ${customer.id} WHERE id = ${tenantId}
  `;

  return customer.id;
}

/**
 * Create a Stripe Checkout Session for either a subscription or a
 * one-time payment. Returns the full session object (caller extracts
 * the URL).
 */
export async function createCheckoutSession(
  tenantId: string,
  productType: ProductType,
  metadata: {
    tenantSlug: string;
    customerId: string;
    opportunityId?: string;
  },
): Promise<Stripe.Checkout.Session> {
  if (!stripe) throw new Error('Stripe is not configured');

  const priceId = PRICE_IDS[productType];
  if (!priceId) {
    throw new Error(`No price ID configured for product type: ${productType}`);
  }

  const isSubscription = productType === 'finder_subscription';

  const successUrl = `${process.env.NEXTAUTH_URL ?? 'http://localhost:3000'}/portal/${metadata.tenantSlug}/billing?session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = `${process.env.NEXTAUTH_URL ?? 'http://localhost:3000'}/portal/${metadata.tenantSlug}/billing`;

  const sessionParams: Stripe.Checkout.SessionCreateParams = {
    customer: metadata.customerId,
    mode: isSubscription ? 'subscription' : 'payment',
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: {
      tenant_id: tenantId,
      product_type: productType,
      ...(metadata.opportunityId ? { opportunity_id: metadata.opportunityId } : {}),
    },
  };

  // For one-time payments, also attach metadata to the payment intent
  if (!isSubscription) {
    sessionParams.payment_intent_data = {
      metadata: {
        tenant_id: tenantId,
        product_type: productType,
        ...(metadata.opportunityId ? { opportunity_id: metadata.opportunityId } : {}),
      },
    };
  } else {
    sessionParams.subscription_data = {
      metadata: {
        tenant_id: tenantId,
        product_type: productType,
      },
    };
  }

  return stripe.checkout.sessions.create(sessionParams);
}

/**
 * Create a Stripe Customer Portal session so tenants can self-manage
 * billing (update card, cancel subscription, view invoices).
 */
export async function createCustomerPortalSession(
  stripeCustomerId: string,
  returnUrl: string,
): Promise<Stripe.BillingPortal.Session> {
  if (!stripe) throw new Error('Stripe is not configured');

  return stripe.billingPortal.sessions.create({
    customer: stripeCustomerId,
    return_url: returnUrl,
  });
}

-- 022_stripe_columns.sql
-- Add Stripe customer ID and subscription status to tenants for billing integration.

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS subscription_status TEXT NOT NULL DEFAULT 'none'
    CHECK (subscription_status IN ('none','active','past_due','canceled'));

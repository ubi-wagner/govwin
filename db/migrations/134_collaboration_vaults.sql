-- 134_collaboration_vaults.sql
--
-- Collaboration vaults ("nooks") — the segregated external-partner bridge
-- (docs/LIBRARY_AND_VAULTS_DESIGN.md §5). A nook is a customer-owned, RLS-segregated
-- branch library, one per (customer tenant × external partner). Collaborators see ONLY
-- their nook; the tenant admin (incl. shadow) copies content IN and harvests grains OUT.
--
-- P8.1: tables + RLS scaffolding (owner-tenant isolation). The collaborator-facing
-- isolation contract (a partner sees ONLY their vault) + the rights matrix are enforced
-- at the application layer (live) with these RLS policies as the backstop for the
-- eventual NOBYPASSRLS govtech_app cutover.

-- The nook: one per (owner tenant × partner).
CREATE TABLE IF NOT EXISTS collaboration_vaults (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,   -- the OWNER customer
  partner_name text NOT NULL,
  partner_org  text,
  status       text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed')),
  created_by   uuid REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  closed_at    timestamptz
);
CREATE INDEX IF NOT EXISTS idx_collab_vaults_tenant ON collaboration_vaults(tenant_id);

-- Vault membership: the partner emails granted to a SPECIFIC nook. tenant_id is the
-- owner (denormalized so RLS is a simple tenant match). user_id is filled when the
-- invited email signs in; the email is the durable grant key (invite-before-signup).
CREATE TABLE IF NOT EXISTS vault_members (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vault_id    uuid NOT NULL REFERENCES collaboration_vaults(id) ON DELETE CASCADE,
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,   -- owner (RLS key)
  email       text NOT NULL,
  user_id     uuid REFERENCES users(id),
  role        text NOT NULL DEFAULT 'partner_user' CHECK (role = 'partner_user'),
  status      text NOT NULL DEFAULT 'invited' CHECK (status IN ('invited', 'active', 'revoked')),
  invited_by  uuid REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  revoked_at  timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_vault_member_email ON vault_members(vault_id, lower(email));
CREATE INDEX IF NOT EXISTS idx_vault_members_user ON vault_members(user_id) WHERE user_id IS NOT NULL;

-- Vault content lives in library_atoms: visibility='vault' + vault_id set. A vault atom
-- is never visible to the tenant's main library queries (which filter visibility) and
-- cascades away with its vault.
ALTER TABLE library_atoms ADD COLUMN IF NOT EXISTS vault_id uuid REFERENCES collaboration_vaults(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_library_atoms_vault ON library_atoms(vault_id) WHERE vault_id IS NOT NULL;

ALTER TABLE library_atoms DROP CONSTRAINT IF EXISTS library_atoms_visibility_check;
ALTER TABLE library_atoms ADD CONSTRAINT library_atoms_visibility_check
  CHECK (visibility = ANY (ARRAY['tenant'::text, 'owner_only'::text, 'shared_for_proposal'::text, 'admin_only'::text, 'vault'::text]));

-- RLS scaffolding: owner-tenant isolation on the two new tables (backstop; the app runs
-- as the RLS-bypassing owner today, so these arm for the NOBYPASSRLS cutover — the live
-- vault isolation + rights are enforced in the routes, proven by the P8.10 security gate).
ALTER TABLE collaboration_vaults ENABLE ROW LEVEL SECURITY;
ALTER TABLE collaboration_vaults FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON collaboration_vaults;
CREATE POLICY tenant_isolation ON collaboration_vaults
  USING      (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE vault_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE vault_members FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON vault_members;
CREATE POLICY tenant_isolation ON vault_members
  USING      (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

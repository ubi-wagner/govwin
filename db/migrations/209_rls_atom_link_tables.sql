-- 209 · The READ half of "nothing reads or writes cross-tenant"
--
-- Mig 208 closed the WRITE half for `atom_lineage`: a trigger refuses any edge whose two endpoints
-- belong to different tenants, even under a superuser. But the rule the owner stated covers reads
-- too — *"nothing reads or writes cross tenant, ever"* — and both atom link tables were readable
-- from any tenant context, because neither had row-level security at all.
--
-- WHY THEY WERE MISSED. They carry no `tenant_id` column of their own; their tenancy is implied
-- through their endpoints. Every sweep that looks for a tenant column skips them by construction —
-- which is also how 303 cross-tenant lineage edges sat unnoticed. `atom_tags` was given a policy of
-- exactly this shape by mig 117, and the two siblings were simply never done: the comment in
-- `lib/atoms.ts` says so outright — *"atom_lineage has no RLS (mig 117 covered atom_tags only)"* —
-- and that sentence has been carrying a real gap as an aside.
--
--     BEFORE            atom_tags  RLS ✓ forced ✓        atom_embeddings  RLS ✓ forced ✓
--                    atom_lineage  RLS ✗                    atom_members  RLS ✗
--
-- `atom_members` is the one that matters most in content terms: it holds the
-- foundation ⊃ section ⊃ group ⊃ primitive tree, which is the customer's own library structure.
--
-- SHAPE COPIED FROM `atom_tags`, deliberately, rather than invented. A denormalised `tenant_id`
-- column would make the policy simpler but would add a second source of truth to keep in sync, and
-- a drifted denormalisation is a silent isolation hole. The EXISTS form has one source of truth:
-- the atom's own tenant.
--
-- BOTH endpoints are required to be in the current tenant, not just one. Mig 208's trigger already
-- guarantees they match for `atom_lineage`, so checking both is redundant there today — but it is
-- redundant in the direction that fails SAFE, it documents the invariant in the policy itself, and
-- `atom_members` has no such trigger.

BEGIN;

-- ── atom_lineage ────────────────────────────────────────────────────────────────────────────────
ALTER TABLE atom_lineage ENABLE ROW LEVEL SECURITY;
ALTER TABLE atom_lineage FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON atom_lineage;
CREATE POLICY tenant_isolation ON atom_lineage
  USING (
    EXISTS (SELECT 1 FROM library_atoms a
            WHERE a.id = atom_lineage.parent_atom_id
              AND a.tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    AND EXISTS (SELECT 1 FROM library_atoms b
            WHERE b.id = atom_lineage.child_atom_id
              AND b.tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM library_atoms a
            WHERE a.id = atom_lineage.parent_atom_id
              AND a.tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    AND EXISTS (SELECT 1 FROM library_atoms b
            WHERE b.id = atom_lineage.child_atom_id
              AND b.tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  );

-- ── atom_members ────────────────────────────────────────────────────────────────────────────────
ALTER TABLE atom_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE atom_members FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON atom_members;
CREATE POLICY tenant_isolation ON atom_members
  USING (
    EXISTS (SELECT 1 FROM library_atoms g
            WHERE g.id = atom_members.group_atom_id
              AND g.tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    AND EXISTS (SELECT 1 FROM library_atoms m
            WHERE m.id = atom_members.member_atom_id
              AND m.tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM library_atoms g
            WHERE g.id = atom_members.group_atom_id
              AND g.tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    AND EXISTS (SELECT 1 FROM library_atoms m
            WHERE m.id = atom_members.member_atom_id
              AND m.tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  );

-- The membership lookups the policy runs on every row — without these it is a seq scan per check.
CREATE INDEX IF NOT EXISTS idx_atom_lineage_parent ON atom_lineage (parent_atom_id);
CREATE INDEX IF NOT EXISTS idx_atom_lineage_child  ON atom_lineage (child_atom_id);
CREATE INDEX IF NOT EXISTS idx_atom_members_group  ON atom_members (group_atom_id);
CREATE INDEX IF NOT EXISTS idx_atom_members_member ON atom_members (member_atom_id);

COMMIT;

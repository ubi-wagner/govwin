-- 208 · NOTHING READS OR WRITES CROSS-TENANT. EVER.
--
-- The rule, stated by the owner: tenants never read or write each other's data. Bridges carry
-- messages, and data moves by INWARD COPY only — opportunities copied into tenants, templates
-- copied into tenants. A stored reference from one tenant's row to another tenant's row is not a
-- copy; it is a shared object, and it is exactly what the rule forbids.
--
-- WHAT THIS FIXES. A sweep of every entity↔entity link in the schema — the 46 FKs where both sides
-- carry `tenant_id`, plus the join tables that carry none of their own and were therefore invisible
-- to a tenant-column check — found exactly one violation class:
--
--     atom_lineage: 303 of 303 edges tenant↔tenant   (rfp-pipeline → entrepreneurs-center)
--
-- Everything else was clean: atom_members 0 of 600, atom_tags 0 of 6015, and the single
-- tenant_documents→document_templates link is PLATFORM scope (`tenant_id IS NULL`, `is_system`),
-- which is the documented template bridge and not a tenant reading another tenant.
--
-- WHERE THE 303 CAME FROM, AND WHY THIS IS RESIDUE RATHER THAN A LIVE HOLE. All 303 were written in
-- a single minute on 2026-08-12, alongside their child atoms — the KEEP+COPY starter copy-forward
-- (task #71), before `createAtom` grew its same-tenant parent guard. The current code CANNOT
-- reproduce them: `createAtom` accepts a parent only when it belongs to the same tenant as the
-- child, and a live copy driven today produced 0 cross-tenant edges against 31 copied grains.
--
-- So the app layer is already correct. What was missing is enforcement in the one place app code
-- cannot route around, and the residue that a fresh eye would reasonably read as intended design.
--
-- WHY A TRIGGER AND NOT A CHECK OR RLS. A CHECK constraint cannot see the two parent rows this
-- predicate needs. RLS on `atom_lineage` would scope *reads* but still permit a bad row to be
-- written by any bypassing path (migrations, seeds, the owner role) — and every one of the 303 was
-- written by exactly such a path. A trigger refuses the WRITE itself, whoever is making it.

BEGIN;

-- ── 1 · remove the residue ──────────────────────────────────────────────────────────────────────
-- Recorded before deleting, so the count lands in the migration log rather than only in a report.
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n
  FROM atom_lineage l
  JOIN library_atoms p ON p.id = l.parent_atom_id
  JOIN library_atoms c ON c.id = l.child_atom_id
  WHERE p.tenant_id IS NOT NULL AND c.tenant_id IS NOT NULL AND p.tenant_id <> c.tenant_id;
  RAISE NOTICE '[208] removing % cross-tenant atom_lineage edge(s)', n;
END $$;

DELETE FROM atom_lineage l
USING library_atoms p, library_atoms c
WHERE p.id = l.parent_atom_id
  AND c.id = l.child_atom_id
  AND p.tenant_id IS NOT NULL
  AND c.tenant_id IS NOT NULL
  AND p.tenant_id <> c.tenant_id;

-- ── 2 · make it impossible to write another ─────────────────────────────────────────────────────
--
-- PLATFORM SCOPE IS DELIBERATELY ALLOWED. A NULL `tenant_id` is the platform plane, not "some other
-- tenant" — the same distinction `tenant_isolation_select` makes with its `OR (tenant_id IS NULL)`
-- arm. Blocking it here would forbid the house shelf from ever relating to itself and is not what
-- the rule is about. The predicate fires only when BOTH sides are owned and the owners differ.
CREATE OR REPLACE FUNCTION atom_lineage_same_tenant_only() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE parent_tenant uuid; child_tenant uuid;
BEGIN
  SELECT tenant_id INTO parent_tenant FROM library_atoms WHERE id = NEW.parent_atom_id;
  SELECT tenant_id INTO child_tenant  FROM library_atoms WHERE id = NEW.child_atom_id;

  IF parent_tenant IS NOT NULL AND child_tenant IS NOT NULL AND parent_tenant <> child_tenant THEN
    RAISE EXCEPTION
      'cross-tenant atom_lineage refused: parent % (tenant %) -> child % (tenant %)',
      NEW.parent_atom_id, parent_tenant, NEW.child_atom_id, child_tenant
      USING HINT = 'Data moves between tenants by INWARD COPY, never by reference. Copy the atom '
                   'into the target tenant and relate the copy to its own tenant''s rows.',
            ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_atom_lineage_same_tenant ON atom_lineage;
CREATE TRIGGER trg_atom_lineage_same_tenant
  BEFORE INSERT OR UPDATE ON atom_lineage
  FOR EACH ROW EXECUTE FUNCTION atom_lineage_same_tenant_only();

COMMIT;

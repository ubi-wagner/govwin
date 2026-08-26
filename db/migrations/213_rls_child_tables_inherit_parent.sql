-- 213_rls_child_tables_inherit_parent.sql
--
-- Two more tables of the shape mig 212 closed, found by the instrument that mig 212 widened.
--
-- `process_instance_transitions` — the step-by-step history of a workflow instance: which step
-- ran, the actor, the reason, the entity it affected, the content version before and after. RLS
-- off, no policy, so every tenant's workflow history was readable from any tenant context. 300
-- rows, all 300 visible in all 5 contexts.
--
-- `agent_task_results` — the OUTPUT of an agent task. Same posture, same exposure.
--
-- Both are children of a table that IS correctly protected (`process_instances`,
-- `agent_task_queue`), which is exactly why they were missed: the audits look at the parent, the
-- parent is fine, and the child carries no `tenant_id` of its own to be noticed by.
--
-- THE POLICY INHERITS RATHER THAN RESTATES, and this is the point of the migration.
--
-- The obvious way to write these is to copy the parent's predicate down into the child:
--     USING (EXISTS (SELECT 1 FROM process_instances pi
--                     WHERE pi.id = instance_id
--                       AND (pi.tenant_id = app.tenant_id OR pi.tenant_id IS NULL)))
-- That would be a SECOND definition of what "this tenant may see" means, and the two parents do
-- not even agree with each other: `agent_task_queue` is own-tenant only, while
-- `process_instances` deliberately shares platform-scope rows (tenant_id IS NULL) with everyone.
-- Copying both down means two predicates to keep in sync with two parents forever, and a quantity
-- defined twice will eventually disagree with itself — here, silently, on a security boundary.
--
-- So the child asks only "is the parent row visible to me?" and lets the parent's own policy
-- answer. PostgreSQL applies row-level security to tables referenced inside a policy's subquery,
-- so the EXISTS returns a row only when the caller could have selected it directly.
--
-- MEASURED, not assumed. With the bare EXISTS in place, as `govtech_app` across all 5 tenant
-- contexts:
--     owner total                      300
--     sum across the 5 contexts        444
-- If the child were unfiltered the sum would be 300 × 5 = 1500. 444 solves as 264 owned rows seen
-- once plus 36 platform-scope rows seen five times (264 + 36×5 = 444) — the parent's own
-- own-or-shared semantics, inherited exactly, with nothing restated here to drift from it.
--
-- Idempotent / re-runnable.

BEGIN;

-- ---------------------------------------------------------------------------------------------
-- Workflow step history — inherits `process_instances` (own tenant OR platform-scope).
-- ---------------------------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.process_instance_transitions') IS NULL THEN
    RAISE NOTICE 'mig213: process_instance_transitions absent, skipped';
    RETURN;
  END IF;

  ALTER TABLE public.process_instance_transitions ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.process_instance_transitions FORCE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS tenant_isolation ON public.process_instance_transitions;
  CREATE POLICY tenant_isolation ON public.process_instance_transitions
    FOR ALL
    USING (EXISTS (
      SELECT 1 FROM public.process_instances pi
      WHERE pi.id = process_instance_transitions.instance_id
    ));
END $$;

-- ---------------------------------------------------------------------------------------------
-- Agent task output — inherits `agent_task_queue` (own tenant only).
-- ---------------------------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.agent_task_results') IS NULL THEN
    RAISE NOTICE 'mig213: agent_task_results absent, skipped';
    RETURN;
  END IF;

  ALTER TABLE public.agent_task_results ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.agent_task_results FORCE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS tenant_isolation ON public.agent_task_results;
  CREATE POLICY tenant_isolation ON public.agent_task_results
    FOR ALL
    USING (EXISTS (
      SELECT 1 FROM public.agent_task_queue q
      WHERE q.id = agent_task_results.task_id
    ));
END $$;

-- ---------------------------------------------------------------------------------------------
-- Two more of mig 212's exact shape: `proposal_id`-keyed, no tenant_id, no policy.
--
-- BOTH ARE EMPTY TODAY, which is the only reason they are in this migration rather than the last
-- one — the behavioural half of check-rls-posture.mjs measures visibility by counting rows, and a
-- table with no rows produces no counts to compare, so it reported them as "unmeasured" and moved
-- on. They surfaced the moment that check was given a STRUCTURAL rule (a tenant-owned table must
-- carry a policy, whether or not it currently holds data), which needs no fixture and therefore
-- holds on a freshly migrated box — which is exactly when a missing policy is easiest to add and
-- hardest to notice.
--
-- `stage_completion_snapshots` — the sections snapshot taken when a proposal stage completes.
-- `stage_gate_requirements`   — per-stage gate requirements and the evidence that they were met.
-- ---------------------------------------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['stage_completion_snapshots', 'stage_gate_requirements'] LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE NOTICE 'mig213: % absent, skipped', t;
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON public.%I', t);
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON public.%I
        FOR ALL
        USING (EXISTS (
          SELECT 1 FROM public.proposals p
          WHERE p.id = %I.proposal_id
            AND p.tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
        ))
    $f$, t, t);
  END LOOP;
END $$;

-- The policy subqueries run per row touched; without these the EXISTS is a scan of the parent.
CREATE INDEX IF NOT EXISTS idx_pit_instance ON public.process_instance_transitions (instance_id);
CREATE INDEX IF NOT EXISTS idx_agent_task_results_task ON public.agent_task_results (task_id);
CREATE INDEX IF NOT EXISTS idx_stage_completion_snapshots_proposal ON public.stage_completion_snapshots (proposal_id);
CREATE INDEX IF NOT EXISTS idx_stage_gate_requirements_proposal ON public.stage_gate_requirements (proposal_id);

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- 194 — Index the column every RLS policy filters on.
--
-- Six RLS-enabled tables carry `tenant_id`, have a `tenant_isolation` policy whose USING and
-- WITH CHECK both read `tenant_id = current_setting('app.tenant_id')`, and have NO index whose
-- leading column is `tenant_id`. Every tenant-scoped query against them therefore does a
-- sequential scan with the policy applied as a filter — the policy is not a shortcut, it is extra
-- work done per row.
--
-- Found by:
--   SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
--   WHERE n.nspname='public' AND c.relkind='r' AND c.relrowsecurity
--     AND EXISTS (SELECT 1 FROM information_schema.columns col
--                 WHERE col.table_name = c.relname AND col.column_name = 'tenant_id')
--     AND NOT EXISTS (SELECT 1 FROM pg_index i
--                     JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = i.indkey[0]
--                     WHERE i.indrelid = c.oid AND a.attname = 'tenant_id');
--
-- These are small today (0–3 rows in the sandbox), which is exactly why this is cheap to do now.
-- `purchases` is the one that grows monotonically with the business — every sale is a row, it is
-- read on every portal load to decide what the tenant has bought, and ALL THREE of its foreign
-- keys are unindexed (tenant_id, opportunity_id, proposal_id). `agent_task_queue` is the other
-- one with real churn: the fabric polls it continuously.
--
-- IF NOT EXISTS throughout so this is safe to re-run and safe on a database where someone has
-- already added one by hand.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── The six RLS tables missing an index on the policy column ──
CREATE INDEX IF NOT EXISTS idx_purchases_tenant                ON purchases (tenant_id);
CREATE INDEX IF NOT EXISTS idx_agent_task_queue_tenant         ON agent_task_queue (tenant_id);
CREATE INDEX IF NOT EXISTS idx_notification_read_state_tenant  ON notification_read_state (tenant_id);
CREATE INDEX IF NOT EXISTS idx_proposal_amendment_flags_tenant ON proposal_amendment_flags (tenant_id);
CREATE INDEX IF NOT EXISTS idx_shadow_admin_grants_tenant      ON shadow_admin_grants (tenant_id);
CREATE INDEX IF NOT EXISTS idx_vault_members_tenant            ON vault_members (tenant_id);

-- ── purchases' other two FKs ──
-- Both are looked up directly: the portal asks "has this tenant bought this opportunity?" and the
-- provisioning path walks purchase → proposal. A FK with no index also makes any DELETE on the
-- parent scan this whole table.
CREATE INDEX IF NOT EXISTS idx_purchases_opportunity ON purchases (opportunity_id);
CREATE INDEX IF NOT EXISTS idx_purchases_proposal    ON purchases (proposal_id);

-- ── Cascade-relevant FKs with no index ──
-- tenant_bucket_scores.bucket_id is ON DELETE CASCADE from tenant_spotlight_buckets, so deleting
-- one bucket currently scans the whole scores table.
CREATE INDEX IF NOT EXISTS idx_tenant_bucket_scores_bucket ON tenant_bucket_scores (bucket_id);
-- agent_task_results.task_id is the join every result read makes back to its queue row.
CREATE INDEX IF NOT EXISTS idx_agent_task_results_task     ON agent_task_results (task_id);
-- proposal_compliance_matrix.section_id is read per section when the matrix is rendered.
CREATE INDEX IF NOT EXISTS idx_pcm_section                 ON proposal_compliance_matrix (section_id);
-- proposals.solicitation_id backs "every proposal built from this solicitation".
CREATE INDEX IF NOT EXISTS idx_proposals_solicitation      ON proposals (solicitation_id);
-- atom_members.member_atom_id is the reverse edge — "which groups contain this atom?"
CREATE INDEX IF NOT EXISTS idx_atom_members_member         ON atom_members (member_atom_id);

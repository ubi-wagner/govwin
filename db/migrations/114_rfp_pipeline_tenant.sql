-- 114_rfp_pipeline_tenant.sql
-- "Everyone is email + a real company — including us." Make our own organization a
-- first-class tenant so staff have a real workspace (upload + atomizer + library +
-- everything a customer gets), rather than a NULL/platform special case. Our people are
-- customers too. See docs/MULTI_MEMBERSHIP_IDENTITY_DESIGN.md ("including us").

INSERT INTO tenants (name, slug, status, lifecycle_stage)
VALUES ('RFP Pipeline', 'rfp-pipeline', 'active', 'customer')
ON CONFLICT (slug) DO NOTHING;

-- Every RFP/master admin gets a HOME (tenant_admin) membership at our tenant, so inside
-- it they're a real member (not "shadowing" — the portal layout uses this to suppress
-- the shadow banner on our own space). Their platform god-view (/admin) is unchanged.
INSERT INTO user_memberships (user_id, tenant_id, role, status, source)
SELECT u.id, t.id, 'tenant_admin', 'active', 'home'
FROM users u
CROSS JOIN tenants t
WHERE u.role IN ('rfp_admin', 'master_admin') AND t.slug = 'rfp-pipeline'
ON CONFLICT (user_id, tenant_id) DO NOTHING;

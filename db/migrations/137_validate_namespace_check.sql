-- 137_validate_namespace_check.sql
-- Rebaseline cutover-readiness: promote the system_events namespace CHECK from
-- NOT VALID to VALIDATED.
--
-- mig 069 added system_events_namespace_chk as NOT VALID (it constrained new writes
-- but never proved the existing backlog conformed). The Phase-1 workflow/CMS verifiers
-- confirmed every emitter (frontend + pipeline + CMS) uses only the allowed namespaces
-- {finder, capture, identity, proposal, library, system, tool}, and VALIDATE passes
-- clean on a from-scratch migrate. Validating here proves no historical row carries a
-- forbidden namespace (admin/cms/spotlight) before onboarding tenants.
--
-- VALIDATE CONSTRAINT is idempotent (a no-op once validated) and takes only a SHARE
-- UPDATE EXCLUSIVE lock (concurrent reads/writes proceed). If this ever fails at deploy,
-- that is the intended signal: a forbidden-namespace row exists and must be reconciled.

ALTER TABLE system_events VALIDATE CONSTRAINT system_events_namespace_chk;

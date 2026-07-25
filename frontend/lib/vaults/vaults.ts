/**
 * Collaboration vaults ("nooks") — the segregated external-partner bridge
 * (docs/LIBRARY_AND_VAULTS_DESIGN.md §5). This module is the ISOLATION CONTRACT +
 * the rights matrix (P8.2, P8.5, P8.6) plus vault CRUD (P8.3) and membership (P8.4).
 *
 * Two sides, one vault:
 *   • tenant side  — tenant_admin of the owner tenant (incl. shadow rfp_admin/master_admin):
 *                    copy-in upload · atomize · download ANY grain · ingest · manage.
 *   • collaborator — an assigned partner email (vault_members): upload own · atomize ·
 *                    download WHOLE artifacts only. No grain extraction, no ingest, no manage.
 * Anyone else: no access. A collaborator sees ONLY their vault, never the main library
 * or another nook.
 */
import { randomUUID } from 'crypto';
import bcrypt from 'bcryptjs';
import { sql, sqlBypass } from '@/lib/db';
import { hasRoleAtLeast, type Role } from '@/lib/rbac';
import { emitEventSingle, userActor } from '@/lib/events';
import { createTask } from '@/lib/tasks/tasks';
import { decomposeAndIngest, copyFoundationToTenant, type FoundationMeta } from '@/lib/library/foundation';
import type { CanvasDocument } from '@/lib/types/canvas-document';

export type VaultSide = 'tenant' | 'collaborator';

export interface VaultRights {
  upload: boolean;        // add content to the vault
  atomize: boolean;       // structure an artifact into section/group/atom grains
  downloadWhole: boolean; // download a whole foundation artifact
  downloadGrain: boolean; // download an individual section/group/primitive grain
  ingest: boolean;        // copy a vault grain into the proposal-portal library
  manage: boolean;        // invite/revoke members, close the vault
}

export const TENANT_RIGHTS: VaultRights = { upload: true, atomize: true, downloadWhole: true, downloadGrain: true, ingest: true, manage: true };
export const COLLAB_RIGHTS: VaultRights = { upload: true, atomize: true, downloadWhole: true, downloadGrain: false, ingest: false, manage: false };

export interface VaultAccess { vaultId: string; ownerTenantId: string; side: VaultSide; rights: VaultRights; }

export interface Vault { id: string; tenantId: string; partnerName: string; partnerOrg: string | null; status: string; createdAt: string }
export interface VaultMember { id: string; email: string; userId: string | null; status: string; createdAt: string }

/**
 * The isolation contract: resolve a caller's side + rights for a vault, or null if they
 * have no access. Tenant side = a platform admin (can shadow) OR an active tenant_admin
 * membership at the OWNER tenant; collaborator side = an active (non-revoked) vault_members
 * grant matching the caller's user id or email. DB-backed so it can be proven standalone.
 */
export async function resolveVaultAccess(
  vaultId: string,
  actor: { userId: string; email?: string | null; role: Role },
): Promise<VaultAccess | null> {
  // AUTHORIZATION lookup — runs BEFORE any tenant context is pinnable: it resolves the vault BY
  // ID to *discover* its owner tenant (chicken-and-egg — we can't SET app.tenant_id to a tenant
  // we don't yet know). So it reads the forced `collaboration_vaults`/`vault_members` tables via
  // the owner `sqlBypass` pool, exactly like auth reads `users` by email pre-context. Isolation is
  // NOT weakened: access is still gated by the tenant-membership / collaborator-membership checks
  // below (no membership → null → 403). The CALLER then enterTenant(ownerTenantId) for the
  // handler's own content reads. (docs/RLS_CUTOVER.md — entity-first gates use bypass.)
  const [v] = await sqlBypass<Array<{ id: string; tenantId: string }>>`
    SELECT id, tenant_id AS "tenantId" FROM collaboration_vaults
    WHERE id = ${vaultId}::uuid AND status = 'active' LIMIT 1`;
  if (!v) return null;

  // Tenant side.
  const platformAdmin = actor.role === 'master_admin' || actor.role === 'rfp_admin';
  let tenantSide = platformAdmin;
  if (!tenantSide && hasRoleAtLeast(actor.role, 'tenant_admin')) {
    const [m] = await sqlBypass<Array<{ ok: number }>>`
      SELECT 1 AS ok FROM user_memberships
      WHERE user_id = ${actor.userId}::uuid AND tenant_id = ${v.tenantId}::uuid
        AND role = 'tenant_admin' AND status = 'active' LIMIT 1`;
    tenantSide = !!m;
  }
  if (tenantSide) return { vaultId: v.id, ownerTenantId: v.tenantId, side: 'tenant', rights: TENANT_RIGHTS };

  // Collaborator side — active grant by user id OR by invited email. Guard a null/empty
  // session email so it can never match a member row (emails are stored NOT NULL, but be
  // defensive — an empty match must never grant access).
  const emailMatch = actor.email && actor.email.trim() ? actor.email.trim() : null;
  const [cm] = await sqlBypass<Array<{ ok: number }>>`
    SELECT 1 AS ok FROM vault_members
    WHERE vault_id = ${vaultId}::uuid AND status <> 'revoked'
      AND (user_id = ${actor.userId}::uuid OR (${emailMatch}::text IS NOT NULL AND lower(email) = lower(${emailMatch})))
    LIMIT 1`;
  if (cm) return { vaultId: v.id, ownerTenantId: v.tenantId, side: 'collaborator', rights: COLLAB_RIGHTS };

  return null;
}

/** Create a nook for a partner (tenant-admin action; the route gates the role + tenant). */
export async function createVault(
  tenantId: string,
  actor: { id: string; email?: string | null },
  input: { partnerName: string; partnerOrg?: string | null },
): Promise<Vault> {
  const [v] = await sql<Array<Vault>>`
    INSERT INTO collaboration_vaults (tenant_id, partner_name, partner_org, created_by)
    VALUES (${tenantId}::uuid, ${input.partnerName.trim().slice(0, 200)}, ${input.partnerOrg?.trim().slice(0, 200) || null}, ${actor.id}::uuid)
    RETURNING id, tenant_id AS "tenantId", partner_name AS "partnerName", partner_org AS "partnerOrg", status, created_at AS "createdAt"`;
  await emitEventSingle({
    namespace: 'library', type: 'vault.created', actor: userActor(actor.id, actor.email ?? undefined), tenantId,
    payload: { vaultId: v.id, partnerName: v.partnerName },
  });
  return v;
}

/** Fetch one active nook (for a detail page); tenant-scoped by the owner. */
export async function getVault(vaultId: string, ownerTenantId: string): Promise<Vault | null> {
  const [v] = await sql<Array<Vault>>`
    SELECT id, tenant_id AS "tenantId", partner_name AS "partnerName", partner_org AS "partnerOrg", status, created_at AS "createdAt"
    FROM collaboration_vaults WHERE id = ${vaultId}::uuid AND tenant_id = ${ownerTenantId}::uuid AND status = 'active' LIMIT 1`;
  return v ?? null;
}

/** List a tenant's own nooks (tenant side). */
export async function listVaults(tenantId: string): Promise<Vault[]> {
  return sql<Array<Vault>>`
    SELECT id, tenant_id AS "tenantId", partner_name AS "partnerName", partner_org AS "partnerOrg", status, created_at AS "createdAt"
    FROM collaboration_vaults WHERE tenant_id = ${tenantId}::uuid AND status = 'active'
    ORDER BY created_at DESC`;
}

/**
 * The collaborator's view of a nook. A collaborator sees the OWNER org they are
 * partnering with (never their own "partner_name", which is how the tenant labels them),
 * plus the owner slug so the client can address the shared /api/portal/<slug>/vaults API.
 */
export interface CollaboratorVaultView { id: string; ownerName: string; ownerSlug: string; createdAt: string }

/** List the nooks a collaborator can reach (their own vault(s) only — the segregation). */
export async function listVaultsForCollaborator(userId: string, email: string | null): Promise<CollaboratorVaultView[]> {
  const emailMatch = email && email.trim() ? email.trim() : null;
  return sql<Array<CollaboratorVaultView>>`
    SELECT v.id, t.name AS "ownerName", t.slug AS "ownerSlug", v.created_at AS "createdAt"
    FROM collaboration_vaults v
    JOIN vault_members m ON m.vault_id = v.id AND m.status <> 'revoked'
    JOIN tenants t ON t.id = v.tenant_id
    WHERE v.status = 'active' AND t.archived_at IS NULL
      AND (m.user_id = ${userId}::uuid OR (${emailMatch}::text IS NOT NULL AND lower(m.email) = lower(${emailMatch})))
    ORDER BY v.created_at DESC`;
}

/**
 * Resolve the owner org's slug + name for a vault (for the collaborator detail page, which
 * addresses the tenant-namespaced vault API and labels the nook with the owner org). The
 * caller has already been authorized via resolveVaultAccess; this only reads display context.
 */
export async function getVaultOwnerContext(vaultId: string): Promise<{ ownerSlug: string; ownerName: string } | null> {
  const [r] = await sql<Array<{ ownerSlug: string; ownerName: string }>>`
    SELECT t.slug AS "ownerSlug", t.name AS "ownerName"
    FROM collaboration_vaults v JOIN tenants t ON t.id = v.tenant_id
    WHERE v.id = ${vaultId}::uuid AND v.status = 'active' AND t.archived_at IS NULL LIMIT 1`;
  return r ?? null;
}

/**
 * Invite a partner email into a vault (upsert on the email; mirrors adding a proposal
 * collaborator). A nook collaborator resolves access by user_id OR email, but with no
 * `users` row they have NO credential — the invite would be a dead end (sweep finding). So
 * we ensure a login-capable account exists: an unknown email gets a `partner_user` with a
 * temp password (the forced-change middleware gate covers first login) and no home tenant
 * (so the dispatcher routes them straight to /vaults). Returns isNewUser + the tempPassword
 * so the route can send the acceptance email (and the admin can relay it if email fails).
 */
export async function inviteVaultMember(
  vaultId: string,
  tenantId: string,
  actor: { id: string; email?: string | null },
  email: string,
): Promise<VaultMember & { isNewUser: boolean; tempPassword: string | null }> {
  const clean = email.trim().toLowerCase();
  // Ensure a login-capable account for the invited partner.
  let isNewUser = false;
  let tempPassword: string | null = null;
  let [u] = await sql<Array<{ id: string }>>`SELECT id FROM users WHERE email = ${clean} LIMIT 1`;
  if (!u) {
    isNewUser = true;
    tempPassword = randomUUID().slice(0, 12);
    const passwordHash = await bcrypt.hash(tempPassword, 12);
    [u] = await sql<Array<{ id: string }>>`
      INSERT INTO users (email, role, temp_password, password_hash)
      VALUES (${clean}, 'partner_user', true, ${passwordHash})
      ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
      RETURNING id`;
  }
  const [m] = await sql<Array<VaultMember>>`
    INSERT INTO vault_members (vault_id, tenant_id, email, user_id, invited_by)
    VALUES (${vaultId}::uuid, ${tenantId}::uuid, ${clean}, ${u.id}::uuid, ${actor.id}::uuid)
    ON CONFLICT (vault_id, lower(email)) DO UPDATE SET status = 'invited', revoked_at = NULL, user_id = EXCLUDED.user_id
    RETURNING id, email, user_id AS "userId", status, created_at AS "createdAt"`;
  await emitEventSingle({
    namespace: 'library', type: 'vault.member_invited', actor: userActor(actor.id, actor.email ?? undefined), tenantId,
    payload: { vaultId, email: clean, isNewUser },
  });
  return { ...m, isNewUser, tempPassword };
}

/** List a vault's members (tenant side). */
export async function listVaultMembers(vaultId: string, tenantId: string): Promise<VaultMember[]> {
  return sql<Array<VaultMember>>`
    SELECT id, email, user_id AS "userId", status, created_at AS "createdAt"
    FROM vault_members WHERE vault_id = ${vaultId}::uuid AND tenant_id = ${tenantId}::uuid
    ORDER BY created_at`;
}

/** Revoke a partner's access to a vault (tenant side). Audited (mirrors the invite emit). */
export async function revokeVaultMember(
  vaultId: string,
  tenantId: string,
  memberId: string,
  actor?: { id: string; email?: string | null },
): Promise<boolean> {
  const rows = await sql<Array<{ id: string; email: string }>>`
    UPDATE vault_members SET status = 'revoked', revoked_at = now()
    WHERE id = ${memberId}::uuid AND vault_id = ${vaultId}::uuid AND tenant_id = ${tenantId}::uuid
    RETURNING id, email`;
  if (rows.length === 0) return false;
  await emitEventSingle({
    namespace: 'library', type: 'vault.member_revoked',
    actor: userActor(actor?.id ?? 'system', actor?.email ?? undefined), tenantId,
    payload: { vaultId, memberId, email: rows[0].email },
  });
  return true;
}

// ── content ops (P8.5 collaborator / P8.6 tenant-admin) ──

export interface VaultArtifact { id: string; title: string | null; grain: string; createdAt: string }

/**
 * Add an artifact to a vault (upload + atomize): decompose it into vault-scoped grains
 * (visibility='vault' + vault_id), reusing the proven decomposition. Both sides may upload;
 * an atom created here is invisible to the main library + the agents (vault_id filter).
 */
export async function createVaultArtifact(
  vaultId: string,
  ownerTenantId: string,
  doc: CanvasDocument,
  meta: FoundationMeta,
  actor: { id: string },
): Promise<{ foundationId: string }> {
  // Born vault-scoped: decomposeAndIngest tags every grain visibility='vault' + vault_id
  // at insert time, so there is no window where partner content is visible in the main
  // library and a mid-op failure cannot strand it there (atomic per grain).
  const d = await decomposeAndIngest(ownerTenantId, doc, { ...meta, collection: 'vault' }, actor, { vaultId });
  return { foundationId: d.foundationId };
}

/**
 * P8.7 — the collaborator-content HITL. When a COLLABORATOR uploads an artifact into a nook,
 * notify the owner tenant so a human decides whether to harvest it (advisory → land, never an
 * auto-write into the main library). Emits a library audit event for every upload, and raises
 * ONE standing review ToDo per nook for the owner's tenant admins (idempotent — repeated
 * uploads log events but don't pile up ToDos). Best-effort: a notification failure never fails
 * the upload itself (the content is already safely in the vault).
 */
export async function notifyCollaboratorUpload(
  vaultId: string,
  ownerTenantId: string,
  uploader: { id: string; email?: string | null; role: Role },
  foundationId: string,
  partnerLabel: string,
): Promise<void> {
  try {
    await emitEventSingle({
      namespace: 'library', type: 'vault.artifact_uploaded',
      actor: userActor(uploader.id, uploader.email ?? undefined), tenantId: ownerTenantId,
      payload: { vaultId, foundationId, uploadedBy: uploader.id },
    });
  } catch (e) {
    console.error('[vault] notifyCollaboratorUpload event failed:', e);
  }
  try {
    // One standing review ToDo per nook — if an open one already exists for this vault,
    // don't pile on (each upload still emits the audit event above). The benign race of two
    // concurrent uploads both creating a ToDo is acceptable for a notification.
    const [existing] = await sql<Array<{ id: string }>>`
      SELECT id FROM tasks
      WHERE tenant_id = ${ownerTenantId}::uuid AND task_type = 'vault_artifact_review'
        AND entity_id = ${vaultId}::uuid AND status IN ('open', 'in_progress') LIMIT 1`;
    if (existing) return;
    await createTask({
      actor: { id: uploader.id, email: uploader.email ?? null, role: uploader.role, tenantId: null },
      tenantId: ownerTenantId,
      assigneeRole: 'tenant_admin',
      taskType: 'vault_artifact_review',
      title: `New partner content in the ${partnerLabel} nook`,
      description: 'A collaborator uploaded content to a collaboration vault. Review it and harvest what you need into your proposal library.',
      entityType: 'collaboration_vault',
      entityId: vaultId,
    });
  } catch (e) {
    console.error('[vault] notifyCollaboratorUpload task failed:', e);
  }
}

/** List a vault's whole artifacts (foundations) — both sides see these. */
export async function listVaultArtifacts(vaultId: string): Promise<VaultArtifact[]> {
  return sql<Array<VaultArtifact>>`
    SELECT id, title, grain, created_at AS "createdAt"
    FROM library_atoms WHERE vault_id = ${vaultId}::uuid AND grain = 'foundation'
    ORDER BY created_at DESC`;
}

/** Read a vault atom for download (returns its grain so the route can gate whole-vs-grain). */
export async function getVaultAtom(vaultId: string, atomId: string): Promise<{ grain: string; title: string | null } | null> {
  const [a] = await sql<Array<{ grain: string; title: string | null }>>`
    SELECT grain, title FROM library_atoms WHERE id = ${atomId}::uuid AND vault_id = ${vaultId}::uuid LIMIT 1`;
  return a ?? null;
}

/** The whole-only download gate: a collaborator may download only a whole foundation. */
export function canDownloadGrain(access: VaultAccess, grain: string): boolean {
  return access.rights.downloadGrain || grain === 'foundation';
}

/**
 * Ingest a vault foundation into the tenant's MAIN library (tenant-side ingest right).
 * The whole grain tree is copied with derived_from lineage; copies land vault_id NULL +
 * visibility='tenant', so they join the main library and the customer harvests from there.
 */
export async function ingestVaultFoundation(
  vaultId: string,
  sourceFoundationId: string,
  targetTenantId: string,
  actor: { id: string },
): Promise<{ foundationId: string }> {
  const [f] = await sql<Array<{ ok: number }>>`
    SELECT 1 AS ok FROM library_atoms
    WHERE id = ${sourceFoundationId}::uuid AND vault_id = ${vaultId}::uuid AND grain = 'foundation' LIMIT 1`;
  if (!f) throw new Error('not a vault foundation');
  const d = await copyFoundationToTenant(sourceFoundationId, targetTenantId, actor, { collection: 'my_library', visibility: 'tenant' });
  return { foundationId: d.foundationId };
}

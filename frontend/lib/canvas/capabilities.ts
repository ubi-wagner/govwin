/**
 * resolveCanvasCapabilities — the ONE gate every canvas toolbar/panel reads
 * (docs/CANVAS_GEOMETRY_REDESIGN.md §8a).
 *
 * The canvas is one shell for every user, artifact type, and stage. The TOOLS
 * that are enabled/visible are resolved here from `(role × stage × artifactType ×
 * permission × locked)` — defined once, identical across the shell — so a
 * partner in review sees comment enabled, a tenant_admin in draft sees the full
 * authoring set, a locked section is read+export only, and the RFP admin at
 * ingest gets the annotate/atomize tools. All toolbars exist for everyone; this
 * decides which are live.
 *
 * Pure + framework-free so it is unit-testable and shared by server + client.
 */
import { hasRoleAtLeast, type Role } from '@/lib/rbac';

export type CanvasStage = 'ingest' | 'draft' | 'review' | 'locked' | 'template';
export type CanvasArtifactType = 'document' | 'slide' | 'spreadsheet';
/** A collaborator's per-section grant; tenant-wide members are treated as 'edit'. */
export type CanvasPermission = 'edit' | 'comment' | 'view';

export interface CanvasCapabilities {
  /** add / edit / delete / reorder nodes (the Add tab, node actions). */
  canEditContent: boolean;
  /** bold / italic / align / size / color on the selected block. */
  canFormat: boolean;
  /** margins / header / footer / page cap (the floorplan — authoring). */
  canManageFloorplan: boolean;
  /** insert atoms/groups from the library into the active section. */
  canInsertLibrary: boolean;
  /** harvest content back into the library (curation). */
  canAtomize: boolean;
  /** box-and-tag ingest atomizer (Phase 2) — a curation/ingest tool. */
  canAnnotate: boolean;
  /** AI draft / revise / fit-to-budget. */
  canDraftAI: boolean;
  /** node/section comments. */
  canComment: boolean;
  /** download / export (server still enforces the lock gate). */
  canExport: boolean;
  /** section/group structure edits — drag-resize budgets, keep-together (Phase 4). */
  canManageStructure: boolean;
}

const NONE: CanvasCapabilities = {
  canEditContent: false, canFormat: false, canManageFloorplan: false, canInsertLibrary: false,
  canAtomize: false, canAnnotate: false, canDraftAI: false, canComment: false, canExport: false,
  canManageStructure: false,
};

export interface CapabilityInput {
  role: Role;
  /** process stage; defaults to 'draft'. `locked` overrides to read-only regardless. */
  stage?: CanvasStage;
  /** collaborator grant on THIS section; omit for tenant-wide members (⇒ full edit). */
  permission?: CanvasPermission;
  /** section or proposal locked ⇒ no content edits (everyone). */
  locked?: boolean;
  artifactType?: CanvasArtifactType;
}

/**
 * Resolve the live tool set. The shell renders all toolbars; each reads its flag
 * from here. Server routes still enforce their own auth — this governs UI, not trust.
 */
export function resolveCanvasCapabilities(input: CapabilityInput): CanvasCapabilities {
  const { role, stage = 'draft', permission, locked = false } = input;

  const isTenantAdmin = hasRoleAtLeast(role, 'tenant_admin'); // tenant_admin / rfp_admin / master_admin
  // A tenant-wide member has no per-section grant (permission undefined) ⇒ full edit.
  const grantAllowsEdit = permission === undefined || permission === 'edit';
  const grantAllowsComment = permission !== 'view'; // edit or comment (or member)

  // Read-only whenever locked, on a view/comment-only grant, or explicitly at the
  // locked stage. Comments + export survive read-only.
  const editable = !locked && stage !== 'locked' && grantAllowsEdit;

  const caps: CanvasCapabilities = {
    ...NONE,
    canComment: grantAllowsComment,
    canExport: true, // shell always offers export; the route gates on lock/stage
  };
  if (!editable) return caps;

  caps.canEditContent = true;
  caps.canFormat = true;
  caps.canInsertLibrary = true;
  caps.canDraftAI = true;
  // Floorplan + structure + library-harvest are AUTHORING/CURATION powers → admin.
  caps.canManageFloorplan = isTenantAdmin;
  caps.canManageStructure = isTenantAdmin;
  caps.canAtomize = isTenantAdmin;
  // The box-and-tag ingest atomizer belongs to an admin at ingest/template time
  // (the RFP admin curating, or the tenant admin building their own library).
  caps.canAnnotate = isTenantAdmin && (stage === 'ingest' || stage === 'template');
  return caps;
}

/**
 * The tenant-governable trigger catalog (#190 Phase D). The fixed grammar the tenant
 * Automation editor renders — one row per (scope, trigger_key) a customer can tune.
 * Framework-hard gates (the curation SLA) are deliberately NOT here: a tenant cannot
 * move them (decision ⑦). Extensible: add a row here to expose a new tunable trigger.
 */
export type PolicyScope = 'discovery' | 'build';

export interface CatalogTrigger {
  scope: PolicyScope;
  triggerKey: string;
  label: string;
  help: string;
  /** Whether this trigger can auto-run an agent (the AI-agents group; Phase E). */
  agentCapable?: boolean;
}

export const TRIGGER_CATALOG: CatalogTrigger[] = [
  // ── Discovery (buckets / OPPs) ──
  {
    scope: 'discovery',
    triggerKey: 'capture:card.applied',
    label: 'New priority opportunity',
    help: 'Alert when a new high-alignment opportunity lands in a bucket (else a company-profile match near its close date).',
  },
  // ── Build (portals) ──
  {
    scope: 'build',
    triggerKey: 'proposal:document.locked',
    label: 'Document ready',
    help: 'Notify the team when every section of a document is accepted & locked.',
  },
  {
    scope: 'build',
    triggerKey: 'proposal:collaborator.get_ready',
    label: 'Collaborator "get ready"',
    help: 'Give collaborators a heads-up as their stage approaches.',
  },
  {
    scope: 'build',
    triggerKey: 'proposal:proposal.advanced',
    label: 'Stage advanced',
    help: 'Notify when a proposal advances a stage. Can also run an AI review.',
    agentCapable: true,
  },
  {
    scope: 'build',
    triggerKey: 'section_review',
    label: 'Draft review gate',
    help: 'The pre-staged ToDo to review & complete the (AI-)drafted sections. Tune who reviews and the nudge cadence.',
  },
  {
    scope: 'build',
    triggerKey: 'final_review',
    label: 'Final review gate',
    help: 'The agent-assisted final review before submission. Tune who confirms and the nudge cadence.',
    agentCapable: true,
  },
];

export const TRIGGER_KEYS = new Set(TRIGGER_CATALOG.map((t) => t.triggerKey));
export const VALID_SCOPES = new Set<PolicyScope>(['discovery', 'build']);
export const VALID_CHANNELS = new Set(['email', 'todo', 'both']);
export const VALID_RECIPIENT_ROLES = new Set(['tenant_admin', 'tenant_user', 'partner_user']);
export const VALID_RECIPIENT_FLAGS = new Set(['delegated_managers', 'collaborators_at_stage']);

/** A catalog trigger is valid for a given scope only if it matches the catalog. */
export function isCatalogTrigger(scope: string, triggerKey: string): boolean {
  return TRIGGER_CATALOG.some((t) => t.scope === scope && t.triggerKey === triggerKey);
}

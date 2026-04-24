/**
 * Tool module index — registers every tool at import time.
 *
 * Any file that needs the registry populated must import from this
 * module (e.g., the `/api/tools/[name]/route.ts` adapter). Importing
 * it has the side effect of calling `register()` on every tool in
 * this file, which is why the imports look "unused" — they're
 * triggering the registration side effects.
 *
 * To add a new tool:
 *   1. Create frontend/lib/tools/<your-tool>.ts that exports
 *      `export const myTool = defineTool({ ... });`
 *   2. Import it here
 *   3. Pass it to `register()` below
 *   4. Ensure its namespace is listed in docs/NAMESPACES.md §"Tool namespaces"
 */

import { register } from './registry';
import { memorySearchTool } from './memory-search';
import { memoryWriteTool } from './memory-write';
// Phase 1 §E — read-only foundation tools (E.1 sub-commit)
import { solicitationListTriageTool } from './solicitation-list-triage';
import { solicitationGetDetailTool } from './solicitation-get-detail';
import { opportunityGetByIdTool } from './opportunity-get-by-id';
// Phase 1 §E — entry state-machine tools (E.2a sub-commit)
import { solicitationClaimTool } from './solicitation-claim';
import { solicitationReleaseTool } from './solicitation-release';
import { solicitationDismissTool } from './solicitation-dismiss';
// Phase 1 §E — approval-flow state-machine tools (E.2b sub-commit)
import { solicitationRequestReviewTool } from './solicitation-request-review';
import { solicitationApproveTool } from './solicitation-approve';
import { solicitationRejectReviewTool } from './solicitation-reject-review';
import { solicitationPushTool } from './solicitation-push';
// Phase 1 §E — compliance + annotation tools (E.3 sub-commit)
import { complianceListVariablesTool } from './compliance-list-variables';
import { complianceSaveVariableValueTool } from './compliance-save-variable-value';
import { solicitationSaveAnnotationTool } from './solicitation-save-annotation';
import { solicitationDeleteAnnotationTool } from './solicitation-delete-annotation';
// Phase 1 §E — final sub-commit (E.4): ingest + add_variable + extract_from_text
import { complianceAddVariableTool } from './compliance-add-variable';
import { complianceExtractFromTextTool } from './compliance-extract-from-text';
import { ingestTriggerManualTool } from './ingest-trigger-manual';
import { ingestListRecentRunsTool } from './ingest-list-recent-runs';
import { ingestGetRunDetailTool } from './ingest-get-run-detail';
// Phase 1 §E extension: topics under a solicitation (post-migration 013)
import { opportunityAddTopicTool } from './opportunity-add-topic';
import { opportunityBulkAddTopicsTool } from './opportunity-bulk-add-topics';
// Phase 1 §E extension: volumes + required items (post-migration 012/014)
import { volumeAddTool } from './volume-add';
import { volumeDeleteTool } from './volume-delete';
import { volumeAddRequiredItemTool } from './volume-add-required-item';
import { volumeUpdateRequiredItemTool } from './volume-update-required-item';
import { volumeDeleteRequiredItemTool } from './volume-delete-required-item';

// ─── Registration (side effects on import) ─────────────────────────

register(memorySearchTool);
register(memoryWriteTool);
// Phase 1 §E tools (21 total)
register(solicitationListTriageTool);
register(solicitationGetDetailTool);
register(opportunityGetByIdTool);
register(solicitationClaimTool);
register(solicitationReleaseTool);
register(solicitationDismissTool);
register(solicitationRequestReviewTool);
register(solicitationApproveTool);
register(solicitationRejectReviewTool);
register(solicitationPushTool);
register(complianceListVariablesTool);
register(complianceSaveVariableValueTool);
register(solicitationSaveAnnotationTool);
register(solicitationDeleteAnnotationTool);
register(complianceAddVariableTool);
register(complianceExtractFromTextTool);
register(ingestTriggerManualTool);
register(ingestListRecentRunsTool);
register(ingestGetRunDetailTool);
register(opportunityAddTopicTool);
register(opportunityBulkAddTopicsTool);
register(volumeAddTool);
register(volumeDeleteTool);
register(volumeAddRequiredItemTool);
register(volumeUpdateRequiredItemTool);
register(volumeDeleteRequiredItemTool);

// Re-export common surface so callers can import from a single path.
export {
  register,
  get,
  list,
  invoke,
  __resetForTest,
} from './registry';

export type { Tool, ToolContext, ToolResult, ToolActor, ToolActorType } from './base';
export { defineTool } from './base';
export {
  ToolValidationError,
  ToolAuthorizationError,
  ToolNotFoundError,
  ToolExecutionError,
  ToolExternalError,
} from './errors';

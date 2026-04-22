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

// ─── Registration (side effects on import) ─────────────────────────

register(memorySearchTool);
register(memoryWriteTool);
// Phase 1 §E tools
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

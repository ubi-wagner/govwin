"""Pipeline-side tool dispatcher.

The frontend is the single source of truth for tool definitions — all
business logic lives in `frontend/lib/tools/`. The pipeline worker
dequeues agent tasks from `agent_task_queue` and invokes the target
tool by POSTing to the frontend's generic
`/api/tools/:name` adapter over HTTP.

This keeps the dual-use promise: one tool implementation, three entry
points (direct in-process, HTTP from an API route, pipeline via this
dispatcher). Adding a new tool in the frontend automatically makes
it available to the agent fabric without any pipeline-side work.

See docs/TOOL_CONVENTIONS.md §"Dual-use entry points" for the
architecture rationale.
"""

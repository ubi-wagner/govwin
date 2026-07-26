"""
Proposal cost/budget domain package.

Pure, deterministic proposal-support logic that carries NO external dependency
(no DB, no LLM, no network) so it is unit-testable in isolation and safe to call
from an advisory agent tool. Today it holds the budget/PoP-bucket fill engine
(`budget_model`) — the exact government cost-volume waterfall (direct labor →
fringe → overhead → G&A → fee) bucketed across a period-of-performance — that the
tenant-scope `cost_estimator` agent calls so its arithmetic is EXACT, never
hallucinated. The agent stays advisory (it maps constraints/atoms → engine
inputs and lands review-staged guidance); the math lives here.
"""

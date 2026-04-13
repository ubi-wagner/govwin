"""Python error class hierarchy — mirrors frontend/lib/errors.ts.

The `code` strings MUST match between Python and TypeScript so
system_events rows are queryable from either language. Verify with:
  grep -c "INGESTER_RATE_LIMITED" frontend/lib/errors.ts pipeline/src/errors.py docs/ERROR_HANDLING.md
  → should return 3 (one per file)

See docs/ERROR_HANDLING.md for the full specification.
"""
from __future__ import annotations


class AppError(Exception):
    """Base error for all typed errors in the pipeline."""

    def __init__(
        self,
        message: str,
        code: str,
        http_status: int = 500,
        details: dict | None = None,
    ):
        super().__init__(message)
        self.code = code
        self.http_status = http_status
        self.details = details or {}


class IngesterRateLimitError(AppError):
    """An upstream API returned 429 or our local rate-limit guard fired."""

    def __init__(
        self,
        message: str = "upstream rate limit exceeded",
        details: dict | None = None,
    ):
        super().__init__(message, "INGESTER_RATE_LIMITED", 429, details)


class IngesterContractError(AppError):
    """An upstream API returned a payload that doesn't match expectations."""

    def __init__(
        self,
        message: str = "upstream contract violated",
        details: dict | None = None,
    ):
        super().__init__(message, "INGESTER_CONTRACT_VIOLATED", 502, details)


class ShredderBudgetError(AppError):
    """A single shredding run exceeded the per-document Claude token budget."""

    def __init__(
        self,
        message: str = "shredder token budget exceeded",
        details: dict | None = None,
    ):
        super().__init__(message, "SHREDDER_BUDGET_EXCEEDED", 503, details)


class ExternalServiceError(AppError):
    """A dependency we called failed (SAM.gov, Anthropic, Stripe, etc.)."""

    def __init__(
        self,
        message: str = "external service failure",
        details: dict | None = None,
    ):
        super().__init__(message, "EXTERNAL_SERVICE_ERROR", 502, details)


class StateTransitionError(AppError):
    """A solicitation state transition is illegal from the current state."""

    def __init__(
        self,
        message: str = "invalid state transition",
        details: dict | None = None,
    ):
        super().__init__(message, "INVALID_STATE_TRANSITION", 409, details)


class ClaimConflictError(AppError):
    """A solicitation.claim race lost — already claimed by another admin."""

    def __init__(
        self,
        message: str = "solicitation already claimed",
        details: dict | None = None,
    ):
        super().__init__(message, "CLAIM_CONFLICT", 409, details)

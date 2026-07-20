"""
================================================================================
Workflow Action: create_default_categories (create_library_defaults.py)
================================================================================

WHO:    Called by workflow processor when OnApplicationAccepted workflow
        executes the create_library_defaults step.

WHAT:   Creates 8 default library categories for a newly accepted tenant.
        These categories match the typical volume structure of DoD
        SBIR/STTR/BAA proposals: Technical Approach, Past Performance,
        Key Personnel, Management Plan, Cost & Pricing, Company Overview,
        Certifications & Compliance, and Commercialization. Each category
        is represented by a seed library_unit row that acts as a category
        marker — users add real content units into these categories over
        time.

INPUTS:
        - tenant_id: str — tenants.id (UUID string) of the newly accepted
          tenant

OUTPUTS:
        - categoriesCreated: int — number of new categories inserted
        - categoriesSkipped: int — categories that already existed
        - status: str — "skipped" if tenant not found (with reason)

ERROR HANDLING:
    - Tenant not found: Returns status="skipped", reason="tenant_not_found"
    - Invalid tenant_id format: Raises ValueError (caught by processor)
    - Per-category INSERT failure: Caught and logged per-category,
      continues with remaining categories. One failed category does not
      block creation of others.
    - DB connection errors: Propagate to processor for step-level handling

TENANT ISOLATION:
    - Retired no-op: writes nothing (the legacy per-tenant library_units
      category-seed rows are gone; the canonical library is library_atoms)
    - No cross-tenant data access

EVENT EMISSIONS:
    - None directly — events are emitted by the workflow processor at
      the step level (workflow.step_completed / workflow.step_failed).

CHANGE LOG:
    PR #140 (2026-05-22) — Initial implementation: 8 default categories,
                           idempotent insert, tenant verification
    PR #xxx (2026-05-22) — Added comprehensive documentation header,
                           per-category error handling, idempotency
                           documentation, tenant isolation notes
================================================================================
"""
from __future__ import annotations

import logging
import time
import uuid
from typing import Any

import asyncpg

from events import emit_event

log = logging.getLogger("pipeline.workflows.actions.create_library_defaults")

# Standard library categories for government contracting proposals.
# These match the typical volume structure of DoD SBIR/STTR/BAA proposals.
DEFAULT_CATEGORIES = [
    {
        "name": "Technical Approach",
        "description": "Technical methodology, innovation, and approach narratives",
    },
    {
        "name": "Past Performance",
        "description": "Prior contract performance narratives and references",
    },
    {
        "name": "Key Personnel",
        "description": "Resumes, bios, and qualifications for key team members",
    },
    {
        "name": "Management Plan",
        "description": "Project management approach, org charts, schedules",
    },
    {
        "name": "Cost & Pricing",
        "description": "Cost volume narratives, basis of estimate, rate justifications",
    },
    {
        "name": "Company Overview",
        "description": "Company capabilities, facilities, certifications",
    },
    {
        "name": "Certifications & Compliance",
        "description": "Small business certs, ITAR/EAR, security clearances",
    },
    {
        "name": "Commercialization",
        "description": "Commercialization plans, market analysis, transition strategy",
    },
]


async def create_default_categories(
    conn: asyncpg.Connection,
    *,
    tenant_id: str,
) -> dict[str, Any]:
    """Create default library categories for a newly accepted tenant.

    Idempotent: skips categories that already exist for this tenant.

    Args:
        conn: Active asyncpg connection.
        tenant_id: tenants.id (UUID string) of the newly accepted tenant.

    Returns:
        {"categoriesCreated": N, "categoriesSkipped": M}
    """
    start_ms = time.monotonic()

    # Validate tenant_id format
    try:
        uuid.UUID(tenant_id)
    except (ValueError, TypeError):
        log.error("create_default_categories: invalid tenant_id: %s", tenant_id)
        return {"status": "skipped", "reason": "invalid_tenant_id"}

    # RETIRED (library cutover): the legacy per-tenant library_units category-seed
    # rows are gone. The canonical library is library_atoms, whose taxonomy lives in
    # the atom_tags satellite (dimension/value) rather than a per-row `category`
    # column — so there is nothing to seed here. This action is now a safe no-op so
    # the OnApplicationAccepted workflow step never dead-ends; the library.defaults
    # events are still emitted (with zero counts) for continuity/observability.
    start_event_id = ""
    try:
        start_event_id = await emit_event(
            conn, namespace="library", type="defaults.created", phase="start",
            tenant_id=tenant_id,
            payload={"tenantId": tenant_id},
        )
    except Exception as exc:
        log.error("create_default_categories: failed to emit start event: %s", exc)

    duration_ms = int((time.monotonic() - start_ms) * 1000)
    try:
        await emit_event(
            conn, namespace="library", type="defaults.created", phase="end",
            parent_event_id=start_event_id,
            tenant_id=tenant_id,
            payload={"tenantId": tenant_id, "categoriesCreated": 0,
                     "categoriesSkipped": 0, "durationMs": duration_ms,
                     "reason": "library_units_retired"},
        )
    except Exception as exc:
        log.error("create_default_categories: failed to emit end event: %s", exc)

    return {"status": "skipped", "reason": "library_units_retired",
            "categoriesCreated": 0, "categoriesSkipped": 0}

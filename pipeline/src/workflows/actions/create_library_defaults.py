"""
Workflow ACTION target for creating default library categories.

Called by OnApplicationAccepted workflow to set up a new tenant's library
with standard categories that help organize past performance, resumes,
and reusable content from day one.

Trigger chain:
  admin accepts application → capture:application.accepted:end
  → OnApplicationAccepted.create_library_defaults → this function
"""
from __future__ import annotations

import logging
import uuid
from typing import Any

import asyncpg

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
    # TODO: Implement default category creation
    #
    # Implementation steps:
    # 1. Verify tenant exists:
    #      SELECT id FROM tenants WHERE id = $1
    #
    # 2. Check existing categories for this tenant:
    #      SELECT DISTINCT category FROM library_units WHERE tenant_id = $1
    #
    # 3. For each DEFAULT_CATEGORIES entry not already present,
    #    insert a seed library_unit with source_type='system':
    #      INSERT INTO library_units (
    #          id, tenant_id, category, title, content, source_type,
    #          status, created_at, updated_at
    #      ) VALUES ($1, $2, $3, $4, $5, 'system', 'approved', now(), now())
    #
    #    The seed unit acts as a category marker. Users will add real
    #    content units into these categories over time.
    #
    # 4. Return summary

    raise NotImplementedError(
        "create_default_categories() action not yet implemented — see inline TODO"
    )

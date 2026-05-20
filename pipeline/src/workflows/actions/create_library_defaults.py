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
    tenant_uuid = uuid.UUID(tenant_id)

    # 1. Verify tenant exists
    tenant_row = await conn.fetchval(
        "SELECT id FROM tenants WHERE id = $1",
        tenant_uuid,
    )
    if tenant_row is None:
        return {"status": "skipped", "reason": "tenant_not_found"}

    # 2. Check existing categories for this tenant
    existing_rows = await conn.fetch(
        "SELECT DISTINCT category FROM library_units WHERE tenant_id = $1",
        tenant_uuid,
    )
    existing_categories = {row["category"] for row in existing_rows}

    # 3. For each default category not already present, insert a seed
    #    library_unit. source_type='ai' is the closest valid option for
    #    system-generated content (CHECK constraint allows: manual, upload,
    #    harvest, ai). The seed unit acts as a category marker — users
    #    add real content units into these categories over time.
    created = 0
    skipped = 0
    for cat in DEFAULT_CATEGORIES:
        if cat["name"] in existing_categories:
            skipped += 1
            continue
        try:
            await conn.execute(
                """INSERT INTO library_units
                     (id, tenant_id, category, heading_text, content,
                      source_type, status, created_at, updated_at)
                   VALUES ($1, $2, $3, $4, $5, 'ai', 'approved', now(), now())""",
                uuid.uuid4(),
                tenant_uuid,
                cat["name"],
                cat["name"],
                cat["description"],
            )
            created += 1
        except Exception as e:
            log.warning(
                "failed to create default category '%s' for tenant %s: %s",
                cat["name"], tenant_id, e,
            )

    return {"categoriesCreated": created, "categoriesSkipped": skipped}

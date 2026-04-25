"""Portal artifact copy — customer data isolation at purchase time.

When a customer purchases a Proposal Portal for a topic, this module
copies ALL relevant artifacts from the master rfp-pipeline store into
the customer's isolated sandbox at:

    customers/{tenant_slug}/proposals/{proposal_id}/rfp-snapshot/

The customer's AI agents read ONLY from this snapshot — never from
the master. This is the physical enforcement of the data isolation
promise from the InfoSec page.

Artifacts copied:
  - source.pdf (the original RFP PDF)
  - text.md (extracted markdown)
  - metadata.json (extraction summary)
  - shredded/{section}.md (per-section atomized content)
  - compliance.json (compliance matrix snapshot at time of purchase)
  - topic.pdf (if the topic has its own uploaded artifact)

The copy is a server-side S3 copy (no download/upload) via
copy_object(). A manifest.json is written at the end listing every
copied artifact with its source key, dest key, size, and timestamp.

See docs/DECISIONS.md and the InfoSec page for the rationale.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any, Optional

logger = logging.getLogger("pipeline.storage.portal_provisioner")


async def provision_portal_artifacts(
    conn: Any,
    *,
    tenant_slug: str,
    proposal_id: str,
    solicitation_id: str,
    topic_id: Optional[str] = None,
) -> dict[str, Any]:
    """Copy all artifacts for a solicitation (+ optional topic) into
    a customer's proposal sandbox.

    Args:
        conn: asyncpg connection for reading metadata.
        tenant_slug: the customer's tenant slug (e.g. 'acme-tech').
        proposal_id: the new proposal UUID.
        solicitation_id: the curated_solicitations.id.
        topic_id: the opportunities.id for the specific topic (optional;
            if null, copies the umbrella solicitation artifacts only).

    Returns:
        Summary dict: { copied: int, skipped: int, manifest_key, artifacts }
    """
    from storage.s3_client import (
        copy_object,
        list_keys,
        put_json as s3_put_json,
        get_object_bytes,
    )

    # Resolve the opportunity_id (for the rfp-pipeline path) from the
    # solicitation. The master artifacts live under the opportunity_id.
    opp_id = await conn.fetchval(
        "SELECT opportunity_id FROM curated_solicitations WHERE id = $1",
        solicitation_id if not hasattr(solicitation_id, 'bytes') else solicitation_id,
    )
    if opp_id is None:
        raise ValueError(f"solicitation {solicitation_id} not found or has no opportunity")

    opp_id_str = str(opp_id)
    source_prefix = f"rfp-pipeline/{opp_id_str}/"
    dest_prefix = f"customers/{tenant_slug}/proposals/{proposal_id}/rfp-snapshot/"

    # List all objects under the master solicitation path
    source_keys = list_keys(prefix=source_prefix)
    logger.info(
        "portal_provisioner: found %d artifacts under %s for proposal %s",
        len(source_keys), source_prefix, proposal_id,
    )

    copied: list[dict[str, str]] = []
    skipped: list[str] = []

    for src_key in source_keys:
        # Compute the destination key by replacing the prefix
        relative = src_key[len(source_prefix):]
        dst_key = dest_prefix + relative

        try:
            copy_object(source_key=src_key, dest_key=dst_key)
            copied.append({
                "source_key": src_key,
                "dest_key": dst_key,
                "relative": relative,
            })
        except Exception as e:
            logger.warning(
                "portal_provisioner: copy failed src=%s dst=%s err=%s",
                src_key, dst_key, e,
            )
            skipped.append(src_key)

    # If the topic has its own uploaded artifact (individual PDF), copy that too
    if topic_id:
        topic_docs = await conn.fetch(
            """
            SELECT storage_key, original_filename
            FROM solicitation_documents
            WHERE solicitation_id = $1
              AND document_type = 'topic'
              AND metadata->>'parsed_topic_number' IS NOT NULL
            """,
            solicitation_id if not hasattr(solicitation_id, 'bytes') else solicitation_id,
        )
        for doc in topic_docs:
            src_key = doc["storage_key"]
            filename = doc["original_filename"] or "topic.pdf"
            dst_key = f"{dest_prefix}topics/{filename}"
            try:
                copy_object(source_key=src_key, dest_key=dst_key)
                copied.append({"source_key": src_key, "dest_key": dst_key, "relative": f"topics/{filename}"})
            except Exception as e:
                logger.warning("portal_provisioner: topic copy failed: %s", e)
                skipped.append(src_key)

    # Write a compliance matrix snapshot from the current DB state
    comp_row = await conn.fetchrow(
        """
        SELECT page_limit_technical, page_limit_cost, font_family, font_size,
               margins, line_spacing, submission_format, taba_allowed,
               pi_must_be_employee, custom_variables, verified_by, verified_at
        FROM solicitation_compliance
        WHERE solicitation_id = $1
        """,
        solicitation_id if not hasattr(solicitation_id, 'bytes') else solicitation_id,
    )
    if comp_row:
        comp_snapshot = dict(comp_row)
        comp_snapshot["snapshot_at"] = datetime.now(timezone.utc).isoformat()
        comp_snapshot["solicitation_id"] = str(solicitation_id)
        comp_key = dest_prefix + "compliance.json"
        try:
            s3_put_json(key=comp_key, obj=comp_snapshot)
            copied.append({"source_key": "(generated)", "dest_key": comp_key, "relative": "compliance.json"})
        except Exception as e:
            logger.warning("portal_provisioner: compliance snapshot write failed: %s", e)

    # Write manifest.json — the record of what was copied
    manifest = {
        "proposal_id": proposal_id,
        "tenant_slug": tenant_slug,
        "solicitation_id": str(solicitation_id),
        "topic_id": str(topic_id) if topic_id else None,
        "source_opportunity_id": opp_id_str,
        "provisioned_at": datetime.now(timezone.utc).isoformat(),
        "artifacts_copied": len(copied),
        "artifacts_skipped": len(skipped),
        "artifacts": copied,
    }
    manifest_key = dest_prefix + "manifest.json"
    try:
        s3_put_json(key=manifest_key, obj=manifest)
    except Exception as e:
        logger.warning("portal_provisioner: manifest write failed: %s", e)
        manifest_key = None

    logger.info(
        "portal_provisioner: provisioned %d artifacts for proposal %s (%d skipped)",
        len(copied), proposal_id, len(skipped),
    )

    return {
        "copied": len(copied),
        "skipped": len(skipped),
        "manifest_key": manifest_key,
        "artifacts": copied,
    }

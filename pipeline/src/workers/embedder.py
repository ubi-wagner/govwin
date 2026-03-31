"""
Embedding Generator workers — Library unit vectorization for semantic search.

Workers:
  - EmbedderEventWorker: Consumes library.atoms_extracted events and generates
    embeddings for new library units from that upload.

Scheduled:
  - run_embedding_batch(conn): Catches up any library_units missing embeddings.
    Called from main.py's job executor on a schedule.

Uses OpenAI text-embedding-3-small (1536 dimensions) via httpx.
Stores embeddings in the pgvector `embedding` column on library_units.
"""

import logging
import os
from typing import Optional

import asyncpg
import httpx
from tenacity import (
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

from .base import BaseEventWorker
from events import (
    emit_customer_event,
    pipeline_actor,
    trigger_ref,
)

log = logging.getLogger("workers.embedder")

OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")
EMBEDDING_MODEL = "text-embedding-3-small"
EMBEDDING_DIMENSIONS = 1536
API_BATCH_SIZE = 20  # Max texts per OpenAI API call
SCHEDULED_BATCH_SIZE = 100  # Max units per scheduled run


def _build_embedding_text(unit: dict) -> str:
    """Build the text to embed from a library unit's fields."""
    category = unit.get("category") or ""
    subcategory = unit.get("subcategory") or ""
    content = unit.get("content") or ""
    return f"{category}: {subcategory}. {content}"


def _embedding_to_pgvector(embedding: list[float]) -> str:
    """Convert an embedding list to pgvector string format."""
    return "[" + ",".join(str(x) for x in embedding) + "]"


@retry(
    retry=retry_if_exception_type(httpx.HTTPStatusError),
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=2, min=1, max=30),
    reraise=True,
)
async def generate_embeddings(texts: list[str]) -> list[list[float]]:
    """
    Call OpenAI text-embedding-3-small API.

    Retries up to 3 times with exponential backoff on HTTP errors
    (rate limits, server errors, etc.).
    """
    if not OPENAI_API_KEY:
        raise ValueError("OPENAI_API_KEY environment variable is not set")

    async with httpx.AsyncClient() as client:
        response = await client.post(
            "https://api.openai.com/v1/embeddings",
            headers={
                "Authorization": f"Bearer {OPENAI_API_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "model": EMBEDDING_MODEL,
                "input": texts,
                "dimensions": EMBEDDING_DIMENSIONS,
            },
            timeout=60.0,
        )
        response.raise_for_status()
        data = response.json()
        # OpenAI returns items sorted by index, but sort explicitly to be safe
        sorted_items = sorted(data["data"], key=lambda item: item["index"])
        return [item["embedding"] for item in sorted_items]


async def _embed_and_store(
    conn: asyncpg.Connection,
    units: list[dict],
) -> tuple[int, int]:
    """
    Generate embeddings for a list of library unit dicts and store them.

    Returns (embedded_count, error_count).
    """
    embedded = 0
    errors = 0

    # Process in batches of API_BATCH_SIZE
    for i in range(0, len(units), API_BATCH_SIZE):
        batch = units[i : i + API_BATCH_SIZE]
        texts = [_build_embedding_text(u) for u in batch]

        try:
            embeddings = await generate_embeddings(texts)
        except Exception as e:
            log.error(
                f"[embedder] OpenAI API call failed for batch "
                f"starting at index {i}: {e}"
            )
            errors += len(batch)
            continue

        if len(embeddings) != len(batch):
            log.error(
                f"[embedder] Embedding count mismatch: "
                f"expected {len(batch)}, got {len(embeddings)}"
            )
            errors += len(batch)
            continue

        for unit, embedding in zip(batch, embeddings):
            try:
                embedding_str = _embedding_to_pgvector(embedding)
                await conn.execute(
                    "UPDATE library_units SET embedding = $1::vector, "
                    "updated_at = NOW() WHERE id = $2",
                    embedding_str,
                    unit["id"],
                )
                embedded += 1
            except Exception as e:
                log.error(
                    f"[embedder] Failed to store embedding for "
                    f"unit {unit['id']}: {e}"
                )
                errors += 1

    return embedded, errors


class EmbedderEventWorker(BaseEventWorker):
    """
    Handles: library.atoms_extracted

    When atoms are extracted from a library upload:
    1. Finds all library_units for that upload that lack embeddings
    2. Generates embeddings via OpenAI text-embedding-3-small
    3. Updates library_units.embedding column
    4. Emits a customer event with the count
    """

    namespace = "embedder"
    event_bus = "customer_events"
    event_types = ["library.atoms_extracted"]
    batch_size = 10

    async def handle_event(self, event: dict) -> None:
        metadata = event.get("metadata")
        if isinstance(metadata, str):
            import json
            try:
                metadata = json.loads(metadata)
            except (json.JSONDecodeError, TypeError):
                metadata = {}
        metadata = metadata or {}

        payload = metadata.get("payload", {})
        upload_id = (
            event.get("entity_id")
            or payload.get("upload_id")
        )
        tenant_id = event.get("tenant_id")

        if not upload_id:
            self.log.error(
                f"[embedder] Event {event.get('id')} missing entity_id/upload_id, "
                "skipping"
            )
            return

        # Find library units for this upload that need embeddings
        try:
            units = await self.conn.fetch(
                """
                SELECT id, content, category, subcategory
                FROM library_units
                WHERE source_upload_id = $1
                  AND embedding IS NULL
                  AND status != 'archived'
                """,
                upload_id,
            )
        except Exception as e:
            self.log.error(
                f"[embedder] DB query failed for upload {upload_id}: {e}"
            )
            return

        if not units:
            self.log.info(
                f"[embedder] No units needing embeddings for upload {upload_id}"
            )
            return

        unit_dicts = [dict(u) for u in units]
        self.log.info(
            f"[embedder] Generating embeddings for {len(unit_dicts)} units "
            f"from upload {upload_id}"
        )

        embedded, errors = await _embed_and_store(self.conn, unit_dicts)

        self.log.info(
            f"[embedder] Upload {upload_id}: embedded={embedded}, errors={errors}"
        )

        # Emit a customer event recording the result
        if tenant_id:
            try:
                await emit_customer_event(
                    self.conn,
                    tenant_id=str(tenant_id),
                    event_type="library.embeddings_generated",
                    entity_type="upload",
                    entity_id=str(upload_id),
                    description=f"Generated embeddings for {embedded} library units",
                    actor=pipeline_actor("embedder"),
                    trigger=trigger_ref(str(event["id"]), event["event_type"]),
                    payload={
                        "units_embedded": embedded,
                        "errors": errors,
                    },
                )
            except Exception as e:
                self.log.error(
                    f"[embedder] Failed to emit customer event: {e}"
                )


async def run_embedding_batch(conn: asyncpg.Connection) -> dict:
    """
    Scheduled mode: find up to 100 library units missing embeddings
    and generate them in batches.

    Returns: {"units_embedded": N, "errors": N}
    """
    try:
        units = await conn.fetch(
            """
            SELECT id, content, category, subcategory
            FROM library_units
            WHERE embedding IS NULL
              AND status != 'archived'
            ORDER BY created_at ASC
            LIMIT $1
            """,
            SCHEDULED_BATCH_SIZE,
        )
    except Exception as e:
        log.error(f"[embedder] Scheduled batch DB query failed: {e}")
        return {"units_embedded": 0, "errors": 1}

    if not units:
        log.info("[embedder] Scheduled batch: no units needing embeddings")
        return {"units_embedded": 0, "errors": 0}

    unit_dicts = [dict(u) for u in units]
    log.info(
        f"[embedder] Scheduled batch: processing {len(unit_dicts)} units"
    )

    embedded, errors = await _embed_and_store(conn, unit_dicts)

    log.info(
        f"[embedder] Scheduled batch complete: "
        f"embedded={embedded}, errors={errors}"
    )

    return {"units_embedded": embedded, "errors": errors}

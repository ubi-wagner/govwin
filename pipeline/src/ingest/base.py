"""Base ingester class for all opportunity source ingesters.

Every ingester inherits from BaseIngester and implements:
  - fetch_page(client, api_key, cursor) → (items, next_cursor)
  - normalize(raw) → dict matching opportunities table columns

The base class provides:
  - _hash(row) — deterministic SHA-256 of canonical fields for dedupe
  - _emit_event(conn, ...) — writes to system_events
  - run(conn, run_type) — the outer loop that pages, dedupes, inserts

See docs/phase-1/C-python-ingester-framework.md for the full spec.
See docs/DECISIONS.md D-Phase1-01 for why ingesters live in pipeline.
"""
from __future__ import annotations

import hashlib
import json
import logging
import uuid
from abc import ABC, abstractmethod
from datetime import datetime, timezone
from dataclasses import dataclass, field
from typing import Any, Optional

import asyncpg
import httpx


@dataclass
class IngestResult:
    """Result of a single ingester run."""
    source: str
    run_type: str
    inserted: int = 0
    updated: int = 0
    skipped: int = 0
    failed: int = 0
    pages_fetched: int = 0
    last_cursor: Optional[str] = None
    errors: list[str] = field(default_factory=list)
    started_at: Optional[datetime] = None
    finished_at: Optional[datetime] = None

    @property
    def duration_ms(self) -> int:
        if self.started_at and self.finished_at:
            return int((self.finished_at - self.started_at).total_seconds() * 1000)
        return 0


class BaseIngester(ABC):
    """Abstract base for all opportunity source ingesters."""

    name: str = "base"
    source: str = "unknown"
    max_pages: int = 50

    def __init__(self) -> None:
        self.log = logging.getLogger(f"pipeline.ingest.{self.name}")

    # ── Abstract methods (subclasses implement) ───────────────────────

    @abstractmethod
    async def fetch_page(
        self,
        client: httpx.AsyncClient,
        api_key: str | None,
        cursor: str | None,
    ) -> tuple[list[dict[str, Any]], str | None]:
        """Fetch one page of results from the upstream API.

        Returns (items, next_cursor). next_cursor is None when there
        are no more pages.
        """
        ...

    @abstractmethod
    def normalize(self, raw: dict[str, Any]) -> dict[str, Any]:
        """Map a raw API response item to an opportunities table row.

        Returns a dict with keys matching opportunities columns:
        source, source_id, title, agency, office, solicitation_number,
        naics_codes, classification_code, set_aside_type, program_type,
        close_date, posted_date, description, content_hash.

        Must be PURE — no DB access, no side effects.
        """
        ...

    # ── Concrete methods ──────────────────────────────────────────────

    def _hash(self, row: dict[str, Any]) -> str:
        """Deterministic SHA-256 of canonical fields for dedupe.

        Uses source + source_id + title + close_date + first 500 chars
        of description. Same input → same hash, single-char change →
        different hash. Verified by unit test.
        """
        canonical = json.dumps(
            {
                "source": row.get("source", ""),
                "source_id": row.get("source_id", ""),
                "title": row.get("title", ""),
                "close_date": str(row.get("close_date", "")),
                "description": (row.get("description") or "")[:500],
            },
            sort_keys=True,
            ensure_ascii=True,
        )
        return hashlib.sha256(canonical.encode("utf-8")).hexdigest()

    async def _create_triage_row(
        self,
        conn: asyncpg.Connection,
        opp_id: Any,
        row: dict[str, Any],
    ) -> None:
        """Auto-create a curated_solicitations row for the admin triage queue.

        Every newly-ingested opportunity gets a triage row at status='new'
        so admins see it immediately in /admin/rfp-curation. Namespace is
        computed from the opportunity's agency/office/program_type.
        """
        from shredder.namespace import compute_namespace_key

        namespace = compute_namespace_key(
            row.get("agency"),
            row.get("office"),
            row.get("program_type"),
        ) or "pending"

        description = (row.get("description") or "")[:50000]

        try:
            await conn.execute(
                """
                INSERT INTO curated_solicitations
                  (opportunity_id, namespace, status, full_text)
                SELECT $1, $2, 'new', $3
                WHERE NOT EXISTS (
                    SELECT 1 FROM curated_solicitations WHERE opportunity_id = $1
                )
                """,
                opp_id,
                namespace,
                description or None,
            )
        except Exception as e:
            # Don't fail the ingest if the triage row fails — just log.
            # The UNIQUE on (opportunity_id) means this is safe on re-runs.
            self.log.warning(
                "failed to create triage row for opp %s: %s", opp_id, e
            )

    async def _emit_event(
        self,
        conn: asyncpg.Connection,
        namespace: str,
        event_type: str,
        payload: dict[str, Any],
        phase: str = "single",
        parent_event_id: str | None = None,
        tenant_id: str | None = None,
    ) -> str:
        """Write a row to system_events and return the event id."""
        event_id = str(uuid.uuid4())
        try:
            await conn.execute(
                """
                INSERT INTO system_events
                  (id, namespace, type, phase, actor_type, actor_id,
                   tenant_id, parent_event_id, payload, created_at)
                VALUES ($1, $2, $3, $4, 'pipeline', $5,
                        $6, $7, $8::jsonb, now())
                """,
                uuid.UUID(event_id),
                namespace,
                event_type,
                phase,
                f"ingest:{self.name}",
                uuid.UUID(tenant_id) if tenant_id else None,
                uuid.UUID(parent_event_id) if parent_event_id else None,
                json.dumps(payload),
            )
        except Exception as e:
            # Instrumentation must never break the business path
            self.log.error("failed to emit event %s.%s: %s", namespace, event_type, e)
        return event_id

    async def run(
        self,
        conn: asyncpg.Connection,
        run_type: str = "incremental",
    ) -> IngestResult:
        """Outer loop: page through upstream, normalize, dedupe, insert.

        Emits finder.ingest.run.start at the beginning and
        finder.ingest.run.end at the end (with totals).
        """
        result = IngestResult(source=self.source, run_type=run_type)
        result.started_at = datetime.now(timezone.utc)

        # Emit start event
        start_event_id = await self._emit_event(
            conn,
            "finder",
            "ingest.run.start",
            {"source": self.source, "run_type": run_type},
            phase="start",
        )

        self.log.info("starting %s ingest run_type=%s", self.source, run_type)

        try:
            # Resolve API key (subclass can override)
            api_key = await self._resolve_api_key(conn)

            async with httpx.AsyncClient(timeout=30.0) as client:
                cursor: str | None = None
                for page_num in range(self.max_pages):
                    items, next_cursor = await self.fetch_page(
                        client, api_key, cursor
                    )
                    result.pages_fetched += 1

                    for raw in items:
                        try:
                            row = self.normalize(raw)
                            row["source"] = self.source
                            row["content_hash"] = self._hash(row)

                            # Upsert: ON CONFLICT (content_hash) DO NOTHING
                            # for new rows, or detect amendment if hash changed.
                            # RETURNING id so we can auto-create a triage row.
                            upsert_row = await conn.fetchrow(
                                """
                                INSERT INTO opportunities
                                  (source, source_id, title, agency, office,
                                   solicitation_number, naics_codes,
                                   classification_code, set_aside_type,
                                   program_type, close_date, posted_date,
                                   estimated_value_min, estimated_value_max,
                                   description, content_hash, is_active)
                                VALUES
                                  ($1, $2, $3, $4, $5, $6, $7, $8, $9,
                                   $10, $11, $12, $13, $14, $15, $16, true)
                                ON CONFLICT (source, source_id) DO UPDATE SET
                                  title = EXCLUDED.title,
                                  agency = EXCLUDED.agency,
                                  office = EXCLUDED.office,
                                  solicitation_number = EXCLUDED.solicitation_number,
                                  naics_codes = EXCLUDED.naics_codes,
                                  classification_code = EXCLUDED.classification_code,
                                  set_aside_type = EXCLUDED.set_aside_type,
                                  program_type = EXCLUDED.program_type,
                                  close_date = EXCLUDED.close_date,
                                  posted_date = EXCLUDED.posted_date,
                                  estimated_value_min = EXCLUDED.estimated_value_min,
                                  estimated_value_max = EXCLUDED.estimated_value_max,
                                  description = EXCLUDED.description,
                                  content_hash = EXCLUDED.content_hash,
                                  updated_at = now()
                                WHERE opportunities.content_hash != EXCLUDED.content_hash
                                RETURNING id, (xmax = 0) AS was_insert
                                """,
                                row.get("source"),
                                row.get("source_id"),
                                row.get("title"),
                                row.get("agency"),
                                row.get("office"),
                                row.get("solicitation_number"),
                                row.get("naics_codes", []),
                                row.get("classification_code"),
                                row.get("set_aside_type"),
                                row.get("program_type"),
                                row.get("close_date"),
                                row.get("posted_date"),
                                row.get("estimated_value_min"),
                                row.get("estimated_value_max"),
                                (row.get("description") or "")[:50000],
                                row.get("content_hash"),
                            )

                            if upsert_row is None:
                                # ON CONFLICT matched but content_hash
                                # was identical — no update, skip.
                                result.skipped += 1
                            elif upsert_row["was_insert"]:
                                result.inserted += 1
                                opp_id = upsert_row["id"]
                                # Auto-create curated_solicitations
                                # row so the opportunity appears in
                                # the admin triage queue immediately.
                                await self._create_triage_row(
                                    conn, opp_id, row
                                )
                                await self._emit_event(
                                    conn,
                                    "finder",
                                    "opportunity.ingested",
                                    {
                                        "source": self.source,
                                        "source_id": row.get("source_id"),
                                        "content_hash": row.get("content_hash"),
                                    },
                                )
                            else:
                                result.updated += 1
                                await self._emit_event(
                                    conn,
                                    "finder",
                                    "opportunity.amended",
                                    {
                                        "source": self.source,
                                        "source_id": row.get("source_id"),
                                        "new_hash": row.get("content_hash"),
                                    },
                                )

                        except Exception as e:
                            result.failed += 1
                            result.errors.append(str(e)[:200])
                            self.log.warning(
                                "failed to process item: %s", str(e)[:200]
                            )

                    cursor = next_cursor
                    if cursor is None:
                        break

        except Exception as e:
            result.errors.append(str(e)[:500])
            self.log.error("ingest run failed: %s", e)

        result.finished_at = datetime.now(timezone.utc)
        result.last_cursor = cursor

        # Emit end event
        await self._emit_event(
            conn,
            "finder",
            "ingest.run.end",
            {
                "source": self.source,
                "run_type": run_type,
                "inserted": result.inserted,
                "updated": result.updated,
                "skipped": result.skipped,
                "failed": result.failed,
                "pages_fetched": result.pages_fetched,
                "duration_ms": result.duration_ms,
                "last_cursor": result.last_cursor,
            },
            phase="end",
            parent_event_id=start_event_id,
        )

        self.log.info(
            "%s ingest complete: inserted=%d updated=%d skipped=%d failed=%d duration=%dms",
            self.source,
            result.inserted,
            result.updated,
            result.skipped,
            result.failed,
            result.duration_ms,
        )

        return result

    async def _resolve_api_key(self, conn: asyncpg.Connection) -> str | None:
        """Resolve API key: DB encrypted value first, env var fallback.

        Subclasses that don't need auth can return None.
        """
        return None

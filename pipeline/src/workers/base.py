"""
Base worker class and event worker manager.

Workers inherit from BaseEventWorker and declare:
  - namespace: e.g. 'finder', 'reminder', 'drive_sync'
  - event_bus: 'opportunity_events' or 'customer_events'
  - event_types: list of event types to consume

The EventWorkerManager:
  - Listens on NOTIFY channels (opportunity_events, customer_events)
  - Routes events to registered workers
  - Handles batch dequeue with FOR UPDATE SKIP LOCKED
  - Manages worker lifecycle (start, stop, health)
"""

import asyncio
import json
import logging
import os
import signal
import sys
from abc import ABC, abstractmethod
from datetime import datetime, timezone
from typing import Any

import asyncpg

log = logging.getLogger("workers")

DATABASE_URL = os.environ.get("DATABASE_URL", "")


class BaseEventWorker(ABC):
    """Base class for all event-driven workers."""

    # Subclasses MUST set these
    namespace: str = ""          # e.g. 'finder', 'reminder.deadline'
    event_bus: str = ""          # 'opportunity_events' or 'customer_events'
    event_types: list[str] = []  # e.g. ['ingest.new', 'ingest.updated']
    batch_size: int = 100        # max events per dequeue

    def __init__(self, conn: asyncpg.Connection):
        self.conn = conn
        self.worker_id = f"{self.namespace}-{os.getpid()}"
        self.log = logging.getLogger(f"workers.{self.namespace}")

    @abstractmethod
    async def handle_event(self, event: dict) -> None:
        """Process a single event. Implement in subclass."""
        ...

    async def handle_batch(self, events: list[dict]) -> dict[str, int]:
        """
        Process a batch of events. Default: call handle_event() for each.
        Override for bulk operations (e.g., batch Drive API calls).

        Returns: { 'processed': N, 'errors': N }
        """
        processed = 0
        errors = 0
        for event in events:
            try:
                await self.handle_event(event)
                processed += 1
            except Exception as e:
                errors += 1
                self.log.error(
                    f"[{self.namespace}] Error processing event {event.get('id')}: {e}",
                    exc_info=True,
                )
        return {"processed": processed, "errors": errors}

    async def dequeue_and_process(self) -> dict[str, int]:
        """
        Atomically dequeue events for this worker and process them.
        Uses the DB function which does FOR UPDATE SKIP LOCKED.
        """
        func = (
            "dequeue_opportunity_events"
            if self.event_bus == "opportunity_events"
            else "dequeue_customer_events"
        )
        rows = await self.conn.fetch(
            f"SELECT * FROM {func}($1, $2, $3)",
            self.event_types,
            self.worker_id,
            self.batch_size,
        )

        if not rows:
            return {"processed": 0, "errors": 0}

        events = [dict(row) for row in rows]
        self.log.info(
            f"[{self.namespace}] Dequeued {len(events)} events"
        )

        return await self.handle_batch(events)

    async def on_start(self) -> None:
        """Called when the worker starts. Override for initialization."""
        pass

    async def on_stop(self) -> None:
        """Called when the worker stops. Override for cleanup."""
        pass


class EventWorkerManager:
    """
    Manages multiple event workers, listens on NOTIFY channels,
    and routes events to the appropriate workers.

    Usage:
        manager = EventWorkerManager()
        manager.register(FinderSummaryWorker)
        manager.register(ReminderDeadlineWorker)
        await manager.run()
    """

    def __init__(self):
        self.worker_classes: list[type[BaseEventWorker]] = []
        self.workers: list[BaseEventWorker] = []
        self.shutdown_event = asyncio.Event()
        self.conn: asyncpg.Connection | None = None

        # Graceful shutdown
        signal.signal(signal.SIGINT, self._handle_signal)
        signal.signal(signal.SIGTERM, self._handle_signal)

    def _handle_signal(self, sig: int, frame: Any) -> None:
        log.info(f"Received signal {sig}, shutting down workers...")
        self.shutdown_event.set()

    def register(self, worker_class: type[BaseEventWorker]) -> None:
        """Register a worker class. Instantiated on run()."""
        self.worker_classes.append(worker_class)

    async def _connect(self) -> asyncpg.Connection:
        """Connect to Postgres with retry."""
        for attempt in range(4):
            try:
                conn = await asyncpg.connect(DATABASE_URL)
                log.info("Connected to database")
                return conn
            except Exception as e:
                delay = 2 ** (attempt + 1)
                log.warning(f"DB connect failed (attempt {attempt + 1}): {e}, retrying in {delay}s")
                await asyncio.sleep(delay)
        raise RuntimeError("Failed to connect to database after 4 attempts")

    async def _listen(self, channel: str) -> None:
        """Subscribe to a NOTIFY channel."""
        if self.conn:
            await self.conn.add_listener(channel, lambda *args: None)
            log.info(f"Listening on channel: {channel}")

    async def _poll_workers(self) -> int:
        """Run all workers once. Returns total events processed."""
        total = 0
        for worker in self.workers:
            try:
                result = await worker.dequeue_and_process()
                total += result["processed"]
            except (asyncpg.PostgresConnectionError, asyncpg.InterfaceError):
                raise  # Propagate connection errors for reconnect
            except Exception as e:
                log.error(f"Worker {worker.namespace} error: {e}", exc_info=True)
        return total

    async def run(self) -> None:
        """Main event loop. Listens for events and dispatches to workers."""
        if not DATABASE_URL:
            log.error("DATABASE_URL not set")
            sys.exit(1)

        self.conn = await self._connect()

        # Instantiate workers
        self.workers = [cls(self.conn) for cls in self.worker_classes]
        for w in self.workers:
            await w.on_start()
            log.info(f"Started worker: {w.namespace} → {w.event_bus}:{w.event_types}")

        # Determine which channels to listen on
        channels = set()
        for w in self.workers:
            channels.add(w.event_bus)
        for ch in channels:
            await self._listen(ch)

        # Also listen on the pipeline_worker channel for job-based triggers
        await self._listen("pipeline_worker")

        # Process any backlog first
        log.info("Processing event backlog...")
        total = await self._poll_workers()
        if total > 0:
            log.info(f"Processed {total} backlogged events")

        log.info("Event worker manager running. Waiting for events...")

        try:
            while not self.shutdown_event.is_set():
                try:
                    # Wait for notification or timeout
                    await asyncio.wait_for(
                        self._wait_for_notify(),
                        timeout=30,
                    )
                except asyncio.TimeoutError:
                    pass
                except (asyncpg.PostgresConnectionError, asyncpg.InterfaceError):
                    log.warning("Connection lost, reconnecting...")
                    await self._reconnect()
                    continue

                if self.shutdown_event.is_set():
                    break

                # Process all pending events
                while True:
                    try:
                        processed = await self._poll_workers()
                        if processed == 0:
                            break
                    except (asyncpg.PostgresConnectionError, asyncpg.InterfaceError):
                        log.warning("Connection lost during processing, reconnecting...")
                        await self._reconnect()
                        break

        finally:
            for w in self.workers:
                try:
                    await w.on_stop()
                except Exception as e:
                    log.error(f"Worker {w.namespace} stop error: {e}")
            if self.conn:
                await self.conn.close()
            log.info("Event worker manager stopped")

    async def _reconnect(self) -> None:
        """Reconnect to the database and reinitialize workers."""
        if self.conn:
            try:
                await self.conn.close()
            except Exception:
                pass

        await asyncio.sleep(5)

        try:
            self.conn = await self._connect()
            # Re-instantiate workers with new connection
            self.workers = [cls(self.conn) for cls in self.worker_classes]
            for w in self.workers:
                await w.on_start()

            channels = set(w.event_bus for w in self.workers)
            channels.add("pipeline_worker")
            for ch in channels:
                await self._listen(ch)
        except Exception as e:
            log.error(f"Reconnect failed: {e}")
            await asyncio.sleep(10)

    async def _wait_for_notify(self) -> str | None:
        """Wait for any notification. Returns payload."""
        if not self.conn:
            return None

        future: asyncio.Future[str] = asyncio.get_event_loop().create_future()

        def callback(conn_ref: Any, pid: int, channel: str, payload: str) -> None:
            if not future.done():
                future.set_result(payload)

        # Listen on all channels
        channels = list(set(w.event_bus for w in self.workers))
        channels.append("pipeline_worker")

        for ch in channels:
            await self.conn.add_listener(ch, callback)
        try:
            return await future
        finally:
            for ch in channels:
                try:
                    await self.conn.remove_listener(ch, callback)
                except Exception:
                    pass

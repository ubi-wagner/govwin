"""
Event Worker Runner — Entry point for the event-driven worker process.

Usage:
    python -m workers.runner                    # Run all workers
    python -m workers.runner --namespace finder  # Run only finder workers
    python -m workers.runner --namespace reminder # Run only reminder workers

This is a separate process from main.py (the pipeline job worker).
main.py handles pipeline_jobs (scheduled ingest/scoring).
This runner handles event-driven workers (real-time reactions to events).

Both processes can run simultaneously. They use different NOTIFY channels
and different dequeue functions, so there's no contention.
"""

import argparse
import asyncio
import logging
import sys

from .base import EventWorkerManager
from .document_fetcher import DocumentFetcherWorker
from .email_trigger import EmailTriggerWorker
from .finder import FinderOppIngestWorker, FinderDriveArchiveWorker
from .grinder import GrinderUploadWorker
from .embedder import EmbedderEventWorker
from .reminder import ReminderAmendmentWorker, ReminderDeadlineWorker
from automation.worker import AutomationCustomerWorker, AutomationOpportunityWorker

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    stream=sys.stdout,
)
log = logging.getLogger("workers.runner")

# Registry of all available workers by namespace
WORKER_REGISTRY: dict[str, list[type]] = {
    "finder": [
        FinderOppIngestWorker,
        FinderDriveArchiveWorker,
        DocumentFetcherWorker,
    ],
    "reminder": [
        ReminderAmendmentWorker,
        ReminderDeadlineWorker,
    ],
    "email": [
        EmailTriggerWorker,
    ],
    "automation": [
        AutomationCustomerWorker,
        AutomationOpportunityWorker,
    ],
    "grinder": [
        GrinderUploadWorker,
        EmbedderEventWorker,
    ],
}


def main() -> None:
    parser = argparse.ArgumentParser(description="Event Worker Runner")
    parser.add_argument(
        "--namespace",
        type=str,
        default=None,
        help="Only run workers for this namespace (e.g., 'finder', 'reminder')",
    )
    args = parser.parse_args()

    manager = EventWorkerManager()

    if args.namespace:
        workers = WORKER_REGISTRY.get(args.namespace)
        if not workers:
            log.error(
                f"Unknown namespace: {args.namespace}. "
                f"Available: {list(WORKER_REGISTRY.keys())}"
            )
            sys.exit(1)
        for w in workers:
            manager.register(w)
        log.info(f"Starting workers for namespace: {args.namespace}")
    else:
        for namespace, workers in WORKER_REGISTRY.items():
            for w in workers:
                manager.register(w)
        log.info(f"Starting all workers: {list(WORKER_REGISTRY.keys())}")

    asyncio.run(manager.run())


if __name__ == "__main__":
    main()

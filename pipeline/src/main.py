"""
RFP Pipeline — Main Worker Process
Listens for job notifications, executes ingestion, scoring, agent tasks.
"""
import asyncio
import signal
import os

shutdown_event = asyncio.Event()


def handle_signal(sig: signal.Signals) -> None:
    print(f"Received {sig.name}, shutting down...")
    shutdown_event.set()


async def main() -> None:
    print("RFP Pipeline worker starting...")
    # TODO: Initialize database connection pool
    # TODO: Register event handlers
    # TODO: Start cron ticker for pipeline_schedules
    # TODO: Listen for pipeline_worker notifications
    # TODO: Main loop: dequeue and execute jobs

    while not shutdown_event.is_set():
        await asyncio.sleep(1)

    print("Pipeline worker stopped.")


if __name__ == "__main__":
    loop = asyncio.new_event_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, lambda s=sig: handle_signal(s))
    loop.run_until_complete(main())

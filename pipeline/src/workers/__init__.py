"""
Event-driven worker infrastructure.

Workers are namespaced and consume events from two parallel buses:
  - opportunity_events: SAM.gov changes, scoring, Drive archival
  - customer_events: tenant actions, AI summaries, nudges

Each worker:
  1. Declares which event_types it handles
  2. Dequeues events atomically (FOR UPDATE SKIP LOCKED)
  3. Processes them
  4. Events are marked processed by the dequeue function

Workers are registered by namespace (e.g. 'finder', 'reminder') and
managed by the EventWorkerManager which runs them on the NOTIFY channels.
"""

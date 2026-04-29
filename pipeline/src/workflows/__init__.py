"""
Workflow automation framework.

Each workflow is a Python class that defines:
  - trigger: which system_events row (namespace + type + phase) starts it
  - steps: ordered actions with dependencies, timeouts, retry logic

The event_processor (see processor.py) polls system_events, matches
against registered workflow triggers, and instantiates process_instances.

See docs/EVENT_CONTRACT.md §7 for the full architecture.
"""

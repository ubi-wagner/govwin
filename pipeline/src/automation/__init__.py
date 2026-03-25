"""
Automation Framework — Event-driven rule engine for GovWin Pipeline.

Architecture:
  Events fire → AutomationWorker dequeues → Engine evaluates rules → Actions execute

Components:
  engine.py  — Rule evaluation: loads rules from DB, matches against events, checks conditions
  actions.py — Action handlers: emit_event, queue_notification, queue_job, log_only
  worker.py  — AutomationWorker: BaseEventWorker that bridges event bus → engine
"""

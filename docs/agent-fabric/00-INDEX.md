# Agent Fabric — Implementation Architecture

**The AI Workforce System for RFP Pipeline Portal**

This document series defines, in excruciating detail, how the AI agent workforce
is built, deployed, specialized per customer, and continuously improved. It covers
the actual implementation — not theory, not marketing, not aspirational architecture —
but what gets built, how it stores data, how it learns, and how it stays secure.

---

## Chapters

1. **[How Agents Actually Work](./01-HOW-AGENTS-WORK.md)**
   The mechanics of a Claude-based agent. What happens when an agent "thinks."
   How context injection replaces fine-tuning. Why this works and where it breaks.

2. **[Agent Archetypes and Insertion Points](./02-ARCHETYPES-AND-INSERTION-POINTS.md)**
   Every agent role, what it does, and exactly where in the proposal lifecycle
   it activates. The trigger events, inputs, outputs, and human gates for each.

3. **[Memory Architecture](./03-MEMORY-ARCHITECTURE.md)**
   The PostgreSQL schema for agent memory. Three memory types (episodic, semantic,
   procedural). How memories are written, retrieved, ranked, injected, decayed,
   compacted, and garbage-collected. Actual SQL.

4. **[Continuous Learning](./04-CONTINUOUS-LEARNING.md)**
   How agents get better without fine-tuning. The feedback loop from human edits
   to stored corrections to improved future output. Outcome attribution. The
   learning flywheel implementation.

5. **[Multi-Tenant Isolation and Security](./05-MULTI-TENANT-SECURITY.md)**
   How tenant data stays completely separated in agent memory. Row-level security.
   Namespace enforcement. Cost isolation. What can go wrong and how we prevent it.

6. **[Project Structure and Code Architecture](./06-PROJECT-STRUCTURE.md)**
   Where the agent code lives. The Python service structure. The API surface
   between the Next.js portal and the agent workers. Configuration and deployment.

7. **[Cost Model and Scaling](./07-COST-MODEL.md)**
   What this costs per tenant, per agent call, per proposal. How prompt caching
   reduces cost 10x. Token budgets. When to scale what. The break-even math.

---

**Reading order:** Start with Chapter 1 even if you think you understand how LLM
agents work. The mental model matters for everything that follows. Then Chapters
2-3 are the core — where agents insert and how they remember. Chapters 4-7 are
the operational details that make it production-ready.

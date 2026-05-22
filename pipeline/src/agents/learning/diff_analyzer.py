"""
================================================================================
DiffAnalyzer — Analyzes Human Edits to Agent Output for Learning
================================================================================

WHO:    Triggered on-event when `proposal.section.edited` fires AND the section
        was AI-drafted. Called by the event-driven workflow processor.

WHAT:   Compares the original agent output with the human-edited version using
        difflib. Computes edit metrics (distance, lines changed, percentage) and
        classifies the type of change (STYLE, CONTENT, STRUCTURE, MINOR) using
        heuristics. Creates an episodic memory capturing the edit pattern.

WHY:    Edit diffs are the highest-signal learning channel. When a human edits
        agent output, we know exactly what the agent got wrong. Capturing these
        diffs enables the learning flywheel: better memories -> better context
        -> better output -> smaller diffs -> more autonomy.

HOW:    Uses difflib.SequenceMatcher for diff computation and heuristic
        classification (no LLM for V1). Word substitutions -> STYLE, significant
        text additions/removals -> CONTENT, paragraph reordering -> STRUCTURE,
        small edits -> MINOR.

SCHEDULE: On-event (proposal.section.edited)

INPUTS: Original agent output text, human-edited text, context metadata

OUTPUTS: Episodic memory in episodic_memories table, analysis result dict

DEPENDENCIES:
    - episodic_memories table (001_baseline.sql)
    - pipeline.src.events.emit_event
    - pipeline.src.agents.memory.MemoryStore

EVENT EMISSIONS:
    - system:memory.edit_analyzed (single)

CHANGE LOG:
    PR #140 (2026-05-22) — Empty stub
    PR #xxx (2026-05-22) — Full implementation
================================================================================
"""
from __future__ import annotations

import difflib
import json
import logging
import re
import uuid
from datetime import datetime, timezone

from pipeline.src.events import emit_event

logger = logging.getLogger("pipeline.agents.diff_analyzer")


class DiffAnalyzer:
    """Analyzes human edits to agent output to learn preferences."""

    # Zero vector placeholder (1536 dims for text-embedding-3-small compat)
    _ZERO_VECTOR = "[" + ",".join(["0.0"] * 1536) + "]"

    def _compute_diff_metrics(self, original: str, edited: str) -> dict:
        """Compute diff metrics between original and edited text.

        Returns dict with edit_distance, lines_added, lines_removed,
        lines_unchanged, and edit_percentage.
        """
        ratio = difflib.SequenceMatcher(None, original, edited).ratio()
        edit_percentage = round((1.0 - ratio) * 100, 2)

        orig_lines = original.splitlines()
        edit_lines = edited.splitlines()

        differ = difflib.unified_diff(orig_lines, edit_lines, lineterm="")
        added = 0
        removed = 0
        for line in differ:
            if line.startswith("+") and not line.startswith("+++"):
                added += 1
            elif line.startswith("-") and not line.startswith("---"):
                removed += 1

        unchanged = max(0, len(orig_lines) - removed)

        return {
            "edit_distance": round(1.0 - ratio, 4),
            "lines_added": added,
            "lines_removed": removed,
            "lines_unchanged": unchanged,
            "edit_percentage": edit_percentage,
        }

    def _classify_changes(self, original: str, edited: str, metrics: dict) -> str:
        """Classify the type of change using heuristics (no LLM for V1).

        Returns one of: MINOR, STYLE, CONTENT, STRUCTURE.
        """
        if metrics["edit_percentage"] < 5.0:
            return "MINOR"

        orig_words = set(re.findall(r"\w+", original.lower()))
        edit_words = set(re.findall(r"\w+", edited.lower()))

        words_added = edit_words - orig_words
        words_removed = orig_words - edit_words

        # Check for structural changes: paragraph reordering
        orig_paras = [p.strip() for p in original.split("\n\n") if p.strip()]
        edit_paras = [p.strip() for p in edited.split("\n\n") if p.strip()]

        if len(orig_paras) > 1 and len(edit_paras) > 1:
            # Check if paragraphs were reordered (similar content but different order)
            orig_para_set = set(p[:50] for p in orig_paras)
            edit_para_set = set(p[:50] for p in edit_paras)
            overlap = orig_para_set & edit_para_set
            if len(overlap) > 0 and len(overlap) < len(orig_paras):
                # Some paragraphs survived but order changed or sections reorganized
                structural_ratio = 1.0 - (len(overlap) / max(len(orig_paras), len(edit_paras)))
                if structural_ratio > 0.3:
                    return "STRUCTURE"

        # Check for content changes: significant new text or removals
        total_words = max(len(orig_words), 1)
        new_word_ratio = len(words_added) / total_words
        removed_word_ratio = len(words_removed) / total_words

        if new_word_ratio > 0.2 or removed_word_ratio > 0.2:
            return "CONTENT"

        # Default to STYLE for word substitutions, tone changes, etc.
        return "STYLE"

    def _summarize_changes(self, original: str, edited: str, classification: str) -> str:
        """Generate a brief human-readable summary of the changes."""
        orig_words = re.findall(r"\w+", original.lower())
        edit_words = re.findall(r"\w+", edited.lower())

        orig_set = set(orig_words)
        edit_set = set(edit_words)
        added = edit_set - orig_set
        removed = orig_set - edit_set

        parts = []
        if classification == "STYLE":
            parts.append("Word substitutions and tone adjustments")
        elif classification == "CONTENT":
            if added:
                sample = list(added)[:5]
                parts.append(f"Added content with terms: {', '.join(sample)}")
            if removed:
                sample = list(removed)[:5]
                parts.append(f"Removed content with terms: {', '.join(sample)}")
        elif classification == "STRUCTURE":
            parts.append("Reorganized sections/paragraphs")
        else:
            parts.append("Minor corrections")

        return "; ".join(parts) if parts else "Edits applied"

    async def analyze_edit(
        self,
        conn,
        tenant_id: str,
        agent_role: str,
        original: str,
        edited: str,
        context: dict,
    ) -> dict:
        """Compare original agent output with human-edited version.

        Args:
            conn: asyncpg connection
            tenant_id: UUID of the tenant
            agent_role: agent role/archetype name (e.g. 'section_drafter')
            original: the original agent-generated text
            edited: the human-edited text
            context: dict with optional keys like proposal_id, section_id, task_id

        Returns:
            Analysis result dict with classification, metrics, and memory_id.
        """
        try:
            # 1. Compute diff metrics
            metrics = self._compute_diff_metrics(original, edited)

            # 2. Classify changes
            classification = self._classify_changes(original, edited, metrics)

            # 3. Summarize changes
            summary = self._summarize_changes(original, edited, classification)

            # 4. Compute importance: higher edit percentage = more important to learn from
            edit_pct = metrics["edit_percentage"]
            importance = min(0.5 + edit_pct / 100.0, 1.0)

            # 5. Create episodic memory
            memory_content = (
                f"Human edited {agent_role} output. "
                f"Edit type: {classification}. "
                f"Edit percentage: {edit_pct}%. "
                f"Key changes: {summary}"
            )

            memory_id = str(uuid.uuid4())
            metadata = {
                "edit_type": classification,
                "edit_percentage": edit_pct,
                "lines_added": metrics["lines_added"],
                "lines_removed": metrics["lines_removed"],
                "proposal_id": context.get("proposal_id"),
                "section_id": context.get("section_id"),
                "task_id": context.get("task_id"),
            }

            await conn.execute(
                """
                INSERT INTO episodic_memories
                    (id, tenant_id, agent_role, embedding, content, memory_type,
                     importance, metadata, source, occurred_at, created_at)
                VALUES
                    ($1, $2, $3, $4::vector, $5, 'observation',
                     $6, $7::jsonb, 'diff_analyzer', $8, $8)
                """,
                uuid.UUID(memory_id),
                uuid.UUID(tenant_id),
                agent_role,
                self._ZERO_VECTOR,
                memory_content,
                importance,
                json.dumps(metadata),
                datetime.now(timezone.utc),
            )

            # 6. Update task log if task_id provided
            task_id = context.get("task_id")
            if task_id:
                try:
                    human_accepted = edit_pct < 20.0
                    await conn.execute(
                        """
                        UPDATE agent_task_log
                        SET human_accepted = $1, human_edit_pct = $2
                        WHERE id = $3 AND tenant_id = $4
                        """,
                        human_accepted,
                        edit_pct / 100.0,
                        uuid.UUID(task_id),
                        uuid.UUID(tenant_id),
                    )
                except Exception as e:
                    logger.error("failed to update task log for task=%s: %s", task_id, e)

            # 7. Emit event
            await emit_event(
                conn,
                namespace="system",
                type="memory.edit_analyzed",
                tenant_id=tenant_id,
                payload={
                    "memoryId": memory_id,
                    "agentRole": agent_role,
                    "editType": classification,
                    "editPercentage": edit_pct,
                    "proposalId": context.get("proposal_id"),
                },
            )

            logger.info(
                "analyzed edit for tenant=%s agent=%s type=%s pct=%.1f%%",
                tenant_id, agent_role, classification, edit_pct,
            )

            return {
                "edit_type": classification,
                "edit_percentage": edit_pct,
                "lines_added": metrics["lines_added"],
                "lines_removed": metrics["lines_removed"],
                "memory_created": memory_id,
            }

        except Exception as e:
            logger.error(
                "failed to analyze edit for tenant=%s agent=%s: %s",
                tenant_id, agent_role, e,
            )
            return {
                "edit_type": "ERROR",
                "edit_percentage": 0.0,
                "lines_added": 0,
                "lines_removed": 0,
                "memory_created": "",
                "error": str(e),
            }

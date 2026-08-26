"""Safe-skip: what a step does when the model fails it.

The agent invariant says the runtime must never DEAD-END a workflow. It does not say the workflow
should pretend the step succeeded. This is the middle: the run continues, and what it continues
with says plainly what it is.

TWO OUTCOMES, and which one applies depends on what the step produces.

  EVIDENCE  — an extracted fact with a citation. The shredder's compliance and section extraction
              return {variable_name, value, source_excerpt, page, confidence}: assertions about
              what a solicitation SAYS. There is no honest way to generate one of these. A
              fabricated source_excerpt is manufactured evidence, and it lands in the one table
              whose whole purpose is provenance (docs/INGEST_PROVENANCE.md — a value the product
              did not read from the solicitation must never look like one it did).

              → FULL SKIP, carrying a COMMENT: "needs completed and verified".

              This is not a degradation. Absence is already handled honestly: the field falls to
              source='default', renders as "Default — unverified", and the readiness bar counts it
              until a person decides. The skip routes into machinery that already exists.

  ARTIFACT  — prose or structure a proposer would have written. A section draft, a canvas node.
              Nothing here asserts a fact about the solicitation, so a labelled placeholder is
              better than an empty section: the canvas keeps a valid node, the export does not
              collapse, and the builder sees exactly what still needs writing.

              → FABRICATED CONTENT, carrying a NOTE: "meets style and form but not substance
                requirements".

WHY THE MARK IS NOT ENOUGH ON ITS OWN, and why evidence gets no fabrication at all: every provenance
bug found in this codebase was a mark that got dropped somewhere downstream — `dsipOnly` collapsing
false into undefined, an empty volume defaulting the wrong way, a timeline factor vanishing, a
truncation making "not read" look like "not stated". Marks depend on every consumer honouring them,
and consumers don't. A generator of look-alike values is safe only where the values are not claims.

RETRY FIRST. A malformed reply is usually recoverable by asking again, it costs one call, and it is
what a person would do. Skip on the second failure, not the first.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

# ── The two annotations, in the words they must always use ───────────────────

#: Attached to a skipped EVIDENCE step. Says the gap is real and a person must close it.
NEEDS_VERIFICATION_COMMENT = "needs completed and verified"

#: Attached to fabricated ARTIFACT content. Says the shape is right and the substance is not.
STYLE_NOT_SUBSTANCE_NOTE = "meets style and form but not substance requirements"

Kind = Literal["evidence", "artifact"]

#: How many times to re-ask before giving up. One retry: cheap, and covers the common transient.
MAX_MODEL_RETRIES = 1


@dataclass
class SafeSkip:
    """A step that could not be completed, recorded rather than raised."""

    step: str
    kind: Kind
    reason: str
    #: EVIDENCE: the comment. ARTIFACT: the note. Never both, never neither.
    comment: str | None = None
    note: str | None = None
    attempts: int = 1
    #: Fabricated stand-in, ARTIFACT only. Always None for evidence.
    content: Any = None

    def as_result(self) -> dict[str, Any]:
        """The step_results payload. Shaped so a reader cannot miss that this was skipped."""
        out: dict[str, Any] = {
            "skipped": True,
            "safe_skip": True,
            "step": self.step,
            "kind": self.kind,
            "reason": self.reason,
            "attempts": self.attempts,
        }
        if self.comment:
            out["comment"] = self.comment
        if self.note:
            out["note"] = self.note
        if self.content is not None:
            out["content"] = self.content
            out["fabricated"] = True
        return out


def skip_evidence(step: str, reason: str, attempts: int = 1) -> SafeSkip:
    """An extraction that could not be made. Nothing is invented — the gap is the answer.

    The comment travels with it so whatever surfaces the field says what is owed, rather than
    leaving a blank that reads like a considered "not applicable".
    """
    return SafeSkip(
        step=step, kind="evidence", reason=reason,
        comment=NEEDS_VERIFICATION_COMMENT, attempts=attempts,
    )


def skip_artifact(step: str, reason: str, content: Any, attempts: int = 1) -> SafeSkip:
    """A draft that could not be written. A labelled stand-in keeps the shape valid.

    `content` must already carry the note visibly to a reader — see `placeholder_text`. The note on
    the result is for machines; the text is for the person who opens the section.
    """
    return SafeSkip(
        step=step, kind="artifact", reason=reason,
        note=STYLE_NOT_SUBSTANCE_NOTE, content=content, attempts=attempts,
    )


def placeholder_text(section_title: str, reason: str) -> str:
    """Stand-in prose for a section the drafter could not write.

    Says what it is in its first line, because that is the line a reader sees in a list view, an
    export preview, or a diff. Anything that requires scrolling to discover it is a draft is
    something that ships as a draft.
    """
    return (
        f"[PLACEHOLDER — {STYLE_NOT_SUBSTANCE_NOTE}]\n\n"
        f"This section ({section_title}) has the expected structure but none of the substance. "
        f"It was generated because the drafting step could not complete: {reason}.\n\n"
        f"Replace this text before submission. Nothing here was read from the solicitation or from "
        f"your library, and no statement in it should be relied upon."
    )

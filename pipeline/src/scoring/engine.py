"""Scoring engine — scores opportunities against tenant profiles."""


class ScoringEngine:
    """Multi-factor scoring with optional LLM adjustment."""

    async def score_all_tenants(self, conn) -> dict:
        # TODO: Implement — copy from existing and adapt for curated-only pipeline
        return {"tenants_scored": 0}

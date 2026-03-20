"""
Scoring Engine — Scores opportunities against each tenant's profile.

Score breakdown (100 total):
  NAICS match:     0-25  (primary=25, secondary=15)
  Keyword match:   0-25  (domain-weighted keyword matches)
  Set-aside match: 0-15  (exact match=15, partial=8)
  Agency priority: 0-15  (tier 1=15, tier 2=10, tier 3=5)
  Opportunity type:0-10  (solicitation=10, sources_sought=5, presol=3)
  Timeline:        0-10  (urgency bonus for approaching deadlines)
  LLM adjustment:  -20 to +20  (Claude analysis for high-scoring opps)
"""

import json
import logging
import os
from datetime import datetime, timezone

log = logging.getLogger("pipeline.scoring")

LLM_TRIGGER_SCORE = 50  # Score above which we trigger Claude analysis
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
CLAUDE_MODEL = os.environ.get("CLAUDE_MODEL", "claude-sonnet-4-20250514")


class ScoringEngine:
    def __init__(self, conn):
        self.conn = conn

    async def score_all_tenants(self) -> dict:
        """Score all active opportunities against all active tenant profiles."""
        result = {"tenants_scored": 0, "errors": []}

        tenants = await self.conn.fetch(
            """
            SELECT t.id AS t_id, t.slug,
                   tp.tenant_id, tp.primary_naics, tp.secondary_naics,
                   tp.keyword_domains, tp.is_small_business, tp.is_sdvosb,
                   tp.is_wosb, tp.is_hubzone, tp.is_8a,
                   tp.agency_priorities, tp.min_contract_value, tp.max_contract_value,
                   tp.min_surface_score, tp.high_priority_score
            FROM tenants t
            JOIN tenant_profiles tp ON tp.tenant_id = t.id
            WHERE t.status IN ('active', 'trial')
            """
        )

        active_opps = await self.conn.fetch(
            "SELECT * FROM opportunities WHERE status = 'active'"
        )

        log.info(f"Scoring {len(active_opps)} opportunities for {len(tenants)} tenants")

        for tenant in tenants:
            try:
                scored = await self._score_tenant(dict(tenant), active_opps)
                result["tenants_scored"] += 1
                log.info(f"Scored {scored} opps for tenant {tenant['slug']}")
            except Exception as e:
                log.error(f"Error scoring tenant {tenant.get('slug', '?')}: {e}")
                result["errors"].append(f"Tenant {tenant.get('slug')}: {e}")

        return result

    async def _score_tenant(self, profile: dict, opportunities: list) -> int:
        """Score all opportunities for a single tenant."""
        tenant_id = profile["tenant_id"]
        scored_count = 0

        for opp in opportunities:
            opp = dict(opp)
            scores = self._compute_scores(profile, opp)
            total = sum(scores.values())

            # Skip if below minimum threshold
            min_score = profile.get("min_surface_score", 40) or 40
            if total < min_score:
                continue

            # Determine matched keywords/domains
            matched_kw, matched_domains = self._find_keyword_matches(profile, opp)

            # Pursuit recommendation
            high_score = profile.get("high_priority_score", 75) or 75
            if total >= high_score:
                recommendation = "pursue"
            elif total >= min_score + 10:
                recommendation = "monitor"
            else:
                recommendation = "pass"

            # LLM analysis for high-scoring opps
            llm_adj = 0.0
            llm_rationale = None
            key_reqs = []
            comp_risks = []
            rfi_questions = []

            if total >= LLM_TRIGGER_SCORE and ANTHROPIC_API_KEY:
                try:
                    llm_result = await self._run_llm_analysis(profile, opp, total)
                    llm_adj = llm_result.get("adjustment", 0)
                    llm_rationale = llm_result.get("rationale", "")
                    key_reqs = llm_result.get("key_requirements", [])
                    comp_risks = llm_result.get("competitive_risks", [])
                    rfi_questions = llm_result.get("rfi_questions", [])
                except Exception as e:
                    log.warning(f"LLM analysis failed for opp {opp['id']}: {e}")

            total_with_llm = max(0, min(100, total + llm_adj))

            # Upsert tenant_opportunity
            await self.conn.execute(
                """
                INSERT INTO tenant_opportunities (
                    tenant_id, opportunity_id, total_score,
                    naics_score, keyword_score, set_aside_score,
                    agency_score, type_score, timeline_score,
                    llm_adjustment, llm_rationale,
                    matched_keywords, matched_domains,
                    pursuit_recommendation,
                    key_requirements, competitive_risks, questions_for_rfi,
                    scored_at
                ) VALUES (
                    $1, $2, $3, $4, $5, $6, $7, $8, $9,
                    $10, $11, $12, $13, $14, $15, $16, $17, NOW()
                )
                ON CONFLICT (tenant_id, opportunity_id) DO UPDATE SET
                    total_score = $3,
                    naics_score = $4, keyword_score = $5, set_aside_score = $6,
                    agency_score = $7, type_score = $8, timeline_score = $9,
                    llm_adjustment = $10, llm_rationale = $11,
                    matched_keywords = $12, matched_domains = $13,
                    pursuit_recommendation = $14,
                    key_requirements = $15, competitive_risks = $16, questions_for_rfi = $17,
                    rescored_at = NOW()
                """,
                tenant_id, opp["id"], total_with_llm,
                scores.get("naics", 0), scores.get("keyword", 0), scores.get("set_aside", 0),
                scores.get("agency", 0), scores.get("type", 0), scores.get("timeline", 0),
                llm_adj, llm_rationale,
                matched_kw, matched_domains,
                recommendation,
                key_reqs, comp_risks, rfi_questions,
            )
            scored_count += 1

        return scored_count

    def _compute_scores(self, profile: dict, opp: dict) -> dict:
        """Compute breakdown scores for an opportunity against a tenant profile."""
        scores = {}

        # NAICS match (0-25)
        opp_naics = set(opp.get("naics_codes") or [])
        primary = set(profile.get("primary_naics") or [])
        secondary = set(profile.get("secondary_naics") or [])
        if opp_naics & primary:
            scores["naics"] = 25
        elif opp_naics & secondary:
            scores["naics"] = 15
        else:
            scores["naics"] = 0

        # Keyword match (0-25)
        kw_score = 0
        domains = profile.get("keyword_domains") or {}
        if isinstance(domains, str):
            try:
                domains = json.loads(domains)
            except (json.JSONDecodeError, TypeError):
                domains = {}

        text = f"{opp.get('title', '')} {opp.get('description', '')}".lower()
        domain_hits = 0
        for domain, keywords in domains.items():
            if any(kw.lower() in text for kw in (keywords or [])):
                domain_hits += 1
        if domain_hits >= 3:
            kw_score = 25
        elif domain_hits >= 2:
            kw_score = 18
        elif domain_hits >= 1:
            kw_score = 10
        scores["keyword"] = kw_score

        # Set-aside match (0-15)
        opp_set_aside = (opp.get("set_aside_type") or "").lower()
        sa_score = 0
        if opp_set_aside:
            if profile.get("is_sdvosb") and "sdvosb" in opp_set_aside:
                sa_score = 15
            elif profile.get("is_wosb") and "wosb" in opp_set_aside:
                sa_score = 15
            elif profile.get("is_hubzone") and "hubzone" in opp_set_aside:
                sa_score = 15
            elif profile.get("is_8a") and "8(a)" in opp_set_aside:
                sa_score = 15
            elif profile.get("is_small_business") and "small" in opp_set_aside:
                sa_score = 8
        scores["set_aside"] = sa_score

        # Agency priority (0-15)
        opp_agency = opp.get("agency_code") or ""
        priorities = profile.get("agency_priorities") or {}
        if isinstance(priorities, str):
            try:
                priorities = json.loads(priorities)
            except (json.JSONDecodeError, TypeError):
                priorities = {}

        tier = priorities.get(opp_agency)
        if tier == 1:
            scores["agency"] = 15
        elif tier == 2:
            scores["agency"] = 10
        elif tier == 3:
            scores["agency"] = 5
        else:
            scores["agency"] = 0

        # Opportunity type (0-10)
        opp_type = opp.get("opportunity_type", "")
        type_scores = {
            "solicitation": 10,
            "sources_sought": 5,
            "presolicitation": 3,
        }
        scores["type"] = type_scores.get(opp_type, 2)

        # Timeline urgency (0-10)
        close_date = opp.get("close_date")
        if close_date:
            now = datetime.now(timezone.utc)
            if hasattr(close_date, "timestamp"):
                days_left = (close_date - now).days
            else:
                days_left = 30  # Default if we can't parse
            if days_left <= 7:
                scores["timeline"] = 10
            elif days_left <= 14:
                scores["timeline"] = 7
            elif days_left <= 30:
                scores["timeline"] = 4
            else:
                scores["timeline"] = 1
        else:
            scores["timeline"] = 0

        return scores

    def _find_keyword_matches(self, profile: dict, opp: dict) -> tuple[list, list]:
        """Find which keywords and domains matched."""
        text = f"{opp.get('title', '')} {opp.get('description', '')}".lower()
        domains = profile.get("keyword_domains") or {}
        if isinstance(domains, str):
            try:
                domains = json.loads(domains)
            except (json.JSONDecodeError, TypeError):
                return [], []

        matched_keywords = []
        matched_domains = []
        for domain, keywords in domains.items():
            hits = [kw for kw in (keywords or []) if kw.lower() in text]
            if hits:
                matched_domains.append(domain)
                matched_keywords.extend(hits[:3])  # Cap per domain

        return matched_keywords[:10], matched_domains

    async def _run_llm_analysis(self, profile: dict, opp: dict, surface_score: float) -> dict:
        """Run Claude analysis on a high-scoring opportunity."""
        try:
            import anthropic
        except ImportError:
            log.warning("anthropic package not installed, skipping LLM analysis")
            return {}

        client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)

        tenant_context = f"""
Company profile:
- Primary NAICS: {', '.join(profile.get('primary_naics') or ['Not specified'])}
- Set-asides: {self._format_set_asides(profile)}
- Keyword domains: {json.dumps(profile.get('keyword_domains') or {}, indent=2)}
"""

        opp_context = f"""
Opportunity:
- Title: {opp.get('title', 'N/A')}
- Agency: {opp.get('agency', 'N/A')}
- Type: {opp.get('opportunity_type', 'N/A')}
- Set-aside: {opp.get('set_aside_type', 'None')}
- NAICS: {', '.join(opp.get('naics_codes') or ['N/A'])}
- Close date: {opp.get('close_date', 'N/A')}
- Description: {(opp.get('description') or 'No description')[:2000]}
"""

        prompt = f"""Analyze this government contracting opportunity for the company described below.
Surface score: {surface_score}/100.

{tenant_context}

{opp_context}

Respond in JSON with these fields:
- adjustment: integer from -20 to +20 (how much to adjust the score)
- rationale: one sentence explaining the adjustment
- key_requirements: array of 2-4 key requirements from the description
- competitive_risks: array of 1-3 competitive risks
- rfi_questions: array of 1-3 questions to ask if this is an RFI/sources sought
"""

        try:
            resp = client.messages.create(
                model=CLAUDE_MODEL,
                max_tokens=500,
                messages=[{"role": "user", "content": prompt}],
            )
            text = resp.content[0].text
            # Extract JSON from response
            if "```json" in text:
                text = text.split("```json")[1].split("```")[0]
            elif "```" in text:
                text = text.split("```")[1].split("```")[0]
            return json.loads(text.strip())
        except Exception as e:
            log.warning(f"LLM analysis parse error: {e}")
            return {}

    @staticmethod
    def _format_set_asides(profile: dict) -> str:
        parts = []
        if profile.get("is_small_business"):
            parts.append("Small Business")
        if profile.get("is_sdvosb"):
            parts.append("SDVOSB")
        if profile.get("is_wosb"):
            parts.append("WOSB")
        if profile.get("is_hubzone"):
            parts.append("HUBZone")
        if profile.get("is_8a"):
            parts.append("8(a)")
        return ", ".join(parts) or "None"

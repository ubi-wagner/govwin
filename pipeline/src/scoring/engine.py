"""
Scoring Engine — Scores opportunities against each tenant's SBIR/STTR profile.

Score breakdown (100 total base + LLM adjustment):
  Technology/Topic match: 0-30  (research_areas + technology_focus vs opp description/topics)
  NAICS match:            0-15  (primary=15, secondary=10 — less critical for SBIR)
  Agency alignment:       0-15  (target_agencies match + agency history from past_sbir_awards)
  Program type fit:       0-15  (program type match + phase readiness)
  Set-aside eligibility:  0-10  (still relevant but simpler for SBIR — mostly small business)
  Timeline/urgency:       0-10  (approaching deadlines weighted higher)
  TRL alignment:          0-5   (technology_readiness_level vs opportunity requirements)
  LLM adjustment:        -15 to +15  (Claude analysis for high-scoring opps, narrower range)
"""

import json
import logging
import os
import re
from datetime import datetime, timezone

from crypto import decrypt_api_key
from events import emit_opportunity_event, pipeline_actor

log = logging.getLogger("pipeline.scoring")

LLM_TRIGGER_SCORE = 50  # Score above which we trigger Claude analysis
ANTHROPIC_API_KEY_ENV = os.environ.get("ANTHROPIC_API_KEY", "")
CLAUDE_MODEL = os.environ.get("CLAUDE_MODEL", "claude-sonnet-4-20250514")


async def _resolve_anthropic_key(conn) -> str:
    """Resolve Anthropic API key: DB encrypted value first, env var fallback."""
    try:
        row = await conn.fetchrow(
            "SELECT encrypted_value FROM api_key_registry WHERE source = 'anthropic'"
        )
        if row and row["encrypted_value"]:
            key = decrypt_api_key(row["encrypted_value"])
            log.info("Using Anthropic API key from database (encrypted)")
            return key
    except Exception as e:
        log.warning("Could not load encrypted Anthropic key from DB: %s", e)

    if ANTHROPIC_API_KEY_ENV:
        log.info("Using Anthropic API key from environment variable")
    return ANTHROPIC_API_KEY_ENV


class ScoringEngine:
    def __init__(self, conn):
        self.conn = conn

    async def score_all_tenants(self) -> dict:
        """Score all active opportunities against all active tenant profiles."""
        result = {"tenants_scored": 0, "errors": []}

        # Resolve Anthropic key once per scoring run
        self._anthropic_key = await _resolve_anthropic_key(self.conn)

        tenants = await self.conn.fetch(
            """
            SELECT t.id AS t_id, t.slug,
                   tp.tenant_id, tp.primary_naics, tp.secondary_naics,
                   tp.keyword_domains, tp.is_small_business, tp.is_sdvosb,
                   tp.is_wosb, tp.is_hubzone, tp.is_8a,
                   tp.agency_priorities, tp.min_contract_value, tp.max_contract_value,
                   tp.min_surface_score, tp.high_priority_score,
                   tp.technology_readiness_level, tp.research_areas,
                   tp.past_sbir_awards, tp.target_agencies,
                   tp.company_summary, tp.technology_focus
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

            # Detect and store program_type if not already set
            detected_type = self._detect_program_type(opp)
            if detected_type != 'other' and not opp.get('program_type'):
                try:
                    await self.conn.execute(
                        "UPDATE opportunities SET program_type = $1 WHERE id = $2",
                        detected_type, opp['id']
                    )
                    opp['program_type'] = detected_type
                except Exception as e:
                    log.warning(f"Failed to update program_type for opp {opp['id']}: {e}")

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

            if total >= LLM_TRIGGER_SCORE and self._anthropic_key:
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
                scores.get("naics", 0),
                scores.get("technology", 0),  # technology match stored in keyword_score column
                scores.get("set_aside", 0),
                scores.get("agency", 0),
                scores.get("program_type", 0),  # program type fit stored in type_score column
                scores.get("timeline", 0),
                llm_adj, llm_rationale,
                matched_kw, matched_domains,
                recommendation,
                key_reqs, comp_risks, rfi_questions,
            )
            # Emit scoring.scored event
            await emit_opportunity_event(
                self.conn,
                opportunity_id=str(opp["id"]),
                event_type="scoring.scored",
                source="scoring_engine",
                actor=pipeline_actor("scoring_engine"),
                refs={"tenant_id": str(tenant_id)},
                payload={
                    "tenant_id": str(tenant_id),
                    "total_score": total_with_llm,
                    "surface_score": total,
                    "technology_score": scores.get("technology", 0),
                    "naics_score": scores.get("naics", 0),
                    "agency_score": scores.get("agency", 0),
                    "program_type_score": scores.get("program_type", 0),
                    "set_aside_score": scores.get("set_aside", 0),
                    "timeline_score": scores.get("timeline", 0),
                    "trl_score": scores.get("trl", 0),
                    "program_type": opp.get("program_type") or detected_type,
                    "recommendation": recommendation,
                    "matched_keywords": matched_kw,
                    "matched_domains": matched_domains,
                },
            )

            # Emit scoring.llm_adjusted if LLM modified the score
            if llm_adj != 0:
                await emit_opportunity_event(
                    self.conn,
                    opportunity_id=str(opp["id"]),
                    event_type="scoring.llm_adjusted",
                    source="scoring_engine",
                    actor=pipeline_actor("scoring_engine"),
                    refs={"tenant_id": str(tenant_id)},
                    payload={
                        "tenant_id": str(tenant_id),
                        "surface_score": total,
                        "llm_adjustment": llm_adj,
                        "final_score": total_with_llm,
                        "llm_rationale": llm_rationale,
                        "key_requirements": key_reqs,
                        "competitive_risks": comp_risks,
                    },
                )

            scored_count += 1

        return scored_count

    def _compute_scores_original(self, profile: dict, opp: dict) -> dict:
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

        client = anthropic.Anthropic(api_key=self._anthropic_key)

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

    # ==================================================================
    # SPOTLIGHT (BUCKET) SCORING
    # ==================================================================

    async def score_all_spotlights(self) -> dict:
        """Score all active opportunities against all active SpotLight buckets."""
        result = {"buckets_scored": 0, "total_scores": 0, "errors": []}

        self._anthropic_key = await _resolve_anthropic_key(self.conn)

        spotlights = await self.conn.fetch(
            """
            SELECT fa.*, t.slug AS tenant_slug, t.status AS tenant_status
            FROM focus_areas fa
            JOIN tenants t ON fa.tenant_id = t.id
            WHERE fa.status = 'active'
              AND t.status IN ('active', 'trial')
            """
        )

        active_opps = await self.conn.fetch(
            "SELECT * FROM opportunities WHERE status = 'active'"
        )

        log.info(f"SpotLight scoring: {len(active_opps)} opps x {len(spotlights)} buckets")

        for spotlight in spotlights:
            try:
                scored = await self._score_spotlight(dict(spotlight), active_opps)
                result["buckets_scored"] += 1
                result["total_scores"] += scored
                log.info(f"Scored {scored} opps for SpotLight '{spotlight['name']}' (tenant {spotlight['tenant_slug']})")
            except Exception as e:
                log.error(f"Error scoring SpotLight {spotlight.get('name', '?')}: {e}")
                result["errors"].append(f"SpotLight {spotlight.get('name')}: {e}")

        # Update tenant_opportunities with best spotlight scores
        await self._update_best_spotlight_scores()

        return result

    async def score_spotlight(self, spotlight_id: str) -> dict:
        """Score all active opps against a single SpotLight bucket."""
        result = {"scores": 0, "errors": []}

        self._anthropic_key = await _resolve_anthropic_key(self.conn)

        row = await self.conn.fetchrow(
            "SELECT fa.*, t.slug AS tenant_slug FROM focus_areas fa JOIN tenants t ON fa.tenant_id = t.id WHERE fa.id = $1",
            spotlight_id,
        )
        if not row:
            return {"error": "SpotLight not found"}

        active_opps = await self.conn.fetch(
            "SELECT * FROM opportunities WHERE status = 'active'"
        )

        try:
            scored = await self._score_spotlight(dict(row), active_opps)
            result["scores"] = scored
        except Exception as e:
            result["errors"].append(str(e))

        await self._update_best_spotlight_scores(tenant_id=str(row["tenant_id"]))
        return result

    async def _score_spotlight(self, spotlight: dict, opportunities: list) -> int:
        """Score all opportunities against a single SpotLight bucket."""
        spotlight_id = spotlight["id"]
        tenant_id = spotlight["tenant_id"]
        scored_count = 0

        # Build a profile-like dict from the spotlight config
        profile = self._spotlight_to_profile(spotlight)

        for opp in opportunities:
            opp = dict(opp)
            scores = self._compute_scores(profile, opp)
            total = sum(scores.values())

            min_threshold = spotlight.get("min_score_threshold", 40) or 40
            if total < min_threshold * 0.5:
                continue  # Skip very low scores but keep moderately low ones

            matched_kw, matched_domains = self._find_keyword_matches(profile, opp)

            # LLM for high-scoring spotlight matches
            llm_adj = 0.0
            llm_rationale = None
            if total >= LLM_TRIGGER_SCORE and self._anthropic_key:
                try:
                    llm_result = await self._run_llm_analysis(profile, opp, total)
                    llm_adj = llm_result.get("adjustment", 0)
                    llm_rationale = llm_result.get("rationale", "")
                except Exception as e:
                    log.warning(f"LLM analysis failed for spotlight score: {e}")

            total_with_llm = max(0, min(100, total + llm_adj))

            # Upsert spotlight_scores
            await self.conn.execute(
                """
                INSERT INTO spotlight_scores (
                    tenant_id, spotlight_id, opportunity_id,
                    total_score, naics_score, keyword_score,
                    set_aside_score, agency_score, type_score, timeline_score,
                    llm_adjustment, llm_rationale,
                    matched_keywords, matched_domains, scored_at
                ) VALUES (
                    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
                    $11, $12, $13, $14, NOW()
                )
                ON CONFLICT (spotlight_id, opportunity_id) DO UPDATE SET
                    total_score = $4,
                    naics_score = $5, keyword_score = $6,
                    set_aside_score = $7, agency_score = $8,
                    type_score = $9, timeline_score = $10,
                    llm_adjustment = $11, llm_rationale = $12,
                    matched_keywords = $13, matched_domains = $14,
                    scored_at = NOW()
                """,
                tenant_id, spotlight_id, opp["id"],
                total_with_llm,
                scores.get("naics", 0), scores.get("keyword", 0),
                scores.get("set_aside", 0), scores.get("agency", 0),
                scores.get("type", 0), scores.get("timeline", 0),
                llm_adj, llm_rationale,
                matched_kw, matched_domains,
            )
            scored_count += 1

        # Update spotlight metadata
        await self.conn.execute(
            """
            UPDATE focus_areas
            SET last_scored_at = NOW(),
                matched_opp_count = (
                    SELECT COUNT(*) FROM spotlight_scores
                    WHERE spotlight_id = $1 AND total_score >= $2
                )
            WHERE id = $1
            """,
            spotlight_id, spotlight.get("min_score_threshold", 40) or 40,
        )

        return scored_count

    async def _update_best_spotlight_scores(self, tenant_id: str = None):
        """Update tenant_opportunities with the best score across all spotlights."""
        where_clause = "WHERE ss.tenant_id = $1" if tenant_id else ""
        params = [tenant_id] if tenant_id else []

        # For each tenant+opp, find the best spotlight score and update tenant_opportunities
        query = f"""
            WITH best_scores AS (
                SELECT DISTINCT ON (ss.tenant_id, ss.opportunity_id)
                    ss.tenant_id, ss.opportunity_id,
                    ss.spotlight_id AS best_spotlight_id,
                    fa.name AS best_spotlight_name,
                    ss.total_score,
                    ARRAY_AGG(ss.spotlight_id) OVER (
                        PARTITION BY ss.tenant_id, ss.opportunity_id
                    ) AS matched_spotlight_ids
                FROM spotlight_scores ss
                JOIN focus_areas fa ON ss.spotlight_id = fa.id
                {where_clause}
                ORDER BY ss.tenant_id, ss.opportunity_id, ss.total_score DESC
            )
            UPDATE tenant_opportunities to2
            SET
                best_spotlight_id = bs.best_spotlight_id,
                best_spotlight_name = bs.best_spotlight_name,
                matched_spotlight_ids = bs.matched_spotlight_ids
            FROM best_scores bs
            WHERE to2.tenant_id = bs.tenant_id
              AND to2.opportunity_id = bs.opportunity_id
        """
        await self.conn.execute(query, *params)

    @staticmethod
    def _spotlight_to_profile(spotlight: dict) -> dict:
        """Convert a SpotLight bucket config to a profile-like dict for _compute_scores."""
        # Map spotlight fields to the profile format used by _compute_scores
        set_aside_types = spotlight.get("set_aside_types") or []
        return {
            "primary_naics": spotlight.get("naics_codes") or [],
            "secondary_naics": [],
            "keyword_domains": spotlight.get("keyword_domains") or {},
            "is_small_business": spotlight.get("is_small_business", False) or ("Small Business" in set_aside_types),
            "is_sdvosb": "SDVOSB" in set_aside_types,
            "is_wosb": "WOSB" in set_aside_types or "EDWOSB" in set_aside_types,
            "is_hubzone": "HUBZone" in set_aside_types,
            "is_8a": "8(a)" in set_aside_types,
            "agency_priorities": spotlight.get("agency_priorities") or {},
            "min_contract_value": spotlight.get("min_contract_value"),
            "max_contract_value": spotlight.get("max_contract_value"),
            "min_surface_score": spotlight.get("min_score_threshold", 40),
            "high_priority_score": 75,
            # Use keywords as a single domain for keyword matching
            "keywords": spotlight.get("keywords") or [],
        }

    def _compute_scores(self, profile: dict, opp: dict) -> dict:
        """Compute breakdown scores for an opportunity against a tenant profile."""
        scores = self._compute_scores_original(profile, opp)

        # If profile has flat keywords (from SpotLight), also score those
        flat_keywords = profile.get("keywords") or []
        if flat_keywords and scores.get("keyword", 0) < 25:
            text = f"{opp.get('title', '')} {opp.get('description', '')}".lower()
            hits = sum(1 for kw in flat_keywords if kw.lower() in text)
            if hits >= 3:
                kw_score = 25
            elif hits >= 2:
                kw_score = 18
            elif hits >= 1:
                kw_score = 10
            else:
                kw_score = 0
            scores["keyword"] = max(scores.get("keyword", 0), kw_score)

        return scores

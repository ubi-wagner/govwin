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
        """Compute SBIR/STTR-focused breakdown scores for an opportunity against a tenant profile.

        Returns dict with keys: technology, naics, agency, program_type, set_aside, timeline, trl
        """
        scores = {}

        scores["technology"] = self._score_technology_match(profile, opp)
        scores["naics"] = self._score_naics_match(profile, opp)
        scores["agency"] = self._score_agency_alignment(profile, opp)
        scores["program_type"] = self._score_program_type_fit(profile, opp)
        scores["set_aside"] = self._score_set_aside_match(profile, opp)
        scores["timeline"] = self._score_timeline(profile, opp)
        scores["trl"] = self._score_trl_alignment(profile, opp)

        return scores

    def _score_technology_match(self, profile: dict, opp: dict) -> int:
        """Technology/Topic match (0-30).

        Compares tenant's research_areas and technology_focus against opportunity
        title, description, and topic information. Uses keyword overlap scoring.
        Falls back to legacy keyword_domains if SBIR fields are not populated.
        """
        text = f"{opp.get('title', '')} {opp.get('description', '')}".lower()

        # Collect all technology terms from the tenant profile
        research_areas = profile.get("research_areas") or []
        technology_focus = profile.get("technology_focus") or ""

        # Build a combined set of technology terms
        tech_terms = []
        if research_areas:
            tech_terms.extend(research_areas)
        if technology_focus:
            # Split technology_focus on common delimiters for matching
            tech_terms.extend([t.strip() for t in re.split(r'[,;|]', technology_focus) if t.strip()])

        # Also include legacy keyword_domains as fallback
        domains = profile.get("keyword_domains") or {}
        if isinstance(domains, str):
            try:
                domains = json.loads(domains)
            except (json.JSONDecodeError, TypeError):
                domains = {}

        domain_hits = 0
        for domain, keywords in domains.items():
            if any(kw.lower() in text for kw in (keywords or [])):
                domain_hits += 1

        # Score technology term matches
        tech_hits = sum(1 for term in tech_terms if term.lower() in text)

        # Combine: technology terms are primary, keyword domains are secondary
        if tech_terms:
            if tech_hits >= 4:
                return 30
            elif tech_hits >= 3:
                return 25
            elif tech_hits >= 2:
                return 20
            elif tech_hits >= 1:
                # Boost if keyword domains also match
                return 15 if domain_hits >= 1 else 12
            elif domain_hits >= 2:
                return 10
            elif domain_hits >= 1:
                return 5
            return 0
        else:
            # Fallback to keyword_domains only (legacy profiles)
            if domain_hits >= 3:
                return 30
            elif domain_hits >= 2:
                return 20
            elif domain_hits >= 1:
                return 10
            return 0

    def _score_naics_match(self, profile: dict, opp: dict) -> int:
        """NAICS match (0-15). Less critical for SBIR but still relevant."""
        opp_naics = set(opp.get("naics_codes") or [])
        primary = set(profile.get("primary_naics") or [])
        secondary = set(profile.get("secondary_naics") or [])
        if opp_naics & primary:
            return 15
        elif opp_naics & secondary:
            return 10
        return 0

    def _score_agency_alignment(self, profile: dict, opp: dict) -> int:
        """Agency alignment (0-15).

        Combines target_agencies match and agency history from past_sbir_awards.
        Falls back to legacy agency_priorities if new fields are not populated.
        """
        opp_agency = (opp.get("agency") or "").upper()
        opp_agency_code = opp.get("agency_code") or ""
        opp_department = (opp.get("department") or "").upper()
        opp_sub_tier = (opp.get("sub_tier") or "").upper()

        score = 0

        # Check target_agencies (new SBIR field)
        target_agencies = profile.get("target_agencies") or []
        if target_agencies:
            for target in target_agencies:
                target_upper = target.upper()
                if (target_upper in opp_agency or target_upper in opp_department
                        or target_upper in opp_sub_tier):
                    score = 10
                    break

        # Boost from past_sbir_awards — if tenant has won SBIR/STTR from this agency before
        past_awards = profile.get("past_sbir_awards") or []
        if isinstance(past_awards, str):
            try:
                past_awards = json.loads(past_awards)
            except (json.JSONDecodeError, TypeError):
                past_awards = []

        if past_awards:
            for award in past_awards:
                if not isinstance(award, dict):
                    continue
                award_agency = (award.get("agency") or "").upper()
                if award_agency and (award_agency in opp_agency or award_agency in opp_department
                                     or award_agency in opp_sub_tier):
                    score = min(15, score + 5)  # Boost for past relationship
                    break

        # Fallback to legacy agency_priorities if no target_agencies
        if not target_agencies and score == 0:
            priorities = profile.get("agency_priorities") or {}
            if isinstance(priorities, str):
                try:
                    priorities = json.loads(priorities)
                except (json.JSONDecodeError, TypeError):
                    priorities = {}

            tier = priorities.get(opp_agency_code)
            if tier == 1:
                score = 15
            elif tier == 2:
                score = 10
            elif tier == 3:
                score = 5

        return score

    def _score_program_type_fit(self, profile: dict, opp: dict) -> int:
        """Program type fit (0-15).

        Checks if opportunity's program_type matches what the tenant pursues.
        SBIR/STTR opportunities score highest for SBIR-focused tenants.
        Phase readiness is considered via TRL and past awards.
        """
        program_type = opp.get("program_type") or self._detect_program_type(opp)

        # SBIR/STTR programs are the primary targets
        sbir_sttr_types = {'sbir_phase_1', 'sbir_phase_2', 'sttr_phase_1', 'sttr_phase_2'}
        related_types = {'baa', 'ota'}

        if program_type in sbir_sttr_types:
            score = 12

            # Boost if tenant has past awards matching the phase
            past_awards = profile.get("past_sbir_awards") or []
            if isinstance(past_awards, str):
                try:
                    past_awards = json.loads(past_awards)
                except (json.JSONDecodeError, TypeError):
                    past_awards = []

            if past_awards:
                # Phase II requires Phase I experience
                if program_type in ('sbir_phase_2', 'sttr_phase_2'):
                    has_phase1 = any(
                        isinstance(a, dict) and 'phase' in str(a.get('phase', '')).lower()
                        for a in past_awards
                    )
                    if has_phase1:
                        score = 15
                else:
                    # Phase I — any SBIR experience is a bonus
                    score = 15

            return score
        elif program_type in related_types:
            return 8
        elif program_type == 'challenge':
            return 5
        elif program_type in ('rfi', 'sources_sought'):
            return 3
        return 2

    def _score_set_aside_match(self, profile: dict, opp: dict) -> int:
        """Set-aside eligibility match (0-10). Simpler for SBIR — mostly small business."""
        opp_set_aside = (opp.get("set_aside_type") or "").lower()
        sa_score = 0
        if opp_set_aside:
            if profile.get("is_sdvosb") and "sdvosb" in opp_set_aside:
                sa_score = 10
            elif profile.get("is_wosb") and "wosb" in opp_set_aside:
                sa_score = 10
            elif profile.get("is_hubzone") and "hubzone" in opp_set_aside:
                sa_score = 10
            elif profile.get("is_8a") and "8(a)" in opp_set_aside:
                sa_score = 10
            elif profile.get("is_small_business") and "small" in opp_set_aside:
                sa_score = 7
            elif "sbir" in opp_set_aside or "sttr" in opp_set_aside:
                # SBIR/STTR set-asides — all small businesses qualify
                if profile.get("is_small_business"):
                    sa_score = 10
                else:
                    sa_score = 5
        return sa_score

    def _score_timeline(self, profile: dict, opp: dict) -> int:
        """Timeline/urgency (0-10). Approaching deadlines weighted higher."""
        close_date = opp.get("close_date")
        if close_date:
            now = datetime.now(timezone.utc)
            if hasattr(close_date, "timestamp"):
                days_left = (close_date - now).days
            else:
                days_left = 30  # Default if we can't parse
            if days_left <= 7:
                return 10
            elif days_left <= 14:
                return 7
            elif days_left <= 30:
                return 4
            else:
                return 1
        return 0

    def _score_trl_alignment(self, profile: dict, opp: dict) -> int:
        """TRL alignment (0-5).

        Compares tenant's technology_readiness_level against opportunity requirements.
        Phase I typically requires TRL 1-4, Phase II typically requires TRL 4-6.
        """
        tenant_trl = profile.get("technology_readiness_level")
        if tenant_trl is None:
            return 2  # Neutral default when TRL is not specified

        try:
            tenant_trl = int(tenant_trl)
        except (ValueError, TypeError):
            return 2

        program_type = opp.get("program_type") or self._detect_program_type(opp)

        # Define expected TRL ranges for each program type
        trl_ranges = {
            'sbir_phase_1': (1, 4),
            'sttr_phase_1': (1, 4),
            'sbir_phase_2': (4, 6),
            'sttr_phase_2': (4, 6),
            'baa': (1, 6),
            'ota': (3, 7),
        }

        expected_range = trl_ranges.get(program_type)
        if not expected_range:
            return 2  # Neutral for unknown program types

        low, high = expected_range
        if low <= tenant_trl <= high:
            return 5  # Perfect alignment
        elif abs(tenant_trl - low) <= 1 or abs(tenant_trl - high) <= 1:
            return 3  # Close alignment
        return 0  # Poor alignment

    def _detect_program_type(self, opp: dict) -> str:
        """Detect SBIR/STTR program type from opportunity text."""
        text = f"{opp.get('title', '')} {opp.get('description', '')}".upper()

        if 'STTR' in text and 'PHASE II' in text:
            return 'sttr_phase_2'
        if 'STTR' in text and 'PHASE I' in text:
            return 'sttr_phase_1'
        if 'STTR' in text:
            return 'sttr_phase_1'  # default STTR to Phase I
        if 'SBIR' in text and 'PHASE II' in text:
            return 'sbir_phase_2'
        if 'SBIR' in text and 'PHASE I' in text:
            return 'sbir_phase_1'
        if 'SBIR' in text:
            return 'sbir_phase_1'  # default SBIR to Phase I
        if 'BROAD AGENCY ANNOUNCEMENT' in text or 'BAA' in text:
            return 'baa'
        if 'OTHER TRANSACTION' in text or ' OTA' in text or 'OT AUTHORITY' in text:
            return 'ota'
        if 'CHALLENGE' in text and ('PRIZE' in text or 'COMPETITION' in text):
            return 'challenge'
        if 'REQUEST FOR INFORMATION' in text or ' RFI' in text:
            return 'rfi'
        if 'SOURCES SOUGHT' in text:
            return 'sources_sought'
        return 'other'

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

        research_areas = profile.get("research_areas") or []
        technology_focus = profile.get("technology_focus") or "Not specified"
        company_summary = profile.get("company_summary") or "Not specified"
        target_agencies = profile.get("target_agencies") or []
        trl = profile.get("technology_readiness_level")

        tenant_context = f"""
Company profile (SBIR/STTR focus):
- Company summary: {company_summary}
- Technology focus: {technology_focus}
- Research areas: {', '.join(research_areas) if research_areas else 'Not specified'}
- Target agencies: {', '.join(target_agencies) if target_agencies else 'Not specified'}
- TRL level: {trl if trl is not None else 'Not specified'}
- Primary NAICS: {', '.join(profile.get('primary_naics') or ['Not specified'])}
- Set-asides: {self._format_set_asides(profile)}
"""

        program_type = opp.get('program_type') or self._detect_program_type(opp)
        opp_context = f"""
Opportunity:
- Title: {opp.get('title', 'N/A')}
- Agency: {opp.get('agency', 'N/A')}
- Program type: {program_type}
- Type: {opp.get('opportunity_type', 'N/A')}
- Set-aside: {opp.get('set_aside_type', 'None')}
- NAICS: {', '.join(opp.get('naics_codes') or ['N/A'])}
- Close date: {opp.get('close_date', 'N/A')}
- Description: {(opp.get('description') or 'No description')[:2000]}
"""

        prompt = f"""Analyze this SBIR/STTR opportunity for the small business described below.
Focus on: technology alignment, research area fit, agency relationship, TRL readiness,
and whether the company's capabilities match the solicitation topics.

Surface score: {surface_score}/100.

{tenant_context}

{opp_context}

Respond in JSON with these fields:
- adjustment: integer from -15 to +15 (how much to adjust the score)
- rationale: one sentence explaining the adjustment, focused on SBIR/STTR fit
- key_requirements: array of 2-4 key technical requirements or topic areas
- competitive_risks: array of 1-3 competitive risks specific to this SBIR/STTR solicitation
- rfi_questions: array of 1-3 questions to clarify technical scope or proposal requirements
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
                scores.get("naics", 0),
                scores.get("technology", 0),  # technology match stored in keyword_score column
                scores.get("set_aside", 0), scores.get("agency", 0),
                scores.get("program_type", 0),  # program type fit stored in type_score column
                scores.get("timeline", 0),
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

        # If profile has flat keywords (from SpotLight), also boost technology score
        flat_keywords = profile.get("keywords") or []
        if flat_keywords and scores.get("technology", 0) < 30:
            text = f"{opp.get('title', '')} {opp.get('description', '')}".lower()
            hits = sum(1 for kw in flat_keywords if kw.lower() in text)
            if hits >= 3:
                kw_score = 30
            elif hits >= 2:
                kw_score = 20
            elif hits >= 1:
                kw_score = 10
            else:
                kw_score = 0
            scores["technology"] = max(scores.get("technology", 0), kw_score)

        return scores

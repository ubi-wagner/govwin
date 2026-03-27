"""
AI Deep Dive — Kill & Cook Phase

Uses the Anthropic API to:
1. KILL: Extract carrier, premium, expiration, decision maker from documents
2. COOK: Draft 4 distinct outreach email campaigns based on extracted data
"""

import json
import os

import anthropic

ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")

KILL_PROMPT = """You are an expert insurance analyst specializing in Florida condominium associations. Analyze the following three documents for a single condo association and extract structured intelligence.

DOCUMENTS:
--- SUNBIZ ANNUAL REPORT ---
{sunbiz}

--- AUDITED FINANCIAL STATEMENTS ---
{audit}

--- INCOME & EXPENSE REPORT ---
{ie}

EXTRACT THE FOLLOWING (return as valid JSON only, no markdown):
{{
  "carrier": "Primary property insurance carrier name",
  "premium": "Annual property insurance premium (number only, no $)",
  "premium_prior_year": "Prior year premium if available (number only)",
  "premium_increase_pct": "Year-over-year increase percentage (number only)",
  "tiv": "Total Insured Value (number only)",
  "expiration_date": "Policy expiration date (MM/DD/YYYY)",
  "deductible": "Named storm deductible description",
  "decision_maker": "Name of the Board President or primary decision maker",
  "decision_maker_title": "Their title",
  "building_details": "Stories, units, year built, location description",
  "reserve_funded_ratio": "Current reserve funded percentage",
  "special_assessment": "Any special assessment details",
  "key_risks": ["List of identified risk factors"]
}}"""

COOK_PROMPT = """You are an expert insurance broker writing outreach emails to a condominium association board president. Use the following extracted data to write 4 distinct email campaigns.

TARGET PROPERTY DATA:
- Association: {name}
- Address: {address}
- County: {county}
- Decision Maker: {decision_maker} ({decision_maker_title})
- Current Carrier: {carrier}
- Current Premium: ${premium}
- Prior Year Premium: ${premium_prior_year}
- Premium Increase: {premium_increase_pct}%
- Total Insured Value (TIV): ${tiv}
- Policy Expiration: {expiration_date}
- Deductible: {deductible}
- Reserve Funded Ratio: {reserve_funded_ratio}
- Key Risks: {key_risks}

Write exactly 4 emails. For each email provide a JSON object. Return a JSON array of 4 objects, no markdown:
[
  {{
    "style": "Informal",
    "subject": "Email subject line",
    "body": "Full email body"
  }},
  {{
    "style": "Formal",
    "subject": "Email subject line",
    "body": "Full email body"
  }},
  {{
    "style": "Cost-Effective",
    "subject": "Email subject line",
    "body": "Full email body"
  }},
  {{
    "style": "Risk-Averse",
    "subject": "Email subject line",
    "body": "Full email body"
  }}
]

EMAIL STYLE GUIDELINES:
1. **Informal**: Friendly, local broker vibe. First-name basis, casual tone, "saw your building" feel.
2. **Formal**: Highly professional. Highlight brokerage capabilities, market access, carrier relationships.
3. **Cost-Effective**: Lead with the premium number. Directly attack the ${premium} cost, reference the {premium_increase_pct}% increase, offer a market-rate comparison.
4. **Risk-Averse**: Highlight specific regional risks (coastal wind, surge, flood zone) they may be underinsured for. Reference the {deductible} and TIV adequacy. Focus on coverage gaps, not just price.

Sign each email from "Jason Wagner, Wagner Insurance Group"."""


def run_kill_phase(sunbiz: str, audit: str, ie: str) -> dict:
    """Extract structured intelligence from the three document types."""
    if not ANTHROPIC_API_KEY:
        raise ValueError("ANTHROPIC_API_KEY not set")

    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)

    prompt = KILL_PROMPT.format(sunbiz=sunbiz, audit=audit, ie=ie)

    message = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=2000,
        messages=[{"role": "user", "content": prompt}],
    )

    response_text = message.content[0].text.strip()

    try:
        return json.loads(response_text)
    except json.JSONDecodeError:
        # Try to extract JSON from response
        start = response_text.find("{")
        end = response_text.rfind("}") + 1
        if start >= 0 and end > start:
            return json.loads(response_text[start:end])
        raise ValueError(f"Could not parse Kill phase response as JSON: {response_text[:200]}")


def run_cook_phase(entity_data: dict) -> list[dict]:
    """Generate 4 distinct outreach email campaigns."""
    if not ANTHROPIC_API_KEY:
        raise ValueError("ANTHROPIC_API_KEY not set")

    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)

    prompt = COOK_PROMPT.format(**entity_data)

    message = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=4000,
        messages=[{"role": "user", "content": prompt}],
    )

    response_text = message.content[0].text.strip()

    try:
        return json.loads(response_text)
    except json.JSONDecodeError:
        start = response_text.find("[")
        end = response_text.rfind("]") + 1
        if start >= 0 and end > start:
            return json.loads(response_text[start:end])
        raise ValueError(f"Could not parse Cook phase response as JSON: {response_text[:200]}")


def deep_dive(
    entity_name: str,
    entity_address: str,
    entity_county: str,
    sunbiz_text: str,
    audit_text: str,
    ie_text: str,
) -> tuple[dict, list[dict]]:
    """
    Run the full Kill → Cook pipeline.
    Returns (extracted_data, email_drafts).
    """
    # Phase 1: Kill — extract intelligence
    extracted = run_kill_phase(sunbiz_text, audit_text, ie_text)

    # Phase 2: Cook — generate emails using extracted data
    cook_input = {
        "name": entity_name,
        "address": entity_address,
        "county": entity_county,
        "decision_maker": extracted.get("decision_maker", "Board President"),
        "decision_maker_title": extracted.get("decision_maker_title", "President"),
        "carrier": extracted.get("carrier", "Unknown"),
        "premium": extracted.get("premium", "N/A"),
        "premium_prior_year": extracted.get("premium_prior_year", "N/A"),
        "premium_increase_pct": extracted.get("premium_increase_pct", "N/A"),
        "tiv": extracted.get("tiv", "N/A"),
        "expiration_date": extracted.get("expiration_date", "N/A"),
        "deductible": extracted.get("deductible", "N/A"),
        "reserve_funded_ratio": extracted.get("reserve_funded_ratio", "N/A"),
        "key_risks": ", ".join(extracted.get("key_risks", [])),
    }

    emails = run_cook_phase(cook_input)

    return extracted, emails

"""
SAM.gov Opportunities API Ingester

Fetches opportunities from the SAM.gov public API, deduplicates via content_hash,
and inserts/updates the global opportunities table.

API docs: https://open.gsa.gov/api/get-opportunities-public-api/
Rate limit: ~1000 requests/day (tracked in rate_limit_state).
"""

import hashlib
import json
import logging
import os
import re
from datetime import datetime, timedelta, timezone

import httpx

from crypto import decrypt_api_key

log = logging.getLogger("pipeline.ingest.sam_gov")

SAM_API_BASE = "https://api.sam.gov/opportunities/v2/search"
SAM_API_KEY_ENV = os.environ.get("SAM_GOV_API_KEY", "")
DEFAULT_DAYS_BACK = 7
PAGE_SIZE = 25  # SAM.gov max per request

# Stub mode: USE_STUB_DATA=true enables seed data for local development/demos.
# In production, set SAM_GOV_API_KEY and leave USE_STUB_DATA unset.
USE_STUB_DATA = os.environ.get("USE_STUB_DATA", "false").lower() == "true"


async def _resolve_api_key(conn) -> str:
    """Resolve SAM.gov API key: DB encrypted value first, env var fallback."""
    try:
        row = await conn.fetchrow(
            "SELECT encrypted_value FROM api_key_registry WHERE source = 'sam_gov'"
        )
        if row and row["encrypted_value"]:
            key = decrypt_api_key(row["encrypted_value"])
            log.info("Using SAM.gov API key from database (encrypted)")
            return key
    except Exception as e:
        log.warning("Could not load encrypted SAM.gov key from DB: %s", e)

    if SAM_API_KEY_ENV:
        log.info("Using SAM.gov API key from environment variable")
    return SAM_API_KEY_ENV


def _generate_stub_opportunities() -> list[dict]:
    """Return realistic SBIR/STTR SAM.gov API response data for testing/development.

    Each dict matches the exact field names from the SAM.gov GET /opportunities/v2/search
    response as documented at https://open.gsa.gov/api/get-opportunities-public-api/

    Includes:
      - 3 SBIR Phase I opportunities (Air Force, Army, Navy)
      - 2 SBIR Phase II opportunities
      - 2 STTR opportunities (with research institution requirements)
      - 1 BAA (Broad Agency Announcement)
      - 1 OTA (Other Transaction Authority)
    """
    now = datetime.now(timezone.utc)
    return [
        # ── SBIR Phase I: Air Force ──
        {
            "noticeId": "stub_sbir_001_af_hypersonics",
            "title": "SBIR Phase I: Advanced Materials for Hypersonic Vehicles (AF241-001)",
            "solicitationNumber": "FA8650-26-S-0001",
            "department": "DEPT OF DEFENSE",
            "subTier": "DEPT OF THE AIR FORCE",
            "office": "AFRL/RQ WRIGHT-PATTERSON AFB",
            "fullParentPathName": "DEPT OF DEFENSE.DEPT OF THE AIR FORCE.AFRL/RQ WRIGHT-PATTERSON AFB",
            "fullParentPathCode": "097.057.AFRL_RQ",
            "postedDate": (now - timedelta(days=3)).strftime("%Y-%m-%d"),
            "type": "Solicitation",
            "baseType": "Solicitation",
            "archiveType": "autocustom",
            "archiveDate": (now + timedelta(days=60)).strftime("%Y-%m-%d"),
            "typeOfSetAside": "SBR",
            "typeOfSetAsideDescription": "Small Business SBIR Program",
            "responseDeadLine": (now + timedelta(days=28)).strftime("%Y-%m-%dT17:00:00-05:00"),
            "naicsCode": "541715",
            "classificationCode": "A014",
            "active": "Yes",
            "description": (
                "SBIR Phase I topic AF241-001: The Air Force Research Laboratory seeks innovative "
                "solutions for advanced thermal protection materials capable of withstanding "
                "temperatures exceeding 2000C during sustained hypersonic flight. Research areas "
                "include ultra-high temperature ceramics (UHTC), carbon-carbon composites, and "
                "novel ablative materials. Phase I will demonstrate material feasibility through "
                "laboratory testing and computational modeling. TRL 1-3 expected at Phase I entry. "
                "Maximum Phase I award: $250,000 over 6 months."
            ),
            "organizationType": "OFFICE",
            "additionalInfoLink": None,
            "uiLink": "https://sam.gov/opp/stub_sbir_001_af_hypersonics/view",
            "award": None,
            "pointOfContact": [
                {
                    "type": "primary",
                    "fullName": "Dr. Robert Chen",
                    "email": "robert.chen.test@us.af.mil",
                    "phone": "937-555-0101",
                    "fax": None,
                    "title": "SBIR/STTR Program Manager",
                },
            ],
            "officeAddress": {
                "zipcode": "45433",
                "city": "Wright-Patterson AFB",
                "countryCode": "USA",
                "state": "OH",
            },
            "placeOfPerformance": {
                "city": {"code": "86772", "name": "Wright-Patterson AFB"},
                "state": {"code": "OH", "name": "Ohio"},
                "country": {"code": "USA", "name": "UNITED STATES"},
            },
        },
        # ── SBIR Phase I: Army ──
        {
            "noticeId": "stub_sbir_002_army_autonomy",
            "title": "SBIR Phase I: Autonomous Navigation for Unmanned Ground Vehicles (A261-003)",
            "solicitationNumber": "W911NF-26-S-0015",
            "department": "DEPT OF DEFENSE",
            "subTier": "DEPT OF THE ARMY",
            "office": "ACC-APG ADELPHI",
            "fullParentPathName": "DEPT OF DEFENSE.DEPT OF THE ARMY.ACC-APG ADELPHI",
            "fullParentPathCode": "012.21A1.W6QK",
            "postedDate": (now - timedelta(days=5)).strftime("%Y-%m-%d"),
            "type": "Solicitation",
            "baseType": "Solicitation",
            "archiveType": "autocustom",
            "archiveDate": (now + timedelta(days=55)).strftime("%Y-%m-%d"),
            "typeOfSetAside": "SBR",
            "typeOfSetAsideDescription": "Small Business SBIR Program",
            "responseDeadLine": (now + timedelta(days=21)).strftime("%Y-%m-%dT16:00:00-05:00"),
            "naicsCode": "541715",
            "classificationCode": "A014",
            "active": "Yes",
            "description": (
                "SBIR Phase I topic A261-003: Army Research Laboratory seeks innovative approaches "
                "for GPS-denied autonomous navigation of unmanned ground vehicles in complex terrain. "
                "Solutions should leverage LiDAR, computer vision, and machine learning for real-time "
                "path planning and obstacle avoidance. Must address degraded visual environments "
                "including dust, smoke, and low-light conditions. Phase I feasibility demonstration "
                "required. TRL 2-4 expected. Maximum award: $250,000 over 6 months."
            ),
            "organizationType": "OFFICE",
            "additionalInfoLink": None,
            "uiLink": "https://sam.gov/opp/stub_sbir_002_army_autonomy/view",
            "award": None,
            "pointOfContact": [
                {
                    "type": "primary",
                    "fullName": "Dr. Lisa Park",
                    "email": "lisa.park.test@army.mil",
                    "phone": "301-555-0202",
                    "title": "SBIR Program Manager",
                },
            ],
            "officeAddress": {
                "zipcode": "20783",
                "city": "Adelphi",
                "countryCode": "USA",
                "state": "MD",
            },
            "placeOfPerformance": {
                "city": {"code": "01600", "name": "Adelphi"},
                "state": {"code": "MD", "name": "Maryland"},
                "country": {"code": "USA", "name": "UNITED STATES"},
            },
        },
        # ── SBIR Phase I: Navy ──
        {
            "noticeId": "stub_sbir_003_navy_sensors",
            "title": "SBIR Phase I: Compact Underwater Acoustic Sensor Arrays (N261-015)",
            "solicitationNumber": "N68335-26-S-0008",
            "department": "DEPT OF DEFENSE",
            "subTier": "DEPT OF THE NAVY",
            "office": "NAVSEA WARFARE CENTERS",
            "fullParentPathName": "DEPT OF DEFENSE.DEPT OF THE NAVY.NAVSEA WARFARE CENTERS",
            "fullParentPathCode": "017.NAVSEA.NUWC",
            "postedDate": (now - timedelta(days=2)).strftime("%Y-%m-%d"),
            "type": "Solicitation",
            "baseType": "Solicitation",
            "archiveType": "autocustom",
            "archiveDate": (now + timedelta(days=65)).strftime("%Y-%m-%d"),
            "typeOfSetAside": "SBR",
            "typeOfSetAsideDescription": "Small Business SBIR Program",
            "responseDeadLine": (now + timedelta(days=35)).strftime("%Y-%m-%dT17:00:00-05:00"),
            "naicsCode": "541711",
            "classificationCode": "AC12",
            "active": "Yes",
            "description": (
                "SBIR Phase I topic N261-015: Naval Undersea Warfare Center seeks innovative compact "
                "acoustic sensor array designs for submarine detection and classification. Research "
                "should address piezoelectric materials, MEMS-based transducers, and advanced signal "
                "processing algorithms for improved sensitivity and reduced form factor. Phase I "
                "deliverables include sensor design, simulation results, and test plan. "
                "TRL 1-3 at entry. Maximum Phase I award: $250,000."
            ),
            "organizationType": "OFFICE",
            "additionalInfoLink": None,
            "uiLink": "https://sam.gov/opp/stub_sbir_003_navy_sensors/view",
            "award": None,
            "pointOfContact": [
                {
                    "type": "primary",
                    "fullName": "Cmdr. David Torres",
                    "email": "david.torres.test@navy.mil",
                    "phone": "401-555-0303",
                    "title": "SBIR Topic Author",
                },
            ],
            "officeAddress": {
                "zipcode": "02841",
                "city": "Newport",
                "countryCode": "USA",
                "state": "RI",
            },
            "placeOfPerformance": {
                "city": {"code": "49960", "name": "Newport"},
                "state": {"code": "RI", "name": "Rhode Island"},
                "country": {"code": "USA", "name": "UNITED STATES"},
            },
        },
        # ── SBIR Phase II: Air Force ──
        {
            "noticeId": "stub_sbir_004_af_phase2_ai",
            "title": "SBIR Phase II: AI-Driven Predictive Maintenance for Aircraft Engines (AF242-010)",
            "solicitationNumber": "FA8650-26-S-0042",
            "department": "DEPT OF DEFENSE",
            "subTier": "DEPT OF THE AIR FORCE",
            "office": "AFRL/RQ WRIGHT-PATTERSON AFB",
            "fullParentPathName": "DEPT OF DEFENSE.DEPT OF THE AIR FORCE.AFRL/RQ WRIGHT-PATTERSON AFB",
            "fullParentPathCode": "097.057.AFRL_RQ",
            "postedDate": (now - timedelta(days=4)).strftime("%Y-%m-%d"),
            "type": "Solicitation",
            "baseType": "Solicitation",
            "archiveType": "autocustom",
            "archiveDate": (now + timedelta(days=90)).strftime("%Y-%m-%d"),
            "typeOfSetAside": "SBR",
            "typeOfSetAsideDescription": "Small Business SBIR Program",
            "responseDeadLine": (now + timedelta(days=42)).strftime("%Y-%m-%dT17:00:00-05:00"),
            "naicsCode": "541715",
            "classificationCode": "A014",
            "active": "Yes",
            "description": (
                "SBIR Phase II topic AF242-010: Following successful Phase I demonstration, "
                "this Phase II effort seeks to develop and validate an AI/ML-based predictive "
                "maintenance system for military turbofan engines. The system must integrate "
                "with existing ALIS/ODIN maintenance databases, process vibration, thermal, and "
                "oil analysis data streams, and provide actionable maintenance predictions with "
                ">90%% accuracy. TRL 4-6 expected. Maximum Phase II award: $1,500,000 over 24 months."
            ),
            "organizationType": "OFFICE",
            "additionalInfoLink": None,
            "uiLink": "https://sam.gov/opp/stub_sbir_004_af_phase2_ai/view",
            "award": None,
            "pointOfContact": [
                {
                    "type": "primary",
                    "fullName": "Dr. Robert Chen",
                    "email": "robert.chen.test@us.af.mil",
                    "phone": "937-555-0101",
                    "title": "SBIR/STTR Program Manager",
                },
            ],
            "officeAddress": {
                "zipcode": "45433",
                "city": "Wright-Patterson AFB",
                "countryCode": "USA",
                "state": "OH",
            },
            "placeOfPerformance": {
                "city": {"code": "86772", "name": "Wright-Patterson AFB"},
                "state": {"code": "OH", "name": "Ohio"},
                "country": {"code": "USA", "name": "UNITED STATES"},
            },
        },
        # ── SBIR Phase II: Army ──
        {
            "noticeId": "stub_sbir_005_army_phase2_comms",
            "title": "SBIR Phase II: Resilient Tactical Communications for Contested Environments (A252-008)",
            "solicitationNumber": "W15QKN-26-S-0022",
            "department": "DEPT OF DEFENSE",
            "subTier": "DEPT OF THE ARMY",
            "office": "ACC-NJ PICATINNY",
            "fullParentPathName": "DEPT OF DEFENSE.DEPT OF THE ARMY.ACC-NJ PICATINNY",
            "fullParentPathCode": "012.21A1.W15Q",
            "postedDate": (now - timedelta(days=6)).strftime("%Y-%m-%d"),
            "type": "Solicitation",
            "baseType": "Solicitation",
            "archiveType": "autocustom",
            "archiveDate": (now + timedelta(days=80)).strftime("%Y-%m-%d"),
            "typeOfSetAside": "SBR",
            "typeOfSetAsideDescription": "Small Business SBIR Program",
            "responseDeadLine": (now + timedelta(days=38)).strftime("%Y-%m-%dT16:00:00-05:00"),
            "naicsCode": "541712",
            "classificationCode": "A014",
            "active": "Yes",
            "description": (
                "SBIR Phase II topic A252-008: Develop a prototype resilient tactical "
                "communications system for GPS-denied and spectrum-contested environments. "
                "Must demonstrate mesh networking, frequency hopping, and low probability of "
                "intercept/detection (LPI/LPD). Integration with existing PRC-162 radio systems "
                "required. Phase II prototype testing in operational environment. "
                "TRL 5-6 expected. Maximum Phase II award: $1,750,000 over 24 months."
            ),
            "organizationType": "OFFICE",
            "additionalInfoLink": None,
            "uiLink": "https://sam.gov/opp/stub_sbir_005_army_phase2_comms/view",
            "award": None,
            "pointOfContact": [
                {
                    "type": "primary",
                    "fullName": "Col. Marcus Hall",
                    "email": "marcus.hall.test@army.mil",
                    "phone": "973-555-0505",
                    "title": "SBIR Program Director",
                },
            ],
            "officeAddress": {
                "zipcode": "07806",
                "city": "Picatinny Arsenal",
                "countryCode": "USA",
                "state": "NJ",
            },
            "placeOfPerformance": {
                "city": {"code": "58200", "name": "Picatinny Arsenal"},
                "state": {"code": "NJ", "name": "New Jersey"},
                "country": {"code": "USA", "name": "UNITED STATES"},
            },
        },
        # ── STTR Phase I: Navy + University ──
        {
            "noticeId": "stub_sttr_006_navy_quantum",
            "title": "STTR Phase I: Quantum Sensing for Undersea Magnetic Anomaly Detection (N261-T01)",
            "solicitationNumber": "N68335-26-T-0003",
            "department": "DEPT OF DEFENSE",
            "subTier": "DEPT OF THE NAVY",
            "office": "ONR ARLINGTON",
            "fullParentPathName": "DEPT OF DEFENSE.DEPT OF THE NAVY.ONR ARLINGTON",
            "fullParentPathCode": "017.ONR.ARL",
            "postedDate": (now - timedelta(days=1)).strftime("%Y-%m-%d"),
            "type": "Solicitation",
            "baseType": "Solicitation",
            "archiveType": "autocustom",
            "archiveDate": (now + timedelta(days=70)).strftime("%Y-%m-%d"),
            "typeOfSetAside": "STTR",
            "typeOfSetAsideDescription": "Small Business STTR Program",
            "responseDeadLine": (now + timedelta(days=30)).strftime("%Y-%m-%dT17:00:00-05:00"),
            "naicsCode": "541715",
            "classificationCode": "AC12",
            "active": "Yes",
            "description": (
                "STTR Phase I topic N261-T01: Office of Naval Research seeks collaborative "
                "proposals from small businesses partnered with research institutions to develop "
                "quantum magnetometry sensors for undersea magnetic anomaly detection. Must "
                "demonstrate nitrogen-vacancy (NV) center diamond magnetometer or equivalent "
                "quantum sensing approach. Research institution must perform at least 30%% of work. "
                "Phase I feasibility study and proof-of-concept required. "
                "TRL 1-3 at entry. Maximum STTR Phase I award: $250,000."
            ),
            "organizationType": "OFFICE",
            "additionalInfoLink": None,
            "uiLink": "https://sam.gov/opp/stub_sttr_006_navy_quantum/view",
            "award": None,
            "pointOfContact": [
                {
                    "type": "primary",
                    "fullName": "Dr. Angela Kim",
                    "email": "angela.kim.test@navy.mil",
                    "phone": "703-555-0606",
                    "title": "STTR Program Manager",
                },
            ],
            "officeAddress": {
                "zipcode": "22217",
                "city": "Arlington",
                "countryCode": "USA",
                "state": "VA",
            },
            "placeOfPerformance": {
                "city": {"code": "03000", "name": "Arlington"},
                "state": {"code": "VA", "name": "Virginia"},
                "country": {"code": "USA", "name": "UNITED STATES"},
            },
        },
        # ── STTR Phase I: Air Force + University ──
        {
            "noticeId": "stub_sttr_007_af_directed_energy",
            "title": "STTR Phase I: High-Energy Laser Beam Control for Airborne Platforms (AF261-T05)",
            "solicitationNumber": "FA9451-26-T-0001",
            "department": "DEPT OF DEFENSE",
            "subTier": "DEPT OF THE AIR FORCE",
            "office": "AFRL/RD KIRTLAND AFB",
            "fullParentPathName": "DEPT OF DEFENSE.DEPT OF THE AIR FORCE.AFRL/RD KIRTLAND AFB",
            "fullParentPathCode": "097.057.AFRL_RD",
            "postedDate": (now - timedelta(days=3)).strftime("%Y-%m-%d"),
            "type": "Solicitation",
            "baseType": "Solicitation",
            "archiveType": "autocustom",
            "archiveDate": (now + timedelta(days=65)).strftime("%Y-%m-%d"),
            "typeOfSetAside": "STTR",
            "typeOfSetAsideDescription": "Small Business STTR Program",
            "responseDeadLine": (now + timedelta(days=32)).strftime("%Y-%m-%dT17:00:00-05:00"),
            "naicsCode": "541715",
            "classificationCode": "A014",
            "active": "Yes",
            "description": (
                "STTR Phase I topic AF261-T05: AFRL Directed Energy Directorate seeks small "
                "business/research institution teams to develop adaptive optics and beam control "
                "solutions for airborne high-energy laser systems. Must address atmospheric "
                "turbulence compensation, thermal blooming mitigation, and real-time wavefront "
                "sensing. Research institution must contribute fundamental atmospheric propagation "
                "modeling. TRL 2-4 at entry. Maximum STTR Phase I award: $250,000."
            ),
            "organizationType": "OFFICE",
            "additionalInfoLink": None,
            "uiLink": "https://sam.gov/opp/stub_sttr_007_af_directed_energy/view",
            "award": None,
            "pointOfContact": [
                {
                    "type": "primary",
                    "fullName": "Dr. James Whitfield",
                    "email": "james.whitfield.test@us.af.mil",
                    "phone": "505-555-0707",
                    "title": "STTR Topic Author",
                },
            ],
            "officeAddress": {
                "zipcode": "87117",
                "city": "Kirtland AFB",
                "countryCode": "USA",
                "state": "NM",
            },
            "placeOfPerformance": {
                "city": {"code": "02000", "name": "Albuquerque"},
                "state": {"code": "NM", "name": "New Mexico"},
                "country": {"code": "USA", "name": "UNITED STATES"},
            },
        },
        # ── BAA: DARPA ──
        {
            "noticeId": "stub_baa_008_darpa_bio",
            "title": "Broad Agency Announcement: Biological Technologies for National Security",
            "solicitationNumber": "HR001126-BAA-0045",
            "department": "DEPT OF DEFENSE",
            "subTier": "DEFENSE ADVANCED RESEARCH PROJECTS AGENCY",
            "office": "DARPA/BTO",
            "fullParentPathName": "DEPT OF DEFENSE.DEFENSE ADVANCED RESEARCH PROJECTS AGENCY.DARPA/BTO",
            "fullParentPathCode": "097.DARPA.BTO",
            "postedDate": (now - timedelta(days=7)).strftime("%Y-%m-%d"),
            "type": "Solicitation",
            "baseType": "Solicitation",
            "archiveType": "autocustom",
            "archiveDate": (now + timedelta(days=180)).strftime("%Y-%m-%d"),
            "typeOfSetAside": "SBA",
            "typeOfSetAsideDescription": "Total Small Business Set-Aside",
            "responseDeadLine": (now + timedelta(days=60)).strftime("%Y-%m-%dT17:00:00-05:00"),
            "naicsCode": "541715",
            "classificationCode": "A014",
            "active": "Yes",
            "description": (
                "Broad Agency Announcement (BAA): DARPA Biological Technologies Office solicits "
                "white papers for innovative research in synthetic biology, engineered living "
                "materials, biosensors for threat detection, and biomanufacturing for defense "
                "applications. Multiple awards anticipated across TRL 1-4. Both small and large "
                "businesses eligible. Proposals accepted on a rolling basis."
            ),
            "organizationType": "OFFICE",
            "additionalInfoLink": None,
            "uiLink": "https://sam.gov/opp/stub_baa_008_darpa_bio/view",
            "award": None,
            "pointOfContact": [
                {
                    "type": "primary",
                    "fullName": "Dr. Sarah Mitchell",
                    "email": "sarah.mitchell.test@darpa.mil",
                    "phone": "703-555-0808",
                    "title": "Program Manager",
                },
            ],
            "officeAddress": {
                "zipcode": "22203",
                "city": "Arlington",
                "countryCode": "USA",
                "state": "VA",
            },
            "placeOfPerformance": {
                "city": {"code": "03000", "name": "Arlington"},
                "state": {"code": "VA", "name": "Virginia"},
                "country": {"code": "USA", "name": "UNITED STATES"},
            },
        },
        # ── OTA: Army Futures Command ──
        {
            "noticeId": "stub_ota_009_army_ai",
            "title": "Other Transaction Authority: AI/ML Solutions for Battlefield Decision Support",
            "solicitationNumber": "W519TC-26-9-0005",
            "department": "DEPT OF DEFENSE",
            "subTier": "DEPT OF THE ARMY",
            "office": "ARMY FUTURES COMMAND",
            "fullParentPathName": "DEPT OF DEFENSE.DEPT OF THE ARMY.ARMY FUTURES COMMAND",
            "fullParentPathCode": "012.21A1.AFC",
            "postedDate": (now - timedelta(days=2)).strftime("%Y-%m-%d"),
            "type": "Special Notice",
            "baseType": "Special Notice",
            "archiveType": "autocustom",
            "archiveDate": (now + timedelta(days=120)).strftime("%Y-%m-%d"),
            "typeOfSetAside": "SBA",
            "typeOfSetAsideDescription": "Total Small Business Set-Aside",
            "responseDeadLine": (now + timedelta(days=45)).strftime("%Y-%m-%dT16:00:00-05:00"),
            "naicsCode": "541715",
            "classificationCode": "A014",
            "active": "Yes",
            "description": (
                "Other Transaction Authority (OTA) prototype opportunity: Army Futures Command "
                "seeks AI/ML solutions for real-time battlefield decision support. Solutions must "
                "process multi-domain sensor data (satellite, UAV, ground) and provide actionable "
                "intelligence within tactical timelines. Preference for non-traditional defense "
                "contractors and small businesses with commercial AI/ML capabilities. "
                "OT agreements under 10 USC 4022."
            ),
            "organizationType": "OFFICE",
            "additionalInfoLink": None,
            "uiLink": "https://sam.gov/opp/stub_ota_009_army_ai/view",
            "award": None,
            "pointOfContact": [
                {
                    "type": "primary",
                    "fullName": "Maj. Katherine Brooks",
                    "email": "katherine.brooks.test@army.mil",
                    "phone": "512-555-0909",
                    "title": "OTA Agreements Officer",
                },
            ],
            "officeAddress": {
                "zipcode": "78234",
                "city": "Austin",
                "countryCode": "USA",
                "state": "TX",
            },
            "placeOfPerformance": {
                "city": {"code": "05000", "name": "Austin"},
                "state": {"code": "TX", "name": "Texas"},
                "country": {"code": "USA", "name": "UNITED STATES"},
            },
        },
    ]


class SamGovIngester:
    def __init__(self, conn):
        self.conn = conn

    async def run(self, params: dict | None = None) -> dict:
        """Run a full or incremental SAM.gov ingest."""
        params = params or {}
        days_back = params.get("days_back", DEFAULT_DAYS_BACK)

        result = {
            "opportunities_fetched": 0,
            "opportunities_new": 0,
            "opportunities_updated": 0,
            "amendments_detected": 0,
            "errors": [],
        }

        # Resolve API key from DB (encrypted) or env var fallback
        sam_api_key = await _resolve_api_key(self.conn)

        # ── Stub mode: ONLY when USE_STUB_DATA=true (explicit opt-in) ──
        if USE_STUB_DATA:
            log.info("USE_STUB_DATA=true — returning stub SAM.gov data (not real opportunities)")
            stub_opps = _generate_stub_opportunities()
            for opp in stub_opps:
                try:
                    await self._upsert_opportunity(opp)
                    result["opportunities_fetched"] += 1
                    result["opportunities_new"] += 1
                except Exception as e:
                    result["errors"].append(f"Stub upsert error for {opp.get('noticeId')}: {e}")
                    log.error("Stub upsert error: %s", e)
            return result

        if not sam_api_key:
            msg = (
                "SAM_GOV_API_KEY not configured — cannot fetch real opportunities. "
                "Set SAM_GOV_API_KEY env var or add encrypted key to api_key_registry. "
                "To use test data, set USE_STUB_DATA=true explicitly."
            )
            log.error(msg)
            result["errors"].append(msg)
            return result

        # Check rate limit
        quota = await self.conn.fetchrow(
            "SELECT * FROM get_remaining_quota('sam_gov')"
        )
        if quota and quota.get("can_proceed") is False:
            result["errors"].append("SAM.gov rate limit reached")
            log.warning("Rate limit reached for SAM.gov")
            return result

        posted_from = (datetime.now(timezone.utc) - timedelta(days=days_back)).strftime("%m/%d/%Y")
        posted_to = datetime.now(timezone.utc).strftime("%m/%d/%Y")

        offset = 0
        total_fetched = 0

        async with httpx.AsyncClient(timeout=30) as client:
            while True:
                try:
                    # Build query params — prefer SBIR/STTR but don't exclude
                    # everything else. SAM.gov scoring handles relevance filtering.
                    api_params = {
                        "api_key": sam_api_key,
                        "postedFrom": posted_from,
                        "postedTo": posted_to,
                        "limit": PAGE_SIZE,
                        "offset": offset,
                        "ptype": "o,k,p,s",  # Solicitations, sources sought, presolicitations, special notices
                    }
                    # Apply optional SBIR filters from job params
                    set_aside_filter = params.get("typeOfSetAside")
                    naics_filter = params.get("ncode")
                    if set_aside_filter:
                        api_params["typeOfSetAside"] = set_aside_filter
                    if naics_filter:
                        api_params["ncode"] = naics_filter

                    resp = await client.get(SAM_API_BASE, params=api_params)

                    # Track rate limit
                    await self.conn.execute(
                        """
                        UPDATE rate_limit_state
                        SET requests_today = requests_today + 1,
                            requests_this_hour = requests_this_hour + 1,
                            last_request_at = NOW()
                        WHERE source = 'sam_gov'
                        """
                    )

                    if resp.status_code != 200:
                        result["errors"].append(f"SAM API returned {resp.status_code}")
                        log.error(f"SAM API error: {resp.status_code} - {resp.text[:200]}")
                        break

                    data = resp.json()
                    opps = data.get("opportunitiesData", [])

                    if not opps:
                        break

                    for raw_opp in opps:
                        try:
                            stats = await self._upsert_opportunity(raw_opp)
                            result["opportunities_fetched"] += 1
                            if stats == "new":
                                result["opportunities_new"] += 1
                            elif stats == "updated":
                                result["opportunities_updated"] += 1
                                result["amendments_detected"] += 1
                        except Exception as e:
                            log.error(f"Error processing opp {raw_opp.get('noticeId', '?')}: {e}")
                            result["errors"].append(f"Process error: {e}")

                    total_fetched += len(opps)
                    log.info(f"Fetched {total_fetched} opportunities so far (page offset={offset})")

                    # If fewer than page size, we're done
                    if len(opps) < PAGE_SIZE:
                        break

                    offset += PAGE_SIZE

                    # Re-check rate limit
                    quota = await self.conn.fetchrow(
                        "SELECT * FROM get_remaining_quota('sam_gov')"
                    )
                    if quota and quota.get("can_proceed") is False:
                        log.warning("Rate limit reached mid-ingest, stopping")
                        break

                except httpx.TimeoutException:
                    result["errors"].append("SAM API timeout")
                    log.error("SAM API request timed out")
                    break
                except Exception as e:
                    result["errors"].append(f"Fetch error: {e}")
                    log.error(f"Fetch error: {e}", exc_info=True)
                    break

        log.info(
            f"SAM.gov ingest complete: {result['opportunities_fetched']} fetched, "
            f"{result['opportunities_new']} new, {result['opportunities_updated']} updated"
        )
        return result

    async def _upsert_opportunity(self, raw: dict) -> str:
        """Insert or update an opportunity. Returns 'new', 'updated', or 'unchanged'."""
        source_id = raw.get("noticeId", "")
        if not source_id:
            return "unchanged"

        # Build content hash for change detection
        content_str = json.dumps(raw, sort_keys=True, default=str)
        content_hash = hashlib.sha256(content_str.encode()).hexdigest()[:16]

        # Check existing
        existing = await self.conn.fetchrow(
            "SELECT id, content_hash FROM opportunities WHERE source = 'sam_gov' AND source_id = $1",
            source_id,
        )

        if existing and existing["content_hash"] == content_hash:
            return "unchanged"

        # ── Parse all fields from SAM.gov response ──
        fields = self._extract_all_fields(raw, source_id)

        if existing:
            await self.conn.execute(
                """
                UPDATE opportunities SET
                    title = $1, description = $2, agency = $3, agency_code = $4,
                    naics_codes = $5, set_aside_type = $6, set_aside_code = $7,
                    opportunity_type = $8, posted_date = $9, close_date = $10,
                    solicitation_number = $11, source_url = $12, content_hash = $13,
                    raw_data = $14::jsonb,
                    classification_code = $15, department = $16, sub_tier = $17,
                    office = $18, organization_type = $19, full_parent_path_code = $20,
                    pop_city = $21, pop_state = $22, pop_country = $23, pop_zip = $24,
                    office_city = $25, office_state = $26, office_zip = $27, office_country = $28,
                    contact_name = $29, contact_email = $30, contact_phone = $31, contact_title = $32,
                    award_date = $33, award_number = $34, award_amount = $35,
                    awardee_name = $36, awardee_uei = $37, awardee_city = $38, awardee_state = $39,
                    base_type = $40, archive_type = $41, archive_date = $42,
                    is_active = $43, sam_ui_link = $44, additional_info_link = $45,
                    resource_links = $46::jsonb, document_urls = $47::jsonb,
                    estimated_value_min = $48, estimated_value_max = $49,
                    program_type = COALESCE($50, program_type),
                    updated_at = NOW()
                WHERE id = $51
                """,
                fields["title"], fields["description"], fields["agency"], fields["agency_code"],
                fields["naics_codes"], fields["set_aside"], fields["set_aside_code"],
                fields["opp_type"], fields["posted_date"], fields["close_date"],
                fields["sol_number"], fields["source_url"], content_hash,
                json.dumps(raw, default=str),
                fields["classification_code"], fields["department"], fields["sub_tier"],
                fields["office"], fields["organization_type"], fields["full_parent_path_code"],
                fields["pop_city"], fields["pop_state"], fields["pop_country"], fields["pop_zip"],
                fields["office_city"], fields["office_state"], fields["office_zip"], fields["office_country"],
                fields["contact_name"], fields["contact_email"], fields["contact_phone"], fields["contact_title"],
                fields["award_date"], fields["award_number"], fields["award_amount"],
                fields["awardee_name"], fields["awardee_uei"], fields["awardee_city"], fields["awardee_state"],
                fields["base_type"], fields["archive_type"], fields["archive_date"],
                fields["is_active"], fields["sam_ui_link"], fields["additional_info_link"],
                json.dumps(fields["resource_links"], default=str),       # $46 resource_links
                json.dumps(fields["resource_links"], default=str),       # $47 document_urls (same data — SAM resourceLinks ARE the attachments)
                fields["award_amount"],                                  # $48 estimated_value_min (SAM only provides award.amount, no separate estimate)
                fields["award_amount"],                                  # $49 estimated_value_max (same — exact figure when awarded, NULL otherwise)
                fields.get("program_type"),                              # $50 program_type (COALESCE preserves existing)
                existing["id"],
            )

            # Legacy amendment record (kept for backward compat)
            await self.conn.execute(
                """
                INSERT INTO amendments (opportunity_id, change_type, old_value, new_value)
                VALUES ($1, 'content_update', $2, $3)
                """,
                existing["id"], existing["content_hash"], content_hash,
            )

            # Emit opportunity event: ingest.updated
            from events import emit_opportunity_event, pipeline_actor
            await emit_opportunity_event(
                self.conn,
                opportunity_id=str(existing["id"]),
                event_type="ingest.updated",
                source="sam_gov",
                old_value=existing["content_hash"],
                new_value=content_hash,
                snapshot_hash=content_hash,
                actor=pipeline_actor("sam_gov_ingest"),
                refs={"source_id": source_id},
                payload={
                    "title": fields["title"],
                    "solicitation_number": fields["sol_number"],
                    "agency": fields["agency"],
                    "department": fields["department"],
                    "opp_type": fields["opp_type"],
                    "program_type": fields.get("program_type"),
                    "topic_number": fields.get("topic_number"),
                },
            )
            return "updated"
        else:
            row = await self.conn.fetchrow(
                """
                INSERT INTO opportunities (
                    source, source_id, title, description, agency, agency_code,
                    naics_codes, set_aside_type, set_aside_code, opportunity_type,
                    posted_date, close_date, solicitation_number, source_url,
                    content_hash, raw_data,
                    classification_code, department, sub_tier, office,
                    organization_type, full_parent_path_code,
                    pop_city, pop_state, pop_country, pop_zip,
                    office_city, office_state, office_zip, office_country,
                    contact_name, contact_email, contact_phone, contact_title,
                    award_date, award_number, award_amount,
                    awardee_name, awardee_uei, awardee_city, awardee_state,
                    base_type, archive_type, archive_date,
                    is_active, sam_ui_link, additional_info_link,
                    resource_links, document_urls,
                    estimated_value_min, estimated_value_max,
                    program_type
                ) VALUES (
                    'sam_gov', $1, $2, $3, $4, $5,
                    $6, $7, $8, $9,
                    $10, $11, $12, $13,
                    $14, $15::jsonb,
                    $16, $17, $18, $19,
                    $20, $21,
                    $22, $23, $24, $25,
                    $26, $27, $28, $29,
                    $30, $31, $32, $33,
                    $34, $35, $36,
                    $37, $38, $39, $40,
                    $41, $42, $43,
                    $44, $45, $46,
                    $47::jsonb, $48::jsonb,
                    $49, $50,
                    $51
                )
                RETURNING id
                """,
                source_id, fields["title"], fields["description"], fields["agency"], fields["agency_code"],
                fields["naics_codes"], fields["set_aside"], fields["set_aside_code"], fields["opp_type"],
                fields["posted_date"], fields["close_date"], fields["sol_number"], fields["source_url"],
                content_hash, json.dumps(raw, default=str),
                fields["classification_code"], fields["department"], fields["sub_tier"], fields["office"],
                fields["organization_type"], fields["full_parent_path_code"],
                fields["pop_city"], fields["pop_state"], fields["pop_country"], fields["pop_zip"],
                fields["office_city"], fields["office_state"], fields["office_zip"], fields["office_country"],
                fields["contact_name"], fields["contact_email"], fields["contact_phone"], fields["contact_title"],
                fields["award_date"], fields["award_number"], fields["award_amount"],
                fields["awardee_name"], fields["awardee_uei"], fields["awardee_city"], fields["awardee_state"],
                fields["base_type"], fields["archive_type"], fields["archive_date"],
                fields["is_active"], fields["sam_ui_link"], fields["additional_info_link"],
                json.dumps(fields["resource_links"], default=str),       # $47 resource_links
                json.dumps(fields["resource_links"], default=str),       # $48 document_urls (same — SAM resourceLinks ARE the attachments)
                fields["award_amount"],                                  # $49 estimated_value_min (SAM only provides award.amount, no separate estimate)
                fields["award_amount"],                                  # $50 estimated_value_max (same — exact figure when awarded, NULL otherwise)
                fields.get("program_type"),                              # $51 program_type
            )

            # Emit opportunity event: ingest.new
            if row:
                from events import emit_opportunity_event, pipeline_actor
                await emit_opportunity_event(
                    self.conn,
                    opportunity_id=str(row["id"]),
                    event_type="ingest.new",
                    source="sam_gov",
                    snapshot_hash=content_hash,
                    actor=pipeline_actor("sam_gov_ingest"),
                    refs={"source_id": source_id},
                    payload={
                        "title": fields["title"],
                        "solicitation_number": fields["sol_number"],
                        "agency": fields["agency"],
                        "agency_code": fields["agency_code"],
                        "naics_codes": fields["naics_codes"],
                        "set_aside": fields["set_aside_code"],
                        "opp_type": fields["opp_type"],
                        "department": fields["department"],
                        "classification_code": fields["classification_code"],
                        "pop_state": fields["pop_state"],
                        "program_type": fields.get("program_type"),
                        "topic_number": fields.get("topic_number"),
                        "solicitation_agency": fields.get("solicitation_agency"),
                    },
                )
            return "new"

    @staticmethod
    def _detect_program_type(raw: dict) -> str:
        """Detect SBIR/STTR program type from opportunity text."""
        text = f"{raw.get('title', '')} {raw.get('description', '')}".upper()

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

    @staticmethod
    def _extract_topic_number(title: str) -> str | None:
        """Extract SBIR/STTR topic number from title (e.g., 'AF241-001', 'N261-T01')."""
        match = re.search(r'\b([A-Z]{1,4}\d{2,3}-[A-Z]?\d{2,4})\b', title)
        return match.group(1) if match else None

    def _extract_all_fields(self, raw: dict, source_id: str) -> dict:
        """Extract all metadata fields from a SAM.gov API response record."""
        # ── Core fields ──
        title = raw.get("title", "Untitled")[:500]
        description = raw.get("description", "")
        if isinstance(description, dict):
            description = description.get("body", "")
        if not isinstance(description, str):
            description = str(description) if description else ""

        # ── Organization hierarchy ──
        agency = raw.get("fullParentPathName", "")
        full_parent_code = raw.get("fullParentPathCode", "")
        agency_code = full_parent_code.split(".")[0] if full_parent_code else ""
        department = raw.get("department", "")
        sub_tier = raw.get("subTier", "")
        office = raw.get("office", "")
        organization_type = raw.get("organizationType", "")

        # ── Classification ──
        naics = raw.get("naicsCode", "")
        naics_codes = [naics] if naics else []
        classification_code = raw.get("classificationCode", "")

        # ── Set-aside ──
        set_aside = raw.get("typeOfSetAsideDescription", "")
        set_aside_code = raw.get("typeOfSetAside", "")

        # ── Opportunity type mapping ──
        opp_type_map = {
            "o": "solicitation",
            "k": "sources_sought",
            "p": "presolicitation",
            "Solicitation": "solicitation",
            "Combined Synopsis/Solicitation": "solicitation",
            "Sources Sought": "sources_sought",
            "Presolicitation": "presolicitation",
            "Special Notice": "special_notice",
            "Award Notice": "award",
            "Intent to Bundle Requirements": "intent_bundle",
            "Justification and Approval": "justification",
        }
        opp_type = opp_type_map.get(raw.get("type", ""), "other")
        base_type = raw.get("baseType", "")

        # ── Dates ──
        posted_date = self._parse_date(raw.get("postedDate"))
        close_date = self._parse_date(raw.get("responseDeadLine") or raw.get("archiveDate"))
        archive_date = self._parse_date(raw.get("archiveDate"))
        archive_type = raw.get("archiveType", "")

        # ── Active flag ──
        is_active = (raw.get("active", "Yes") or "Yes").lower() == "yes"

        # ── Identifiers & links ──
        sol_number = raw.get("solicitationNumber", "")
        source_url = f"https://sam.gov/opp/{source_id}/view"
        sam_ui_link = raw.get("uiLink", "") or source_url
        additional_info_link = raw.get("additionalInfoLink", "")

        # ── Resource / attachment links ──
        resource_links = raw.get("resourceLinks", []) or []
        if not isinstance(resource_links, list):
            resource_links = []

        # ── Place of performance ──
        pop = raw.get("placeOfPerformance") or {}
        pop_city_obj = pop.get("city") or {}
        pop_state_obj = pop.get("state") or {}
        pop_country_obj = pop.get("country") or {}
        pop_city = pop_city_obj.get("name", "") if isinstance(pop_city_obj, dict) else str(pop_city_obj)
        pop_state = pop_state_obj.get("code", "") if isinstance(pop_state_obj, dict) else str(pop_state_obj)
        pop_country = pop_country_obj.get("code", "USA") if isinstance(pop_country_obj, dict) else str(pop_country_obj or "USA")
        pop_zip = pop.get("zip", "")

        # ── Office address ──
        off_addr = raw.get("officeAddress") or {}
        office_city = off_addr.get("city", "")
        office_state = off_addr.get("state", "")
        office_zip = off_addr.get("zipcode", "")
        office_country = off_addr.get("countryCode", "")

        # ── Primary point of contact ──
        contacts = raw.get("pointOfContact") or []
        primary_contact = next(
            (c for c in contacts if isinstance(c, dict) and c.get("type") == "primary"),
            contacts[0] if contacts and isinstance(contacts[0], dict) else {},
        )
        contact_name = primary_contact.get("fullName", "")
        contact_email = primary_contact.get("email", "")
        contact_phone = primary_contact.get("phone", "")
        contact_title = primary_contact.get("title", "")

        # ── Award info (populated when type is "Award Notice") ──
        award = raw.get("award") or {}
        award_date = self._parse_date(award.get("date")) if award else None
        award_number = award.get("number", "") if award else ""
        award_amount_raw = award.get("amount") if award else None
        award_amount = None
        if award_amount_raw is not None:
            try:
                award_amount = float(str(award_amount_raw).replace(",", "").replace("$", ""))
            except (ValueError, TypeError):
                award_amount = None

        awardee = award.get("awardee") or {} if award else {}
        awardee_name = awardee.get("name", "") if awardee else ""
        awardee_uei = awardee.get("ueiSAM", "") if awardee else ""
        awardee_loc = awardee.get("location") or {} if awardee else {}
        awardee_city = awardee_loc.get("city", "") if awardee_loc else ""
        awardee_state = awardee_loc.get("state", "") if awardee_loc else ""

        # ── SBIR/STTR-specific fields ──
        program_type = self._detect_program_type(raw)
        topic_number = self._extract_topic_number(title)
        solicitation_agency = sub_tier or department or agency

        return {
            "title": title,
            "description": description,
            "agency": agency,
            "agency_code": agency_code,
            "naics_codes": naics_codes,
            "set_aside": set_aside,
            "set_aside_code": set_aside_code,
            "opp_type": opp_type,
            "posted_date": posted_date,
            "close_date": close_date,
            "sol_number": sol_number,
            "source_url": source_url,
            "classification_code": classification_code or None,
            "department": department or None,
            "sub_tier": sub_tier or None,
            "office": office or None,
            "organization_type": organization_type or None,
            "full_parent_path_code": full_parent_code or None,
            "pop_city": pop_city or None,
            "pop_state": pop_state or None,
            "pop_country": pop_country or None,
            "pop_zip": pop_zip or None,
            "office_city": office_city or None,
            "office_state": office_state or None,
            "office_zip": office_zip or None,
            "office_country": office_country or None,
            "contact_name": contact_name or None,
            "contact_email": contact_email or None,
            "contact_phone": contact_phone or None,
            "contact_title": contact_title or None,
            "award_date": award_date,
            "award_number": award_number or None,
            "award_amount": award_amount,
            "awardee_name": awardee_name or None,
            "awardee_uei": awardee_uei or None,
            "awardee_city": awardee_city or None,
            "awardee_state": awardee_state or None,
            "base_type": base_type or None,
            "archive_type": archive_type or None,
            "archive_date": archive_date,
            "is_active": is_active,
            "sam_ui_link": sam_ui_link or None,
            "additional_info_link": additional_info_link or None,
            "resource_links": resource_links,
            "program_type": program_type if program_type != 'other' else None,
            "topic_number": topic_number,
            "solicitation_agency": solicitation_agency or None,
        }

    @staticmethod
    def _parse_date(date_str: str | None) -> datetime | None:
        if not date_str:
            return None
        for fmt in ("%Y-%m-%dT%H:%M:%S%z", "%m/%d/%Y", "%Y-%m-%d"):
            try:
                dt = datetime.strptime(date_str.strip(), fmt)
                # For tz-aware formats, convert to UTC (don't replace, which drops the offset)
                if dt.tzinfo is not None:
                    return dt.astimezone(timezone.utc)
                # For naive formats, assume UTC
                return dt.replace(tzinfo=timezone.utc)
            except (ValueError, AttributeError):
                continue
        return None

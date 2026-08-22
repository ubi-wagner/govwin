#!/usr/bin/env python3
"""Foundational company documents for the MT-3 tenant-library phase.

A tenant's library is built from the documents the company already has — a capability statement,
past performance, key personnel. These three sets match the three companies that apply through the
public form in MT-2, so the atoms a tenant ends up with are actually ABOUT that company, and a
later cross-tenant leak would be obvious on sight rather than a UUID comparison.

Deliberately distinct vocabularies (concrete printing / survey robotics / cement chemistry) so
semantic retrieval has something real to separate.

Run: python3 scripts/make-company-fixtures.py [outdir]
"""
import sys
from pathlib import Path

import fitz

COMPANIES = {
    "northwind": {
        "name": "Northwind Additive",
        "docs": {
            "capability-statement": [
                "NORTHWIND ADDITIVE — CAPABILITY STATEMENT",
                "",
                "CORE COMPETENCIES",
                "Mobile gantry 3D concrete printing for expeditionary and disaster-recovery",
                "construction. Rapid-cure binder chemistry formulated for field temperatures from",
                "-5 to 45 degrees Celsius. Printed structural forms reach 28-day design strength in",
                "under four hours of cure at ambient conditions.",
                "",
                "DIFFERENTIATORS",
                "Two issued patents on nozzle geometry (US 11,842,331 and US 12,004,918) covering",
                "variable-aperture extrusion that maintains bead consistency across a 40-to-1 flow",
                "range. No competitor prints structural wall sections without formwork at this rate.",
                "",
                "PAST PERFORMANCE",
                "Ohio Third Frontier TVSF Round 43 — printed a 900 square foot barracks shell in",
                "eleven hours at Camp Perry, meeting all ASTM C1314 compression requirements.",
                "Delivered on schedule and 12 percent under the awarded budget.",
                "",
                "FACILITIES",
                "18,000 square foot fabrication and test facility in Dayton, Ohio, including a",
                "climate-controlled cure chamber and a 20-tonne materials handling bay.",
            ],
            "key-personnel": [
                "NORTHWIND ADDITIVE — KEY PERSONNEL",
                "",
                "Dana Reyes, Chief Executive Officer and Principal Investigator",
                "Fifteen years in structural materials, previously lead process engineer for",
                "precast operations at a top-five North American concrete supplier. Holds a PhD in",
                "Civil Engineering from Ohio State. Named inventor on both company patents.",
                "",
                "Marcus Whitfield, Chief Technology Officer",
                "Robotics and controls. Built the gantry motion stack and the closed-loop extrusion",
                "controller. Twelve years in industrial automation, six of them in additive",
                "manufacturing.",
                "",
                "Priya Raghunathan, Materials Lead",
                "Binder chemistry and admixture design. Developed the four-hour cure formulation.",
                "Previously a research chemist at a national laboratory cement program.",
            ],
        },
    },
    "kestrel": {
        "name": "Kestrel Robotics",
        "docs": {
            "capability-statement": [
                "KESTREL ROBOTICS — CAPABILITY STATEMENT",
                "",
                "CORE COMPETENCIES",
                "Autonomous ground robots for progress capture on active construction sites.",
                "Visual-inertial SLAM that holds localization through airborne dust, changing site",
                "geometry and the absence of GPS. Automated comparison of as-built scans against the",
                "design BIM, with deviation reports generated overnight.",
                "",
                "DIFFERENTIATORS",
                "Our loop-closure approach tolerates a site whose geometry changes daily, which",
                "defeats conventional SLAM built on the assumption of a static map. Median drift",
                "under 4 centimetres over a 200 metre traverse on an active site.",
                "",
                "PAST PERFORMANCE",
                "Deployed on eleven commercial construction sites across three states. On a",
                "hospital expansion in Pittsburgh the system identified a 60 millimetre slab",
                "elevation deviation four weeks before it would have been found at inspection.",
                "",
                "FACILITIES",
                "Robotics laboratory and 6,000 square foot indoor test course in Pittsburgh,",
                "Pennsylvania, with a reconfigurable mock construction environment.",
            ],
            "key-personnel": [
                "KESTREL ROBOTICS — KEY PERSONNEL",
                "",
                "Amara Okafor, Chief Technology Officer and Principal Investigator",
                "Perception and state estimation. PhD in Robotics from Carnegie Mellon, thesis on",
                "SLAM in dynamic environments. Eight peer-reviewed publications on visual-inertial",
                "odometry.",
                "",
                "Tomas Lindgren, Chief Executive Officer",
                "Commercial construction technology. Ran field operations for a national general",
                "contractor before founding Kestrel. Owns the customer relationships behind all",
                "eleven current deployments.",
                "",
                "Wei Chen, Software Lead",
                "BIM integration and the deviation-reporting pipeline. Ten years in AEC software.",
            ],
        },
    },
    "calcite": {
        "name": "Calcite Materials",
        "docs": {
            "capability-statement": [
                "CALCITE MATERIALS — CAPABILITY STATEMENT",
                "",
                "CORE COMPETENCIES",
                "Supplementary cementitious materials produced by accelerated carbonation of steel",
                "slag. Replaces up to 40 percent of Portland clinker with no loss of 28-day",
                "compressive strength, cutting embodied carbon by approximately 32 percent per cubic",
                "metre of finished concrete.",
                "",
                "DIFFERENTIATORS",
                "Our carbonation route consumes CO2 rather than merely avoiding it, and runs on slag",
                "that is currently a disposal liability for steel producers. The process operates at",
                "atmospheric pressure, which is what separates it from competing mineralization",
                "approaches that require pressurized reactors.",
                "",
                "PAST PERFORMANCE",
                "DOE SBIR Phase I (DE-SC0024117) — demonstrated 40 percent replacement at bench",
                "scale with ASTM C109 mortar cube strength within 3 percent of the control at 28",
                "days. All Phase I milestones met.",
                "",
                "FACILITIES",
                "Pilot line in Dearborn, Michigan producing two tonnes per day, co-located with a",
                "materials characterization laboratory including XRD and TGA.",
            ],
            "key-personnel": [
                "CALCITE MATERIALS — KEY PERSONNEL",
                "",
                "Rafael Duarte, Founder and Principal Investigator",
                "Cement and concrete chemistry. PhD in Materials Science from Michigan. Nine years",
                "in industrial cement research, including supplementary cementitious material",
                "qualification for a major ready-mix producer.",
                "",
                "Helen Vasquez, Process Engineering Lead",
                "Scale-up and reactor design. Designed and commissioned the two-tonne-per-day pilot",
                "line. Previously in continuous process design for specialty chemicals.",
                "",
                "Samuel Bright, Quality and Standards",
                "ASTM and AASHTO qualification pathways. Twenty years in construction materials",
                "testing and certification.",
            ],
        },
    },
}


def build(text_lines, out: Path) -> Path:
    doc = fitz.open()
    page = doc.new_page(width=612, height=792)
    y = 72.0
    for i, line in enumerate(text_lines):
        if y > 730:
            page = doc.new_page(width=612, height=792)
            y = 72.0
        font = "tibo" if i == 0 or line.isupper() and line.strip() else "tiro"
        page.insert_text((72, y), line, fontname=font, fontsize=11 if i == 0 else 10.5)
        y += 16
    doc.save(out)
    doc.close()
    return out


def main() -> int:
    outdir = Path(sys.argv[1] if len(sys.argv) > 1 else "frontend/e2e/fixtures/companies")
    outdir.mkdir(parents=True, exist_ok=True)
    n = 0
    for slug, spec in COMPANIES.items():
        for name, lines in spec["docs"].items():
            p = build(lines, outdir / f"{slug}-{name}.pdf")
            print(f"  {p}  ({p.stat().st_size:,} bytes)  {spec['name']}")
            n += 1
    print(f"\n{n} company documents written to {outdir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

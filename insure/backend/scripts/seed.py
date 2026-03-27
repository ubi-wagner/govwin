"""
Comprehensive seed script — inserts 3 mock Florida condo properties with
realistic Sunbiz Annual Reports, Financial Audits, and I&E Reports
directly into EntityAsset.extracted_text for offline testing.
"""

import os
import sys

# Allow running from /backend
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from database.models import (
    ActionType,
    Base,
    Contact,
    DocType,
    Entity,
    EntityAsset,
    LeadLedger,
    RegionOfInterest,
    RegionStatus,
)

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://user:password@localhost:5432/insure")

engine = create_engine(DATABASE_URL, pool_pre_ping=True)
Session = sessionmaker(bind=engine)

# ---------------------------------------------------------------------------
# Mock property data
# ---------------------------------------------------------------------------

PROPERTIES = [
    {
        "name": "Sandcastle Towers Condominium Association, Inc.",
        "address": "1600 Gulf Blvd, Clearwater Beach, FL 33767",
        "county": "Pinellas",
        "latitude": 27.9780,
        "longitude": -82.8270,
        "contacts": [
            {"name": "John P. Hartman", "title": "President, Board of Directors"},
            {"name": "Mary L. Vasquez", "title": "Treasurer"},
            {"name": "Robert K. Chen", "title": "Secretary"},
        ],
        "sunbiz": """
STATE OF FLORIDA
DEPARTMENT OF STATE — DIVISION OF CORPORATIONS

2024 ANNUAL REPORT
DOCUMENT NUMBER: N24000012847

Entity Name: SANDCASTLE TOWERS CONDOMINIUM ASSOCIATION, INC.
Current Principal Place of Business: 1600 GULF BLVD, CLEARWATER BEACH, FL 33767
FEI/EIN Number: 59-2847163
Date Filed: 02/15/2024
State: FL   Status: ACTIVE

Registered Agent Name & Address:
  COASTAL MANAGEMENT SERVICES, INC.
  4200 34TH STREET SOUTH, SUITE 200
  ST PETERSBURG, FL 33711

Officer/Director Detail:
  Title: President       Name: HARTMAN, JOHN P.       Address: 1600 GULF BLVD APT 1801, CLEARWATER BEACH, FL 33767
  Title: Treasurer       Name: VASQUEZ, MARY L.       Address: 1600 GULF BLVD APT 904, CLEARWATER BEACH, FL 33767
  Title: Secretary       Name: CHEN, ROBERT K.        Address: 1600 GULF BLVD APT 1205, CLEARWATER BEACH, FL 33767
  Title: Director        Name: JOHNSON, PATRICIA A.   Address: 1600 GULF BLVD APT 610, CLEARWATER BEACH, FL 33767
  Title: Director        Name: WILLIAMS, DAVID M.     Address: 1600 GULF BLVD APT 302, CLEARWATER BEACH, FL 33767
""".strip(),
        "audit": """
SANDCASTLE TOWERS CONDOMINIUM ASSOCIATION, INC.
AUDITED FINANCIAL STATEMENTS
FOR THE YEAR ENDED DECEMBER 31, 2024

Prepared by: Clearwater Bay CPA Group, P.A.

INDEPENDENT AUDITOR'S REPORT

To the Board of Directors
Sandcastle Towers Condominium Association, Inc.
Clearwater Beach, Florida

Opinion
We have audited the accompanying financial statements of Sandcastle Towers
Condominium Association, Inc. (the "Association"), which comprise the balance
sheet as of December 31, 2024, and the related statements of revenues and
expenses, changes in fund balances, and cash flows for the year then ended,
and the related notes to the financial statements.

In our opinion, the financial statements referred to above present fairly, in
all material respects, the financial position of the Association as of
December 31, 2024.

BALANCE SHEET — DECEMBER 31, 2024

ASSETS
  Cash and Cash Equivalents                     $   847,291
  Assessments Receivable                        $    62,450
  Prepaid Insurance                             $   112,500
  Reserve Fund — Money Market                   $ 1,245,000
  Reserve Fund — CD Ladder                      $   780,000
                                                -----------
  Total Assets                                  $ 3,047,241

LIABILITIES AND FUND BALANCES
  Accounts Payable                              $    34,200
  Prepaid Assessments                           $    18,750
  Accrued Expenses                              $    45,100
                                                -----------
  Total Liabilities                             $    98,050
  Operating Fund Balance                        $   704,191
  Reserve Fund Balance                          $ 2,245,000
                                                -----------
  Total Liabilities and Fund Balances           $ 3,047,241

NOTES TO FINANCIAL STATEMENTS

Note 1 — Organization
Sandcastle Towers is a 22-story, 180-unit residential condominium located at
1600 Gulf Blvd, Clearwater Beach, Pinellas County, Florida. The Association
was incorporated in 1998.

Note 4 — Insurance Coverage
The Association maintains the following insurance policies:

  Property Insurance (Wind/Flood):
    Carrier: Citizens Property Insurance Corporation
    Policy Number: CIT-FL-2024-8847201
    Total Insured Value (TIV): $45,000,000
    Deductible: 5% Named Storm / $25,000 AOP
    Annual Premium: $387,000
    Policy Period: 06/01/2024 — 05/31/2025

  General Liability:
    Carrier: Everest National Insurance Company
    Policy Number: GL-4420187
    Limit: $1,000,000 per occurrence / $2,000,000 aggregate
    Annual Premium: $18,200

  Directors & Officers:
    Carrier: Travelers Casualty and Surety Co.
    Policy Number: DO-FL-889247
    Limit: $1,000,000
    Annual Premium: $4,800

  Fidelity Bond:
    Carrier: Hartford Fire Insurance Company
    Limit: $500,000
    Annual Premium: $2,100

Note 5 — Reserve Study
Per the most recent reserve study (dated March 2024), the Association's fully
funded reserve balance should be $3,100,000. The current funded ratio is
approximately 72.4%.
""".strip(),
        "ie": """
SANDCASTLE TOWERS CONDOMINIUM ASSOCIATION, INC.
INCOME & EXPENSE STATEMENT (COMPARATIVE)
FOR THE YEARS ENDED DECEMBER 31, 2024 AND 2023

                                          2024            2023        Variance
                                       ----------     ----------    ----------
REVENUE
  Unit Assessments                     $2,160,000     $1,680,000     $480,000
  Special Assessment — Insurance          450,000              0      450,000
  Late Fees & Interest                     12,400          8,200        4,200
  Rental/Common Area Income                36,000         36,000            0
  Interest Income                          28,750         14,200       14,550
                                       ----------     ----------    ----------
  TOTAL REVENUE                        $2,687,150     $1,738,400     $948,750

OPERATING EXPENSES
  Management Fees                      $  108,000     $  102,000     $  6,000
  Insurance — Property (Wind/Flood)       387,000        142,000      245,000
  Insurance — Liability/D&O/Bond           25,100         22,400        2,700
  Utilities — Electric (Common)            96,000         89,500        6,500
  Utilities — Water/Sewer                 124,800        118,200        6,600
  Elevator Maintenance                     67,200         58,400        8,800
  Landscaping & Grounds                    42,000         42,000            0
  Pool/Recreation Maintenance              28,800         26,400        2,400
  Repairs & Maintenance — General         187,500         94,200       93,300
  Pest Control                             14,400         14,400            0
  Security/Access Control                  36,000         33,600        2,400
  Legal & Accounting                       48,000         32,000       16,000
  Reserves Contribution                   480,000        360,000      120,000
  Painting/Waterproofing Reserve          120,000              0      120,000
  Concrete Restoration Reserve            180,000              0      180,000
                                       ----------     ----------    ----------
  TOTAL EXPENSES                       $1,944,800     $1,135,100     $809,700

NET SURPLUS / (DEFICIT)                $  742,350     $  603,300     $139,050

NOTE: Property insurance premiums increased 172.5% year-over-year due to
Citizens Property Insurance Corporation rate adjustments following the 2023
hurricane season. A special assessment of $2,500 per unit was levied in
Q1 2024 to cover the shortfall. The Board is actively seeking alternative
market quotes for the 06/2025 renewal.
""".strip(),
    },
    {
        "name": "Boca Harbour Villas Condominium Association, Inc.",
        "address": "900 S Ocean Blvd, Boca Raton, FL 33432",
        "county": "Palm Beach",
        "latitude": 26.3420,
        "longitude": -80.0660,
        "contacts": [
            {"name": "Linda S. Morrison", "title": "President, Board of Directors"},
            {"name": "Alan J. Berkowitz", "title": "Treasurer"},
        ],
        "sunbiz": """
STATE OF FLORIDA
DEPARTMENT OF STATE — DIVISION OF CORPORATIONS

2024 ANNUAL REPORT
DOCUMENT NUMBER: N24000034891

Entity Name: BOCA HARBOUR VILLAS CONDOMINIUM ASSOCIATION, INC.
Current Principal Place of Business: 900 S OCEAN BLVD, BOCA RATON, FL 33432
FEI/EIN Number: 65-0412893
Date Filed: 01/28/2024
State: FL   Status: ACTIVE

Registered Agent Name & Address:
  SOUTHEASTERN ASSOCIATION MANAGEMENT
  1200 YAMATO ROAD, SUITE 300
  BOCA RATON, FL 33431

Officer/Director Detail:
  Title: President       Name: MORRISON, LINDA S.      Address: 900 S OCEAN BLVD UNIT PH-A, BOCA RATON, FL 33432
  Title: Treasurer       Name: BERKOWITZ, ALAN J.       Address: 900 S OCEAN BLVD UNIT 1402, BOCA RATON, FL 33432
  Title: Secretary       Name: DELGADO, CARMEN R.       Address: 900 S OCEAN BLVD UNIT 808, BOCA RATON, FL 33432
  Title: Director        Name: PATEL, NISHA K.          Address: 900 S OCEAN BLVD UNIT 501, BOCA RATON, FL 33432
""".strip(),
        "audit": """
BOCA HARBOUR VILLAS CONDOMINIUM ASSOCIATION, INC.
AUDITED FINANCIAL STATEMENTS
FOR THE YEAR ENDED DECEMBER 31, 2024

Prepared by: Gold Coast Accounting Partners, LLP

INDEPENDENT AUDITOR'S REPORT

To the Board of Directors
Boca Harbour Villas Condominium Association, Inc.
Boca Raton, Florida

Opinion
In our opinion, the financial statements present fairly, in all material
respects, the financial position of the Association as of December 31, 2024.

BALANCE SHEET — DECEMBER 31, 2024

ASSETS
  Cash and Cash Equivalents                     $   412,800
  Assessments Receivable                        $    28,100
  Prepaid Insurance                             $    67,000
  Reserve Fund — Money Market                   $   890,000
  Reserve Fund — US Treasury Bills              $   420,000
                                                -----------
  Total Assets                                  $ 1,817,900

LIABILITIES AND FUND BALANCES
  Accounts Payable                              $    22,600
  Prepaid Assessments                           $    11,200
  Deferred Revenue                              $     8,400
                                                -----------
  Total Liabilities                             $    42,200
  Operating Fund Balance                        $   465,700
  Reserve Fund Balance                          $ 1,310,000
                                                -----------
  Total Liabilities and Fund Balances           $ 1,817,900

NOTES TO FINANCIAL STATEMENTS

Note 1 — Organization
Boca Harbour Villas is a 16-story, 120-unit luxury condominium located at
900 S Ocean Blvd, Boca Raton, Palm Beach County, Florida, directly on the
Atlantic Ocean. Originally constructed in 2001.

Note 4 — Insurance Coverage
The Association maintains the following insurance policies:

  Property Insurance (Wind/Flood):
    Carrier: Heritage Insurance Holdings
    Policy Number: HER-FL-2024-5521094
    Total Insured Value (TIV): $32,000,000
    Deductible: 5% Named Storm / $50,000 AOP
    Annual Premium: $298,000
    Policy Period: 09/01/2024 — 08/31/2025

  General Liability:
    Carrier: Zurich American Insurance Company
    Policy Number: GLO-7741290
    Limit: $2,000,000 per occurrence / $5,000,000 aggregate
    Annual Premium: $24,500

  Flood Insurance (NFIP Excess):
    Carrier: Lloyds of London (Syndicate 4020)
    Policy Number: LLF-2024-99201
    Limit: $5,000,000 excess of NFIP
    Annual Premium: $42,000

Note 5 — Reserve Study
Per the structural integrity reserve study (SIRS) completed June 2024, the
Association requires $2,400,000 in fully funded reserves. Current funded
ratio is approximately 54.6%. The Board has approved a phased special
assessment schedule over 36 months.
""".strip(),
        "ie": """
BOCA HARBOUR VILLAS CONDOMINIUM ASSOCIATION, INC.
INCOME & EXPENSE STATEMENT (COMPARATIVE)
FOR THE YEARS ENDED DECEMBER 31, 2024 AND 2023

                                          2024            2023        Variance
                                       ----------     ----------    ----------
REVENUE
  Unit Assessments                     $1,440,000     $1,080,000     $360,000
  Special Assessment — Structural         360,000              0      360,000
  Late Fees & Interest                      8,900          6,100        2,800
  Cabana/Storage Rental                    24,000         24,000            0
  Interest Income                          18,200          9,400        8,800
                                       ----------     ----------    ----------
  TOTAL REVENUE                        $1,851,100     $1,119,500     $731,600

OPERATING EXPENSES
  Management Fees                      $   84,000     $   78,000     $  6,000
  Insurance — Property (Wind/Flood)       298,000        108,000      190,000
  Insurance — Liability/Flood Excess       66,500         52,000       14,500
  Insurance — D&O / Fidelity                6,200          5,800          400
  Utilities — Electric (Common)            68,000         64,200        3,800
  Utilities — Water/Sewer                  92,400         87,000        5,400
  Elevator Maintenance                     48,000         44,000        4,000
  Landscaping & Grounds                    36,000         36,000            0
  Pool/Beach Access Maintenance            32,400         28,800        3,600
  Repairs & Maintenance — General         142,000         78,000       64,000
  Concrete Restoration                    210,000              0      210,000
  Pest Control                             10,800         10,800            0
  Security — 24hr Front Desk              144,000        132,000       12,000
  Legal & Accounting                       62,000         28,000       34,000
  Reserves Contribution                   360,000        240,000      120,000
                                       ----------     ----------    ----------
  TOTAL EXPENSES                       $1,660,300     $  992,600     $667,700

NET SURPLUS / (DEFICIT)                $  190,800     $  126,900     $ 63,900

NOTE: Property insurance premiums increased 175.9% year-over-year. Heritage
Insurance Holdings repriced the coastal corridor following Hurricane Idalia
claims activity. The Board engaged an independent broker to market the
09/2025 renewal and has received indicative quotes from three admitted
carriers ranging from $245,000 to $310,000.
""".strip(),
    },
    {
        "name": "Gulf Breeze Tower Condominium Association, Inc.",
        "address": "2100 N Atlantic Ave, Daytona Beach Shores, FL 32118",
        "county": "Volusia",
        "latitude": 29.1755,
        "longitude": -80.9785,
        "contacts": [
            {"name": "Thomas R. Whitfield", "title": "President, Board of Directors"},
            {"name": "Evelyn M. Santiago", "title": "Treasurer"},
            {"name": "James D. O'Neill", "title": "Secretary"},
        ],
        "sunbiz": """
STATE OF FLORIDA
DEPARTMENT OF STATE — DIVISION OF CORPORATIONS

2024 ANNUAL REPORT
DOCUMENT NUMBER: N24000041267

Entity Name: GULF BREEZE TOWER CONDOMINIUM ASSOCIATION, INC.
Current Principal Place of Business: 2100 N ATLANTIC AVE, DAYTONA BEACH SHORES, FL 32118
FEI/EIN Number: 59-3718204
Date Filed: 03/10/2024
State: FL   Status: ACTIVE

Registered Agent Name & Address:
  FLORIDA FIRST PROPERTY MANAGEMENT, LLC
  800 INTERNATIONAL SPEEDWAY BLVD, SUITE 420
  DAYTONA BEACH, FL 32114

Officer/Director Detail:
  Title: President       Name: WHITFIELD, THOMAS R.     Address: 2100 N ATLANTIC AVE APT 2201, DAYTONA BEACH SHORES, FL 32118
  Title: Treasurer       Name: SANTIAGO, EVELYN M.      Address: 2100 N ATLANTIC AVE APT 1504, DAYTONA BEACH SHORES, FL 32118
  Title: Secretary       Name: O'NEILL, JAMES D.        Address: 2100 N ATLANTIC AVE APT 710, DAYTONA BEACH SHORES, FL 32118
  Title: Director        Name: KUMAR, ANITA S.          Address: 2100 N ATLANTIC AVE APT 1812, DAYTONA BEACH SHORES, FL 32118
  Title: Director        Name: FLETCHER, GERALD W.      Address: 2100 N ATLANTIC AVE APT 403, DAYTONA BEACH SHORES, FL 32118
""".strip(),
        "audit": """
GULF BREEZE TOWER CONDOMINIUM ASSOCIATION, INC.
AUDITED FINANCIAL STATEMENTS
FOR THE YEAR ENDED DECEMBER 31, 2024

Prepared by: Volusia Coast CPAs, P.A.

INDEPENDENT AUDITOR'S REPORT

To the Board of Directors
Gulf Breeze Tower Condominium Association, Inc.
Daytona Beach Shores, Florida

Opinion
In our opinion, the financial statements present fairly, in all material
respects, the financial position of the Association as of December 31, 2024.

BALANCE SHEET — DECEMBER 31, 2024

ASSETS
  Cash and Cash Equivalents                     $   298,400
  Assessments Receivable                        $    41,800
  Prepaid Insurance                             $    89,000
  Reserve Fund — Money Market                   $   520,000
  Reserve Fund — CD                             $   300,000
                                                -----------
  Total Assets                                  $ 1,249,200

LIABILITIES AND FUND BALANCES
  Accounts Payable                              $    19,800
  Prepaid Assessments                           $     9,600
  Line of Credit — Reserve Shortfall            $   200,000
                                                -----------
  Total Liabilities                             $   229,400
  Operating Fund Balance                        $   199,800
  Reserve Fund Balance                          $   820,000
                                                -----------
  Total Liabilities and Fund Balances           $ 1,249,200

NOTES TO FINANCIAL STATEMENTS

Note 1 — Organization
Gulf Breeze Tower is a 24-story, 210-unit residential condominium located at
2100 N Atlantic Ave, Daytona Beach Shores, Volusia County, Florida, directly
on the Atlantic beachfront. Built in 1995, the building has undergone
significant concrete restoration (2018) and window replacement (2022).

Note 4 — Insurance Coverage
The Association maintains the following insurance policies:

  Property Insurance (Wind/Flood):
    Carrier: Citizens Property Insurance Corporation
    Policy Number: CIT-FL-2024-6629401
    Total Insured Value (TIV): $52,000,000
    Deductible: 5% Named Storm ($2,600,000) / $50,000 AOP
    Annual Premium: $468,000
    Policy Period: 04/01/2024 — 03/31/2025

  General Liability:
    Carrier: Scottsdale Insurance Company
    Policy Number: CGL-3301984
    Limit: $1,000,000 per occurrence / $3,000,000 aggregate
    Annual Premium: $21,800

  Umbrella/Excess Liability:
    Carrier: Markel Insurance Company
    Policy Number: UMB-FL-22901
    Limit: $10,000,000
    Annual Premium: $12,400

  Directors & Officers / Fidelity:
    Carrier: Philadelphia Indemnity Insurance Co.
    Policy Number: DOF-FL-447829
    Limit: $2,000,000 D&O / $1,000,000 Fidelity
    Annual Premium: $7,800

Note 5 — Reserve Study & SB 4-D Compliance
Structural Integrity Reserve Study completed January 2024 per Florida SB 4-D.
Required fully funded reserve: $4,200,000. Current funded ratio: 19.5%.
The Association secured a $200,000 line of credit and approved a mandatory
special assessment of $5,000/unit over 24 months beginning July 2024.

Note 6 — Going Concern Consideration
Due to the significant reserve shortfall and the magnitude of the special
assessment required, the auditors note that certain unit owners have
expressed financial hardship. The Association is exploring alternative
financing structures including HUD Section 241 supplemental loans.
""".strip(),
        "ie": """
GULF BREEZE TOWER CONDOMINIUM ASSOCIATION, INC.
INCOME & EXPENSE STATEMENT (COMPARATIVE)
FOR THE YEARS ENDED DECEMBER 31, 2024 AND 2023

                                          2024            2023        Variance
                                       ----------     ----------    ----------
REVENUE
  Unit Assessments                     $2,520,000     $1,512,000    $1,008,000
  Special Assessment — Insurance/Rsv      630,000              0      630,000
  Late Fees & Interest                     18,200         11,400        6,800
  Laundry/Vending Income                    8,400          8,400            0
  Interest Income                          12,800          6,200        6,600
                                       ----------     ----------    ----------
  TOTAL REVENUE                        $3,189,400     $1,538,000   $1,651,400

OPERATING EXPENSES
  Management Fees                      $  126,000     $  114,000     $ 12,000
  Insurance — Property (Wind/Flood)       468,000        180,000      288,000
  Insurance — Liability/Umbrella           34,200         28,400        5,800
  Insurance — D&O / Fidelity                7,800          7,200          600
  Utilities — Electric (Common)           132,000        121,800       10,200
  Utilities — Water/Sewer                 168,000        156,000       12,000
  Elevator Maintenance (3 units)           96,000         84,000       12,000
  Landscaping & Grounds                    48,000         48,000            0
  Pool/Recreation Maintenance              36,000         32,400        3,600
  Repairs & Maintenance — General         228,000        112,000      116,000
  Pest Control                             16,800         16,800            0
  Security/Camera System                   48,000         42,000        6,000
  Fire Safety/Sprinkler Inspection         24,000         18,000        6,000
  Legal & Accounting                       78,000         36,000       42,000
  Line of Credit Interest                  12,000              0       12,000
  Reserves Contribution                   720,000        360,000      360,000
  Concrete/Structural Reserve             240,000              0      240,000
                                       ----------     ----------    ----------
  TOTAL EXPENSES                       $2,482,800     $1,356,600   $1,126,200

NET SURPLUS / (DEFICIT)                $  706,600     $  181,400     $525,200

NOTE: Property insurance premiums increased 160.0% year-over-year. Citizens
Property Insurance Corporation implemented statewide actuarial rate increases
in 2024. The $468,000 annual premium for a $52M TIV represents a rate of
$0.90 per $100 of insured value. The Board is evaluating the Florida
Insurance Guaranty Association (FIGA) market and excess & surplus lines
for the 04/2025 renewal. Additionally, the Association incurred $78,000 in
legal fees related to SB 4-D milestone inspection compliance and reserve
funding disputes with unit owners.
""".strip(),
    },
]


def seed():
    """Insert mock properties, contacts, assets, and ledger events."""
    db = Session()

    try:
        # Create a region for context
        region = RegionOfInterest(
            name="Seed — Florida Coastal Condos",
            bounding_box={"north": 30.0, "south": 26.0, "east": -80.0, "west": -83.0},
            target_county="Multiple",
            parameters={"stories": 10, "coast_distance": 1},
            status=RegionStatus.COMPLETED,
        )
        db.add(region)
        db.flush()

        for prop in PROPERTIES:
            # Entity
            entity = Entity(
                name=prop["name"],
                address=prop["address"],
                county=prop["county"],
                latitude=prop["latitude"],
                longitude=prop["longitude"],
                characteristics={
                    "source": "seed",
                    "region_id": region.id,
                },
            )
            db.add(entity)
            db.flush()

            # HUNT_FOUND ledger event
            db.add(LeadLedger(entity_id=entity.id, action_type=ActionType.HUNT_FOUND))

            # Contacts
            for c in prop["contacts"]:
                db.add(Contact(entity_id=entity.id, name=c["name"], title=c["title"]))

            # Assets — Sunbiz
            db.add(EntityAsset(
                entity_id=entity.id,
                doc_type=DocType.SUNBIZ,
                extracted_text=prop["sunbiz"],
            ))

            # Assets — Audit
            db.add(EntityAsset(
                entity_id=entity.id,
                doc_type=DocType.AUDIT,
                extracted_text=prop["audit"],
            ))

            # Assets — I&E Report
            db.add(EntityAsset(
                entity_id=entity.id,
                doc_type=DocType.IE_REPORT,
                extracted_text=prop["ie"],
            ))

            print(f"  Seeded: {prop['name']} ({prop['county']} County)")

        db.commit()
        print(f"\nSeed complete — {len(PROPERTIES)} properties inserted.")

    except Exception as e:
        db.rollback()
        print(f"Seed error: {e}")
        raise
    finally:
        db.close()


if __name__ == "__main__":
    print("Running seed script...")
    seed()

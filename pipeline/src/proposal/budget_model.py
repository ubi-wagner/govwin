"""
================================================================================
Budget Model — the deterministic budget / PoP-bucket cost-volume fill engine
================================================================================

WHAT:   The exact government cost-volume arithmetic — the burden waterfall
        (Direct Labor → Fringe → Overhead → G&A → Fee/Profit) plus Other Direct
        Costs and Subcontracts — computed PER period-of-performance bucket and
        rolled up to grand totals, with cost-realism flags (ceiling, indirect-rate
        caps, subcontract/partner limit, SBIR/STTR work-share, fee reasonableness).

WHY:    Cost math must be EXACT, not an LLM guess. The tenant-scope `cost_estimator`
        agent is ADVISORY: it maps the solicitation cost constraints + the tenant's
        cost atoms (rates, hours, uploaded collaborator budgets) into this engine's
        typed inputs, calls `compute_budget`, and returns the FILLED model as
        review-staged guidance. The agent never invents burdened numbers — it asks
        this engine, which computes them deterministically. Unknown inputs stay
        placeholders (zero) and surface as flags, never as fabricated dollars.

WATERFALL (matches the frontend cost-volume template
           frontend/lib/templates/dod-sbir-phase1-cost.ts exactly, so the pipeline's
           advisory numbers equal the exported xlsx sheet's formula results):

        A. Direct Labor         = Σ(hours × unburdened_rate)
        B. Fringe               = A × fringe_pct                     (base: direct labor)
        C. Overhead             = (A + B) × overhead_pct             (base: labor + fringe)
        D..G Other Direct Costs = materials + travel + equipment + odc_other
        (F) Subcontracts        = Σ subcontract amounts             (pass-through)
        Total before G&A        = A + B + C + ODC + Subs            (G&A base incl. subs)
        H. G&A                  = (Total before G&A) × gna_pct
        Total Estimated Cost    = (Total before G&A) + H
        I. Fee / Profit         = (Total Est. Cost) × fee_pct
        TOTAL PROPOSED PRICE    = (Total Est. Cost) + I

        The waterfall is fully LINEAR in the dollar bases, so allocating labor/ODC/
        subs across PoP buckets and summing the per-bucket waterfalls yields the
        identical grand total as a single-bucket computation (a tested invariant).

PERIOD OF PERFORMANCE (PoP) bucketing — three shapes (design §3, cost-volume row):
        - pop_by_months(total, bucket)   6/12/18/24-mo → N equal buckets
        - pop_base_plus_option([...])    explicit named base + option periods
        - pop_by_year(n)                 year 1..n

        Each cost line may carry an explicit per-bucket allocation (fractions that
        sum to 1); absent an allocation it is spread evenly. Uploaded collaborator /
        teaming budgets enter as Subcontract pass-through lines.

INVARIANTS:
        - Pure & deterministic: stdlib only, no DB / LLM / network / clock.
        - Full precision internally (Excel-equivalent); round only for display.
        - No side effects; inputs are frozen dataclasses.

CHANGE LOG:
    P4 -- Initial implementation (Proposal Draft Manager · Mode C cost-fill engine).
================================================================================
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

# Cents precision for display rounding. Internal math stays full-precision.
_CENTS = 2

# ODC kinds that roll into the "Other Direct Costs" band (order = display order).
ODC_KINDS = ("materials", "travel", "equipment", "odc_other")

# Default work-share floors (small-business concern share of the research effort).
WORKSHARE_FLOOR = {"sbir": 0.67, "sttr": 0.40}

# Fee/profit is typically reasonable at ≤ this fraction (FAR 15.404 sanity, SBIR/STTR).
FEE_REASONABLE_MAX = 0.10


def round_cents(x: float) -> float:
    """Round to cents for display. Internal math never uses this — only outputs do."""
    return round(float(x), _CENTS)


# ─── Typed inputs (frozen — no accidental mutation) ─────────────────────────────


@dataclass(frozen=True)
class LaborLine:
    """One direct-labor line: a person/category × hours × unburdened hourly rate."""
    name: str
    category: str
    hours: float
    unburdened_rate: float
    # Per-PoP-bucket fractions (sum ≈ 1). None → spread evenly across buckets.
    allocation: Optional[list[float]] = None

    @property
    def direct_labor(self) -> float:
        return self.hours * self.unburdened_rate


@dataclass(frozen=True)
class OtherDirectCost:
    """A non-labor direct cost. `kind` ∈ ODC_KINDS."""
    kind: str
    label: str
    amount: float
    allocation: Optional[list[float]] = None


@dataclass(frozen=True)
class Subcontract:
    """A subcontract / consultant / collaborator pass-through line (uploaded
    collaborator budgets land here). `is_research_institution` marks STTR RI work."""
    org: str
    role: str
    amount: float
    is_research_institution: bool = False
    allocation: Optional[list[float]] = None


@dataclass(frozen=True)
class IndirectRates:
    """Indirect rate schedule (as fractions, e.g. 0.35 == 35%)."""
    fringe_pct: float = 0.0
    overhead_pct: float = 0.0
    gna_pct: float = 0.0
    fee_pct: float = 0.0


@dataclass(frozen=True)
class Period:
    """One PoP bucket: a display name + its length in months (for even-weighting)."""
    name: str
    months: float = 0.0


@dataclass(frozen=True)
class IndirectCaps:
    """Optional solicitation caps on indirect rates (fractions). None → uncapped."""
    fringe_pct: Optional[float] = None
    overhead_pct: Optional[float] = None
    gna_pct: Optional[float] = None


# ─── PoP builders ───────────────────────────────────────────────────────────────


def pop_by_months(total_months: float, bucket_months: float) -> list[Period]:
    """Split a total PoP into equal buckets of `bucket_months` (6/12/18/24…).

    A trailing partial bucket is kept (e.g. 30 months @ 12 → 12,12,6). Raises on
    non-positive inputs so a bad PoP never silently yields zero buckets.
    """
    if total_months <= 0 or bucket_months <= 0:
        raise ValueError("total_months and bucket_months must be positive")
    periods: list[Period] = []
    remaining = float(total_months)
    idx = 1
    while remaining > 1e-9:
        span = min(bucket_months, remaining)
        periods.append(Period(name=f"Period {idx}", months=span))
        remaining -= span
        idx += 1
    return periods


def pop_base_plus_option(periods: list[tuple[str, float]]) -> list[Period]:
    """Explicit named periods, e.g. [("Base", 12), ("Option 1", 12)]."""
    if not periods:
        raise ValueError("at least one period is required")
    return [Period(name=name, months=float(months)) for name, months in periods]


def pop_by_year(n_years: int, months_per_year: float = 12.0) -> list[Period]:
    """Year 1..n annual buckets."""
    if n_years <= 0:
        raise ValueError("n_years must be positive")
    return [Period(name=f"Year {i}", months=months_per_year) for i in range(1, n_years + 1)]


def single_period(name: str = "Total") -> list[Period]:
    """A single all-in bucket (no PoP split)."""
    return [Period(name=name, months=0.0)]


# ─── Allocation helper ──────────────────────────────────────────────────────────


def _weights(periods: list[Period]) -> list[float]:
    """Even-split weights, by months when known else uniform. Sums to 1."""
    n = len(periods)
    total_months = sum(p.months for p in periods)
    if total_months > 0:
        return [p.months / total_months for p in periods]
    return [1.0 / n for _ in periods]


def _alloc_fractions(allocation: Optional[list[float]], periods: list[Period]) -> list[float]:
    """Resolve a line's per-bucket fractions.

    An explicit allocation must have one entry per bucket; it is normalized to sum
    to 1 (defensive — a caller passing raw dollars-per-period still allocates
    proportionally). Absent/empty → even split by the period weights.
    """
    n = len(periods)
    if allocation:
        if len(allocation) != n:
            raise ValueError(f"allocation length {len(allocation)} != period count {n}")
        total = sum(allocation)
        if total <= 0:
            raise ValueError("allocation must sum to a positive value")
        return [a / total for a in allocation]
    return _weights(periods)


# ─── Result shapes ──────────────────────────────────────────────────────────────


@dataclass
class PeriodBreakdown:
    """The full burden waterfall for one PoP bucket (full precision)."""
    name: str
    months: float
    direct_labor: float
    fringe: float
    overhead: float
    materials: float
    travel: float
    equipment: float
    odc_other: float
    subcontracts: float
    total_before_gna: float
    gna: float
    total_est_cost: float
    fee: float
    total_price: float

    @property
    def odc_total(self) -> float:
        return self.materials + self.travel + self.equipment + self.odc_other

    def as_display(self) -> dict:
        """Cents-rounded dict for advisory output / sheet fill."""
        return {
            "name": self.name,
            "months": self.months,
            "direct_labor": round_cents(self.direct_labor),
            "fringe": round_cents(self.fringe),
            "overhead": round_cents(self.overhead),
            "materials": round_cents(self.materials),
            "travel": round_cents(self.travel),
            "equipment": round_cents(self.equipment),
            "odc_other": round_cents(self.odc_other),
            "odc_total": round_cents(self.odc_total),
            "subcontracts": round_cents(self.subcontracts),
            "total_before_gna": round_cents(self.total_before_gna),
            "gna": round_cents(self.gna),
            "total_est_cost": round_cents(self.total_est_cost),
            "fee": round_cents(self.fee),
            "total_price": round_cents(self.total_price),
        }


@dataclass
class RealismFlag:
    """One cost-realism issue, mirroring the agent's advisory flag shape."""
    issue: str
    severity: str  # low | medium | high

    def as_display(self) -> dict:
        return {"issue": self.issue, "severity": self.severity}


@dataclass
class BudgetResult:
    """The computed budget: per-period breakdowns, grand roll-up, work-share, flags."""
    periods: list[PeriodBreakdown]
    grand: PeriodBreakdown
    workshare: dict
    realism_flags: list[RealismFlag]
    rates: IndirectRates

    def as_display(self) -> dict:
        return {
            "periods": [p.as_display() for p in self.periods],
            "grand": self.grand.as_display(),
            "workshare": {k: (round_cents(v) if isinstance(v, float) else v)
                          for k, v in self.workshare.items()},
            "realism_flags": [f.as_display() for f in self.realism_flags],
            "rates": {
                "fringe_pct": self.rates.fringe_pct,
                "overhead_pct": self.rates.overhead_pct,
                "gna_pct": self.rates.gna_pct,
                "fee_pct": self.rates.fee_pct,
            },
        }


# ─── The engine ─────────────────────────────────────────────────────────────────


def _period_waterfall(
    name: str,
    months: float,
    dl: float,
    materials: float,
    travel: float,
    equipment: float,
    odc_other: float,
    subs: float,
    rates: IndirectRates,
) -> PeriodBreakdown:
    """Apply the burden waterfall to one bucket's already-allocated direct dollars."""
    fringe = dl * rates.fringe_pct
    overhead = (dl + fringe) * rates.overhead_pct
    odc_total = materials + travel + equipment + odc_other
    # G&A base includes subcontracts (matches the frontend template's A+B+C+D+E+F+G).
    total_before_gna = dl + fringe + overhead + odc_total + subs
    gna = total_before_gna * rates.gna_pct
    total_est_cost = total_before_gna + gna
    fee = total_est_cost * rates.fee_pct
    total_price = total_est_cost + fee
    return PeriodBreakdown(
        name=name,
        months=months,
        direct_labor=dl,
        fringe=fringe,
        overhead=overhead,
        materials=materials,
        travel=travel,
        equipment=equipment,
        odc_other=odc_other,
        subcontracts=subs,
        total_before_gna=total_before_gna,
        gna=gna,
        total_est_cost=total_est_cost,
        fee=fee,
        total_price=total_price,
    )


def compute_budget(
    labor: list[LaborLine],
    rates: IndirectRates,
    odcs: Optional[list[OtherDirectCost]] = None,
    subs: Optional[list[Subcontract]] = None,
    periods: Optional[list[Period]] = None,
    *,
    ceiling: Optional[float] = None,
    indirect_caps: Optional[IndirectCaps] = None,
    partner_max_pct: Optional[float] = None,
    program: Optional[str] = None,
) -> BudgetResult:
    """Compute the full cost volume: per-PoP-bucket burden waterfall + roll-up + flags.

    Args:
      labor:          direct-labor lines (person × hours × unburdened rate).
      rates:          indirect rate schedule (fringe/overhead/gna/fee).
      odcs:           other direct costs (materials/travel/equipment/odc_other).
      subs:           subcontracts / consultants / uploaded collaborator budgets.
      periods:        PoP buckets (from a pop_* builder). None → single all-in bucket.
      ceiling:        solicitation funding ceiling → high flag if total price exceeds.
      indirect_caps:  optional caps on fringe/overhead/gna rates → flags if exceeded.
      partner_max_pct: max subcontract share of total price → flag if exceeded.
      program:        'sbir' | 'sttr' (case-insensitive) → work-share floor flag.

    Returns a BudgetResult (full precision; call .as_display() for cents-rounded).
    """
    odcs = odcs or []
    subs = subs or []
    periods = periods or single_period()
    n = len(periods)

    for kind in {o.kind for o in odcs}:
        if kind not in ODC_KINDS:
            raise ValueError(f"unknown ODC kind '{kind}'; allowed: {ODC_KINDS}")

    # Pre-resolve each line's per-bucket fractions (validates allocation lengths).
    labor_fracs = [(ln, _alloc_fractions(ln.allocation, periods)) for ln in labor]
    odc_fracs = [(o, _alloc_fractions(o.allocation, periods)) for o in odcs]
    sub_fracs = [(s, _alloc_fractions(s.allocation, periods)) for s in subs]

    breakdowns: list[PeriodBreakdown] = []
    for i, period in enumerate(periods):
        dl = sum(ln.direct_labor * fr[i] for ln, fr in labor_fracs)
        materials = sum(o.amount * fr[i] for o, fr in odc_fracs if o.kind == "materials")
        travel = sum(o.amount * fr[i] for o, fr in odc_fracs if o.kind == "travel")
        equipment = sum(o.amount * fr[i] for o, fr in odc_fracs if o.kind == "equipment")
        odc_other = sum(o.amount * fr[i] for o, fr in odc_fracs if o.kind == "odc_other")
        sub_amt = sum(s.amount * fr[i] for s, fr in sub_fracs)
        breakdowns.append(
            _period_waterfall(
                period.name, period.months, dl,
                materials, travel, equipment, odc_other, sub_amt, rates,
            )
        )

    grand = _grand_total(breakdowns)
    workshare = _workshare(grand, subs)
    flags = _realism_flags(
        grand, rates, subs, workshare,
        ceiling=ceiling, indirect_caps=indirect_caps,
        partner_max_pct=partner_max_pct, program=program,
    )
    return BudgetResult(periods=breakdowns, grand=grand, workshare=workshare,
                        realism_flags=flags, rates=rates)


def _grand_total(breakdowns: list[PeriodBreakdown]) -> PeriodBreakdown:
    """Sum the per-period breakdowns into an all-in grand total."""
    def s(attr: str) -> float:
        return sum(getattr(b, attr) for b in breakdowns)
    return PeriodBreakdown(
        name="Grand Total",
        months=s("months"),
        direct_labor=s("direct_labor"),
        fringe=s("fringe"),
        overhead=s("overhead"),
        materials=s("materials"),
        travel=s("travel"),
        equipment=s("equipment"),
        odc_other=s("odc_other"),
        subcontracts=s("subcontracts"),
        total_before_gna=s("total_before_gna"),
        gna=s("gna"),
        total_est_cost=s("total_est_cost"),
        fee=s("fee"),
        total_price=s("total_price"),
    )


def _workshare(grand: PeriodBreakdown, subs: list[Subcontract]) -> dict:
    """Small-business-concern work share (labor-effort basis, mirroring the template):
    SBC work % = (direct labor + fringe) / (direct labor + fringe + subcontracts).
    Also reports the subcontract share of total price and the STTR RI share."""
    sbc_effort = grand.direct_labor + grand.fringe
    denom = sbc_effort + grand.subcontracts
    sbc_work_pct = (sbc_effort / denom) if denom > 0 else 1.0
    sub_share_of_price = (grand.subcontracts / grand.total_price) if grand.total_price > 0 else 0.0
    ri_amount = sum(s.amount for s in subs if s.is_research_institution)
    ri_share_of_price = (ri_amount / grand.total_price) if grand.total_price > 0 else 0.0
    return {
        "sbc_work_pct": sbc_work_pct,
        "subcontract_share_of_price": sub_share_of_price,
        "research_institution_share_of_price": ri_share_of_price,
    }


def _realism_flags(
    grand: PeriodBreakdown,
    rates: IndirectRates,
    subs: list[Subcontract],
    workshare: dict,
    *,
    ceiling: Optional[float],
    indirect_caps: Optional[IndirectCaps],
    partner_max_pct: Optional[float],
    program: Optional[str],
) -> list[RealismFlag]:
    """Derive cost-realism flags an evaluator would trip on. Never fabricates data —
    only reports on what was computed against the supplied constraints."""
    flags: list[RealismFlag] = []

    # Missing-input placeholders (advisory: the tenant must fill these in).
    if grand.direct_labor <= 0:
        flags.append(RealismFlag("No direct labor provided — labor basis is a placeholder.", "high"))
    if rates.fringe_pct <= 0 and rates.overhead_pct <= 0 and rates.gna_pct <= 0:
        flags.append(RealismFlag("No indirect rates provided — burden is a placeholder.", "high"))

    # Funding ceiling.
    if ceiling is not None and grand.total_price > ceiling + 1e-6:
        over = grand.total_price - ceiling
        flags.append(RealismFlag(
            f"Total proposed price ${round_cents(grand.total_price):,.2f} exceeds the "
            f"funding ceiling ${round_cents(ceiling):,.2f} by ${round_cents(over):,.2f}.",
            "high",
        ))

    # Indirect-rate caps.
    if indirect_caps is not None:
        for label, rate, cap in (
            ("Fringe", rates.fringe_pct, indirect_caps.fringe_pct),
            ("Overhead", rates.overhead_pct, indirect_caps.overhead_pct),
            ("G&A", rates.gna_pct, indirect_caps.gna_pct),
        ):
            if cap is not None and rate > cap + 1e-9:
                flags.append(RealismFlag(
                    f"{label} rate {rate:.1%} exceeds the solicitation cap {cap:.1%}.",
                    "high",
                ))

    # Subcontract / partner share limit.
    if partner_max_pct is not None:
        share = workshare["subcontract_share_of_price"]
        if share > partner_max_pct + 1e-9:
            flags.append(RealismFlag(
                f"Subcontract share {share:.1%} of total price exceeds the partner "
                f"limit {partner_max_pct:.1%}.",
                "high",
            ))

    # Work-share floor (SBIR/STTR).
    prog = (program or "").lower()
    floor = WORKSHARE_FLOOR.get(prog)
    if floor is not None:
        sbc = workshare["sbc_work_pct"]
        if sbc < floor - 1e-9:
            flags.append(RealismFlag(
                f"Small-business work share {sbc:.1%} is below the {prog.upper()} "
                f"floor {floor:.0%}.",
                "high",
            ))
        if prog == "sttr":
            ri = workshare["research_institution_share_of_price"]
            if ri < 0.30 - 1e-9:
                flags.append(RealismFlag(
                    f"Research-institution share {ri:.1%} is below the STTR 30% floor.",
                    "medium",
                ))

    # Fee reasonableness.
    if rates.fee_pct > FEE_REASONABLE_MAX + 1e-9:
        flags.append(RealismFlag(
            f"Fee/profit {rates.fee_pct:.1%} exceeds the typical reasonable ceiling "
            f"{FEE_REASONABLE_MAX:.0%}.",
            "medium",
        ))

    return flags

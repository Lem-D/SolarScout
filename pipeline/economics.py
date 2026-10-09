"""Solar economics.

This module is mirrored by web/src/economics.js. The two MUST produce identical
numbers: tests/test_economics_parity.py runs both over tests/fixtures/economics_cases.json
and fails on any disagreement. Change one, change the other.

Nothing here is stored in roofs.geojson. The frontend recomputes it on every slider
move from the roof's physical fields plus region.json, which is what makes the sliders
instant. See docs/DESIGN.md.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

# Agreed with web/src/economics.js. Payback is reported in years to 2 decimals;
# anything longer than this is reported as "never" rather than a large number.
MAX_PAYBACK_YEARS = 100.0


@dataclass(frozen=True)
class RegionParams:
    """The economic half of region.json."""

    retail_price_per_kwh: float
    export_price_per_kwh: float
    self_consumption_share: float
    installed_cost_per_watt: float
    grid_emissions_kg_per_kwh: float
    panel_kwp_per_m2: float
    degradation_per_year: float
    min_system_kwp: float
    snow_loss_share: float = 0.0
    incentive_total: float = 0.0

    @classmethod
    def from_region(cls, region: dict) -> "RegionParams":
        econ = region.get("economics", region)
        return cls(
            retail_price_per_kwh=float(econ["retail_price_per_kwh"]),
            export_price_per_kwh=float(econ["export_price_per_kwh"]),
            self_consumption_share=float(econ["self_consumption_share"]),
            installed_cost_per_watt=float(econ["installed_cost_per_watt"]),
            grid_emissions_kg_per_kwh=float(econ["grid_emissions_kg_per_kwh"]),
            panel_kwp_per_m2=float(econ["panel_kwp_per_m2"]),
            degradation_per_year=float(econ["degradation_per_year"]),
            min_system_kwp=float(econ["min_system_kwp"]),
            snow_loss_share=float(region.get("solar", {}).get("snow_loss_share", 0.0)),
            incentive_total=float(econ.get("incentive_total", 0.0)),
        )


@dataclass(frozen=True)
class Result:
    kwp: float
    annual_kwh: float
    cost: float
    annual_savings: float
    payback_years: Optional[float]  # None == never pays back
    co2_avoided_kg: float
    viable: bool


def system_size_kwp(usable_area_m2: float, p: RegionParams,
                    cap_kwp: Optional[float] = None) -> float:
    """Default system size from usable area, optionally capped by the UI slider."""
    kwp = usable_area_m2 * p.panel_kwp_per_m2
    if cap_kwp is not None:
        kwp = min(kwp, cap_kwp)
    return kwp


def annual_output_kwh(kwp: float, kwh_per_kwp_year: float, p: RegionParams) -> float:
    """Yearly production, after the snow-loss haircut PVGIS's loss term does not model."""
    return kwp * kwh_per_kwp_year * (1.0 - p.snow_loss_share)


def monthly_output_kwh(kwh_monthly_per_kwp: list[float], kwp: float,
                       p: RegionParams) -> list[float]:
    """Twelve monthly production figures for a system of `kwp`.

    Carries the same snow-loss haircut as annual_output_kwh, applied flat across all
    months. Snow is a winter phenomenon, so the flat share gets the shape wrong even
    though the total is right — a seasonal model needs a sourced snow series that
    region.json does not have yet. Flat at least keeps the monthly chart summing to the
    annual figure shown beside it, and the UI says the haircut is flat.
    """
    scale = kwp * (1.0 - p.snow_loss_share)
    return [m * scale for m in kwh_monthly_per_kwp]


def upfront_cost(kwp: float, p: RegionParams) -> float:
    """Installed cost less any incentives, floored at zero."""
    gross = kwp * 1000.0 * p.installed_cost_per_watt
    return max(0.0, gross - p.incentive_total)


def annual_savings(annual_kwh: float, p: RegionParams) -> float:
    """Self-consumed energy avoids the retail price; the rest earns the export price.

    Where export == retail (Alberta micro-generation), the share cancels out and this
    reduces to annual_kwh * retail_price.
    """
    share = p.self_consumption_share
    return (annual_kwh * share * p.retail_price_per_kwh
            + annual_kwh * (1.0 - share) * p.export_price_per_kwh)


def simple_payback_years(cost: float, savings_year_one: float) -> Optional[float]:
    """cost / savings, ignoring degradation. None when savings are zero or negative."""
    if savings_year_one <= 0:
        return None
    years = cost / savings_year_one
    return None if years > MAX_PAYBACK_YEARS else years


def detailed_payback_years(cost: float, savings_year_one: float,
                           p: RegionParams) -> Optional[float]:
    """Sum degrading yearly savings until they cover the cost.

    Year n produces (1 - degradation)^(n-1) of year one. Interpolates within the
    final year so the result is continuous rather than a step.
    """
    if savings_year_one <= 0:
        return None
    cumulative = 0.0
    for year in range(1, int(MAX_PAYBACK_YEARS) + 1):
        this_year = savings_year_one * (1.0 - p.degradation_per_year) ** (year - 1)
        if cumulative + this_year >= cost:
            shortfall = cost - cumulative
            return (year - 1) + shortfall / this_year
        cumulative += this_year
    return None


def co2_avoided_kg(annual_kwh: float, p: RegionParams) -> float:
    return annual_kwh * p.grid_emissions_kg_per_kwh


def evaluate(usable_area_m2: float, kwh_per_kwp_year: float, p: RegionParams,
             cap_kwp: Optional[float] = None, detailed: bool = False) -> Result:
    """Full economics for one roof. The one entry point the frontend mirrors."""
    kwp = system_size_kwp(usable_area_m2, p, cap_kwp)
    viable = kwp >= p.min_system_kwp
    energy = annual_output_kwh(kwp, kwh_per_kwp_year, p)
    cost = upfront_cost(kwp, p)
    savings = annual_savings(energy, p)
    payback = (detailed_payback_years(cost, savings, p) if detailed
               else simple_payback_years(cost, savings))
    return Result(
        kwp=kwp,
        annual_kwh=energy,
        cost=cost,
        annual_savings=savings,
        payback_years=payback,
        co2_avoided_kg=co2_avoided_kg(energy, p),
        viable=viable,
    )


def payback_band(payback_years: Optional[float], viable: bool,
                 green_max: float = 8.0, yellow_max: float = 15.0) -> str:
    """Map colour band. Mirrored by the data-driven expression in web/src/map.js."""
    if not viable or payback_years is None:
        return "grey"
    if payback_years <= green_max:
        return "green"
    if payback_years <= yellow_max:
        return "yellow"
    return "grey"

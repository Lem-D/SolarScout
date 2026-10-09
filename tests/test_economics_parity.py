"""Parity between pipeline/economics.py and web/src/economics.js.

DESIGN.md puts the same formulas in both languages so the frontend can recompute on
every slider move without a server. That only works if they agree. This test runs both
over the same fixtures and fails on any disagreement.

If this test fails you changed one implementation and not the other. Fix the other one;
do not loosen the tolerance.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from pipeline.economics import (  # noqa: E402
    RegionParams,
    evaluate,
    monthly_output_kwh,
    payback_band,
)

FIXTURES = json.loads((ROOT / "tests" / "fixtures" / "economics_cases.json").read_text())

# Currency and kWh values run to thousands, so compare relatively. This is tight enough
# to catch a reordered formula and loose enough to tolerate float64 associativity.
REL_TOL = 1e-9


def _python_results():
    out = []
    for case in FIXTURES["cases"]:
        params = RegionParams.from_region(FIXTURES["regions"][case["region"]])
        result = evaluate(
            case["usable_area_m2"],
            case["kwh_per_kwp_year"],
            params,
            cap_kwp=case["cap_kwp"],
            detailed=case["detailed"],
        )
        out.append({
            "name": case["name"],
            "kwp": result.kwp,
            "annual_kwh": result.annual_kwh,
            "cost": result.cost,
            "annual_savings": result.annual_savings,
            "payback_years": result.payback_years,
            "co2_avoided_kg": result.co2_avoided_kg,
            "viable": result.viable,
            "band": payback_band(result.payback_years, result.viable),
            "monthly_kwh": monthly_output_kwh(
                FIXTURES["monthly_profile"]["kwh_monthly_per_kwp"], result.kwp, params
            ),
        })
    return out


@pytest.fixture(scope="module")
def js_results():
    node = subprocess.run(
        ["node", str(ROOT / "tests" / "run_economics_js.mjs")],
        capture_output=True, text=True,
    )
    if node.returncode != 0:
        pytest.fail(f"node runner failed:\n{node.stderr}")
    return json.loads(node.stdout)


NUMERIC = ("kwp", "annual_kwh", "cost", "annual_savings", "co2_avoided_kg")


@pytest.mark.parametrize("index", range(len(FIXTURES["cases"])))
def test_parity(index, js_results):
    py = _python_results()[index]
    js = js_results[index]
    assert py["name"] == js["name"], "fixture order drifted between runners"

    for field in NUMERIC:
        assert py[field] == pytest.approx(js[field], rel=REL_TOL), (
            f'{py["name"]}: {field} differs — python {py[field]!r}, js {js[field]!r}'
        )

    # None/null must agree exactly: "never pays back" is a different claim from "pays
    # back in a very long time", and the UI renders them differently.
    if py["payback_years"] is None or js["payback_years"] is None:
        assert py["payback_years"] is None and js["payback_years"] is None, (
            f'{py["name"]}: one implementation says never, the other does not — '
            f'python {py["payback_years"]!r}, js {js["payback_years"]!r}'
        )
    else:
        assert py["payback_years"] == pytest.approx(js["payback_years"], rel=REL_TOL), (
            f'{py["name"]}: payback differs'
        )

    assert py["viable"] == js["viable"], f'{py["name"]}: viability differs'
    assert py["band"] == js["band"], f'{py["name"]}: colour band differs'

    # The monthly chart must sum to the annual figure printed beside it, in both
    # implementations, or the panel contradicts itself.
    assert len(py["monthly_kwh"]) == len(js["monthly_kwh"]) == 12
    for month, (a, b) in enumerate(zip(py["monthly_kwh"], js["monthly_kwh"]), start=1):
        assert a == pytest.approx(b, rel=REL_TOL), (
            f'{py["name"]}: month {month} differs — python {a!r}, js {b!r}'
        )


def test_alberta_share_is_inert():
    """Where export == retail, self_consumption_share must not change savings.

    docs/DATA_SOURCES.md relies on this to justify hiding the self-consumption slider in
    Edmonton. If it ever stops holding, that UI decision is wrong.
    """
    region = json.loads(json.dumps(FIXTURES["regions"]["webber-greens"]))
    base = RegionParams.from_region(region)
    region["economics"]["self_consumption_share"] = 0.1
    altered = RegionParams.from_region(region)
    assert evaluate(70.0, 1109.0, base).annual_savings == pytest.approx(
        evaluate(70.0, 1109.0, altered).annual_savings
    )


def test_split_tariff_share_does_bite():
    """The converse: where export != retail, the share must matter. Guards against the
    share being accidentally dropped from the formula entirely."""
    region = json.loads(json.dumps(FIXTURES["regions"]["split-tariff"]))
    base = RegionParams.from_region(region)
    region["economics"]["self_consumption_share"] = 0.1
    altered = RegionParams.from_region(region)
    assert evaluate(70.0, 1109.0, base).annual_savings != pytest.approx(
        evaluate(70.0, 1109.0, altered).annual_savings
    )

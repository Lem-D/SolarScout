"""Stage 6: annual and monthly yield from PVGIS PVcalc.

PVGIS is rate-limited (CLAUDE.md), so this module never calls it per roof. It calls once
per (location cell, aspect bucket, tilt) at **1 kWp** and the caller scales linearly,
which is exact: PVcalc output is linear in `peakpower`. Responses are cached on disk under
data/<region>/pvgis_cache/, so a rerun costs nothing and a partial run resumes.

Verified 2026-10-08 at Edmonton's latitude: PVcalc returns 200 and auto-selects
PVGIS-NSRDB radiation with ERA5 meteo, 2005-2015, horizon from DEM. See
docs/DATA_SOURCES.md for the orientation sweep this reproduces.
"""

from __future__ import annotations

import json
import time
from pathlib import Path

import requests

# Cell size for grouping roofs. A neighbourhood is ~1 km across and the solar resource
# does not vary measurably over that, so 2 decimal places (~1 km) is plenty; it collapses
# a thousand roofs into a handful of calls.
LOCATION_DECIMALS = 2
# Aspect is bucketed because a 7 deg azimuth difference is worth well under 1 % of yield,
# far less than the orientation heuristic's own error.
ASPECT_BUCKET_DEG = 15
TILT_BUCKET_DEG = 1

REQUEST_SPACING_S = 1.0  # be a good citizen; PVGIS asks for no more than ~30 calls/s
_last_call = 0.0


def cache_key(lat: float, lon: float, aspect_deg: float, tilt_deg: float) -> tuple:
    """The grouping key. Roofs sharing a key share one PVGIS call."""
    return (
        round(lat, LOCATION_DECIMALS),
        round(lon, LOCATION_DECIMALS),
        int(round(aspect_deg / ASPECT_BUCKET_DEG) * ASPECT_BUCKET_DEG),
        int(round(tilt_deg / TILT_BUCKET_DEG) * TILT_BUCKET_DEG),
    )


def _cache_path(cache_dir: Path, key: tuple) -> Path:
    lat, lon, aspect, tilt = key
    return cache_dir / f"{lat}_{lon}_a{aspect}_t{tilt}.json"


def _fetch(cfg: dict, key: tuple) -> dict:
    global _last_call
    lat, lon, aspect, tilt = key
    solar = cfg["solar"]

    elapsed = time.monotonic() - _last_call
    if elapsed < REQUEST_SPACING_S:
        time.sleep(REQUEST_SPACING_S - elapsed)

    resp = requests.get(
        solar["pvgis_endpoint"],
        params={
            "lat": lat,
            "lon": lon,
            "peakpower": 1,          # scale linearly in the caller; never ask per roof
            "loss": solar["loss_pct"],
            "angle": tilt,
            "aspect": aspect,        # PVGIS convention: 0 = south, -90 = east
            "mountingplace": "building",
            "pvtechchoice": "crystSi",
            "outputformat": "json",
        },
        timeout=60,
    )
    _last_call = time.monotonic()
    resp.raise_for_status()
    return resp.json()


def _parse(payload: dict) -> dict:
    """Pull the two numbers we keep out of a PVcalc response.

    Stored per kWp so the browser can scale by any system size the slider allows.
    """
    outputs = payload["outputs"]
    monthly = [round(m["E_m"], 2) for m in outputs["monthly"]["fixed"]]
    if len(monthly) != 12:
        raise ValueError(f"expected 12 monthly values, got {len(monthly)}")
    return {
        "kwh_per_kwp_year": round(outputs["totals"]["fixed"]["E_y"], 2),
        "kwh_monthly_per_kwp": monthly,
        "radiation_db": payload.get("inputs", {}).get("meteo_data", {}).get("radiation_db"),
    }


def yields_for(cfg: dict, keys: set[tuple], cache_dir: Path,
               offline: bool = False) -> dict[tuple, dict]:
    """Resolve every key to a per-kWp yield, fetching only what is not cached.

    With `offline=True` nothing is fetched and missing keys raise, which keeps a rerun
    honest instead of silently filling the map with made-up numbers.
    """
    cache_dir.mkdir(parents=True, exist_ok=True)
    out: dict[tuple, dict] = {}
    fetched = 0

    for key in sorted(keys):
        path = _cache_path(cache_dir, key)
        if path.exists():
            out[key] = _parse(json.loads(path.read_text()))
            continue
        if offline:
            raise RuntimeError(
                f"pvgis: {key} is not cached and --offline was given; "
                f"rerun without --offline to fetch it"
            )
        payload = _fetch(cfg, key)
        path.write_text(json.dumps(payload))
        out[key] = _parse(payload)
        fetched += 1

    print(f"  pvgis: {len(keys)} orientation groups ({fetched} fetched, "
          f"{len(keys) - fetched} cached)")
    return out

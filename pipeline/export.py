"""Stage 8: write the contract between the pipeline and the browser.

Two files per region, both consumed directly by the static site:

- `roofs.geojson` — one feature per roof, **physical and energy facts only**. Cost,
  savings, payback and CO2 are deliberately absent: the browser recomputes them on every
  slider move from these fields plus region.json (CLAUDE.md).
- `region.json` — prices, assumptions, colour bands, sources, attribution. Its nested
  `economics` / `solar` blocks are the shape `RegionParams.from_region` and
  `regionParams()` in web/src/economics.js already read, so the same file drives both
  implementations without a translation layer.

DESIGN.md sketches region.json as one flat object. Keeping the config's nested blocks
instead means the file can be diffed against pipeline/config/<region>.yaml, and means a
price only ever has one spelling.
"""

from __future__ import annotations

import json
from pathlib import Path

from shapely.geometry import mapping

# roofs.geojson coordinate precision. 6 decimal places is ~0.1 m at this latitude, well
# below footprint accuracy, and it roughly halves the file against full float repr.
COORD_DECIMALS = 6


def _round_coords(obj):
    if isinstance(obj, (list, tuple)):
        return [_round_coords(o) for o in obj]
    if isinstance(obj, float):
        return round(obj, COORD_DECIMALS)
    return obj


def roof_feature(roof: dict) -> dict:
    """One GeoJSON feature. Properties are exactly the DESIGN.md data model."""
    return {
        "type": "Feature",
        "id": roof["id"],
        "geometry": {
            "type": roof["geometry"].geom_type,
            "coordinates": _round_coords(mapping(roof["geometry"])["coordinates"]),
        },
        "properties": {
            "id": roof["id"],
            "usable_area_m2": round(roof["usable_area_m2"], 1),
            "kwp": round(roof["kwp"], 2),
            "aspect_deg": round(roof["aspect_deg"], 1),
            "tilt_deg": round(roof["tilt_deg"], 1),
            "tilt_assumed": roof["tilt_assumed"],
            "is_flat": roof["is_flat"],
            "kwh_per_kwp_year": roof["kwh_per_kwp_year"],
            "kwh_monthly_per_kwp": roof["kwh_monthly_per_kwp"],
            "confidence": roof["confidence"],
            "source": roof["source"],
            "footprint_area_m2": round(roof["footprint_area_m2"], 1),
            "building_height_m": roof["building_height_m"],
        },
    }


def write_roofs(roofs: list[dict], out: Path) -> None:
    fc = {
        "type": "FeatureCollection",
        "features": [roof_feature(r) for r in roofs],
    }
    out.write_text(json.dumps(fc, separators=(",", ":")))
    print(f"  export: {len(roofs)} roofs -> {out.name} "
          f"({out.stat().st_size / 1_000_000:.1f} MB)")


def region_payload(cfg: dict, roofs: list[dict], usable_params: dict) -> dict:
    """region.json. Every number the browser uses, and where each one came from."""
    viable = [r for r in roofs
              if r["kwp"] >= cfg["economics"]["min_system_kwp"]]
    return {
        "name": cfg["name"],
        "display_name": cfg["display_name"],
        "centre": cfg["centre"],
        "bbox": cfg["bbox"],
        "economics": cfg["economics"],
        "solar": {
            "loss_pct": cfg["solar"]["loss_pct"],
            "snow_loss_share": cfg["solar"]["snow_loss_share"],
            "assumed_tilt_deg": cfg["solar"]["assumed_tilt_deg"],
            "optimal_tilt_deg": cfg["solar"]["optimal_tilt_deg"],
            "pvgis_endpoint": cfg["solar"]["pvgis_endpoint"],
        },
        "usable_area": usable_params,
        "payback_bands": cfg["payback_bands"],
        "stats": {
            "roofs": len(roofs),
            "viable_roofs": len(viable),
            "total_kwp": round(sum(r["kwp"] for r in roofs), 1),
            "flat_roofs": sum(1 for r in roofs if r["is_flat"]),
            "sam_roofs": sum(1 for r in roofs if r["source"] == "sam"),
        },
        # Which numbers above are guesses. The assumptions page reads this list directly,
        # so an unsourced value cannot quietly look sourced.
        "placeholders": [k for k, v in cfg.get("sources", {}).items() if v is None],
        "sources": cfg.get("sources", {}),
        "attribution": cfg["attribution"],
    }


def write_region(cfg: dict, roofs: list[dict], usable_params: dict, out: Path) -> None:
    out.write_text(json.dumps(region_payload(cfg, roofs, usable_params), indent=2))
    print(f"  export: region.json -> {out.name}")


def copy_to_web(region: str, files: list[Path], web_root: Path) -> None:
    """Mirror the output into web/public/data/<region>/ so Vite serves it."""
    dest = web_root / "public" / "data" / region
    dest.mkdir(parents=True, exist_ok=True)
    for f in files:
        (dest / f.name).write_bytes(f.read_bytes())
    print(f"  export: copied {len(files)} files -> web/public/data/{region}/")

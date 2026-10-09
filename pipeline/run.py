"""Pipeline CLI: python -m pipeline.run --region webber-greens

Runs the stages in order, each reading the previous stage's output from data/<region>/
so any one of them can be rerun on its own. Stages 2 and 3 of DESIGN.md (imagery and SAM
segmentation) are skipped while the Edmonton orthophoto licence is unresolved
(docs/DATA_SOURCES.md); every roof therefore takes the documented setback fallback and
says so in its `source` and `confidence`.

  --offline   use only cached PVGIS responses and fail on a miss, instead of calling out
  --limit N   first N footprints only, for a quick end-to-end check
"""

from __future__ import annotations

import argparse
import hashlib
from pathlib import Path

from . import config, export, footprints, geometry, orientation, pvgis, usable_area

WEB_ROOT = Path(__file__).resolve().parent.parent / "web"


def stable_id(row: dict, poly_wgs84) -> str:
    """Socrata's `:id` when present, else a hash of the rounded centroid.

    The fallback is stable across reruns for unchanged geometry, which is what CLAUDE.md
    requires; it is not stable if the city moves a building, and that is the right
    behaviour — a moved building is a different roof.
    """
    if row.get(":id"):
        return str(row[":id"])
    c = poly_wgs84.centroid
    digest = hashlib.sha1(f"{c.x:.7f},{c.y:.7f}".encode()).hexdigest()
    return f"g{digest[:12]}"


def build_roofs(cfg: dict, rows: list[dict], limit: int | None = None) -> list[dict]:
    """Stages 4 and 5: usable area and orientation, per roof."""
    metric_crs = cfg["metric_crs"]
    solar = cfg["solar"]
    min_area = cfg["footprints"]["min_area_m2"]
    up = usable_area.params(cfg)

    roofs: list[dict] = []
    skipped_small = skipped_bad = 0

    for row in rows[: limit or len(rows)]:
        geom = row.get("the_geom")
        poly = geometry.largest_polygon(geom) if geom else None
        if poly is None or not poly.is_valid:
            skipped_bad += 1
            continue

        poly_m = geometry.to_metric(poly, metric_crs)
        if poly_m.area < min_area:
            skipped_small += 1
            continue

        aspect, tilt, is_flat = orientation.pvgis_aspect(
            poly_m, solar["assumed_tilt_deg"], solar["optimal_tilt_deg"]
        )
        _, usable_m2, source, conf = usable_area.evaluate(poly_m, tilt, is_flat, up)

        height = row.get("building_height")
        roofs.append({
            "id": stable_id(row, poly),
            "geometry": poly,                      # WGS84 footprint, as the map draws it
            "footprint_area_m2": poly_m.area,
            "usable_area_m2": usable_m2,
            "aspect_deg": aspect,
            "tilt_deg": tilt,
            # Always true on this path: no dataset supplies a measured pitch for Edmonton.
            "tilt_assumed": True,
            "is_flat": is_flat,
            "source": source,
            "confidence": conf,
            "building_height_m": round(float(height), 1) if height else None,
        })

    print(f"  roofs: {len(roofs)} kept, {skipped_small} under {min_area} m2, "
          f"{skipped_bad} unusable geometry")
    return roofs


def attach_yields(cfg: dict, roofs: list[dict], data_dir: Path,
                  offline: bool = False) -> None:
    """Stage 6: one PVGIS call per orientation group, scaled per kWp in the browser."""
    for r in roofs:
        c = r["geometry"].centroid
        r["_pvgis_key"] = pvgis.cache_key(c.y, c.x, r["aspect_deg"], r["tilt_deg"])

    keys = {r["_pvgis_key"] for r in roofs}
    yields = pvgis.yields_for(cfg, keys, data_dir / "pvgis_cache", offline=offline)

    panel_kwp_per_m2 = cfg["economics"]["panel_kwp_per_m2"]
    for r in roofs:
        y = yields[r.pop("_pvgis_key")]
        r["kwh_per_kwp_year"] = y["kwh_per_kwp_year"]
        r["kwh_monthly_per_kwp"] = y["kwh_monthly_per_kwp"]
        # Default system size. Physical sizing, not economics: cost, savings, payback and
        # CO2 stay out of roofs.geojson so the sliders need no reload (CLAUDE.md).
        r["kwp"] = r["usable_area_m2"] * panel_kwp_per_m2


def main() -> None:
    ap = argparse.ArgumentParser(prog="python -m pipeline.run")
    ap.add_argument("--region", required=True)
    ap.add_argument("--offline", action="store_true",
                    help="use cached PVGIS responses only; fail on a miss")
    ap.add_argument("--limit", type=int, help="first N footprints only (smoke test)")
    ap.add_argument("--no-web-copy", action="store_true",
                    help="leave output in data/ instead of copying into web/public")
    args = ap.parse_args()

    cfg = config.load(args.region)
    data_dir = config.region_data_dir(args.region)
    print(f"region: {cfg['display_name']}")

    rows = footprints.fetch(cfg, data_dir / "footprints.json")
    roofs = build_roofs(cfg, rows, args.limit)
    if not roofs:
        raise SystemExit("no roofs survived stage 4; check bbox and min_area_m2")

    attach_yields(cfg, roofs, data_dir, offline=args.offline)

    roofs_path = data_dir / "roofs.geojson"
    region_path = data_dir / "region.json"
    export.write_roofs(roofs, roofs_path)
    export.write_region(cfg, roofs, usable_area.params(cfg), region_path)
    if not args.no_web_copy:
        export.copy_to_web(args.region, [roofs_path, region_path], WEB_ROOT)

    viable = sum(1 for r in roofs if r["kwp"] >= cfg["economics"]["min_system_kwp"])
    print(f"done: {len(roofs)} roofs, {viable} viable, "
          f"{sum(r['kwp'] for r in roofs):.0f} kWp total")


if __name__ == "__main__":
    main()

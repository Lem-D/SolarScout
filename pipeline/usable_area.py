"""Stage 4: usable roof area.

The SAM path (DESIGN.md stage 3) is blocked on the Edmonton orthophoto licence question
in docs/DATA_SOURCES.md, so every roof currently takes the documented fallback: the
footprint minus an edge setback. Each roof carries `source = "footprint_setback"` and a
`confidence` so the UI can say so; when masks arrive they fill the same fields.

Three reductions turn a building outline into mountable panel area, and all three are
assumptions rather than measurements:

1. **Setback.** Panels cannot sit on the roof edge. Negative buffer, default 0.5 m.
2. **Face share.** A pitched roof has two faces and only the equator-facing one is worth
   using here, so roughly half the plan area is available. DESIGN.md does not mention
   this; without it every pitched roof is overstated by ~2x, which no slider could fix.
3. **Slope correction.** Plan area understates the sloped surface by 1/cos(tilt), which
   partly offsets (2). At the assumed 22 deg this is +7.9 %.

Flat roofs keep their whole area but lose a row-packing factor instead: panels racked at
the optimal 43 deg shade the row behind them, so a flat roof cannot be paved edge to edge.

Every factor is read from the region config and echoed into region.json, so the
assumptions page can show its value and its reasoning.
"""

from __future__ import annotations

import math

from shapely.geometry.base import BaseGeometry

# Defaults when the region config is silent. Overridable per region under `usable_area:`.
DEFAULTS = {
    "setback_m": 0.5,
    "pitched_face_share": 0.5,
    "flat_row_packing": 0.7,
    "min_usable_area_m2": 8.0,
}


def params(cfg: dict) -> dict:
    """Merge the region's `usable_area` block over the defaults."""
    return {**DEFAULTS, **(cfg.get("usable_area") or {})}


def usable_polygon(poly_metric: BaseGeometry, setback_m: float) -> BaseGeometry:
    """Footprint minus the edge setback, in the metric CRS.

    A negative buffer on a narrow roof can return an empty or multi-part geometry; both
    mean the roof is too small to mount anything once the setback is honoured.
    """
    shrunk = poly_metric.buffer(-setback_m)
    if shrunk.is_empty:
        return shrunk
    if shrunk.geom_type == "MultiPolygon":
        return max(shrunk.geoms, key=lambda g: g.area)
    return shrunk


def mountable_area_m2(plan_area_m2: float, tilt_deg: float, is_flat: bool,
                      p: dict) -> float:
    """Convert setback plan area into panel-mountable surface area."""
    if plan_area_m2 <= 0:
        return 0.0
    if is_flat:
        # Racked rows on a flat roof: the roof stays flat, so no slope correction, but
        # inter-row spacing costs real area.
        return plan_area_m2 * p["flat_row_packing"]
    # One face of a pitched roof, and that face is longer than its plan projection.
    return plan_area_m2 * p["pitched_face_share"] / math.cos(math.radians(tilt_deg))


def confidence(source: str, mask_iou: float | None = None) -> str:
    """Confidence for the UI badge.

    The setback fallback is never better than "medium": the outline is real (LiDAR-derived
    2019 rooflines) but the face share and tilt are guesses. Low is reserved for roofs
    where even the outline is suspect.
    """
    if source == "footprint_setback":
        return "medium"
    if mask_iou is None:
        return "low"
    if mask_iou >= 0.8:
        return "high"
    if mask_iou >= 0.6:
        return "medium"
    return "low"


def evaluate(poly_metric: BaseGeometry, tilt_deg: float, is_flat: bool,
             p: dict) -> tuple[BaseGeometry, float, str, str]:
    """Return (usable polygon in metric CRS, usable area m2, source, confidence)."""
    shrunk = usable_polygon(poly_metric, p["setback_m"])
    area = mountable_area_m2(shrunk.area if not shrunk.is_empty else 0.0,
                             tilt_deg, is_flat, p)
    source = "footprint_setback"
    return shrunk, area, source, confidence(source)

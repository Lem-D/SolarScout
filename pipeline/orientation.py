"""Stage 5: orientation and tilt from footprint geometry.

No roof-plane data exists for Edmonton in the Rooflines layer (one polygon, one height
per building), so orientation is inferred from the minimum rotated rectangle: its long
axis approximates the ridge, and the roof faces point perpendicular to it. The face
toward the equator is the one we use.

This is an assumption, and every roof it touches is flagged `tilt_assumed`.
See docs/DATA_SOURCES.md for what would replace it (the 3D Buildings LiDAR model).
"""

from __future__ import annotations

import math

from shapely.geometry import Polygon

# A roof squarer than this has no meaningful long axis, so the ridge direction is
# arbitrary. Treat it as flat rather than inventing an orientation.
SQUARENESS_FLAT_THRESHOLD = 1.15


def ridge_azimuth_deg(poly: Polygon) -> tuple[float, float]:
    """Return (ridge bearing in degrees clockwise from north, long/short ratio)."""
    rect = poly.minimum_rotated_rectangle
    x, y = rect.exterior.coords.xy
    edges = []
    for i in range(4):
        dx, dy = x[i + 1] - x[i], y[i + 1] - y[i]
        edges.append((math.hypot(dx, dy), dx, dy))
    edges.sort(reverse=True)
    long_len, dx, dy = edges[0]
    short_len = edges[2][0]
    bearing = math.degrees(math.atan2(dx, dy)) % 180.0
    ratio = long_len / short_len if short_len > 0 else 1.0
    return bearing, ratio


def pvgis_aspect(poly: Polygon, assumed_tilt: float, optimal_tilt: float) -> tuple[float, float, bool]:
    """Return (aspect_deg, tilt_deg, is_flat) in the PVGIS convention: 0 = south.

    Roof faces are perpendicular to the ridge; of the two, we take the one pointing
    closest to south.
    """
    bearing, ratio = ridge_azimuth_deg(poly)

    if ratio < SQUARENESS_FLAT_THRESHOLD:
        # Near-square footprint: no usable ridge direction. Treat as flat and use the
        # optimal tilt, which is what a flat-roof racking install would do anyway.
        return 0.0, optimal_tilt, True

    # The two faces point perpendicular to the ridge, 180 deg apart.
    face_a = (bearing + 90.0) % 360.0
    face_b = (bearing + 270.0) % 360.0

    # PVGIS: 0 = south, -90 = east, +90 = west. Convert from compass bearing.
    def to_pvgis(compass: float) -> float:
        a = (compass - 180.0) % 360.0
        return a - 360.0 if a > 180.0 else a

    a, b = to_pvgis(face_a), to_pvgis(face_b)
    aspect = a if abs(a) <= abs(b) else b
    return aspect, assumed_tilt, False

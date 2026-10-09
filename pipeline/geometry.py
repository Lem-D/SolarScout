"""Shared geometry helpers: WGS84 <-> the region's metric CRS.

Every area calculation happens in the metric CRS named by `metric_crs` in the region
config (CLAUDE.md: reproject before any area calculation). Socrata hands us WGS84
multipolygons, so these two functions sit between stage 1 and everything downstream.
"""

from __future__ import annotations

from functools import lru_cache

from pyproj import Transformer
from shapely.geometry import shape
from shapely.geometry.base import BaseGeometry
from shapely.ops import transform

WGS84 = "EPSG:4326"


@lru_cache(maxsize=8)
def _transformer(src: str, dst: str) -> Transformer:
    return Transformer.from_crs(src, dst, always_xy=True)


def to_metric(geom: BaseGeometry, metric_crs: str) -> BaseGeometry:
    return transform(_transformer(WGS84, metric_crs).transform, geom)


def to_wgs84(geom: BaseGeometry, metric_crs: str) -> BaseGeometry:
    return transform(_transformer(metric_crs, WGS84).transform, geom)


def largest_polygon(geojson_geom: dict) -> BaseGeometry | None:
    """Socrata rooflines are MultiPolygons, almost always with one ring.

    Where there is more than one we take the largest part: the others are detached
    structures the city grouped under one record, and a roof is one roof.
    """
    geom = shape(geojson_geom)
    if geom.is_empty:
        return None
    if geom.geom_type == "Polygon":
        return geom
    if geom.geom_type == "MultiPolygon":
        return max(geom.geoms, key=lambda g: g.area)
    return None

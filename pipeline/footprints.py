"""Stage 1: building geometry.

Edmonton publishes Rooflines (jpxi-a9a5), which carries a real area and a LiDAR-derived
building_height per building — strictly better than the Building Footprint layer, whose
`area` column is zero for every row. See docs/DATA_SOURCES.md.
"""

from __future__ import annotations

import json
from pathlib import Path

import requests

SOCRATA_PAGE = 50_000

# Columns we need, plus Socrata's stable row id. `elevation_*` are dropped:
# `building_height` is already their difference.
SELECT = ":id, the_geom, area, building_height, layer"


def fetch(cfg: dict, out: Path) -> list[dict]:
    """Download building polygons inside the region bbox. Cached on disk."""
    if out.exists():
        rows = json.loads(out.read_text())
        print(f"  footprints: {len(rows)} (cached)")
        return rows

    fp = cfg["footprints"]
    west, south, east, north = cfg["bbox"]
    # Socrata within_box takes NW then SE corners, latitude first.
    where = f"within_box(the_geom, {north},{west},{south},{east})"

    url = f"https://{fp['socrata_domain']}/resource/{fp['socrata_id']}.json"
    # `:id` is Socrata's own row identifier and is not returned unless asked for by name.
    # Roof ids must stay stable across reruns (CLAUDE.md), so ask for it; if the portal
    # rejects the system field, fall back to the plain query and let run.py derive an id
    # from geometry instead.
    params = {"$where": where, "$limit": SOCRATA_PAGE, "$select": SELECT}
    resp = requests.get(url, params=params, timeout=120)
    if resp.status_code == 400:
        print("  footprints: portal rejected $select, retrying without it")
        resp = requests.get(url, params={"$where": where, "$limit": SOCRATA_PAGE},
                            timeout=120)
    resp.raise_for_status()
    rows = resp.json()

    out.write_text(json.dumps(rows))
    print(f"  footprints: {len(rows)} fetched from {fp['socrata_id']}")
    return rows

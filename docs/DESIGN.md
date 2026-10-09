# Solar Scout: Design

Solar Scout shows every household in a neighbourhood whether its roof can pay for solar, and how fast. It starts from building footprints and high-resolution imagery, finds the usable roof area, estimates yearly output with PVGIS, and turns that into a payback period on an interactive map.

This document describes the system design. The original concept and research notes live in the project plan; this file is the reference for building and changing the code.

## Goals

- Answer "does solar pay on my roof?" instantly, for every rooftop in an area, with no salesperson involved.
- Show a whole neighbourhood's combined potential so groups can organise bulk buys and financing.
- Keep every number checkable: each formula, assumption and data source is visible in the app.
- Work anywhere footprints, imagery and PVGIS coverage exist, so a new region needs only new data and local prices.

## Non-goals (for now)

- Full 3D shading from LiDAR or elevation models. This is a later milestone.
- Installer-grade quotes or panel layouts.
- Running segmentation in the browser or on demand per request.

## Users

**Homeowner.** Finds their house by address, clicks the roof, and sees usable area, system size, yearly output, cost, savings, payback and CO₂ avoided. Sliders for electricity price and system size update the result live, and a chart shows monthly production.

**Community organiser.** Draws an area over several blocks and sees the number of viable roofs, total capacity, combined investment, collective savings and emissions avoided.

## Architecture

The system is split into an offline pipeline and a static frontend. Heavy work (segmentation, PVGIS calls) happens once per region; the browser only reads precomputed data and redoes the economics arithmetic.

```
            OFFLINE PIPELINE (Python)                          FRONTEND (static site)
┌───────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐      ┌──────────────────────────┐
│ Footprints│→ │ Imagery  │→ │ SAM roof │→ │ Usable   │      │ Mapbox GL JS map         │
│ (Overture/│  │ tiles    │  │ masks    │  │ area     │      │  - roofs coloured by     │
│ MS/Google)│  │ ≤0.5 m   │  │          │  │          │      │    payback               │
└───────────┘  └──────────┘  └──────────┘  └────┬─────┘      │  - roof detail panel     │
                                                │            │  - sliders (live econ.)  │
              ┌──────────┐  ┌──────────┐  ┌─────▼─────┐      │  - draw tool + summary   │
              │ Export   │← │ Economics│← │ Orientation│     │  - monthly chart         │
              │ GeoJSON  │  │ defaults │  │ + PVGIS    │     └────────────▲─────────────┘
              └────┬─────┘  └──────────┘  └───────────┘                   │
                   └───────────── data/<region>/roofs.geojson ────────────┘
```

### Repository layout

```
solar-scout/
├── pipeline/                  Python package, run offline per region
│   ├── config/<region>.yaml   bbox, imagery source, prices, emissions factor
│   ├── config.py              region config loading
│   ├── geometry.py            WGS84 <-> metric CRS, multipolygon handling
│   ├── footprints.py          download building polygons (Socrata) -> footprints.json
│   ├── imagery.py             NOT BUILT — blocked on the orthophoto licence
│   ├── segment.py             NOT BUILT — blocked on the orthophoto licence
│   ├── usable_area.py         setback, face share, slope correction, area in m²
│   ├── orientation.py         azimuth and tilt from footprint geometry
│   ├── pvgis.py               PVcalc client with on-disk cache
│   ├── economics.py           cost, savings, payback, CO₂ (mirrors frontend)
│   ├── export.py              writes roofs.geojson and region.json
│   └── run.py                 CLI: python -m pipeline.run --region <name>
├── web/                       Vite + vanilla JS (or React later)
│   ├── src/map.js             MapLibre setup, roof layer, payback colouring
│   ├── src/panel.js           roof detail panel and per-roof size slider
│   ├── src/chart.js           monthly production chart (Chart.js)
│   ├── src/draw.js            area selection and aggregation (Turf.js)
│   ├── src/assumptions.js     the assumptions page, built from region.json
│   ├── src/format.js          number, currency and compass formatting
│   ├── src/economics.js       same formulas as pipeline/economics.py
│   └── public/data/<region>/  copied pipeline output
├── data/                      raw and intermediate files (git-ignored)
├── tests/                     pipeline unit tests, economics parity tests
└── docs/                      DESIGN.md, ROADMAP.md, DATA_SOURCES.md
```

## Pipeline stages

Each stage reads the previous stage's output from `data/<region>/` and writes its own, so stages can be rerun independently.

1. **Footprints.** Download building polygons for the region bounding box from Overture Maps (preferred, merged), Microsoft or Google Open Buildings. Drop polygons under ~20 m² and reproject to a local metric CRS for area calculations. Output: `footprints.json`. (Not parquet: the pipeline has no geopandas dependency, and the raw Socrata response is the most faithful thing to cache.)
2. **Imagery.** Use 0.5 m or finer orthophotos, ideally municipal open data whose licence allows model use. Mapbox satellite tiles are for display only. Output: GeoTIFF tiles covering the bbox.
3. **Segmentation.** Prompt SAM with each footprint's bounding box (plus a small buffer) to get a mask aligned to the visible roof. Use samgeo for map-to-pixel conversion and MobileSAM or FastSAM on CPU, or full SAM on a GPU. Score each mask by IoU with its footprint; masks below a threshold are rejected. Output: `roof_masks.parquet` with a `mask_iou` column.
4. **Usable area.** Starting from the mask (or the footprint when the mask is rejected), subtract detected obstructions (chimneys, vents, HVAC, skylights, dark shaded regions) and apply an edge setback (default 0.5 m). Output: usable polygon and `usable_area_m2`.

   Three reductions turn a building outline into mountable panel area, all of them
   assumptions and all configurable under `usable_area:` in the region config:
   the **setback** (0.5 m), a **pitched face share** (0.5 — a pitched roof has two faces
   and only the equator-facing one is used; without this every pitched roof is overstated
   by ~2x) and a **slope correction** (`1/cos(tilt)`, +7.9 % at 22°). Flat roofs skip the
   last two and take a **row-packing factor** (0.7) instead, because rows racked at the
   optimal tilt shade the row behind them. Obstruction removal is not implemented, so
   `usable_area_m2` is an upper bound and the UI says so.
5. **Orientation and tilt.** Take the footprint's minimum rotated rectangle; its long axis approximates the ridge. Roof faces point perpendicular to it, and the face toward the equator is used. Pitched roofs get an assumed 25–30° tilt; flat roofs get the PVGIS optimal tilt. Output: `aspect_deg` (PVGIS convention, 0 = south) and `tilt_deg`.
6. **Energy (PVGIS).** Call `PVcalc` with lat, lon, `peakpower`, `aspect`, `angle`, and `loss=14`. Cache responses on disk keyed by rounded lat/lon, aspect bucket and tilt so reruns are free and rate limits are respected. Because output scales linearly with kWp, call once per unique (location cell, aspect, tilt) at 1 kWp and scale. Output: annual and monthly kWh.
7. **Economics.** Compute defaults with the formulas below and the region config.
8. **Export.** Write `roofs.geojson` (one feature per roof) and `region.json` (prices, assumptions, sources, attribution).

## Data model

### `roofs.geojson` feature properties

| Property | Type | Meaning |
| --- | --- | --- |
| `id` | string | Stable roof id (source footprint id) |
| `usable_area_m2` | number | Usable roof area after obstructions and setback |
| `kwp` | number | Default system size |
| `aspect_deg` | number | Azimuth, 0 = south, −90 = east, 90 = west |
| `tilt_deg` | number | Panel tilt used |
| `tilt_assumed` | boolean | True when tilt is an assumption, not measured |
| `kwh_per_kwp_year` | number | Specific yield from PVGIS |
| `kwh_monthly_per_kwp` | number[12] | Monthly specific yield |
| `confidence` | `"high"` \| `"medium"` \| `"low"` | From mask IoU and fallback use |
| `source` | `"sam"` \| `"footprint_setback"` | How usable area was derived |
| `is_flat` | boolean | Outline too square to infer a ridge; racked at optimal tilt |
| `footprint_area_m2` | number | Building outline area, before any reduction |
| `building_height_m` | number \| null | LiDAR-derived, for later inter-building shading |

Feature geometry is the **building outline**, not the usable polygon: it is what the user
sees on the imagery and what they click. Carrying a second geometry per roof would roughly
double the file for a line the panel can already describe in words.

Cost, savings, payback and CO₂ are not stored; the frontend computes them from these fields and `region.json` so sliders work without reloading data.

### `region.json`

Written with the config's **nested blocks**, not flattened: `RegionParams.from_region`
and `regionParams()` read this shape directly, the file diffs against
`pipeline/config/<region>.yaml`, and a price has only one spelling.

```json
{
  "name": "example-region",
  "display_name": "Example Region",
  "centre": [lon, lat],
  "bbox": [w, s, e, n],
  "economics": {
    "currency": "USD",
    "retail_price_per_kwh": 0.25,
    "export_price_per_kwh": 0.08,
    "installed_cost_per_watt": 1.10,
    "self_consumption_share": 0.6,
    "grid_emissions_kg_per_kwh": 0.45,
    "panel_kwp_per_m2": 0.2,
    "degradation_per_year": 0.005,
    "min_system_kwp": 1.5
  },
  "solar": { "loss_pct": 14, "snow_loss_share": 0.04, "assumed_tilt_deg": 22 },
  "usable_area": { "setback_m": 0.5, "pitched_face_share": 0.5, "flat_row_packing": 0.7 },
  "payback_bands": { "green_max_years": 8, "yellow_max_years": 15 },
  "stats": { "roofs": 1129, "viable_roofs": 1129, "flat_roofs": 201 },
  "placeholders": ["retail_price_per_kwh", "…"],
  "sources": { "retail_price_per_kwh": "https://…" },
  "attribution": "Building footprints © Microsoft / Google, ODbL"
}
```

`placeholders` lists every key whose `sources` entry is null. The assumptions page reads
it directly, so an unsourced value cannot quietly look sourced.

## Economics model

Implemented identically in `pipeline/economics.py` and `web/src/economics.js`; a parity test runs both on the same fixtures.

- **System size:** `kWp = usable_area_m2 × panel_kwp_per_m2` (default 0.2 kWp/m²), capped by the slider.
- **Annual output:** `E = kWp × kwh_per_kwp_year`.
- **Upfront cost:** `C = kWp × 1000 × installed_cost_per_watt`.
- **Yearly savings:** `S = E × share × retail_price + E × (1 − share) × export_price`.
- **Payback:** simple `C / S`; the detailed version sums yearly savings with 0.5 %/yr degradation until they exceed C.
- **CO₂ avoided:** `E × grid_emissions_kg_per_kwh`.

Payback colour bands (configurable per region): green ≤ 8 years, yellow 8–15 years, grey > 15 years or usable area too small for a minimum system (default 1.5 kWp).

## Frontend

- **Map.** **MapLibre GL JS** (not Mapbox GL JS — see below) over a satellite basemap, with
  a fill layer for roofs coloured by a data-driven expression on payback computed
  client-side. The opening view is plain imagery and the roofs fade in. The roof source and
  layers are declared in the **initial style** rather than added on a `load` event, so
  nothing depends on the map's load lifecycle.
- **Search.** Mapbox Geocoding flies to an address and highlights the nearest roof.
  **Not built yet** — it needs a Mapbox token, which the app no longer requires.
- **Roof panel.** Shows the usable polygon outline, the stats above, a confidence badge, assumption notes and a monthly production chart (Chart.js). Sliders for electricity price and system size recompute everything in the browser.
- **Area tool.** mapbox-gl-draw rectangle or polygon; Turf.js selects roofs inside and sums viable count, kWp, cost, savings, kWh and CO₂.
- **Assumptions page.** Lists every formula, default value and source from `region.json`, plus data attribution.

Global settings (price, self-consumption share) change all roof colours at once; per-roof system size changes only that roof. A global change recomputes every roof and pushes the whole FeatureCollection back through `setData`; 1129 features repaint in a few milliseconds.

### Why MapLibre and not Mapbox GL JS

mapbox-gl v3 requires a Mapbox access token, and the satellite style is a `mapbox://` URL,
so the app could not run at all for anyone without a Mapbox account. MapLibre GL JS is an
API-compatible open fork with no such requirement: the default basemap is Esri World
Imagery, and setting `VITE_MAPBOX_TOKEN` switches the basemap to Mapbox satellite through
the raster tiles API. Both basemaps are display-only — neither licence covers model input.
`@mapbox/mapbox-gl-draw` works against MapLibre once its control class names are pointed at
MapLibre's (`web/src/draw.js`).

## Accuracy and validation

- Compare a sample of roofs against Google's Solar API or real installer quotes and report the gap in the docs.
- Track mask quality: share of roofs on the SAM path vs the setback fallback, and IoU distribution.
- State assumptions in the UI: tilt, self-consumption share, and the lack of 3D shading.

## Risks and fallbacks

| Risk | Fallback |
| --- | --- |
| Poor SAM masks on some roofs | Footprint minus setback, flagged low confidence |
| No GPU | MobileSAM or FastSAM on CPU, or a cloud GPU for batch runs |
| PVGIS rate limits or downtime | Cache, and one call per orientation group scaled by kWp |
| Footprints offset from imagery | SAM box prompts snap to the visible roof; drop persistent failures |
| Imagery licence forbids model use | Switch to municipal open orthophotos |

## Roadmap

1. ~~**Map demo.** Real footprints with placeholder numbers, coloured roofs, roof panel, sliders and area tool.~~ **Done.** 1129 real Webber Greens roofs end to end.
2. ~~**Real numbers.** Setback-based usable area, orientation, cached PVGIS, local prices in `region.json`.~~ **Done for the physics; the prices are still placeholders** — every Alberta price and the emissions factor need a primary source before this is shown to anyone (docs/DATA_SOURCES.md).
3. **Segmentation.** SAM masks, obstruction removal, confidence scores. **Blocked** on the Edmonton orthophoto licence, not on anything technical.
4. **Validation.** Accuracy comparison, deployment. (The assumptions page is built.)
5. **Extensions.** Address search, elevation or LiDAR shading, inter-building shading from `building_height_m`, battery toggle for unreliable grids, financing view (loan payment vs savings), shareable roof links, more regions.

## Open questions

- ~~Which region is first?~~ Webber Greens, Edmonton.
- Vanilla JS or React for the frontend once the panel grows? Still vanilla; `panel.js` is
  the file that will decide it.
- Hosting for larger regions: one GeoJSON file or vector tiles (PMTiles)? One file is
  comfortable at this size — 1129 roofs is 0.8 MB — so the question is open only for a
  region an order of magnitude bigger.
- **Near-square roofs are treated as flat and given the optimal tilt**, which is the most
  favourable assumption in the model, and 201 of 1129 roofs (18 %) take that path. In a
  1990s detached-housing neighbourhood most of them are far more likely to be hipped roofs
  whose ridge direction simply cannot be read from the outline. Either raise
  `SQUARENESS_FLAT_THRESHOLD`, or give ambiguous roofs a pitched penalty rather than the
  optimum. Currently flagged in the UI rather than decided.

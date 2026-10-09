# Data Sources

Provenance for every input Solar Scout uses, per region, plus what was verified and when.
`DESIGN.md` describes how the data is used; this file records where it comes from and what
is wrong with it.

Everything below was checked on **2026-10-08** against live endpoints unless marked otherwise.

## Region: Webber Greens, Edmonton, Alberta

First build region. West-end Edmonton, bounded by Anthony Henday Drive (east) and Winterburn
Road (west). Chosen because it is mostly 1990s–2000s detached housing on curvilinear streets:
varied roof azimuths (which exercise `orientation.py` in a way a street grid would not), large
simple roofs, light tree canopy, and close enough to ground-truth by eye.

| | |
| --- | --- |
| Neighbourhood id | 4740 |
| bbox (WGS84) | `[-113.689033, 53.526687, -113.664357, 53.533931]` |
| Extent | 1634 m E–W × 801 m N–S, ~1.3 km² |
| Buildings | 1196 (rooflines), 1102 (footprints) |
| Centre | `[-113.676695, 53.530309]`, elevation 683 m |

Boundary from **Neighbourhood Boundaries : 2019**, Socrata id `xu6q-xcmj` on data.edmonton.ca.
Note the portal truncates column names to 10 characters: the name field is `descriptiv`, not
`descriptive_name`.

### Building geometry

Two candidate datasets. **Use Rooflines.**

**`jpxi-a9a5` — City of Edmonton Rooflines (as of 2019)** — 384,228 features city-wide, 1196
in Webber Greens. Columns: `the_geom`, `area`, `building_height`, `elevation_rooftop`,
`elevation_ground`, `layer`.

- `area` is populated and sane: median 139 m² in Webber Greens.
- `building_height` = rooftop − ground, median 8.2 m locally. LiDAR-derived (see 3D Buildings).
- One single-ring polygon per building, median 9 vertices. **These are building outlines with
  one height each, not roof planes.** There is no per-plane tilt or azimuth in this dataset,
  so the `DESIGN.md` approach of inferring orientation from the minimum rotated rectangle still
  stands.
- `layer` has two values, `Building` (1008) and `Building_2019` (188). They are **not**
  duplicate vintages of the same buildings — nearest-neighbour distance between the two sets is
  median 41.7 m with 0 of 400 sampled pairs within 3 m. They are complementary; use both, no
  dedup needed.

**`6n9r-ddf8` — Building Footprint** — 365,822 features, 1102 in Webber Greens. **Its `area`
column is zero for every row.** Compute area from geometry instead, or just use Rooflines,
which has both a real area and a height. No reason to prefer this dataset.

### Orthophotos

**Orthophoto Repository 2024**, Socrata `5j7q-2n5f`, with 2023/2020/2017/2015 also published
(useful later for change detection). **7.5 cm** colour, which is 6× finer than the ≤0.5 m
`DESIGN.md` asks for.

- Delivered as individual GeoTIFFs of ~286 MB via Google Drive links, plus a city-wide ECW of
  ~32 GB. Take one or two tiles over the bbox, never the city.
- **Licence is listed only as "See Terms of Use", not a named open licence.** This is risk #6
  in `DESIGN.md` (imagery licence forbids model use) and is *unresolved*. Read the data.edmonton.ca
  Terms of Use before feeding these tiles to SAM. Until that is confirmed, the segmentation
  milestone is blocked on a licence question, not a technical one.

### LiDAR / 3D

**`78sz-qcfr` — 3D Buildings.** A 225 MB `3dBuildings.gdb.zip` (ESRI File Geodatabase,
coordinate system 3TM114-83), described as "based on the 2019 building outlines
(`jpxi-a9a5`) and **2019 LiDAR data**". Static, 2019 only, not updated.

So Edmonton LiDAR products *do* exist, contrary to what GeoDiscover Alberta suggests — the
province's open LiDAR areas (Beaver Hills, Fort McMurray, Fox Creek, RMH Sylvan, Taber,
Utikuma Lake) exclude Edmonton, but the City published its own derived model.

**Not yet inspected.** If it turns out to be LoD2 with individual roof planes, it supplies real
per-plane tilt and azimuth and makes the `tilt_assumed` flag unnecessary for pre-2019 buildings
— a large accuracy win that would reorder the roadmap. Needs GDAL/fiona to read. Worth a look
before investing in orientation heuristics.

Separately, `building_height` on every roofline enables **inter-building shading** (a tall
building south of a short one) without any point cloud. That is a cheap partial answer to the
"no 3D shading" non-goal in `DESIGN.md`.

### Energy — PVGIS

**Verified working at Edmonton's latitude.** `PVcalc` at 53.52 N, −113.65 W returns HTTP 200
and auto-selects `PVGIS-NSRDB` (radiation), `ERA5` (meteo), 2005–2015, with horizon from
DEM. No fallback or alternative API needed; `pipeline/pvgis.py` stands as designed.

Orientation sweep at the Webber Greens centre, 1 kWp, `loss=14`:

| Orientation | kWh/kWp/yr | vs optimal |
| --- | --- | --- |
| Optimal (43° tilt, −4° azimuth) | 1174 | 100 % |
| South, 45° | 1173 | 100 % |
| South, 22° (5/12 pitch) | 1109 | 94 % |
| Flat, 0° | 916 | 78 % |
| East, 22° | 913 | 78 % |
| West, 22° | 885 | 75 % |

Two things follow. Edmonton's resource is genuinely good — ~1174 kWh/kWp/yr at optimal beats
much of Germany, on clear cold winters and long summer days. And the east/west penalty is
~20–25 %, which is a wide enough spread to make the map's colouring meaningful.

Typical Edmonton residential pitch is 4/12 to 6/12 (18–27°), comfortably below the 43° optimum
but only ~6 % off it. **Use 22° as the assumed pitched-roof tilt**, not the 25–30° in
`DESIGN.md`.

Monthly shape at south/45° is strongly peaked: 147 kWh in July against 40 kWh in December, a
3.7:1 ratio — and that is *before* snow.

### Snow

`DESIGN.md`'s `loss=14` does not model snow cover, and Edmonton has weeks of it. Without an
explicit snow-loss term the winter months overstate output, which the "every number checkable"
principle will not survive. Added as `snow_loss_share` in `region.json`; the current value is
a **placeholder**, not a sourced figure. Steep tilt sheds snow, which is a further argument for
assuming the steeper end of the local pitch range.

### Economics — Alberta specifics

Alberta's **Micro-Generation Regulation** (AR 27/2008, administered by the AUC) credits systems
under 150 kW at the **full retail rate** — the same rate the household pays to import.

This changes the model:

- **`self_consumption_share` is inert here.** When `export_price == retail_price`,
  `S = E × retail_price` regardless of the share. The self-consumption slider specified in
  `DESIGN.md` will visibly do nothing in Edmonton. Keep the field (other regions need it) but
  do not build UI affordance around it for this region.
- **Seasonal rate-switching breaks the single-price model.** Several Alberta retailers offer
  "Solar Club"-style plans with a high summer export rate and a low winter import rate
  (figures around 35 ¢/kWh and 8.4 ¢/kWh have been quoted). Combined with the 3.7:1 summer/winter
  production ratio above, this would *dominate* payback and cannot be expressed as one flat
  `retail_price_per_kwh`. **Open question** — either model two seasonal rates or document a
  blended-rate simplification. Do not decide this silently.
- Alberta's grid is carbon-intensive by Canadian standards, so CO₂ avoided per kWh is high
  relative to BC or Quebec. The coal phase-out completed in 2024 has moved this number a lot
  and recently; the current default is a placeholder pending a dated source.
- **`DESIGN.md` has no incentives field**, and the federal Greener Homes Loan plus any live
  Alberta/Edmonton rebates move payback more than most of the sliders will. Added as
  `incentives` in `region.json`.

> ⚠️ **None of the Alberta price, rate or emissions figures are sourced yet.** They came from
> installer and retailer blogs during scoping, not from AUC rate schedules or NRCan factors, and
> every one is currently a placeholder in `region.json`. Before the map is shown to anyone,
> replace them with primary sources and cite each in `region.json.sources`. The "every number
> checkable" goal means a wrong-but-cited number is recoverable and an uncited one is not.

## Verification log

| Date | Checked | Result |
| --- | --- | --- |
| 2026-10-08 | PVGIS `PVcalc` at Edmonton | 200, PVGIS-NSRDB, works |
| 2026-10-08 | Rooflines `jpxi-a9a5` bbox query | 1196 features, areas and heights sane |
| 2026-10-08 | Footprints `6n9r-ddf8` bbox query | 1102 features, `area` column all zero |
| 2026-10-08 | Neighbourhood boundary `xu6q-xcmj` | Webber Greens polygon, 44 vertices |
| 2026-10-08 | Orthophoto 2024 `5j7q-2n5f` | 7.5 cm, licence "See Terms of Use" — **unresolved** |
| 2026-10-08 | 3D Buildings `78sz-qcfr` | 225 MB gdb, LiDAR-derived — **not inspected** |
| 2026-10-08 | Full pipeline run, Webber Greens | 1196 rooflines fetched, 1129 roofs after the 20 m² filter (66 too small, 1 unusable geometry); 42 PVGIS orientation groups; `roofs.geojson` 0.8 MB |
| 2026-10-08 | PVGIS yields across the region | 886–1174 kWh/kWp/yr. Pitched roofs mean 967, roofs treated as flat 1130 |
| 2026-10-08 | Socrata `:id` on `jpxi-a9a5` | Returned when named in `$select`; used as the stable roof id |

## Open accuracy concerns

**201 of 1129 roofs (18 %) are classified flat** by `orientation.py`, because their outline
is squarer than `SQUARENESS_FLAT_THRESHOLD` (1.15) and no ridge direction can be read from
it. Those roofs are then given the *optimal* tilt, which is the most favourable assumption
in the whole model: they average 1130 kWh/kWp/yr against 967 for the pitched ones, and they
are the only roofs that reach the green payback band at the default price. In a 1990s
detached-housing neighbourhood most of them are hipped roofs, not flat ones. This is
flagged in the UI and listed as an open question in `DESIGN.md`; it has not been decided.

**`usable_area_m2` is an upper bound.** Obstruction removal (stage 4 of `DESIGN.md`) is not
implemented, because it depends on the blocked segmentation stage. Median usable area here
is 63 m², i.e. a 12.6 kWp default system — larger than a typical Edmonton residential
install, which is what you would expect from a roof-sized rather than bill-sized system
with no chimneys or vents subtracted.

# Solar Scout

An interactive satellite map that shows whether each rooftop in a neighbourhood can pay
for solar, and how fast. Building footprints + roof geometry + PVGIS yields + local
prices, rendered with MapLibre GL JS.

First region: **Webber Greens, Edmonton** — 1129 roofs.

> ⚠️ Every Alberta price and the grid emissions factor are **unsourced placeholders**.
> The shape of the answer is meaningful; the dollar figures are not, until they are
> replaced with primary sources. See `docs/DATA_SOURCES.md`.

## Run it

```bash
# 1. Pipeline (Python 3.12). Writes data/<region>/ and copies into web/public/data/.
python3 -m venv .venv && ./.venv/bin/pip install pyyaml requests shapely pyproj pytest
./.venv/bin/python -m pipeline.run --region webber-greens

# 2. Frontend
cd web && npm install && npm run dev
```

The pipeline caches the Socrata download and every PVGIS response on disk, so a second run
costs no network. `--offline` fails rather than fetching, `--limit N` runs a quick slice.

No Mapbox account is needed: the basemap falls back to Esri World Imagery. Set
`VITE_MAPBOX_TOKEN` in `web/.env.local` (see `web/.env.example`) for Mapbox satellite
instead. Both are display-only — neither licence permits use as model input.

## Tests

```bash
./.venv/bin/pytest
```

The suite is mostly the parity test: `pipeline/economics.py` and `web/src/economics.js`
implement the same formulas, and the test runs both over the same fixtures. Change one,
change the other.

## Docs

- `docs/DESIGN.md` — architecture, pipeline stages, data model, formulas, roadmap.
- `docs/DATA_SOURCES.md` — where every input comes from, and what is wrong with it.

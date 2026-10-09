# Solar Scout

An interactive satellite map that shows whether each rooftop in a neighbourhood can pay for
solar, and how fast. Building footprints + SAM roof segmentation + PVGIS yields + local
prices, rendered with Mapbox GL JS.

## Project instructions

<!-- Paste the custom instructions from the Claude desktop app project here. Anything about
     tone, priorities, how to work, what to avoid. Delete this comment once filled in. -->

## Documentation

Read these rather than re-deriving from code:

- `docs/DESIGN.md` — the reference for building and changing the code: architecture, pipeline
  stages, data model, economics formulas, frontend behaviour, risks, roadmap, open questions.
  **Read it before any non-trivial change.**
- `docs/ROADMAP.md` — not yet written (roadmap currently lives in DESIGN.md).
- `docs/DATA_SOURCES.md` — not yet written (footprint/imagery/price provenance).

The original concept and research notes live in the Claude desktop app project, not in this
repo. If a decision here contradicts them, say so instead of guessing.

## Shape of the system

Two halves, deliberately separated:

- `pipeline/` — Python, run offline once per region. Heavy work (segmentation, PVGIS calls)
  happens here. Each stage reads the previous stage's output from `data/<region>/` and writes
  its own, so stages are independently rerunnable. CLI: `python -m pipeline.run --region <name>`.
- `web/` — static Vite site. The browser only reads precomputed data and redoes the economics
  arithmetic, so sliders are instant and need no server.

The contract between them is `data/<region>/roofs.geojson` + `region.json`.

## Rules that are easy to break

- **Economics live in two places and must agree.** `pipeline/economics.py` and
  `web/src/economics.js` implement the same formulas; a parity test in `tests/` runs both over
  the same fixtures. Change one, change the other, and keep the test passing.
- **Don't store derived economics in `roofs.geojson`.** Cost, savings, payback and CO₂ are
  computed in the browser from the stored fields plus `region.json` — that's what makes the
  sliders work without reloading data. Store only physical/energy facts.
- **Region-specific numbers belong in `region.json`** (prices, emissions factor, cost per watt,
  self-consumption share) or `pipeline/config/<region>.yaml`. Never hardcode them in code.
- **Every number must stay checkable.** If you add a formula or default, also surface it on the
  assumptions page and record its source in `region.json.sources`.
- **Flag assumptions as assumptions.** Tilt is usually assumed, not measured (`tilt_assumed`);
  usable area may come from the setback fallback rather than SAM (`source`, `confidence`). Keep
  those fields honest and visible in the UI.
- **PVGIS is rate-limited.** Cache on disk, and call once per (location cell, aspect, tilt) at
  1 kWp and scale linearly — never once per roof.
- **Mapbox satellite tiles are display-only.** Model input needs imagery whose licence permits
  it (municipal open orthophotos, 0.5 m or finer).
- `data/` is git-ignored: raw and intermediate files only, nothing the build depends on.

## Conventions

- `aspect_deg` follows the PVGIS convention: 0 = south, −90 = east, 90 = west.
- Areas in m², energy in kWh, system size in kWp. Reproject to a local metric CRS before any
  area calculation.
- Roof `id` is the source footprint id, and must stay stable across pipeline reruns.

## Open questions (don't silently decide these)

- Which region ships first — it sets imagery, prices and how strong the payback story is.
- Vanilla JS or React for the frontend once the roof panel grows.
- One GeoJSON file vs vector tiles (PMTiles) for larger regions.

/**
 * Area selection and aggregation — the community-organiser view.
 *
 * Draw a polygon over a few blocks and see what the whole area adds up to. Selection is
 * by roof centroid rather than polygon intersection: a roof is either in the area or not,
 * and splitting a roof's capacity across a boundary would be a false precision.
 */

import MapboxDraw from '@mapbox/mapbox-gl-draw';
import '@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css';

// mapbox-gl-draw is renderer-agnostic at runtime but names its control classes after
// Mapbox. Point them at MapLibre's so the control inherits the map's own control
// styling instead of landing unstyled. (See the renderer note in map.js.)
MapboxDraw.constants.classes.CONTROL_BASE = 'maplibregl-ctrl';
MapboxDraw.constants.classes.CONTROL_PREFIX = 'maplibregl-ctrl-';
MapboxDraw.constants.classes.CONTROL_GROUP = 'maplibregl-ctrl-group';
import { booleanPointInPolygon, centroid } from '@turf/turf';
import { evaluate } from './economics.js';
import { energy, mass, money, num } from './format.js';

export function createDraw(map) {
  const draw = new MapboxDraw({
    displayControlsDefault: false,
    defaultMode: 'simple_select',
    styles: [
      {
        id: 'sel-fill',
        type: 'fill',
        filter: ['all', ['==', '$type', 'Polygon']],
        paint: { 'fill-color': '#3987e5', 'fill-opacity': 0.12 },
      },
      {
        id: 'sel-line',
        type: 'line',
        filter: ['all', ['==', '$type', 'Polygon']],
        paint: { 'line-color': '#3987e5', 'line-width': 2, 'line-dasharray': [2, 1] },
      },
      {
        id: 'sel-vertex',
        type: 'circle',
        filter: ['all', ['==', 'meta', 'vertex'], ['==', '$type', 'Point']],
        paint: {
          'circle-radius': 4.5,
          'circle-color': '#3987e5',
          // 2px ring in the surface colour, as every other marker in the UI carries.
          'circle-stroke-width': 2,
          'circle-stroke-color': '#1a1a19',
        },
      },
    ],
  });
  map.addControl(draw);
  return draw;
}

/** Roofs whose centroid falls inside the drawn polygon. */
export function roofsInside(fc, polygon) {
  return fc.features.filter((f) => booleanPointInPolygon(centroid(f), polygon));
}

export function aggregate(roofs, params, settings) {
  const totals = {
    roofs: roofs.length,
    viable: 0,
    kwp: 0,
    cost: 0,
    savings: 0,
    kwh: 0,
    co2: 0,
    paybacks: [],
  };

  for (const f of roofs) {
    const p = f.properties;
    const r = evaluate(p.usable_area_m2, p.kwh_per_kwp_year, params, {
      detailed: settings.detailed,
    });
    // Only viable roofs contribute: a sub-minimum roof is not an install anyone would do,
    // and counting its area would inflate the area total with systems nobody can buy.
    if (!r.viable) continue;
    totals.viable += 1;
    totals.kwp += r.kwp;
    totals.cost += r.cost;
    totals.savings += r.annual_savings;
    totals.kwh += r.annual_kwh;
    totals.co2 += r.co2_avoided_kg;
    if (r.payback_years !== null) totals.paybacks.push(r.payback_years);
  }

  // Area payback is the area's own cost over its own savings, not a mean of per-roof
  // paybacks — averaging ratios would weight a tiny roof the same as a large one.
  totals.payback = totals.savings > 0 ? totals.cost / totals.savings : null;
  return totals;
}

export function renderSummary(el, totals, region) {
  const currency = region.economics.currency;
  if (totals.roofs === 0) {
    el.innerHTML = `
      <h3 class="panel-title">No roofs selected</h3>
      <p class="panel-sub">Draw the area over some buildings.</p>`;
    return;
  }

  el.innerHTML = `
    <h3 class="panel-title">${num(totals.viable)} viable roofs</h3>
    <p class="panel-sub">
      of ${num(totals.roofs)} in the area you drew
    </p>

    <div class="hero">
      <div class="hero-value">${num(totals.kwp)}<span class="hero-unit">kWp together</span></div>
      <div class="hero-label">
        ${money(totals.cost, currency)} invested,
        ${money(totals.savings, currency)} saved every year
      </div>
    </div>

    <dl class="stats">
      <div><dt>Combined output</dt><dd>${energy(totals.kwh)}<small> / year</small></dd></div>
      <div>
        <dt>Payback on the whole area</dt>
        <dd>${totals.payback === null ? 'never' : `${num(totals.payback, 1)} yr`}</dd>
      </div>
      <div><dt>CO₂ avoided</dt><dd>${mass(totals.co2)}<small> / year</small></dd></div>
      <div>
        <dt>Average system</dt>
        <dd>${totals.viable ? num(totals.kwp / totals.viable, 1) : 0} kWp</dd>
      </div>
    </dl>

    <ul class="notes">
      <li>Every roof is sized to its own usable area, not to a household's consumption.
          A real bulk buy would size each system to its own bill.</li>
      <li>Roofs below the ${num(region.economics.min_system_kwp, 1)} kWp minimum are
          counted in the area total but contribute nothing.</li>
    </ul>`;
}

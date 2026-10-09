/**
 * App entry point: load the two precomputed files, wire the map, panel, area tool and
 * assumptions page together, and own the global settings.
 *
 * The split that matters: global settings (electricity price, ageing) change every
 * roof's colour and so trigger a recolour of the whole source; a roof's own system-size
 * slider changes only that roof and so only redraws the panel.
 */

import './style.css';
import { regionParams } from './economics.js';
import {
  createMap,
  recolour,
  refreshSource,
  revealRoofs,
  setSelected,
  usingFallbackBasemap,
  wireInteraction,
} from './map.js';
import { destroyChart, renderPanel } from './panel.js';
import { aggregate, createDraw, renderSummary, roofsInside } from './draw.js';
import { renderAssumptions } from './assumptions.js';
import { num } from './format.js';

const REGION = import.meta.env.VITE_REGION ?? 'webber-greens';
const DATA = `data/${REGION}`;

const el = {
  regionName: document.getElementById('region-name'),
  price: document.getElementById('price'),
  priceOut: document.getElementById('price-out'),
  detailed: document.getElementById('detailed'),
  drawToggle: document.getElementById('draw-toggle'),
  notice: document.getElementById('notice'),
  legendGood: document.getElementById('legend-good'),
  legendWarn: document.getElementById('legend-warn'),
  legendFoot: document.getElementById('legend-foot'),
  panel: document.getElementById('panel'),
  panelBody: document.getElementById('panel-body'),
  panelClose: document.getElementById('panel-close'),
  summary: document.getElementById('summary'),
  summaryBody: document.getElementById('summary-body'),
  summaryClose: document.getElementById('summary-close'),
  assumptions: document.getElementById('assumptions'),
  assumptionsBody: document.getElementById('assumptions-body'),
  assumptionsOpen: document.getElementById('assumptions-open'),
  assumptionsClose: document.getElementById('assumptions-close'),
};

async function loadJson(path) {
  const resp = await fetch(path);
  if (!resp.ok) {
    throw new Error(
      `${path} is missing (${resp.status}). Run `
      + `\`python -m pipeline.run --region ${REGION}\` to generate it.`,
    );
  }
  return resp.json();
}

function fail(message) {
  el.notice.hidden = false;
  el.notice.innerHTML = message;
}

async function main() {
  let region;
  let fc;
  try {
    [region, fc] = await Promise.all([
      loadJson(`${DATA}/region.json`),
      loadJson(`${DATA}/roofs.geojson`),
    ]);
  } catch (err) {
    fail(`<b>No data for “${REGION}”.</b> ${err.message}`);
    return;
  }

  const byId = new Map(fc.features.map((f) => [f.properties.id, f.properties]));

  // Global settings. The price starts at the region default and the slider spans a range
  // wide enough to cover a real tariff change in either direction.
  const settings = {
    price: region.economics.retail_price_per_kwh,
    detailed: false,
    greenMax: region.payback_bands.green_max_years,
    yellowMax: region.payback_bands.yellow_max_years,
    capKwp: null,
  };
  let selectedId = null;

  /**
   * Params for the current settings. The price slider moves the retail price, and the
   * export price with it where the region credits exports at the retail rate — which is
   * the Alberta micro-generation case, where the two are the same number by regulation.
   */
  function currentParams() {
    const exportTracksRetail = region.economics.export_price_per_kwh
      === region.economics.retail_price_per_kwh;
    return regionParams({
      ...region,
      economics: {
        ...region.economics,
        retail_price_per_kwh: settings.price,
        export_price_per_kwh: exportTracksRetail
          ? settings.price
          : region.economics.export_price_per_kwh,
      },
    });
  }

  el.regionName.textContent =
    `${region.display_name} · ${num(region.stats.roofs)} roofs`;
  el.legendGood.textContent = `up to ${region.payback_bands.green_max_years} years`;
  el.legendWarn.textContent =
    `${region.payback_bands.green_max_years}–${region.payback_bands.yellow_max_years} years`;
  el.legendFoot.textContent = region.placeholders.length
    ? `${region.placeholders.length} prices behind these bands are unsourced placeholders.`
    : '';

  if (usingFallbackBasemap()) {
    fail('<b>No Mapbox token.</b> Using Esri World Imagery instead. Set '
      + '<code>VITE_MAPBOX_TOKEN</code> in <code>web/.env.local</code> for the Mapbox '
      + 'satellite basemap. Either way the imagery is display-only.');
  }

  // Colour before the map exists: the source is part of the initial style.
  recolour(fc, currentParams(), settings);
  const map = createMap('map', region, fc);
  renderAssumptions(el.assumptionsBody, region);

  function repaint() {
    recolour(fc, currentParams(), settings);
    refreshSource(map, fc);
    if (selectedId) showRoof(selectedId);
    if (drawnPolygon) showSummary();
  }

  function showRoof(id) {
    const roof = byId.get(id);
    if (!roof) return;
    el.panel.hidden = false;
    el.summary.hidden = true;
    const capInput = renderPanel(el.panelBody, {
      roof,
      params: currentParams(),
      settings,
      region,
    });
    capInput?.addEventListener('input', (e) => {
      // Per-roof only: no recolour, because no other roof changed.
      settings.capKwp = Number(e.target.value);
      showRoof(id);
    });
  }

  function select(id) {
    selectedId = id;
    settings.capKwp = null;
    setSelected(map, id);
    if (id === null) {
      el.panel.hidden = true;
      destroyChart();
      return;
    }
    showRoof(id);
  }

  let drawnPolygon = null;
  function showSummary() {
    if (!drawnPolygon) return;
    const inside = roofsInside(fc, drawnPolygon);
    renderSummary(el.summaryBody, aggregate(inside, currentParams(), settings), region);
    el.summary.hidden = false;
    el.panel.hidden = true;
  }

  revealRoofs(map);
  wireInteraction(map, { onSelect: select });

  {
    const draw = createDraw(map);

    el.drawToggle.addEventListener('click', () => {
      const active = el.drawToggle.getAttribute('aria-pressed') === 'true';
      if (active) {
        draw.deleteAll();
        drawnPolygon = null;
        el.summary.hidden = true;
        el.drawToggle.setAttribute('aria-pressed', 'false');
        el.drawToggle.textContent = 'Select an area';
      } else {
        draw.deleteAll();
        draw.changeMode('draw_polygon');
        el.drawToggle.setAttribute('aria-pressed', 'true');
        el.drawToggle.textContent = 'Clear the area';
      }
    });

    const onDrawn = () => {
      const [feature] = draw.getAll().features;
      drawnPolygon = feature ?? null;
      if (drawnPolygon) showSummary();
    };
    map.on('draw.create', onDrawn);
    map.on('draw.update', onDrawn);
  }

  // ---- global controls ----

  // Span a real tariff change in either direction, snapped to the step so the readout
  // lands on round numbers rather than on 0.064 + n x 0.005.
  const price = region.economics.retail_price_per_kwh;
  const step = Number(el.price.step);
  const snap = (v) => (Math.round(v / step) * step).toFixed(3);
  el.price.min = snap(Math.max(0.02, price * 0.4));
  el.price.max = snap(price * 2.5);
  el.price.value = price;

  function showPrice() {
    // Not Intl currency formatting: it rounds to two decimals, and the third decimal
    // is where a per-kWh tariff actually moves.
    el.priceOut.textContent =
      `${settings.price.toFixed(3)} ${region.economics.currency} /kWh`;
  }
  showPrice();

  el.price.addEventListener('input', (e) => {
    settings.price = Number(e.target.value);
    showPrice();
    repaint();
  });

  el.detailed.addEventListener('change', (e) => {
    settings.detailed = e.target.checked;
    repaint();
  });

  el.panelClose.addEventListener('click', () => select(null));
  el.summaryClose.addEventListener('click', () => {
    el.summary.hidden = true;
  });
  el.assumptionsOpen.addEventListener('click', () => el.assumptions.showModal());
  el.assumptionsClose.addEventListener('click', () => el.assumptions.close());
}

main();

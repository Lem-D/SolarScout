/**
 * Map setup, the roof layer, and payback colouring.
 *
 * Renderer is **MapLibre GL JS**, not Mapbox GL JS as DESIGN.md originally specified.
 * mapbox-gl v3 refuses to finish loading a style without a Mapbox access token — the
 * raster painter still draws, but `load` never fires, so no roof layer can ever be
 * added — which made the app unrunnable for anyone without a Mapbox account. MapLibre
 * is an API-compatible open fork with no such gate; a Mapbox token is still used when
 * one is present, through the raster tiles API. See docs/DESIGN.md.
 *
 * Colour is a data-driven expression over a `_band` property this module writes onto the
 * in-memory features. Nothing derived is read from roofs.geojson — payback depends on the
 * price slider, so it is recomputed here and pushed back through `setData`. 1129 features
 * repaint in a few milliseconds, which is why the sliders need no server (DESIGN.md).
 */

import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { evaluate, paybackBand } from './economics.js';

export const BAND_COLOURS = {
  // Status palette from the data-viz reference. Fixed, never themed, and always paired
  // with the labelled legend — the colour never carries the meaning on its own.
  green: '#0ca30c',
  yellow: '#fab219',
  grey: '#6f6e66',
};

const TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;

/** Both basemaps are display-only. Neither licence covers model input (CLAUDE.md). */
function basemap() {
  if (TOKEN) {
    return {
      tiles: [`https://api.mapbox.com/v4/mapbox.satellite/{z}/{x}/{y}@2x.jpg90?access_token=${TOKEN}`],
      tileSize: 512,
      maxzoom: 22,
      attribution: '© Mapbox, © Maxar',
    };
  }
  return {
    tiles: ['https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
    tileSize: 256,
    maxzoom: 19,
    attribution: 'Imagery © Esri, Maxar, Earthstar Geographics',
  };
}

/**
 * The roof layers, declared as part of the initial style rather than added on a `load`
 * event. Nothing then depends on the map's load lifecycle: the layers exist from the
 * first frame, and `getSource('roofs').setData(...)` is the only call the app makes
 * afterwards.
 */
function roofLayers() {
  return [
    {
      id: 'roofs-fill',
      type: 'fill',
      source: 'roofs',
      paint: {
        'fill-color': [
          'match', ['get', '_band'],
          'green', BAND_COLOURS.green,
          'yellow', BAND_COLOURS.yellow,
          BAND_COLOURS.grey,
        ],
        // Starts at 0 and is raised on the next frame, so the opening view is plain
        // imagery and the roofs fade in (DESIGN.md).
        'fill-opacity': 0,
        'fill-opacity-transition': { duration: 650, delay: 0 },
      },
    },
    {
      id: 'roofs-line',
      type: 'line',
      source: 'roofs',
      paint: { 'line-color': '#000000', 'line-opacity': 0.35, 'line-width': 0.6 },
    },
    // Selected roof: a bright hairline rather than a fill change, so the payback colour
    // stays readable underneath.
    {
      id: 'roofs-selected',
      type: 'line',
      source: 'roofs',
      filter: ['==', ['get', 'id'], ''],
      paint: { 'line-color': '#ffffff', 'line-width': 2.2 },
    },
  ];
}

export function createMap(container, region, fc) {
  const sat = basemap();

  const map = new maplibregl.Map({
    container,
    style: {
      version: 8,
      sources: {
        satellite: { type: 'raster', ...sat },
        roofs: { type: 'geojson', data: fc, promoteId: 'id' },
      },
      layers: [
        { id: 'bg', type: 'background', paint: { 'background-color': '#121211' } },
        { id: 'satellite', type: 'raster', source: 'satellite' },
        ...roofLayers(),
      ],
    },
    center: region.centre,
    zoom: 15.4,
    maxZoom: Math.min(sat.maxzoom + 1.5, 20),
    attributionControl: false,
  });

  map.addControl(new maplibregl.AttributionControl({
    customAttribution: region.attribution,
    compact: false,
  }), 'bottom-right');
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
  map.addControl(new maplibregl.GeolocateControl({ trackUserLocation: false }), 'bottom-right');

  return map;
}

export function usingFallbackBasemap() {
  return !TOKEN;
}

/**
 * Recompute payback for every roof at the current global settings and write the band
 * back onto the features. Returns the per-roof results so callers (the area summary)
 * can aggregate without doing the arithmetic twice.
 */
export function recolour(fc, params, settings) {
  const { greenMax, yellowMax } = settings;
  const results = new Map();

  for (const f of fc.features) {
    const p = f.properties;
    const r = evaluate(p.usable_area_m2, p.kwh_per_kwp_year, params, {
      detailed: settings.detailed,
    });
    const band = paybackBand(r.payback_years, r.viable, greenMax, yellowMax);
    p._band = band;
    // Rounded for the tooltip only; the panel uses the unrounded result.
    p._payback = r.payback_years === null ? null : Math.round(r.payback_years * 10) / 10;
    results.set(p.id, r);
  }
  return results;
}

/** Raise the roof fill from transparent once the first frame is on screen. */
export function revealRoofs(map) {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => map.setPaintProperty('roofs-fill', 'fill-opacity', 0.78));
  });
}

export function setSelected(map, id) {
  map.setFilter('roofs-selected', ['==', ['get', 'id'], id ?? '']);
}

export function refreshSource(map, fc) {
  map.getSource('roofs')?.setData(fc);
}

/** Hover tooltip and click selection on the roof layer. */
export function wireInteraction(map, { onSelect }) {
  const popup = new maplibregl.Popup({
    closeButton: false,
    closeOnClick: false,
    className: 'roof-tip',
    offset: 8,
  });

  map.on('mousemove', 'roofs-fill', (e) => {
    map.getCanvas().style.cursor = 'pointer';
    const p = e.features[0].properties;
    // GeoJSON properties round-trip through the tile worker, where null becomes the
    // string "null" — so test both.
    const never = p._payback === null || p._payback === undefined || p._payback === 'null';
    const payback = never ? 'does not pay back' : `<b>${p._payback}</b> yr payback`;
    popup.setLngLat(e.lngLat).setHTML(`${payback} · <b>${p.kwp}</b> kWp`).addTo(map);
  });

  map.on('mouseleave', 'roofs-fill', () => {
    map.getCanvas().style.cursor = '';
    popup.remove();
  });

  map.on('click', 'roofs-fill', (e) => {
    popup.remove();
    // Mark the underlying DOM event so the deselect handler below, which sees the same
    // event, knows a roof already took it. Re-querying there instead would ask the same
    // question twice and disagree with itself if the answers ever differed.
    e.originalEvent._roofClick = true;
    onSelect(e.features[0].properties.id);
  });

  // A click on bare imagery clears the selection. Registered after the layer handler
  // above, so by the time it runs the flag is set.
  map.on('click', (e) => {
    if (!e.originalEvent?._roofClick) onSelect(null);
  });

  return popup;
}

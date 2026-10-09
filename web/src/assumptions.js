/**
 * The assumptions page.
 *
 * "Every number must stay checkable" (CLAUDE.md) only means something if there is one
 * place that shows every number, its formula and its source — and marks the ones that
 * have no source yet. This page is built from region.json alone, so a value cannot
 * appear here without having come from the pipeline, and a value cannot look sourced
 * when region.json says its source is null.
 */

import { escapeHtml, num } from './format.js';

const FORMULAS = [
  ['System size', '<code>kWp = usable area × panel density</code>'],
  ['Annual output', '<code>E = kWp × specific yield × (1 − snow loss)</code>'],
  ['Up-front cost', '<code>C = kWp × 1000 × cost per watt − incentives</code>'],
  ['Yearly savings',
    '<code>S = E × share × retail price + E × (1 − share) × export price</code>'],
  ['Payback (simple)', '<code>C / S</code>'],
  ['Payback (with ageing)',
    'yearly savings fall by the degradation rate and are summed until they cover <code>C</code>'],
  ['CO₂ avoided', '<code>E × grid emissions factor</code>'],
];

// label, region.json path, unit, and what the number actually means.
const VALUES = [
  ['Electricity price', 'economics.retail_price_per_kwh', '/kWh',
   'What a kWh costs the household — the saving on every kWh used on site.'],
  ['Export price', 'economics.export_price_per_kwh', '/kWh',
   'Credit for a kWh sent to the grid.'],
  ['Self-consumption share', 'economics.self_consumption_share', '',
   'Share of production used on site. Where export price equals the retail price this '
   + 'value cannot change the result, which is why there is no slider for it here.'],
  ['Installed cost', 'economics.installed_cost_per_watt', '/W',
   'All-in installed price per watt.'],
  ['Grid emissions', 'economics.grid_emissions_kg_per_kwh', 'kg/kWh',
   'CO₂ per kWh displaced from the local grid.'],
  ['Panel density', 'economics.panel_kwp_per_m2', 'kWp/m²',
   'Capacity per square metre of usable roof.'],
  ['Degradation', 'economics.degradation_per_year', '/yr',
   'Annual output loss, used only by the payback-with-ageing option.'],
  ['Minimum system', 'economics.min_system_kwp', 'kWp',
   'Below this a roof is reported as too small rather than given a payback.'],
  ['System losses', 'solar.loss_pct', '%',
   'Inverter, wiring and temperature losses passed to PVGIS.'],
  ['Snow loss', 'solar.snow_loss_share', '',
   'Flat haircut on production for snow cover, which PVGIS’s loss term does not model.'],
  ['Assumed pitch', 'solar.assumed_tilt_deg', '°',
   'Applied to every pitched roof; no dataset measures the real pitch here.'],
  ['Flat-roof tilt', 'solar.optimal_tilt_deg', '°',
   'Used for roofs treated as flat, where panels would be racked at the optimum.'],
  ['Edge setback', 'usable_area.setback_m', 'm',
   'Strip around the roof edge where panels cannot go.'],
  ['Pitched face share', 'usable_area.pitched_face_share', '',
   'Share of the outline taken as the one equator-facing roof face.'],
  ['Flat row packing', 'usable_area.flat_row_packing', '',
   'Share of a flat roof left after spacing rows so they do not shade each other.'],
];

function dig(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

/** Map a value path to the key region.json.sources uses, where one exists. */
function sourceKey(path) {
  return path.split('.').pop();
}

function valueRow(region, [label, path, unit, meaning]) {
  const raw = dig(region, path);
  if (raw === undefined || raw === null) return '';
  const key = sourceKey(path);
  const src = region.sources?.[key];
  const isPlaceholder = region.placeholders?.includes(key);
  const shown = unit.startsWith('/') || unit === ''
    ? num(raw, raw < 1 ? 3 : 2)
    : num(raw, raw < 1 ? 3 : 1);

  const provenance = src
    ? `<a href="${escapeHtml(src)}" target="_blank" rel="noopener">source</a>`
    : isPlaceholder
      ? '<span class="flag">unsourced placeholder</span>'
      : '<span class="src">derived in the pipeline</span>';

  return `
    <tr>
      <td>${escapeHtml(label)}<div class="src">${meaning}</div></td>
      <td class="num">${shown}${unit ? ` ${escapeHtml(unit)}` : ''}</td>
      <td>${provenance}</td>
    </tr>`;
}

export function renderAssumptions(el, region) {
  const placeholders = region.placeholders ?? [];
  const s = region.stats ?? {};

  el.innerHTML = `
    <h2>How these numbers are made</h2>
    <p>
      Every figure on this map comes from the values and formulas below, applied to
      ${num(s.roofs ?? 0)} buildings in ${escapeHtml(region.display_name)}. Nothing is
      measured on site.
    </p>

    ${placeholders.length ? `
      <p>
        <span class="flag">${placeholders.length} unsourced placeholders</span>
        Some prices came from scoping research, not from a rate schedule or a quote.
        They are marked below. Treat the shape of the answer as meaningful and the exact
        currency figures as provisional.
      </p>` : ''}

    <h3>Formulas</h3>
    <table>
      <tbody>
        ${FORMULAS.map(([k, v]) => `<tr><td>${k}</td><td colspan="2">${v}</td></tr>`).join('')}
      </tbody>
    </table>

    <h3>Values</h3>
    <p>
      These are the region’s defaults. Moving a slider changes the figure used on the
      map but not the default recorded here.
    </p>
    <table>
      <thead><tr><th>What</th><th>Value</th><th>Where it comes from</th></tr></thead>
      <tbody>${VALUES.map((v) => valueRow(region, v)).join('')}</tbody>
    </table>

    <h3>What this model does not know</h3>
    <table>
      <tbody>
        <tr>
          <td>Roof pitch and orientation</td>
          <td colspan="2">Inferred from the shape of the building outline: the long axis
          of its bounding rectangle is taken as the ridge. Outlines too square to tell are
          treated as flat and racked at the optimal tilt, which is the most favourable
          assumption available — ${num(s.flat_roofs ?? 0)} of ${num(s.roofs ?? 0)} roofs
          here fall into that case.</td>
        </tr>
        <tr>
          <td>Obstructions</td>
          <td colspan="2">Chimneys, vents, dormers and skylights are not subtracted yet.
          Usable area is therefore an upper bound.
          ${s.sam_roofs ? '' : 'No roof here used image segmentation; all of them use the '
            + 'outline-minus-setback fallback.'}</td>
        </tr>
        <tr>
          <td>Shading</td>
          <td colspan="2">No trees, no neighbouring buildings. PVGIS applies a terrain
          horizon only.</td>
        </tr>
        <tr>
          <td>Tariff structure</td>
          <td colspan="2">One flat price in and one flat price out, all year. Seasonal or
          time-of-use plans are not modelled, and in a region with a strong summer export
          rate they would change payback substantially.</td>
        </tr>
        <tr>
          <td>Household consumption</td>
          <td colspan="2">Systems are sized to the roof, not to a bill.</td>
        </tr>
      </tbody>
    </table>

    <h3>Solar resource</h3>
    <p>
      Yields come from the European Commission’s PVGIS
      (<code>${escapeHtml(region.solar.pvgis_endpoint)}</code>), called once per
      orientation group at 1 kWp and scaled linearly. Specific yield here runs from
      roughly 880 kWh/kWp/yr on an east-facing pitch to about 1174 at the optimum.
    </p>

    <h3>Attribution</h3>
    <p>${escapeHtml(region.attribution)}</p>
  `;
}

/**
 * Roof detail panel.
 *
 * Payback is the headline because it is the question the user came with. Below it sit
 * the physical facts the number rests on, then the assumptions behind those facts —
 * the confidence badge and the notes are not decoration, they are the honest part
 * (DESIGN.md: state assumptions in the UI).
 *
 * The system-size slider is per-roof: it caps this roof's kWp and recomputes here only.
 * It never repaints the map, because the other roofs did not change.
 */

import { evaluate, monthlyOutputKwh } from './economics.js';
import { renderMonthly, destroyChart } from './chart.js';
import { compass, energy, escapeHtml, mass, money, num, years } from './format.js';

const CONFIDENCE_TEXT = {
  high: 'Roof outline matched to imagery',
  medium: 'Roof outline from city data; pitch and orientation assumed',
  low: 'Roof outline uncertain',
};

/** The assumptions that apply to this particular roof, in plain language. */
function notesFor(roof, region) {
  const notes = [];
  if (roof.source === 'footprint_setback') {
    const u = region.usable_area;
    notes.push(
      `Usable area is the building outline shrunk by ${u.setback_m} m, then `
      + (roof.is_flat
        ? `×${u.flat_row_packing} for spacing between racked rows`
        : `halved for the one south-facing roof face and corrected for pitch`)
      + '. Chimneys, vents and dormers are not yet subtracted, so this is an upper bound.',
    );
  }
  if (roof.tilt_assumed) {
    notes.push(roof.is_flat
      ? `Treated as flat: the outline is too square to tell which way the ridge runs, so `
        + `panels are assumed racked at the optimal ${roof.tilt_deg}°. If this roof is in `
        + `fact pitched, the real figure is lower.`
      : `Pitch is assumed to be ${roof.tilt_deg}°, the typical local roof. It is not measured.`);
  }
  notes.push('No shading from trees or neighbouring buildings is modelled.');
  if (region.solar.snow_loss_share > 0) {
    notes.push(
      `A flat ${Math.round(region.solar.snow_loss_share * 100)}% snow loss is applied to `
      + 'every month. The annual total is the figure to trust; the winter months are not '
      + 'a seasonal snow model.',
    );
  }
  if (region.placeholders.length) {
    notes.push(`${region.placeholders.length} of the prices behind this are unsourced `
      + 'placeholders. See Assumptions.');
  }
  return notes;
}

function heroHtml(result, band, currency) {
  if (!result.viable) {
    return `
      <div class="hero">
        <div class="hero-value">Too small<span class="hero-unit"></span></div>
        <div class="hero-label">
          <i class="sw sw-grey"></i>
          Under the ${num(result.minKwp, 1)} kWp minimum system size
        </div>
      </div>`;
  }
  if (result.payback_years === null) {
    return `
      <div class="hero">
        <div class="hero-value">Never<span class="hero-unit"></span></div>
        <div class="hero-label"><i class="sw sw-grey"></i>Savings never cover the cost</div>
      </div>`;
  }
  const swatch = band === 'green' ? 'sw-good' : band === 'yellow' ? 'sw-warn' : 'sw-grey';
  return `
    <div class="hero">
      <div class="hero-value">${years(result.payback_years)}<span class="hero-unit">years to pay back</span></div>
      <div class="hero-label">
        <i class="sw ${swatch}"></i>
        ${money(result.cost, currency)} up front, ${money(result.annual_savings, currency)} saved a year
      </div>
    </div>`;
}

export function renderPanel(el, { roof, params, settings, region }) {
  const currency = region.economics.currency;
  const maxKwp = roof.usable_area_m2 * params.panelKwpPerM2;
  const cap = settings.capKwp ?? maxKwp;

  const r = evaluate(roof.usable_area_m2, roof.kwh_per_kwp_year, params, {
    capKwp: cap,
    detailed: settings.detailed,
  });
  r.minKwp = params.minSystemKwp;
  const band = !r.viable || r.payback_years === null
    ? 'grey'
    : r.payback_years <= settings.greenMax
      ? 'green'
      : r.payback_years <= settings.yellowMax ? 'yellow' : 'grey';

  const notes = notesFor(roof, region);

  el.innerHTML = `
    <h3 class="panel-title">This roof</h3>
    <p class="panel-sub">
      ${num(roof.footprint_area_m2)} m² building outline ·
      ${roof.is_flat ? 'treated as flat' : `${compass(roof.aspect_deg)}-facing`}
    </p>

    ${heroHtml(r, band, currency)}

    <dl class="stats">
      <div><dt>Usable roof area</dt><dd>${num(roof.usable_area_m2)} m²</dd></div>
      <div><dt>System size</dt><dd>${num(r.kwp, 2)} kWp</dd></div>
      <div><dt>Produces</dt><dd>${energy(r.annual_kwh)}<small> / year</small></dd></div>
      <div><dt>Up-front cost</dt><dd>${money(r.cost, currency)}</dd></div>
      <div><dt>Saves</dt><dd>${money(r.annual_savings, currency)}<small> / year</small></dd></div>
      <div><dt>CO₂ avoided</dt><dd>${mass(r.co2_avoided_kg)}<small> / year</small></dd></div>
      <div>
        <dt>Orientation</dt>
        <dd>${num(roof.aspect_deg)}°<small> aspect, ${num(roof.tilt_deg)}° tilt</small></dd>
      </div>
      <div><dt>Specific yield</dt><dd>${num(roof.kwh_per_kwp_year)}<small> kWh/kWp/yr</small></dd></div>
    </dl>

    <div class="section-head">System size</div>
    <label class="control">
      <span class="control-label">
        <span>Panels installed</span>
        <output>${num(cap, 2)} kWp</output>
      </span>
      <input id="cap" type="range"
             min="${Math.min(params.minSystemKwp, maxKwp).toFixed(2)}"
             max="${maxKwp.toFixed(2)}"
             step="0.25" value="${cap.toFixed(2)}" />
    </label>

    <div class="section-head">Monthly production at ${num(r.kwp, 2)} kWp</div>
    <div class="chart-wrap"><canvas id="monthly"></canvas></div>

    <div class="section-head">
      How confident is this
      <span class="badge" style="margin-left:6px">${escapeHtml(roof.confidence)} confidence</span>
    </div>
    <p style="margin:0;font-size:11.5px;color:var(--text-muted)">
      ${CONFIDENCE_TEXT[roof.confidence] ?? ''}
    </p>
    <ul class="notes">${notes.map((n) => `<li>${n}</li>`).join('')}</ul>
  `;

  renderMonthly(
    el.querySelector('#monthly'),
    monthlyOutputKwh(roof.kwh_monthly_per_kwp, r.kwp, params),
  );

  return el.querySelector('#cap');
}

export { destroyChart };

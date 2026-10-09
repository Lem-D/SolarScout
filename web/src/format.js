/** Number formatting shared by the panel, the area summary and the assumptions page. */

export function money(v, currency) {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(v);
}

export function num(v, digits = 0) {
  return new Intl.NumberFormat(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(v);
}

/** kWh, switching to MWh once the figure stops being readable in kWh. */
export function energy(kwh) {
  return kwh >= 100_000 ? `${num(kwh / 1000)} MWh` : `${num(kwh)} kWh`;
}

/** kg of CO2, switching to tonnes. */
export function mass(kg) {
  return kg >= 2000 ? `${num(kg / 1000, 1)} t` : `${num(kg)} kg`;
}

export function years(v) {
  if (v === null || v === undefined) return 'never';
  return num(v, 1);
}

/** Compass name for a PVGIS aspect (0 = south, -90 = east, 90 = west). */
export function compass(aspectDeg) {
  const names = [
    [-180, 'north'], [-157.5, 'north-east'], [-112.5, 'east'], [-67.5, 'south-east'],
    [-22.5, 'south'], [22.5, 'south-west'], [67.5, 'west'], [112.5, 'north-west'],
    [157.5, 'north'],
  ];
  let out = 'south';
  for (const [edge, name] of names) if (aspectDeg >= edge) out = name;
  return out;
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

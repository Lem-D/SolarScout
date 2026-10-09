/**
 * Solar economics.
 *
 * This module mirrors pipeline/economics.py. The two MUST produce identical numbers:
 * tests/test_economics_parity.py runs both over tests/fixtures/economics_cases.json and
 * fails on any disagreement. Change one, change the other.
 *
 * Nothing here is stored in roofs.geojson. This runs on every slider move from the roof's
 * physical fields plus region.json, which is what makes the sliders instant.
 * See docs/DESIGN.md.
 */

// Agreed with pipeline/economics.py. Payback longer than this is reported as null
// ("never") rather than a large number.
export const MAX_PAYBACK_YEARS = 100.0;

/** Pull the economic half out of region.json into a flat params object. */
export function regionParams(region) {
  const econ = region.economics ?? region;
  return {
    retailPricePerKwh: Number(econ.retail_price_per_kwh),
    exportPricePerKwh: Number(econ.export_price_per_kwh),
    selfConsumptionShare: Number(econ.self_consumption_share),
    installedCostPerWatt: Number(econ.installed_cost_per_watt),
    gridEmissionsKgPerKwh: Number(econ.grid_emissions_kg_per_kwh),
    panelKwpPerM2: Number(econ.panel_kwp_per_m2),
    degradationPerYear: Number(econ.degradation_per_year),
    minSystemKwp: Number(econ.min_system_kwp),
    snowLossShare: Number(region.solar?.snow_loss_share ?? 0),
    incentiveTotal: Number(econ.incentive_total ?? 0),
  };
}

/** Default system size from usable area, optionally capped by the UI slider. */
export function systemSizeKwp(usableAreaM2, p, capKwp = null) {
  const kwp = usableAreaM2 * p.panelKwpPerM2;
  return capKwp === null ? kwp : Math.min(kwp, capKwp);
}

/** Yearly production, after the snow-loss haircut PVGIS's loss term does not model. */
export function annualOutputKwh(kwp, kwhPerKwpYear, p) {
  return kwp * kwhPerKwpYear * (1.0 - p.snowLossShare);
}

/**
 * Twelve monthly production figures for a system of `kwp`. Carries the same snow-loss
 * haircut as annualOutputKwh, applied flat across all months: snow is a winter
 * phenomenon, so the flat share gets the shape wrong even though the total is right.
 * A seasonal model needs a sourced snow series region.json does not have yet; flat at
 * least keeps the monthly chart summing to the annual figure beside it.
 */
export function monthlyOutputKwh(kwhMonthlyPerKwp, kwp, p) {
  const scale = kwp * (1.0 - p.snowLossShare);
  return kwhMonthlyPerKwp.map((m) => m * scale);
}

/** Installed cost less any incentives, floored at zero. */
export function upfrontCost(kwp, p) {
  const gross = kwp * 1000.0 * p.installedCostPerWatt;
  return Math.max(0.0, gross - p.incentiveTotal);
}

/**
 * Self-consumed energy avoids the retail price; the rest earns the export price.
 * Where export == retail (Alberta micro-generation) the share cancels out and this
 * reduces to annualKwh * retailPrice.
 */
export function annualSavings(annualKwh, p) {
  const share = p.selfConsumptionShare;
  return annualKwh * share * p.retailPricePerKwh
       + annualKwh * (1.0 - share) * p.exportPricePerKwh;
}

/** cost / savings, ignoring degradation. null when savings are zero or negative. */
export function simplePaybackYears(cost, savingsYearOne) {
  if (savingsYearOne <= 0) return null;
  const years = cost / savingsYearOne;
  return years > MAX_PAYBACK_YEARS ? null : years;
}

/**
 * Sum degrading yearly savings until they cover the cost. Year n produces
 * (1 - degradation)^(n-1) of year one. Interpolates within the final year so the
 * result is continuous rather than a step.
 */
export function detailedPaybackYears(cost, savingsYearOne, p) {
  if (savingsYearOne <= 0) return null;
  let cumulative = 0.0;
  for (let year = 1; year <= MAX_PAYBACK_YEARS; year++) {
    const thisYear = savingsYearOne * Math.pow(1.0 - p.degradationPerYear, year - 1);
    if (cumulative + thisYear >= cost) {
      const shortfall = cost - cumulative;
      return (year - 1) + shortfall / thisYear;
    }
    cumulative += thisYear;
  }
  return null;
}

export function co2AvoidedKg(annualKwh, p) {
  return annualKwh * p.gridEmissionsKgPerKwh;
}

/** Full economics for one roof. The one entry point pipeline/economics.py mirrors. */
export function evaluate(usableAreaM2, kwhPerKwpYear, p, { capKwp = null, detailed = false } = {}) {
  const kwp = systemSizeKwp(usableAreaM2, p, capKwp);
  const viable = kwp >= p.minSystemKwp;
  const energy = annualOutputKwh(kwp, kwhPerKwpYear, p);
  const cost = upfrontCost(kwp, p);
  const savings = annualSavings(energy, p);
  const payback = detailed
    ? detailedPaybackYears(cost, savings, p)
    : simplePaybackYears(cost, savings);
  return {
    kwp,
    annual_kwh: energy,
    cost,
    annual_savings: savings,
    payback_years: payback,
    co2_avoided_kg: co2AvoidedKg(energy, p),
    viable,
  };
}

/** Map colour band. Mirrored by the data-driven expression in web/src/map.js. */
export function paybackBand(paybackYears, viable, greenMax = 8.0, yellowMax = 15.0) {
  if (!viable || paybackYears === null) return 'grey';
  if (paybackYears <= greenMax) return 'green';
  if (paybackYears <= yellowMax) return 'yellow';
  return 'grey';
}

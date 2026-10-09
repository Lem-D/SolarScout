// Runs web/src/economics.js over tests/fixtures/economics_cases.json and prints
// JSON results on stdout. Driven by tests/test_economics_parity.py; not useful alone.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { regionParams, evaluate, paybackBand, monthlyOutputKwh }
  from '../web/src/economics.js';

const here = dirname(fileURLToPath(import.meta.url));
const fx = JSON.parse(readFileSync(join(here, 'fixtures/economics_cases.json'), 'utf8'));

const out = fx.cases.map((c) => {
  const p = regionParams(fx.regions[c.region]);
  const r = evaluate(c.usable_area_m2, c.kwh_per_kwp_year, p, {
    capKwp: c.cap_kwp,
    detailed: c.detailed,
  });
  return {
    name: c.name,
    ...r,
    band: paybackBand(r.payback_years, r.viable),
    monthly_kwh: monthlyOutputKwh(fx.monthly_profile.kwh_monthly_per_kwp, r.kwp, p),
  };
});

process.stdout.write(JSON.stringify(out));

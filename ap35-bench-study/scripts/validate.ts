/**
 * Command-line validation of the reference profile against the published data
 * (rated points, S3 performance table with calibration/held-out split,
 * frequency-correction curves). Writes docs/validation_report.json.
 *
 *   npm run validate
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { defaultValues } from '../src/config/registry';
import { runValidation } from '../src/model/validation';

const r = runValidation(defaultValues());
const s = r.summary;
const pct = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(1)} %`;
console.log('Rated cooling  : %s kW (%s)  input %s kW (%s)  COP %s  SHF %s', s.rated_cooling.cap_kW.toFixed(3), pct(s.rated_cooling.cap_err_pct), s.rated_cooling.input_kW.toFixed(3), pct(s.rated_cooling.input_err_pct), s.rated_cooling.cop.toFixed(2), s.rated_cooling.shf.toFixed(2));
console.log('Rated heating  : %s kW (%s)  input %s kW (%s)  COP %s', s.rated_heating.cap_kW.toFixed(3), pct(s.rated_heating.cap_err_pct), s.rated_heating.input_kW.toFixed(3), pct(s.rated_heating.input_err_pct), s.rated_heating.cop.toFixed(2));
for (const [k, v] of [['table, calibration rows', s.table_calibration], ['table, held-out rows', s.table_validation_heldout], ['table, dry rows', s.table_dry_rows]] as const) {
  const t = v as Record<string, number>;
  console.log('%s: n=%d  capacity RMSE %s %%, max %s %%  input RMSE %s %%, max %s %%', k.padEnd(24), t.n, t.capacity_rmse_pct.toFixed(2), t.capacity_max_abs_pct.toFixed(2), t.input_rmse_pct.toFixed(2), t.input_max_abs_pct.toFixed(2));
}
console.log('Frequency curves (factor RMSE): cool cap %s, cool input %s, heat cap held-out %s, heat input held-out %s', s.freq_cool_cap.rmse.toFixed(3), s.freq_cool_in.rmse.toFixed(3), s.freq_heat_cap_heldout.rmse.toFixed(3), s.freq_heat_in_heldout.rmse.toFixed(3));
mkdirSync('docs', { recursive: true });
writeFileSync('docs/validation_report.json', JSON.stringify({ generated: new Date().toISOString(), ...r }, null, 1));
console.log('Wrote docs/validation_report.json');

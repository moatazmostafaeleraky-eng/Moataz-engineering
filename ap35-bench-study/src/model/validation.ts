/**
 * Validation of the steady model against the official AP35 data. The same
 * function is used by the calibration script, the headless tests and the
 * in-app evidence panel, so the reported residuals always come from the
 * running model rather than stored constants.
 */
import type { ProfileValues } from '../config/registry';
import { COOL_PERF_TABLE, FREQ_CORRECTION, RATED } from '../config/published';
import { solveSteady } from './steady';
import * as PS from '../props/psychro';

export const CAL_DB = [24, 27, 30];
export const CAL_OD = [21, 35, 46];
/** heating frequency-correction points used for calibration; the others are held out */
export const HEAT_CAL_HZ = [30, 50, 70, 90];

export interface RowResult { set: 'calibration' | 'validation' | 'dry-row'; db: number; wb: number; od: number; Q: number; Qm: number; SHC: number; SHCm: number; P: number; Pm: number }

function stats(rows: RowResult[]) {
  const n = rows.length || 1;
  const eq = rows.map((r) => (r.Qm - r.Q) / r.Q);
  const ep = rows.map((r) => (r.Pm - r.P) / r.P);
  const es = rows.map((r) => r.SHCm - r.SHC);
  const rms = (a: number[]) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / n);
  const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / n;
  const maxAbs = (a: number[]) => a.reduce((s, v) => Math.max(s, Math.abs(v)), 0);
  return {
    n: rows.length,
    capacity_bias_pct: 100 * mean(eq), capacity_rmse_pct: 100 * rms(eq), capacity_max_abs_pct: 100 * maxAbs(eq),
    input_bias_pct: 100 * mean(ep), input_rmse_pct: 100 * rms(ep), input_max_abs_pct: 100 * maxAbs(ep),
    sensible_rmse_kW: rms(es),
  };
}

const interp = (pts: number[][], x: number) => {
  for (let i = 0; i < pts.length - 1; i++) if (x <= pts[i + 1][0]) return pts[i][1] + ((x - pts[i][0]) / (pts[i + 1][0] - pts[i][0])) * (pts[i + 1][1] - pts[i][1]);
  return pts[pts.length - 1][1];
};

export function ratedPoints(P: ProfileValues) {
  const cool = solveSteady(P, {
    mode: 'cool', f: P.fRatedCool, indoor: { T: 27, w: PS.wFromWB(27, 19) }, outdoor: { T: 35, w: PS.wFromWB(35, 24) }, ifanRpm: 970, ofanRpm: 940,
  });
  const heat = solveSteady(P, {
    mode: 'heat', f: P.fRatedHeat, indoor: { T: 20, w: PS.wFromRH(20, 0.5) }, outdoor: { T: 7, w: PS.wFromWB(7, 6) }, ifanRpm: 1070, ofanRpm: 900,
  });
  return { cool, heat };
}

export function runValidation(P: ProfileValues, opts: { rowsStride?: number } = {}) {
  const stride = opts.rowsStride ?? 1;
  const rows: RowResult[] = [];
  COOL_PERF_TABLE.forEach((r, i) => {
    if (i % stride !== 0 && !(CAL_DB.includes(r[0]) && CAL_OD.includes(r[2]))) return;
    const dry = r[4] >= r[3] - 1e-6;
    const set: RowResult['set'] = dry ? 'dry-row' : CAL_DB.includes(r[0]) && CAL_OD.includes(r[2]) ? 'calibration' : 'validation';
    const s = solveSteady(P, { mode: 'cool', f: P.fRatedCool, indoor: { T: r[0], w: PS.wFromWB(r[0], r[1]) }, outdoor: { T: r[2], w: PS.wFromRH(r[2], 0.4) }, ifanRpm: 970, ofanRpm: 940 });
    rows.push({ set, db: r[0], wb: r[1], od: r[2], Q: r[3], Qm: s.Qnet / 1000, SHC: r[4], SHCm: s.Qsens / 1000, P: r[5], Pm: s.Ptotal });
  });
  const { cool, heat } = ratedPoints(P);
  const ratedCool = { cap_kW: cool.Qnet / 1000, input_kW: cool.Ptotal / 1000, cap_err_pct: (100 * (cool.Qnet / 1000 - RATED.cool.capacity_kW)) / RATED.cool.capacity_kW, input_err_pct: (100 * (cool.Ptotal / 1000 - RATED.cool.input_kW)) / RATED.cool.input_kW, shf: cool.Qsens / cool.Qnet, dehum_L_h: (cool.evapCoil.mCond * 3600), Te: cool.Te, Tc: cool.Tc, Td: cool.cyc.comp.T2, core_residual: cool.coreResidual, cop: cool.Qnet / cool.Ptotal };
  const ratedHeat = { cap_kW: heat.Qnet / 1000, input_kW: heat.Ptotal / 1000, cap_err_pct: (100 * (heat.Qnet / 1000 - RATED.heat.capacity_kW)) / RATED.heat.capacity_kW, input_err_pct: (100 * (heat.Ptotal / 1000 - RATED.heat.input_kW)) / RATED.heat.input_kW, Te: heat.Te, Tc: heat.Tc, Td: heat.cyc.comp.T2, core_residual: heat.coreResidual, cop: heat.Qnet / heat.Ptotal };
  // frequency correction curves
  const freq: { curve: string; set: string; hz: number; published: number; model: number }[] = [];
  for (const hz of [20, 30, 40, 50, 60, 70, 80, 90, 95]) {
    const s = solveSteady(P, { mode: 'cool', f: hz, indoor: { T: 27, w: PS.wFromWB(27, 19) }, outdoor: { T: 35, w: PS.wFromWB(35, 24) }, ifanRpm: 970, ofanRpm: 940 });
    freq.push({ curve: 'cool_cap', set: 'calibration', hz, published: interp(FREQ_CORRECTION.cool_cap.points, hz), model: s.Qnet / cool.Qnet });
    freq.push({ curve: 'cool_in', set: 'calibration', hz, published: interp(FREQ_CORRECTION.cool_in.points, hz), model: s.Ptotal / cool.Ptotal });
  }
  for (const hz of [20, 30, 40, 50, 60, 70, 80, 90, 100, 110]) {
    const s = solveSteady(P, { mode: 'heat', f: hz, indoor: { T: 20, w: PS.wFromRH(20, 0.5) }, outdoor: { T: 7, w: PS.wFromWB(7, 6) }, ifanRpm: 1070, ofanRpm: 900 });
    freq.push({ curve: 'heat_cap', set: HEAT_CAL_HZ.includes(hz) ? 'calibration' : 'validation', hz, published: interp(FREQ_CORRECTION.heat_cap.points, hz), model: s.Qnet / heat.Qnet });
    freq.push({ curve: 'heat_in', set: HEAT_CAL_HZ.includes(hz) ? 'calibration' : 'validation', hz, published: interp(FREQ_CORRECTION.heat_in.points, hz), model: s.Ptotal / heat.Ptotal });
  }
  const fstat = (curve: string, set?: string) => {
    const a = freq.filter((x) => x.curve === curve && (!set || x.set === set)).map((x) => x.model - x.published);
    return { n: a.length, rmse: Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length), max_abs: a.reduce((s, v) => Math.max(s, Math.abs(v)), 0) };
  };
  return {
    summary: {
      rated_cooling: ratedCool,
      rated_heating: ratedHeat,
      table_calibration: stats(rows.filter((r) => r.set === 'calibration')),
      table_validation_heldout: stats(rows.filter((r) => r.set === 'validation')),
      table_dry_rows: stats(rows.filter((r) => r.set === 'dry-row')),
      freq_cool_cap: fstat('cool_cap'), freq_cool_in: fstat('cool_in'),
      freq_heat_cap_heldout: fstat('heat_cap', 'validation'), freq_heat_in_heldout: fstat('heat_in', 'validation'),
      catalogue_range_note: 'Catalogue min/max (1.1-3.8 kW cooling) compared at fMin/fMaxCool in the test suite.',
    },
    rows,
    freq,
  };
}

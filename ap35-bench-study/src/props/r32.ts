/**
 * R32 property access from offline CoolProp tables (scripts/gen_r32_tables.py).
 * Tables are aligned with the saturation boundary: a pressure level is a
 * saturation temperature, and vapour / liquid states are indexed by their
 * superheat / subcooling offset from that boundary. Interpolation therefore
 * never crosses the two-phase dome. Two-phase states use the lever rule on the
 * saturated properties.
 * Units: T degC, P Pa (absolute), h J/kg, s J/(kg K), rho kg/m3.
 */
import table from './r32_tables.json';

interface Tables {
  meta: { backend: string; validity: string; critical: { T: number; P: number } };
  T_sat: number[];
  sat: { P: number[]; rl: number[]; rv: number[]; hl: number[]; hv: number[]; sl: number[]; sv: number[] };
  T_level: number[];
  dSH: number[];
  dSC: number[];
  sup: { h: number[][]; s: number[][]; rho: number[][] };
  sub: { h: number[][]; rho: number[][] };
  check_points: { P: number; T: number; h: number; s: number }[];
}

const R = table as unknown as Tables;
export const R32_META = R.meta;
export const R32_CHECK_POINTS = R.check_points;

/** Flags set by lookups that left the tabulated domain (reset by caller). */
export const domainFlags = { outOfDomain: false, last: '' };
function flag(msg: string) {
  domainFlags.outOfDomain = true;
  domainFlags.last = msg;
}

function locate(axis: number[], x: number): [number, number] {
  const n = axis.length;
  if (x <= axis[0]) {
    if (x < axis[0] - 1e-9) flag(`below table axis (${x.toFixed(2)})`);
    return [0, 0];
  }
  if (x >= axis[n - 1]) {
    if (x > axis[n - 1] + 1e-9) flag(`above table axis (${x.toFixed(2)})`);
    return [n - 2, 1];
  }
  // uniform axes: direct index
  const step = axis[1] - axis[0];
  let i = Math.min(n - 2, Math.max(0, Math.floor((x - axis[0]) / step)));
  while (i > 0 && axis[i] > x) i--;
  while (i < n - 2 && axis[i + 1] < x) i++;
  return [i, (x - axis[i]) / (axis[i + 1] - axis[i])];
}

function lin(arr: number[], i: number, f: number) {
  return arr[i] + (arr[i + 1] - arr[i]) * f;
}

/** Saturation pressure [Pa] at temperature T [degC]. Interpolated in ln(P). */
const lnP = R.sat.P.map(Math.log);
export function psat(T: number): number {
  const [i, f] = locate(R.T_sat, T);
  return Math.exp(lin(lnP, i, f));
}

/** Saturation temperature [degC] at pressure P [Pa]. */
export function tsat(P: number): number {
  const lp = Math.log(P);
  const n = lnP.length;
  if (lp <= lnP[0]) { flag('P below table'); return R.T_sat[0]; }
  if (lp >= lnP[n - 1]) { flag('P above table'); return R.T_sat[n - 1]; }
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (lnP[m] > lp) hi = m; else lo = m;
  }
  const f = (lp - lnP[lo]) / (lnP[hi] - lnP[lo]);
  return R.T_sat[lo] + f * (R.T_sat[hi] - R.T_sat[lo]);
}

export interface SatProps { P: number; rl: number; rv: number; hl: number; hv: number; sl: number; sv: number }
export function satProps(T: number): SatProps {
  const [i, f] = locate(R.T_sat, T);
  return {
    P: Math.exp(lin(lnP, i, f)),
    rl: lin(R.sat.rl, i, f), rv: lin(R.sat.rv, i, f),
    hl: lin(R.sat.hl, i, f), hv: lin(R.sat.hv, i, f),
    sl: lin(R.sat.sl, i, f), sv: lin(R.sat.sv, i, f),
  };
}

function bilinear(grid: number[][], i: number, fi: number, j: number, fj: number) {
  const a = grid[i][j] + (grid[i][j + 1] - grid[i][j]) * fj;
  const b = grid[i + 1][j] + (grid[i + 1][j + 1] - grid[i + 1][j]) * fj;
  return a + (b - a) * fi;
}

/** Superheated vapour at saturation temperature Tsat (pressure level) and superheat dT >= 0. */
export function vapour(Tsat: number, dT: number) {
  const [i, fi] = locate(R.T_level, Tsat);
  const [j, fj] = locate(R.dSH, Math.max(0, dT));
  return {
    h: bilinear(R.sup.h, i, fi, j, fj),
    s: bilinear(R.sup.s, i, fi, j, fj),
    rho: bilinear(R.sup.rho, i, fi, j, fj),
  };
}

/** Compressed liquid at saturation temperature Tsat (pressure level) and subcooling dT >= 0. */
export function liquid(Tsat: number, dT: number) {
  const [i, fi] = locate(R.T_level, Tsat);
  const [j, fj] = locate(R.dSC, Math.max(0, dT));
  return { h: bilinear(R.sub.h, i, fi, j, fj), rho: bilinear(R.sub.rho, i, fi, j, fj) };
}

/** Invert a monotonic superheated-vapour property along the superheat axis at pressure level Tsat. */
function invertSup(grid: number[][], Tsat: number, target: number, what: string): number {
  const [i, fi] = locate(R.T_level, Tsat);
  const a = grid[i], b = grid[i + 1];
  const val = (j: number) => a[j] + (b[j] - a[j]) * fi;
  const n = R.dSH.length;
  if (val(0) >= target) return 0;
  if (val(n - 1) < target) { flag(`${what} beyond table`); return R.dSH[n - 1]; }
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (val(m) < target) lo = m; else hi = m; }
  const vl = val(lo), vh = val(hi);
  return R.dSH[lo] + ((target - vl) / (vh - vl)) * (R.dSH[hi] - R.dSH[lo]);
}
/** Superheat [K] of vapour at pressure level Tsat having entropy s (isentropic compression target). */
export function superheatFromS(Tsat: number, s: number): number {
  return invertSup(R.sup.s, Tsat, s, 'isentropic discharge');
}
/** Superheat [K] of vapour at pressure level Tsat having enthalpy h. */
export function superheatFromH(Tsat: number, h: number): number {
  return invertSup(R.sup.h, Tsat, h, 'discharge enthalpy');
}

export type Phase = 'subcooled' | 'two-phase' | 'superheated';
export interface StatePoint { T: number; P: number; h: number; s: number; phase: Phase; x: number | null; Tsat: number }

/** Full state from pressure level (as Tsat) and enthalpy. Quality only in the dome. */
export function stateFromTsatH(Tsat: number, h: number): StatePoint {
  const sp = satProps(Tsat);
  if (h < sp.hl) {
    // subcooled: invert liquid table (h decreases with subcooling)
    const [i, fi] = locate(R.T_level, Tsat);
    const a = R.sub.h[i], b = R.sub.h[i + 1];
    const val = (j: number) => a[j] + (b[j] - a[j]) * fi;
    let lo = 0, hi = R.dSC.length - 1;
    if (val(hi) > h) { flag('subcooling beyond table'); lo = hi - 1; }
    else while (hi - lo > 1) { const m = (lo + hi) >> 1; if (val(m) > h) lo = m; else hi = m; }
    const d = R.dSC[lo] + ((val(lo) - h) / (val(lo) - val(hi))) * (R.dSC[hi] - R.dSC[lo]);
    return { T: Tsat - d, P: sp.P, h, s: sp.sl - (sp.hl - h) / (273.15 + Tsat - d / 2), phase: 'subcooled', x: null, Tsat };
  }
  if (h > sp.hv) {
    const d = superheatFromH(Tsat, h);
    return { T: Tsat + d, P: sp.P, h, s: vapour(Tsat, d).s, phase: 'superheated', x: null, Tsat };
  }
  const x = (h - sp.hl) / (sp.hv - sp.hl);
  return { T: Tsat, P: sp.P, h, s: sp.sl + x * (sp.sv - sp.sl), phase: 'two-phase', x, Tsat };
}

/** Saturation dome for plotting: arrays of (h, P) on liquid and vapour lines. */
export function dome(): { hl: number[]; hv: number[]; P: number[]; T: number[] } {
  const idx = R.T_sat.map((_, i) => i).filter((i) => i % 4 === 0);
  return {
    hl: idx.map((i) => R.sat.hl[i]),
    hv: idx.map((i) => R.sat.hv[i]),
    P: idx.map((i) => R.sat.P[i]),
    T: idx.map((i) => R.T_sat[i]),
  };
}

export const R32_LIMITS = {
  TsatMin: R.T_level[0],
  TsatMax: R.T_level[R.T_level.length - 1],
  dSHmax: R.dSH[R.dSH.length - 1],
  dSCmax: R.dSC[R.dSC.length - 1],
  Tcrit: R.meta.critical.T,
};

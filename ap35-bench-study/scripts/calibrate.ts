/**
 * Calibrate the reduced-order model against official Mitsubishi Electric data.
 *   npm run calibrate
 * Calibration set : S3 p.29-30 rows with indoor DB in {24,27,30} and outdoor DB in {21,35,46}
 *                   (wet-coil rows only), S3 p.23 cooling frequency-correction curves,
 *                   rated heating point (S1/S3 p.6), indoor fan power (S2 p.6).
 * Validation set  : every other S3 p.29-30 row (held out), S3 p.23 heating curves.
 * Writes src/config/calibration.json and docs/calibration_report.json.
 */
import fs from 'node:fs';
import path from 'node:path';
import { defaultValues, type ProfileValues } from '../src/config/registry';
import { COOL_PERF_TABLE, FREQ_CORRECTION, RATED } from '../src/config/published';
import { solveSteady } from '../src/model/steady';
import * as C from '../src/model/components';
import * as PS from '../src/props/psychro';
import { runValidation } from '../src/model/validation';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

// ---------- indoor fan power (S2 p.6, see discrepancy D4) ----------
function fitIndoorFan(P: ProfileValues) {
  const p1 = C.indoorFan({ ...P, ifanEta: 1, ifanPbase: 0 }, 970, 1);
  const p2 = C.indoorFan({ ...P, ifanEta: 1, ifanPbase: 0 }, 1070, 1);
  const eta = (p2.power - p1.power) / (26 - 19);
  const base = 19 - p1.power / eta;
  return { ifanEta: eta, ifanPbase: base };
}

type Key = keyof ProfileValues;
const FIT: { k: Key; lo: number; hi: number; prior: number }[] = [
  { k: 'Vd', lo: 4e-6, hi: 12e-6, prior: 7.5e-6 },
  { k: 'etaIsPeak', lo: 0.5, hi: 0.85, prior: 0.7 },
  { k: 'etaIsPr', lo: 0.0, hi: 0.25, prior: 0.05 },
  { k: 'prOpt', lo: 1.8, hi: 4.5, prior: 2.8 },
  { k: 'fOpt', lo: 35, hi: 90, prior: 60 },
  { k: 'etaIsHi', lo: 0.0, hi: 4.0, prior: 0.8 },
  { k: 'etaIsLo', lo: 0.0, hi: 1.5, prior: 0.3 },
  { k: 'etaVlow', lo: 0.0, hi: 0.15, prior: 0.04 },
  { k: 'etaVpr', lo: 0.0, hi: 0.12, prior: 0.03 },
  { k: 'pInvFixed', lo: 0, hi: 70, prior: 15 },
  { k: 'uaInAir', lo: 100, hi: 1200, prior: 400 },
  { k: 'uaInRef', lo: 200, hi: 4000, prior: 1000 },
  { k: 'uaOutAir', lo: 150, hi: 1500, prior: 500 },
  { k: 'uaOutRef', lo: 300, hi: 6000, prior: 1500 },
];
const sig = (x: number) => 1 / (1 + Math.exp(-x));
const logit = (y: number) => Math.log(y / (1 - y));
function decode(x: number[], base: ProfileValues): ProfileValues {
  const P = { ...base };
  FIT.forEach((f, i) => ((P as unknown as Record<string, number>)[f.k] = f.lo + (f.hi - f.lo) * sig(x[i])));
  return P;
}
function encode(P: ProfileValues): number[] {
  return FIT.map((f) => logit(Math.min(0.999, Math.max(0.001, ((P[f.k] as number) - f.lo) / (f.hi - f.lo)))));
}

import { CAL_DB, CAL_OD, HEAT_CAL_HZ } from '../src/model/validation';
const calRows = COOL_PERF_TABLE.filter((r) => CAL_DB.includes(r[0]) && CAL_OD.includes(r[2]) && r[4] < r[3] - 1e-6);
const air = (db: number, wb: number) => ({ T: db, w: PS.wFromWB(db, wb) });
const ratedCoolIn = air(RATED.cool.indoorDB, RATED.cool.indoorWB);
const ratedCoolOut = air(RATED.cool.outdoorDB, RATED.cool.outdoorWB);
const ratedHeatIn = { T: 20, w: PS.wFromRH(20, 0.5) };
const ratedHeatOut = air(RATED.heat.outdoorDB, RATED.heat.outdoorWB);
const freqPts = FREQ_CORRECTION.cool_cap.points.filter((p) => p[0] >= 18 && p[0] <= 97 && Math.round(p[0]) % 10 === 0);
const interp = (pts: number[][], x: number) => {
  for (let i = 0; i < pts.length - 1; i++) if (x <= pts[i + 1][0]) return pts[i][1] + ((x - pts[i][0]) / (pts[i + 1][0] - pts[i][0])) * (pts[i + 1][1] - pts[i][1]);
  return pts[pts.length - 1][1];
};

function objective(P: ProfileValues): number {
  let e = 0, n = 0;
  for (const r of calRows) {
    const s = solveSteady(P, { mode: 'cool', f: P.fRatedCool, indoor: air(r[0], r[1]), outdoor: { T: r[2], w: PS.wFromRH(r[2], 0.4) }, ifanRpm: 970, ofanRpm: 940 });
    if (!s.ok) { e += 10; continue; }
    const q = s.Qnet / 1000, qs = s.Qsens / 1000, pin = s.Ptotal;
    e += ((q - r[3]) / r[3]) ** 2 + 0.3 * ((qs - r[4]) / r[3]) ** 2 + ((pin - r[5]) / r[5]) ** 2;
    n += 1;
  }
  e /= Math.max(1, n);
  // frequency correction (cooling) at rating conditions
  const ref = solveSteady(P, { mode: 'cool', f: P.fRatedCool, indoor: ratedCoolIn, outdoor: ratedCoolOut, ifanRpm: 970, ofanRpm: 940 });
  let ef = 0;
  for (const p of freqPts) {
    const s = solveSteady(P, { mode: 'cool', f: p[0], indoor: ratedCoolIn, outdoor: ratedCoolOut, ifanRpm: 970, ofanRpm: 940 });
    ef += (s.Qnet / ref.Qnet - interp(FREQ_CORRECTION.cool_cap.points, p[0])) ** 2;
    ef += (s.Ptotal / ref.Ptotal - interp(FREQ_CORRECTION.cool_in.points, p[0])) ** 2;
  }
  e += (0.8 * ef) / freqPts.length;
  // rated points (strong weight)
  e += 3 * ((ref.Qnet / 1000 - 3.5) / 3.5) ** 2 + 3 * ((ref.Ptotal / 1000 - 0.99) / 0.99) ** 2;
  const h = solveSteady(P, { mode: 'heat', f: P.fRatedHeat, indoor: ratedHeatIn, outdoor: ratedHeatOut, ifanRpm: 1070, ofanRpm: 900 });
  e += h.ok ? 3 * ((h.Qnet / 1000 - 4.0) / 4.0) ** 2 + 3 * ((h.Ptotal / 1000 - 1.03) / 1.03) ** 2 : 10;
  // heating frequency curves: calibration half (30/50/70/90 Hz); 20/40/60/80/100/110 Hz are held out
  if (h.ok) {
    let eh = 0;
    for (const hz of HEAT_CAL_HZ) {
      const s = solveSteady(P, { mode: 'heat', f: hz, indoor: ratedHeatIn, outdoor: ratedHeatOut, ifanRpm: 1070, ofanRpm: 900 });
      eh += (s.Qnet / h.Qnet - interp(FREQ_CORRECTION.heat_cap.points, hz)) ** 2 + (s.Ptotal / h.Ptotal - interp(FREQ_CORRECTION.heat_in.points, hz)) ** 2;
    }
    e += (0.8 * eh) / HEAT_CAL_HZ.length;
  }
  // weak priors (regularisation)
  let reg = 0;
  for (const f of FIT) reg += (((P[f.k] as number) - f.prior) / (f.hi - f.lo)) ** 2;
  return e + 0.002 * reg;
}

function nelderMead(f: (x: number[]) => number, x0: number[], step: number, maxEval: number, log: (s: string) => void) {
  const n = x0.length;
  let simplex = [x0, ...x0.map((_, i) => x0.map((v, j) => (i === j ? v + step : v)))];
  let vals = simplex.map(f);
  let evals = n + 1;
  while (evals < maxEval) {
    const idx = vals.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]).map((a) => a[1]);
    simplex = idx.map((i) => simplex[i]); vals = idx.map((i) => vals[i]);
    if (Math.abs(vals[n] - vals[0]) < 1e-9 * (1 + Math.abs(vals[0]))) break;
    const cen = x0.map((_, j) => simplex.slice(0, n).reduce((s, p) => s + p[j], 0) / n);
    const refl = cen.map((c, j) => c + (c - simplex[n][j]));
    const fr = f(refl); evals++;
    if (fr < vals[0]) {
      const exp = cen.map((c, j) => c + 2 * (c - simplex[n][j]));
      const fe = f(exp); evals++;
      if (fe < fr) { simplex[n] = exp; vals[n] = fe; } else { simplex[n] = refl; vals[n] = fr; }
    } else if (fr < vals[n - 1]) { simplex[n] = refl; vals[n] = fr; }
    else {
      const con = cen.map((c, j) => c + 0.5 * (simplex[n][j] - c));
      const fc = f(con); evals++;
      if (fc < vals[n]) { simplex[n] = con; vals[n] = fc; }
      else {
        for (let i = 1; i <= n; i++) { simplex[i] = simplex[i].map((v, j) => simplex[0][j] + 0.5 * (v - simplex[0][j])); vals[i] = f(simplex[i]); evals++; }
      }
    }
    if (evals % 100 < 3) log(`  evals ${evals} best ${vals[0].toExponential(4)}`);
  }
  const best = vals.indexOf(Math.min(...vals));
  return { x: simplex[best], fx: vals[best], evals };
}

async function main() {
  const t0 = Date.now();
  let P = defaultValues();
  Object.assign(P, fitIndoorFan(P));
  console.log('indoor fan:', P.ifanEta.toFixed(4), P.ifanPbase.toFixed(3), `calibration rows: ${calRows.length}`);
  let x = encode(P);
  const budget = Number(process.env.CAL_EVALS ?? 2400);
  for (const step of [0.6, 0.25]) {
    const r = nelderMead((xx) => objective(decode(xx, P)), x, step, budget / 2, console.log);
    x = r.x;
    console.log(`restart step ${step}: J=${r.fx.toExponential(4)} evals=${r.evals}`);
  }
  P = decode(x, P);
  // LEV Cv so that rated cooling needs ~45 % opening
  const rc = solveSteady(P, { mode: 'cool', f: P.fRatedCool, indoor: ratedCoolIn, outdoor: ratedCoolOut, ifanRpm: 970, ofanRpm: 940 });
  const unit = C.levFlow({ ...P, eevCv: 1 }, 1, rc.Tc, rc.Te);
  P.eevCv = rc.cyc.comp.m / (0.45 * unit);
  const out: Record<string, number | string> = {};
  for (const f of FIT) out[f.k] = Number((P[f.k] as number).toPrecision(6));
  out.ifanEta = Number(P.ifanEta.toPrecision(6));
  out.ifanPbase = Number(P.ifanPbase.toPrecision(6));
  out.eevCv = Number(P.eevCv.toPrecision(6));
  out._generated = new Date().toISOString().slice(0, 10);
  out._method = 'Nelder-Mead on sigmoid-bounded parameters; objective = relative errors on calibration rows + S3 p.23 cooling curves + rated points + weak priors';
  fs.writeFileSync(path.join(ROOT, 'src/config/calibration.json'), JSON.stringify(out, null, 2));
  const report = runValidation(P);
  fs.mkdirSync(path.join(ROOT, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'docs/calibration_report.json'), JSON.stringify({ parameters: out, ...report }, null, 1));
  console.log(JSON.stringify(report.summary, null, 2));
  console.log('done in', ((Date.now() - t0) / 1000).toFixed(0), 's');
}
main();

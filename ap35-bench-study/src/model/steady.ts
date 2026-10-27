/**
 * Steady-state operating point of the coupled cycle at fixed compressor
 * frequency, fan speeds, superheat and entering air states. Closure: the
 * evaporator and condenser saturation temperatures are found so that the
 * air-side coil heat equals the refrigerant-side heat at both coils
 * (nested bracketed false-position). Used for calibration, validation and
 * as the reference the dynamic plant must settle to.
 */
import type { ProfileValues } from '../config/registry';
import * as C from './components';
import type { AirState, CoilAir, CycleEval, FanPoint } from './components';

export interface SteadyInputs {
  mode: 'cool' | 'heat';
  f: number;
  indoor: AirState;
  outdoor: AirState;
  ifanRpm: number;
  ofanRpm: number;
  SH?: number;
  filter?: number;
  fouling?: number;
  frostKg?: number;
  outletAreaRatio?: number; // effective / reference (1 = published test)
}

export interface SteadyResult {
  ok: boolean;
  message: string;
  Te: number; Tc: number;
  cyc: CycleEval;
  evapCoil: CoilAir; condCoil: CoilAir;
  ifan: FanPoint; ofan: FanPoint;
  /** useful room capacity incl. indoor fan heat [W] (cooling positive removes heat; heating positive adds) */
  Qnet: number; Qgross: number; Qsens: number; Qlat: number;
  Pcomp: number; Ptotal: number;
  /** core-cycle residual: (Qcond_air - (Qevap_air + Qpickup + Wref)) / Qcond_air */
  coreResidual: number;
  supply: AirState;
  iterations: number;
}

function falsePosition(fn: (x: number) => number, a: number, b: number, tol: number, maxIt = 60): { x: number; it: number; ok: boolean } {
  let fa = fn(a), fb = fn(b);
  if (fa * fb > 0) return { x: Math.abs(fa) < Math.abs(fb) ? a : b, it: 0, ok: false };
  let side = 0, x = a;
  for (let i = 0; i < maxIt; i++) {
    x = (a * fb - b * fa) / (fb - fa);
    const fx = fn(x);
    if (Math.abs(fx) < tol || Math.abs(b - a) < 1e-6) return { x, it: i + 1, ok: true };
    if (fx * fb > 0) { b = x; fb = fx; if (side === -1) fa /= 2; side = -1; }
    else { a = x; fa = fx; if (side === 1) fb /= 2; side = 1; }
  }
  return { x, it: maxIt, ok: true };
}

export function solveSteady(P: ProfileValues, inp: SteadyInputs): SteadyResult {
  const SH = inp.SH ?? P.shTarget;
  const cool = inp.mode === 'cool';
  const rIn = C.indoorResistance(P, inp.filter ?? 0, inp.fouling ?? 0, inp.outletAreaRatio ?? 1, 1).total;
  const frost = inp.frostKg ?? 0;
  const ifan = C.indoorFan(P, inp.ifanRpm, rIn);
  const ofan = C.outdoorFan(P, inp.ofanRpm, 1 + 1.5 * (frost / P.frostRef) ** 2);
  const maIn = C.dryAirFlow(ifan.q_m3h, inp.indoor);
  const maOut = C.dryAirFlow(ofan.q_m3h, inp.outdoor);
  const uaInA = C.uaAirIndoor(P, ifan.q_m3h, inp.fouling ?? 0);
  const uaOutA = C.uaAirOutdoor(P, ofan.q_m3h, 0, frost);

  const evapAir = cool ? inp.indoor : inp.outdoor;
  const condAir = cool ? inp.outdoor : inp.indoor;
  const maE = cool ? maIn : maOut, maC = cool ? maOut : maIn;
  const uaAE = cool ? uaInA : uaOutA, uaAC = cool ? uaOutA : uaInA;
  const uaRE = (cool ? P.uaInRef : P.uaOutRef) * (1 - C.superheatFraction(P, SH));
  const uaRC = cool ? P.uaOutRef : P.uaInRef;

  let iterations = 0;
  let lastTe = evapAir.T - 10;
  const innerTe = (Tc: number) => {
    const g = (Te: number) => {
      const cyc = C.evalCycle(P, inp.f, Te, Tc, SH, 1, false);
      const coil = C.solveCoil(evapAir, maE, uaAE, uaRE, Te);
      return coil.Qcoil - cyc.QevapRef;
    };
    const hi = Math.min(evapAir.T - 0.2, Tc - 1);
    const r = falsePosition(g, -35, hi, 0.5);
    iterations += r.it;
    lastTe = r.x;
    return r.x;
  };
  const outer = (Tc: number) => {
    const Te = innerTe(Tc);
    const cyc = C.evalCycle(P, inp.f, Te, Tc, SH, 1, false);
    const coil = C.solveCoil(condAir, maC, uaAC, uaRC, Tc);
    return -coil.Qcoil - cyc.QcondRef;
  };
  const rc = falsePosition(outer, condAir.T + 0.3, 72, 0.5);
  const Tc = rc.x;
  const Te = innerTe(Tc);
  const cyc = C.evalCycle(P, inp.f, Te, Tc, SH);
  const evapCoil = C.solveCoil(evapAir, maE, uaAE, uaRE, Te);
  const condCoil = C.solveCoil(condAir, maC, uaAC, uaRC, Tc);

  const Pcomp = cyc.comp.Pelec;
  const Ptotal = Pcomp + ifan.power + ofan.power + P.pControls;
  let Qgross: number, Qnet: number, Qsens: number, Qlat: number, supply: AirState;
  if (cool) {
    Qgross = evapCoil.Qtotal;
    Qnet = Qgross - ifan.power;
    Qsens = evapCoil.Qsens - ifan.power;
    Qlat = evapCoil.Qlat;
    supply = { T: evapCoil.out.T + ifan.power / (maIn * 1006), w: evapCoil.out.w };
  } else {
    Qgross = -condCoil.Qtotal;
    Qnet = Qgross + ifan.power;
    Qsens = Qnet;
    Qlat = 0;
    supply = { T: condCoil.out.T + ifan.power / (maIn * 1006), w: condCoil.out.w };
  }
  const qCondAir = -condCoil.Qcoil;
  const coreResidual = (qCondAir - (evapCoil.Qcoil + cyc.Qpickup + cyc.comp.Wref)) / Math.max(1, qCondAir);
  const ok = rc.ok && Number.isFinite(Tc) && Number.isFinite(Te) && Te < Tc;
  return {
    ok, message: ok ? 'converged' : 'no bracket / failed',
    Te, Tc, cyc, evapCoil, condCoil, ifan, ofan,
    Qnet, Qgross, Qsens, Qlat, Pcomp, Ptotal, coreResidual, supply, iterations,
  };
  void lastTe;
}

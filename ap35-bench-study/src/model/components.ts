/**
 * Component models shared by the steady-state solver (calibration) and the
 * dynamic plant: fans on resistance curves, rotary compressor surrogate map,
 * LEV, wet/dry coil (bypass-factor / apparatus-dew-point), and the
 * refrigerant cycle evaluation at given saturation temperatures.
 * SI units unless named: T degC, P Pa abs, h J/kg, flows kg/s, airflow m3/h at the fan.
 */
import type { ProfileValues } from '../config/registry';
import { INDOOR_FAN_COOL, INDOOR_FAN_HEAT, OUTDOOR_FAN_COOL, OUTDOOR_FAN_HEAT } from '../config/published';
import * as R32 from '../props/r32';
import * as PS from '../props/psychro';

// ---------------------------------------------------------------- fans
function mergeCurve(a: [number, number][], b: [number, number][]): [number, number][] {
  const m = new Map<number, number[]>();
  for (const [r, q] of [...a, ...b]) m.set(r, [...(m.get(r) ?? []), q]);
  return [...m.entries()].map(([r, qs]) => [r, qs.reduce((x, y) => x + y, 0) / qs.length] as [number, number]).sort((x, y) => x[0] - y[0]);
}
/** S2 p.6: cooling and heating rpm-airflow points lie on one curve within 1 %, so they are merged. */
export const INDOOR_CURVE = mergeCurve(INDOOR_FAN_COOL, INDOOR_FAN_HEAT);
export const OUTDOOR_CURVE = mergeCurve(OUTDOOR_FAN_COOL, OUTDOOR_FAN_HEAT);
export const IFAN_Q_SH = 684; // m3/h, cooling Super High (S2 p.6)
export const OFAN_Q_REF = 2178; // m3/h at 940 rpm (S3 p.6)

/** Airflow at the reference (clean, published-test) resistance for a fan speed; affinity outside the table. */
export function flowAtRef(curve: [number, number][], rpm: number): { q: number; extrapolated: boolean } {
  if (rpm <= 0) return { q: 0, extrapolated: false };
  const n = curve.length;
  if (rpm < curve[0][0]) return { q: (curve[0][1] * rpm) / curve[0][0], extrapolated: true };
  if (rpm > curve[n - 1][0]) return { q: (curve[n - 1][1] * rpm) / curve[n - 1][0], extrapolated: true };
  for (let i = 0; i < n - 1; i++) {
    if (rpm <= curve[i + 1][0]) {
      const f = (rpm - curve[i][0]) / (curve[i + 1][0] - curve[i][0]);
      return { q: curve[i][1] + f * (curve[i + 1][1] - curve[i][1]), extrapolated: false };
    }
  }
  return { q: curve[n - 1][1], extrapolated: false };
}

/**
 * Fan curve dp = P0 (1 - (Q/Qf)^2) intersecting system k r Q^2, where the published
 * point sits at Q/Qf = phi when r = 1. Returns flow ratio to the reference point.
 */
export function flowRatioForResistance(r: number, phi: number): number {
  const a = 1 / (1 - phi * phi);
  return Math.sqrt(a / (Math.max(0.05, r) + phi * phi * a));
}

export interface FanPoint { rpm: number; q_m3h: number; dp: number; power: number; extrapolated: boolean; r: number }

export function indoorFan(P: ProfileValues, rpm: number, r: number): FanPoint {
  const ref = flowAtRef(INDOOR_CURVE, rpm);
  const q = ref.q * flowRatioForResistance(r, P.ifanPhi);
  const kRef = P.ifanDpRef / (IFAN_Q_SH / 3600) ** 2;
  const dp = kRef * r * (q / 3600) ** 2;
  const power = rpm > 1 ? P.ifanPbase + (dp * (q / 3600)) / P.ifanEta : 0;
  return { rpm, q_m3h: q, dp, power, extrapolated: ref.extrapolated, r };
}

export function outdoorFan(P: ProfileValues, rpm: number, r: number): FanPoint {
  const ref = flowAtRef(OUTDOOR_CURVE, rpm);
  const q = ref.q * flowRatioForResistance(r, P.ofanPhi);
  const kRef = P.ofanDpRef / (OFAN_Q_REF / 3600) ** 2;
  const dp = kRef * r * (q / 3600) ** 2;
  const pAirRef = P.ofanDpRef * (OFAN_Q_REF / 3600);
  const power = rpm > 1 ? (P.ofanPref * (dp * (q / 3600))) / pAirRef : 0;
  return { rpm, q_m3h: q, dp, power, extrapolated: ref.extrapolated, r };
}

/** Effective outlet free area [m2] from vane state; 0 when closed. */
export function outletArea(P: ProfileValues, vaneAngleDeg: number, wideAngleDeg: number, vaneOpen: number): number {
  const base = P.outletW * P.outletH;
  // Flap near its extremes partly obstructs the nozzle (assumed shape).
  const a = Math.max(-10, Math.min(90, vaneAngleDeg));
  const vaneF = 1 - 0.25 * Math.max(0, (a - 55) / 35) ** 2 - 0.1 * Math.max(0, (5 - a) / 15) ** 2;
  const wideF = 0.82 + 0.18 * Math.cos((wideAngleDeg * Math.PI) / 180);
  return base * Math.max(0.02, vaneOpen) * vaneF * wideF;
}

export interface IndoorResistance { filter: number; coil: number; outlet: number; total: number }
/** Indoor resistance ratio vs published test (1.0 = clean filter, clean dry coil, reference outlet). */
export function indoorResistance(P: ProfileValues, filterRestriction: number, coilFouling: number, outletA: number, refA: number): IndoorResistance {
  const filter = P.resFilterShare * (1 + filterRestriction);
  const coil = P.resCoilShare * (1 + 1.5 * coilFouling);
  const outlet = P.resOutletShare * (refA / Math.max(1e-4, outletA)) ** 2;
  return { filter, coil, outlet, total: filter + coil + outlet };
}

// ---------------------------------------------------------------- coils
export interface AirState { T: number; w: number }
export interface CoilAir {
  /** heat from air into coil surface [W] (positive: air is cooled), net of condensate enthalpy */
  Qcoil: number;
  /** air-side total enthalpy change m_a (h_in - h_out) [W] */
  Qtotal: number;
  Qsens: number;
  Qlat: number;
  Ts: number;
  out: AirState;
  /** water deposited on the surface [kg/s] (liquid above 0 degC, frost below) */
  mCond: number;
  wet: boolean;
  BF: number;
}

/** Air side of a coil at a uniform surface temperature Ts (bypass factor / ADP method). */
export function coilAirSide(air: AirState, ma: number, uaAir: number, Ts: number): CoilAir {
  if (ma <= 1e-6) {
    return { Qcoil: 0, Qtotal: 0, Qsens: 0, Qlat: 0, Ts, out: { ...air }, mCond: 0, wet: false, BF: 1 };
  }
  const cp = PS.cpMoist(air.w);
  const BF = Math.exp(-uaAir / (ma * cp));
  const hin = PS.enthalpy(air.T, air.w);
  const wsS = PS.wsat(Ts);
  if (wsS >= air.w) {
    const Q = ma * cp * (1 - BF) * (air.T - Ts);
    const Tout = air.T - Q / (ma * cp);
    return { Qcoil: Q, Qtotal: Q, Qsens: Q, Qlat: 0, Ts, out: { T: Tout, w: air.w }, mCond: 0, wet: false, BF };
  }
  const hS = PS.enthalpy(Ts, wsS);
  const Qt = ma * (1 - BF) * (hin - hS);
  const wout = wsS + BF * (air.w - wsS);
  const hout = hin - Qt / ma;
  const Tout = PS.tFromHW(hout, wout);
  const mCond = ma * (air.w - wout);
  const Qs = ma * cp * (air.T - Tout);
  return { Qcoil: Qt - mCond * PS.hCondensate(Ts), Qtotal: Qt, Qsens: Qs, Qlat: Qt - Qs, Ts, out: { T: Tout, w: wout }, mCond, wet: true, BF };
}

/**
 * Coil with refrigerant at saturation temperature Tr through refrigerant-side
 * conductance uaRef: finds surface temperature where air-side heat equals
 * refrigerant-side heat (both directions: evaporator or condenser).
 */
export function solveCoil(air: AirState, ma: number, uaAir: number, uaRef: number, Tr: number): CoilAir {
  if (ma <= 1e-6) {
    return { Qcoil: 0, Qtotal: 0, Qsens: 0, Qlat: 0, Ts: Tr, out: { ...air }, mCond: 0, wet: false, BF: 1 };
  }
  const cp = PS.cpMoist(air.w);
  const A = ma * cp * (1 - Math.exp(-uaAir / (ma * cp)));
  // dry analytic guess
  const TsDry = (A * air.T + uaRef * Tr) / (A + uaRef);
  if (PS.wsat(TsDry) >= air.w) return coilAirSide(air, ma, uaAir, TsDry);
  // wet: false-position (Illinois) on F(Ts) = Qcoil(Ts) - uaRef (Ts - Tr), decreasing in Ts
  let lo = Math.min(Tr, air.T) - 0.5, hi = TsDry;
  let Flo = coilAirSide(air, ma, uaAir, lo).Qcoil - uaRef * (lo - Tr);
  let Fhi = coilAirSide(air, ma, uaAir, hi).Qcoil - uaRef * (hi - Tr);
  if (Flo < 0) return coilAirSide(air, ma, uaAir, lo);
  let side = 0;
  let x = hi;
  for (let k = 0; k < 40; k++) {
    x = (lo * Fhi - hi * Flo) / (Fhi - Flo);
    const Fx = coilAirSide(air, ma, uaAir, x).Qcoil - uaRef * (x - Tr);
    if (Math.abs(Fx) < 0.5 || hi - lo < 1e-4) break;
    if (Fx > 0) { lo = x; Flo = Fx; if (side === 1) Fhi /= 2; side = 1; }
    else { hi = x; Fhi = Fx; if (side === -1) Flo /= 2; side = -1; }
  }
  return coilAirSide(air, ma, uaAir, x);
}

// ---------------------------------------------------------------- compressor
export interface CompResult {
  m: number; etaV: number; etaIs: number; etaMi: number; PR: number;
  h1: number; s1: number; rho1: number; h2s: number; h2: number; T2: number;
  Wshaft: number; Wref: number; Qshell: number; Pelec: number; Ploss: number;
}

export function compressor(P: ProfileValues, f: number, Te: number, Tc: number, suction: { h: number; s: number; rho: number }): CompResult {
  const Pe = R32.psat(Te), Pc = R32.psat(Tc);
  const PR = Math.max(1.0, Pc / Pe);
  if (f <= 0.01) {
    return { m: 0, etaV: 0, etaIs: 0, etaMi: 0, PR, h1: suction.h, s1: suction.s, rho1: suction.rho, h2s: suction.h, h2: suction.h, T2: Tc, Wshaft: 0, Wref: 0, Qshell: 0, Pelec: 0, Ploss: 0 };
  }
  const etaV = Math.min(0.98, Math.max(0.3, P.etaV0 - P.etaVpr * (PR - 1) - P.etaVlow * (20 / Math.max(5, f))));
  const m = etaV * suction.rho * P.Vd * f;
  const dsh2s = R32.superheatFromS(Tc, suction.s);
  const h2s = R32.vapour(Tc, dsh2s).h;
  const lo = Math.max(0, (P.fOpt - f) / P.fOpt);
  const hi = Math.max(0, (f - P.fOpt) / P.fOpt);
  const etaIs = Math.min(0.85, Math.max(0.2, P.etaIsPeak * (1 - P.etaIsPr * (PR / P.prOpt - 1) ** 2) * (1 - P.etaIsLo * lo * lo)));
  const etaMi = Math.max(0.3, P.etaMotorInv * (1 - P.etaIsHi * hi * hi));
  const Wshaft = (m * Math.max(1, h2s - suction.h)) / etaIs;
  const Qshell = P.fShell * Wshaft;
  const Wref = Wshaft - Qshell;
  const h2 = suction.h + Wref / Math.max(1e-6, m);
  const T2 = Tc + R32.superheatFromH(Tc, h2);
  const Pelec = Wshaft / etaMi + P.pInvFixed;
  return { m, etaV, etaIs, etaMi, PR, h1: suction.h, s1: suction.s, rho1: suction.rho, h2s, h2, T2, Wshaft, Wref, Qshell, Pelec, Ploss: Pelec - Wshaft };
}

/** Compressor mass flow only (no compression calculation). */
export function compMassFlow(P: ProfileValues, f: number, Te: number, Tc: number, SHevap: number): number {
  if (f <= 0.01) return 0;
  const suc = suctionState(P, Te, SHevap, 1);
  const PR = Math.max(1, R32.psat(Math.max(Tc, Te + 0.5)) / R32.psat(Te));
  const etaV = Math.min(0.98, Math.max(0.3, P.etaV0 - P.etaVpr * (PR - 1) - P.etaVlow * (20 / Math.max(5, f))));
  return etaV * suc.rho * P.Vd * f;
}

/** LEV + capillary mass flow [kg/s] for opening 0..1. */
export function levFlow(P: ProfileValues, opening: number, Tc: number, Te: number): number {
  const dP = Math.max(0, R32.psat(Tc) - R32.psat(Te));
  const rho3 = R32.liquid(Tc, P.subcool).rho;
  return P.eevCv * Math.max(0, Math.min(1, opening)) * Math.sqrt(2 * rho3 * dP);
}

// ---------------------------------------------------------------- cycle
export interface CyclePoint { T: number; P: number; h: number; s: number; phase: R32.Phase; x: number | null; Tsat: number }
export interface CycleEval {
  Te: number; Tc: number; SHevap: number; SHsuct: number; SC: number; xSuct: number;
  p1e: CyclePoint; p1: CyclePoint; p2: CyclePoint; p3: CyclePoint; p4: CyclePoint;
  comp: CompResult;
  QevapRef: number; Qpickup: number; QcondRef: number;
}

/** Suction state at evaporator saturation Te with evaporator-outlet superheat and line pickup. */
export function suctionState(P: ProfileValues, Te: number, SHevap: number, xSuct: number) {
  if (xSuct < 0.9999) {
    const sp = R32.satProps(Te);
    const h = sp.hl + xSuct * (sp.hv - sp.hl);
    const s = sp.sl + xSuct * (sp.sv - sp.sl);
    const rho = 1 / (xSuct / sp.rv + (1 - xSuct) / sp.rl);
    return { h, s, rho, T: Te, superheat: 0 };
  }
  const sh = SHevap + P.tPickup;
  const v = R32.vapour(Te, sh);
  return { h: v.h, s: v.s, rho: v.rho, T: Te + sh, superheat: sh };
}

export function evalCycle(P: ProfileValues, f: number, Te: number, Tc: number, SHevap: number, xSuct = 1, detail = true): CycleEval {
  const TcEff = Math.max(Tc, Te + 0.5);
  const suc = suctionState(P, Te, SHevap, xSuct);
  let comp: CompResult;
  if (xSuct < 0.9999) {
    // liquid carry-over: the compressor pumps saturated vapour; the entrained liquid
    // evaporates in the shell and lowers the discharge enthalpy (energy-consistent mixing)
    const v = R32.vapour(Te, 0);
    const cv = compressor(P, f, Te, TcEff, { h: v.h, s: v.s, rho: v.rho });
    const mTot = cv.m / xSuct;
    const hl = R32.satProps(Te).hl;
    const h2 = (cv.m * cv.h2 + (mTot - cv.m) * hl) / Math.max(1e-9, mTot);
    const st = R32.stateFromTsatH(TcEff, h2);
    comp = { ...cv, m: mTot, h1: suc.h, s1: suc.s, h2, T2: st.T };
  } else comp = compressor(P, f, Te, TcEff, suc);
  const sp = R32.satProps(Te);
  const evapOut = xSuct < 0.9999 ? { h: suc.h, s: suc.s } : R32.vapour(Te, SHevap);
  const liq = R32.liquid(TcEff, P.subcool);
  const h3 = liq.h;
  const pe = sp.P, pc = R32.psat(TcEff);
  let p1e: CyclePoint, p1: CyclePoint, p2: CyclePoint, p3: CyclePoint, p4: CyclePoint;
  if (detail) {
    const st4 = R32.stateFromTsatH(Te, h3);
    p1e = xSuct < 0.9999
      ? { T: Te, P: pe, h: evapOut.h, s: evapOut.s, phase: 'two-phase', x: xSuct, Tsat: Te }
      : { T: Te + SHevap, P: pe, h: evapOut.h, s: evapOut.s, phase: SHevap > 0.05 ? 'superheated' : 'two-phase', x: SHevap > 0.05 ? null : 1, Tsat: Te };
    p1 = { T: suc.T, P: pe, h: suc.h, s: suc.s, phase: suc.superheat > 0.05 ? 'superheated' : 'two-phase', x: suc.superheat > 0.05 ? null : xSuct, Tsat: Te };
    p2 = { ...R32.stateFromTsatH(TcEff, comp.h2), P: pc };
    p3 = { T: TcEff - P.subcool, P: pc, h: h3, s: R32.stateFromTsatH(TcEff, h3).s, phase: P.subcool > 0.05 ? 'subcooled' : 'two-phase', x: P.subcool > 0.05 ? null : 0, Tsat: TcEff };
    p4 = { ...st4, P: pe };
  } else {
    const dummy = (T: number, Pp: number, h: number): CyclePoint => ({ T, P: Pp, h, s: 0, phase: 'two-phase', x: null, Tsat: T });
    p1e = dummy(Te + SHevap, pe, evapOut.h); p1 = dummy(suc.T, pe, suc.h); p2 = dummy(comp.T2, pc, comp.h2); p3 = dummy(TcEff - P.subcool, pc, h3); p4 = dummy(Te, pe, h3);
  }
  const m = comp.m;
  return {
    Te, Tc: TcEff, SHevap, SHsuct: suc.superheat, SC: P.subcool, xSuct,
    p1e, p1, p2, p3, p4, comp,
    QevapRef: m * (evapOut.h - h3),
    Qpickup: m * (suc.h - evapOut.h),
    QcondRef: m * (comp.h2 - h3),
  };
}

/** Fraction of evaporator area used for superheating (reduced-order moving boundary). */
export function superheatFraction(P: ProfileValues, SH: number): number {
  return (P.shFracMax * Math.max(0, SH)) / (Math.max(0, SH) + 15);
}

export function uaAirIndoor(P: ProfileValues, q_m3h: number, fouling: number): number {
  return P.uaInAir * Math.pow(Math.max(1e-3, q_m3h) / IFAN_Q_SH, P.uaExp) * (1 - 0.5 * fouling);
}
export function uaAirOutdoor(P: ProfileValues, q_m3h: number, fouling: number, frostKg: number): number {
  const frostF = 1 / (1 + frostKg / P.frostRef);
  return P.uaOutAir * Math.pow(Math.max(1e-3, q_m3h) / OFAN_Q_REF, P.uaExp) * (1 - 0.5 * fouling) * frostF;
}

/** Dry-air mass flow [kg/s] from volumetric fan flow at the entering state. */
export function dryAirFlow(q_m3h: number, air: AirState): number {
  return q_m3h / 3600 / PS.specVol(air.T, air.w);
}

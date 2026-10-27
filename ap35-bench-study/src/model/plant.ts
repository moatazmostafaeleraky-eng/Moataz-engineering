/**
 * Dynamic plant: one fixed time step of the coupled indoor unit, outdoor unit,
 * refrigerant circuit and room. Pure function of (state, actuator commands,
 * environment, faults). Coil saturation temperatures are lumped thermal
 * nodes (metal + refrigerant hold-up); refrigerant flows are quasi-steady
 * within the step; evaporator superheat integrates the compressor/LEV mass
 * flow mismatch (reduced-order inventory). Explicit Euler with bounded states.
 */
import { defaultValues, type ProfileValues } from '../config/registry';
import * as C from './components';
import * as PS from '../props/psychro';
import * as R32 from '../props/r32';
import type { Environment, Faults, Outputs, PlantState } from './types';

export interface ActuatorCmd {
  f: number; // compressor operational frequency command (Hz); 0 = stop
  ifan: number; ofan: number; // rpm
  eev: number; // 0..1
  vaneUpper: number; vaneLower: number; wide: number; vaneOpen: number;
  rv: number; // 0 cooling position, 1 heating position
}

const M_REF = 0.0135; // kg/s, refrigerant flow at rated cooling (normalisation only)
const UA_NAT_IN = 6; // W/K natural convection, indoor coil with fan stopped (assumed)
const UA_NAT_OUT = 12; // W/K outdoor coil with fan stopped (assumed)
const TAU_DIS = 25; // s discharge pipe thermistor / pipe lag (assumed)
const TAU_SHELL_OFF = 900; // s shell cooling when off (assumed)
const TAU_FIN = 90; // s heat-sink time constant (assumed)

export function outdoorAir(env: Environment) {
  return { T: env.outdoorT, w: PS.wFromRH(env.outdoorT, env.outdoorRH / 100, env.patm) };
}

export function initialPlant(P: ProfileValues, env: Environment, room: { T: number; RH: number }): PlantState {
  return {
    TinCoil: room.T, ToutCoil: env.outdoorT, SH: 0, Tdis: env.outdoorT, Tfin: env.outdoorT,
    frost: 0, film: 0, fAct: 0, compRunning: false, ifanAct: 0, ofanAct: 0, eevAct: 0.25,
    vaneUpper: -30, vaneLower: -30, wideAct: 0, vaneOpen: 0, rv: 0,
    Troom: room.T, wroom: PS.wFromRH(room.T, room.RH / 100, env.patm), Tmass: room.T,
    E_total: 0, E_comp: 0, E_ifan: 0, E_ofan: 0, Q_net: 0, Q_gross: 0, condensateL: 0, frostMeltedKg: 0, defrostEnergy: 0, runTime: 0,
  };
  void P;
}

const rate = (x: number, target: number, maxStep: number) => (Math.abs(target - x) <= maxStep ? target : x + Math.sign(target - x) * maxStep);

const REF_P = defaultValues();
/** Outlet free area of the published (reference) geometry: resistance ratios are relative to the tested unit. */
export function refOutletArea(_P?: ProfileValues) {
  return C.outletArea(REF_P, 30, 0, 1);
}

export function plantStep(P: ProfileValues, s0: PlantState, cmd: ActuatorCmd, env: Environment, faults: Faults, dt: number, defrosting: boolean, detail = true): { s: PlantState; out: Outputs } {
  const s: PlantState = { ...s0 };
  const flags: string[] = [];
  R32.domainFlags.outOfDomain = false;

  // ---- actuators
  const fTarget = cmd.f > 0.5 ? cmd.f : 0;
  if (fTarget > 0 && !s.compRunning) { s.compRunning = true; s.fAct = Math.max(s.fAct, 5); }
  s.fAct = s.fAct + (fTarget - s.fAct) * Math.min(1, dt / 1.5);
  if (fTarget === 0 && s.fAct < 2) { s.fAct = 0; s.compRunning = false; }
  const ifanTarget = faults.indoorFanFault ? 0 : cmd.ifan;
  s.ifanAct = rate(s.ifanAct, ifanTarget, (faults.indoorFanFault ? 400 : P.ifanRampRate) * dt);
  const ofanTarget = faults.outdoorFanFault ? 0 : cmd.ofan;
  s.ofanAct = rate(s.ofanAct, ofanTarget, (faults.outdoorFanFault ? 300 : P.ofanRampRate) * dt);
  s.eevAct = rate(s.eevAct, Math.max(0, Math.min(1, cmd.eev)), (P.eevRate / 100) * dt);
  s.vaneUpper = rate(s.vaneUpper, cmd.vaneUpper, P.vaneRate * dt);
  s.vaneLower = rate(s.vaneLower, cmd.vaneLower, P.vaneRate * dt);
  s.wideAct = rate(s.wideAct, cmd.wide, P.wideRate * dt);
  s.vaneOpen = rate(s.vaneOpen, cmd.vaneOpen, dt / 2.5);
  s.rv = rate(s.rv, cmd.rv, dt / 1.0);
  const rvPos = s.rv > 0.5 ? 1 : 0;

  // ---- air states
  const room = { T: s.Troom, w: s.wroom };
  const outA = outdoorAir(env);

  // ---- fans on resistance curves
  const jetAngle = 0.65 * s.vaneUpper + 0.35 * s.vaneLower;
  const area = C.outletArea(P, jetAngle, s.wideAct, s.vaneOpen);
  const res = C.indoorResistance(P, faults.filterRestriction, faults.coilFouling, area, refOutletArea(P));
  const ifan = C.indoorFan(P, s.ifanAct, res.total);
  const ofanR = 1 + 1.5 * (s.frost / P.frostRef) ** 2 + 1.2 * faults.outdoorFouling;
  const ofan = C.outdoorFan(P, s.ofanAct, ofanR);
  if (ifan.extrapolated && s.ifanAct > 1) flags.push('indoor fan speed outside published rpm table (affinity extrapolation)');
  if (ofan.extrapolated && s.ofanAct > 1) flags.push('outdoor fan speed outside published rpm table (affinity extrapolation)');
  const maIn = C.dryAirFlow(ifan.q_m3h, room);
  const maOut = C.dryAirFlow(ofan.q_m3h, outA);

  // ---- refrigerant roles
  const evapIsIndoor = rvPos === 0;
  const Te = evapIsIndoor ? s.TinCoil : s.ToutCoil;
  const Tc = evapIsIndoor ? s.ToutCoil : s.TinCoil;
  const running = s.compRunning && s.fAct > 0.5;
  let mEev = 0, xSuct = 1;
  let cyc: C.CycleEval | null = null;
  if (running) {
    mEev = C.levFlow(P, s.eevAct, Math.max(Tc, Te + 0.5), Te);
    // flooding: LEV passes more than the compressor draws while superheat is zero
    const mComp0 = C.compMassFlow(P, s.fAct, Te, Tc, s.SH);
    if (s.SH <= 0.01 && mEev > mComp0) xSuct = Math.max(0.8, 1 - (0.6 * (mEev - mComp0)) / Math.max(1e-5, mComp0));
    cyc = C.evalCycle(P, s.fAct, Te, Tc, s.SH, xSuct, detail);
  }
  const m = cyc ? cyc.comp.m : 0;

  // ---- coils (air side + refrigerant side conductance)
  const uaInAir = C.uaAirIndoor(P, ifan.q_m3h, faults.coilFouling);
  const uaOutAir = C.uaAirOutdoor(P, ofan.q_m3h, faults.outdoorFouling, s.frost);
  const fsh = running ? C.superheatFraction(P, s.SH) : 0;
  const uaInRef = P.uaInRef * (evapIsIndoor ? 1 - fsh : 1);
  const uaOutRef = P.uaOutRef * (!evapIsIndoor ? 1 - fsh : 1);
  const coilIn = maIn > 1e-4 ? C.solveCoil(room, maIn, uaInAir, uaInRef, s.TinCoil) : null;
  const coilOut = maOut > 1e-4 ? C.solveCoil(outA, maOut, uaOutAir, uaOutRef, s.ToutCoil) : null;
  const qInCoil = coilIn ? coilIn.Qcoil : UA_NAT_IN * (s.Troom - s.TinCoil);
  const qOutCoil = coilOut ? coilOut.Qcoil : UA_NAT_OUT * (env.outdoorT - s.ToutCoil);

  // ---- coil node energy balances
  const QevapRef = cyc ? cyc.QevapRef : 0;
  const QcondRef = cyc ? cyc.QcondRef : 0;
  const Qeq = running ? 0 : P.gEq * (s.ToutCoil - s.TinCoil) * (0.3 + s.eevAct);
  let dQin = qInCoil + Qeq, dQout = qOutCoil - Qeq;
  if (evapIsIndoor) { dQin -= QevapRef; dQout += QcondRef; } else { dQout -= QevapRef; dQin += QcondRef; }

  // frost on outdoor coil (deposit below 0 degC, melt above with frost present)
  if (coilOut && coilOut.mCond > 0 && coilOut.Ts < 0) s.frost += coilOut.mCond * dt;
  let qMelt = 0;
  if (s.frost > 0 && s.ToutCoil >= 0 && dQout > 0) {
    const melt = Math.min(s.frost, (dQout * dt) / PS.H_FUSION);
    s.frost -= melt; s.frostMeltedKg += melt; qMelt = (melt * PS.H_FUSION) / dt; dQout -= qMelt;
  }
  if (coilOut && coilOut.mCond > 0 && coilOut.Ts >= 0) { /* liquid condensate drains from outdoor coil */ }
  const TinNext = s.TinCoil + (dQin * dt) / P.cInCoil;
  const ToutNext = s.ToutCoil + (dQout * dt) / P.cOutCoil;

  // ---- indoor water film, tray and re-evaporation
  let supplyW = coilIn ? coilIn.out.w : room.w;
  let supplyT = coilIn ? coilIn.out.T : room.T;
  let reEvap = 0;
  if (coilIn && coilIn.mCond > 0) {
    s.film += coilIn.mCond * dt;
    if (s.film > P.filmMax) { s.condensateL += s.film - P.filmMax; s.film = P.filmMax; }
  } else if (coilIn && s.film > 0 && maIn > 1e-3) {
    const deficit = Math.max(0, PS.wsat(coilIn.out.T) - supplyW);
    reEvap = Math.min(s.film / dt, P.reEvapK * maIn * deficit);
    s.film -= reEvap * dt;
    const h = PS.enthalpy(supplyT, supplyW);
    supplyW += reEvap / maIn;
    supplyT = PS.tFromHW(h, supplyW);
  }
  // fan heat after the coil (cross-flow blower downstream of the coil)
  if (maIn > 1e-4) supplyT += ifan.power / (maIn * PS.cpMoist(supplyW));

  // ---- superheat / suction inventory
  if (running) {
    const dSH = (P.shK * (m - mEev)) / M_REF;
    s.SH = Math.max(0, Math.min(40, s.SH + dSH * dt));
  } else s.SH = Math.max(0, s.SH - (s.SH / 60) * dt);

  // ---- discharge pipe and heat sink
  if (running && cyc) s.Tdis += ((cyc.comp.T2 - s.Tdis) * dt) / TAU_DIS;
  else s.Tdis += ((env.outdoorT - s.Tdis) * dt) / TAU_SHELL_OFF;
  const Pcomp = cyc ? cyc.comp.Pelec : 0;
  const Pinv = cyc ? 0.04 * Pcomp + P.pInvFixed : 0;
  s.Tfin += ((env.outdoorT + P.finRth * Pinv - s.Tfin) * dt) / TAU_FIN;

  // ---- room
  const V = P.roomW * P.roomH * P.roomD;
  const rhoDa = 1 / PS.specVol(s.Troom, s.wroom, env.patm);
  const Mda = rhoDa * V;
  const Cair = Mda * PS.cpMoist(s.wroom);
  const ach = env.ach + (env.doorOpen ? 6 : 0);
  const mInf = (ach * V) / 3600 * rhoDa;
  const solarAir = env.solar * (1 - P.solarToMass);
  const occS = env.occupants * P.occSens;
  const occW = (env.occupants * P.occLat) / PS.H_FG0; // kg/s
  const supplyOn = maIn > 1e-4 && s.vaneOpen > 0.05;
  const supCp = PS.cpMoist(supplyW);
  const qSupSens = supplyOn ? maIn * supCp * (supplyT - s.Troom) : 0;
  const qNat = !supplyOn && coilIn === null ? -UA_NAT_IN * (s.Troom - s.TinCoil) : 0;
  const dTroom = (qSupSens + qNat + P.uaAirOut * (env.outdoorT - s.Troom) + mInf * PS.cpMoist(s.wroom) * (env.outdoorT - s.Troom) + P.hAmass * (s.Tmass - s.Troom) + solarAir + env.internal + occS) / Cair;
  const dTmass = (P.hAmass * (s.Troom - s.Tmass) + P.uaMassOut * (env.outdoorT - s.Tmass) + env.solar * P.solarToMass) / P.cMass;
  const dw = ((supplyOn ? maIn * (supplyW - s.wroom) : 0) + mInf * (outA.w - s.wroom) + occW) / Mda;

  // ---- useful capacity at the room boundary (supply vs return enthalpy, incl. fan heat)
  const hRet = PS.enthalpy(s.Troom, s.wroom);
  const hSup = PS.enthalpy(supplyT, supplyW);
  const qNetSigned = supplyOn ? maIn * (hRet - hSup) : 0; // + removes heat from room
  const coolingSide = evapIsIndoor;
  const Qnet = coolingSide ? qNetSigned : -qNetSigned;
  const Qsens = supplyOn ? (coolingSide ? -qSupSens : qSupSens) : 0;
  const Qlat = supplyOn ? maIn * (s.wroom - supplyW) * PS.H_FG0 * (coolingSide ? 1 : -1) : 0;
  const Qgross = coilIn ? (coolingSide ? coilIn.Qtotal : -coilIn.Qtotal) : 0;

  // ---- power
  const Pifan = ifan.power, Pofan = ofan.power, Pctrl = P.pControls;
  const Ptotal = Pcomp + Pifan + Pofan + Pctrl;
  const pf = rvPos ? P.pfHeat : P.pfCool;
  const current = Ptotal / (P.supplyV * pf);

  // ---- integrate
  s.TinCoil = TinNext; s.ToutCoil = ToutNext;
  s.Troom += dTroom * dt; s.Tmass += dTmass * dt; s.wroom = Math.max(1e-6, s.wroom + dw * dt);
  if (env.chamber) { s.Troom = env.chamber.T; s.wroom = PS.wFromRH(env.chamber.T, env.chamber.RH / 100, env.patm); s.Tmass = env.chamber.T; }
  const wsatRoom = PS.wsat(s.Troom, env.patm);
  if (s.wroom > wsatRoom) { flags.push('room air saturated: excess moisture condensed on surfaces'); s.wroom = wsatRoom; }
  const hr = dt / 3600;
  s.E_total += (Ptotal * hr) / 1000; s.E_comp += (Pcomp * hr) / 1000; s.E_ifan += (Pifan * hr) / 1000; s.E_ofan += (Pofan * hr) / 1000;
  s.Q_net += (Qnet * hr) / 1000; s.Q_gross += (Qgross * hr) / 1000;
  if (running) s.runTime += dt;
  if (defrosting) s.defrostEnergy += (Ptotal * hr) / 1000;

  if (R32.domainFlags.outOfDomain) flags.push('refrigerant property lookup outside table domain: ' + R32.domainFlags.last);
  if (running && evapIsIndoor && env.outdoorT > P.envelopeCoolMax) flags.push(`outdoor ${env.outdoorT.toFixed(1)} degC above published cooling data (46 degC): extrapolated`);
  if (running && !evapIsIndoor && env.outdoorT < P.envelopeHeatMin) flags.push(`outdoor below guaranteed heating limit (${P.envelopeHeatMin} degC): extrapolated`);
  if (running && s.fAct > (rvPos ? P.fMaxHeat : P.fMaxCool) + 0.5) flags.push('compressor frequency beyond published correction curve: map extrapolated');

  // instantaneous core balance with storage terms
  const storageIn = (dQin) ; const storageOut = dQout;
  let coreResidual: number | null = null;
  if (running && cyc) {
    const qCondAir = evapIsIndoor ? -qOutCoil : -qInCoil;
    const qEvapAir = evapIsIndoor ? qInCoil : qOutCoil;
    coreResidual = (qCondAir - (qEvapAir + cyc.Qpickup + cyc.comp.Wref)) / Math.max(100, qCondAir);
  }

  const out: Outputs = {
    Troom: s.Troom, RHroom: PS.rh(s.Troom, s.wroom, env.patm), Tmass: s.Tmass,
    Tsup: supplyOn ? supplyT : s.Troom, RHsup: supplyOn ? PS.rh(supplyT, supplyW, env.patm) : PS.rh(s.Troom, s.wroom),
    Tret: s.Troom,
    ToutIn: env.outdoorT,
    ToutLeave: coilOut ? coilOut.out.T + (Pofan + (cyc ? cyc.comp.Qshell + cyc.comp.Ploss - cyc.Qpickup : 0)) / (Math.max(1e-3, maOut) * PS.cpMoist(outA.w)) : env.outdoorT,
    fReq: 0, fCmd: cmd.f, fAct: s.fAct, fElec: s.fAct * P.pPolePairs, rpmComp: s.fAct * 60,
    ifanCmd: cmd.ifan, ifanAct: s.ifanAct, qIn: ifan.q_m3h, dpIn: ifan.dp, resIn: res,
    ofanCmd: cmd.ofan, ofanAct: s.ofanAct, qOut: ofan.q_m3h,
    eevCmd: cmd.eev, eevAct: s.eevAct,
    vaneUpperCmd: cmd.vaneUpper, vaneUpper: s.vaneUpper, vaneLowerCmd: cmd.vaneLower, vaneLower: s.vaneLower, wideCmd: cmd.wide, wideAct: s.wideAct, vaneOpen: s.vaneOpen, outletArea: area,
    Qnet, Qgross, Qsens, Qlat, SHR: Math.abs(Qnet) > 150 && coolingSide ? Qsens / Qnet : null,
    Pcomp, Pifan, Pofan, Pctrl, Ptotal, current,
    COP: Ptotal > 80 && Qnet > 150 ? Qnet / Ptotal : null,
    EER_btu: Ptotal > 80 && Qnet > 150 && coolingSide ? (Qnet * 3.412142) / Ptotal : null,
    condRate: coilIn && coilIn.mCond > 0 ? coilIn.mCond * 3600 : 0,
    Pe: R32.psat(Te), Pc: R32.psat(Math.max(Tc, Te)), Te, Tc, Tsuct: cyc ? Te + cyc.SHsuct : Te, Tdis: s.Tdis, T2: cyc ? cyc.comp.T2 : s.Tdis,
    SHevap: running ? s.SH : 0, SHsuct: cyc ? cyc.SHsuct : 0, SC: running ? P.subcool : 0, xSuct,
    m, mEev, QevapRef, QcondRef, Wref: cyc ? cyc.comp.Wref : 0, Qshell: cyc ? cyc.comp.Qshell : 0, Qpickup: cyc ? cyc.Qpickup : 0,
    points: cyc && detail ? { p1e: cyc.p1e, p1: cyc.p1, p2: cyc.p2, p3: cyc.p3, p4: cyc.p4 } : null,
    evapIsIndoor, running,
    coilInSurface: coilIn ? coilIn.Ts : s.TinCoil, coilOutSurface: coilOut ? coilOut.Ts : s.ToutCoil, frost: s.frost, film: s.film,
    coreResidual, storageIn, storageOut,
    flags,
  };
  void qMelt;
  return { s, out };
}

/** Validate a plant state; returns a reason string if any value is not finite or out of physical bounds. */
export function checkPlant(s: PlantState): string | null {
  for (const [k, v] of Object.entries(s)) {
    if (typeof v === 'number' && !Number.isFinite(v)) return `non-finite ${k}`;
  }
  if (s.TinCoil < -40 || s.TinCoil > 75 || s.ToutCoil < -45 || s.ToutCoil > 75) return 'coil temperature outside model domain';
  if (s.wroom < 0) return 'negative humidity ratio';
  return null;
}

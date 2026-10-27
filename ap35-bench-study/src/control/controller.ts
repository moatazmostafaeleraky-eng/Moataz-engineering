/**
 * Supervisory controller surrogate. Documented Mitsubishi sequences (S2 section 9,
 * S3 sections 10-12) are implemented where published; everything else is a
 * labelled engineering surrogate, not reverse-engineered firmware.
 *
 * Priority: fault shutdown > protection/derating > mode sequence > user request > optimisation.
 * Manual overrides (experiment layer) enter at "user request" level and are still
 * clipped by envelope limits and protections.
 */
import type { ProfileValues } from '../config/registry';
import { INDOOR_FAN_COOL, INDOOR_FAN_HEAT } from '../config/published';
import type { ActuatorCmd } from '../model/plant';
import type { CtrlState, Environment, Faults, FanSetting, Outputs, Overrides, PlantState, RemoteSettings, SupState, VaneSetting } from '../model/types';
import * as C from '../model/components';

export interface CtrlEvent { t: number; kind: 'state' | 'protection' | 'fault' | 'user' | 'info' | 'limit'; msg: string; key?: string }

const STEP_RPM: Record<Exclude<FanSetting, 'auto'>, number> = { Silent: 0, Low: 1, Med: 2, High: 3, SuperHigh: 4 };
export function fanRpm(step: Exclude<FanSetting, 'auto'>, heat: boolean) {
  return (heat ? INDOOR_FAN_HEAT : INDOOR_FAN_COOL)[STEP_RPM[step]][0];
}

export function vaneAngle(P: ProfileValues, pos: number) {
  return P.vaneAng1 + ((pos - 1) * (P.vaneAng5 - P.vaneAng1)) / 4;
}
export function wideAngle(P: ProfileValues, pos: number) {
  return -P.wideMax + ((pos - 1) * 2 * P.wideMax) / 4;
}

export function initialCtrl(P: ProfileValues, t: number, roomT: number, ambT: number): CtrlState {
  const lim = (name: string, cap: number) => ({ name, cap, active: false });
  return {
    sup: 'OFF', supSince: t, opMode: 'off', autoSide: null, autoSince: t,
    thermoOn: false, thermoSince: t, compOnSince: t, lastStop: t - 1e6, startAt: null,
    fReq: 0, fCmd: 0, integ: 0,
    limits: {
      discharge: lim('Discharge temperature (S3 no.19)', 200), frost: lim('Indoor coil frost prevention (S3 no.18)', 200),
      hpHeat: lim('High pressure, HEAT (S3 no.18)', 200), hpCool: lim('High pressure, COOL (assumed)', 200),
      current: lim('Input current (S3 no.17)', 200), eco: lim('Eco power cap (experiment)', 200), fin: lim('Heat-sink temperature (assumed derate)', 200),
    },
    limitReason: '',
    eevCmd: 0.25, eevInteg: 0, tdTarget: 70,
    ifanCmd: 0, ofanCmd: 0, ofanOffAt: null,
    vaneUpperCmd: -30, vaneLowerCmd: -30, wideCmd: 0, vaneOpenCmd: 0, positioningUntil: 0,
    rvCmd: 0, rvPulseUntil: 0,
    sens: { room: roomT, coilIn: roomT, coilOut: ambT, dis: ambT, amb: ambT, fin: ambT },
    prot: { tdStop: false, frostStop: false, hpStop: false, finStop: false, lowTdTimer: 0, ifanTimer: 0, ofanTimer: 0, commTimer: 0, envelope: '' },
    fault: null, faultClearArmed: false,
    defrost: { phase: 'none', since: t, heatRun: 0, coldTimer: 0, count: 0 },
    drySet: null, cumCompCool: 0, econoPhase: 0,
    narration: 'Unit is off. Press Start cooling or use the remote.', narrationKey: 'off',
    prevPower: false, lastWeeklyMinute: -1,
  };
  void P;
}

export interface CtrlCtx {
  P: ProfileValues; t: number; dt: number;
  remote: RemoteSettings; ov: Overrides; env: Environment; faults: Faults;
  plant: PlantState; out: Outputs | null;
}

const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));

function setSup(c: CtrlState, t: number, s: SupState, ev: CtrlEvent[], why: string) {
  if (c.sup !== s) {
    ev.push({ t, kind: 'state', msg: `${c.sup} -> ${s}: ${why}`, key: s });
    c.sup = s; c.supSince = t;
  }
}
function narrate(c: CtrlState, key: string, msg: string) {
  c.narrationKey = key; c.narration = msg;
}

/** Compute sensed values (thermistors) including faults, lag and bias. */
function updateSensors(c: CtrlState, x: CtrlCtx) {
  const { plant, out, faults, env, dt } = x;
  const lag = (prev: number, v: number, tau: number) => prev + (v - prev) * Math.min(1, dt / tau);
  c.sens.room = lag(c.sens.room, plant.Troom + faults.roomSensorBias, 20);
  const coilIn = out ? out.coilInSurface : plant.TinCoil;
  const coilOut = out ? out.coilOutSurface : plant.ToutCoil;
  c.sens.coilIn = lag(c.sens.coilIn, coilIn + faults.coilSensorBias, 8);
  c.sens.coilOut = lag(c.sens.coilOut, coilOut, 8);
  c.sens.dis = plant.Tdis;
  c.sens.amb = lag(c.sens.amb, env.outdoorT, 30);
  c.sens.fin = plant.Tfin;
}

function sensorFailure(f: Faults): string | null {
  if (f.sensorFail === 'none') return null;
  return ({ room: 'room temperature thermistor RT11', indoorCoil: 'indoor coil thermistor RT12', discharge: 'discharge thermistor RT62', outdoorCoil: 'outdoor heat exchanger thermistor RT68', ambient: 'ambient thermistor RT65' } as Record<string, string>)[f.sensorFail];
}

export function controlStep(c0: CtrlState, x: CtrlCtx): { c: CtrlState; cmd: ActuatorCmd; events: CtrlEvent[]; remote: RemoteSettings } {
  const c: CtrlState = {
    ...c0, sens: { ...c0.sens }, prot: { ...c0.prot }, defrost: { ...c0.defrost },
    limits: Object.fromEntries(Object.entries(c0.limits).map(([k, v]) => [k, { ...v }])),
  };
  const { P, t, dt, ov, env, faults, plant, out } = x;
  const remote: RemoteSettings = { ...x.remote };
  const ev: CtrlEvent[] = [];
  updateSensors(c, x);

  // ------------------------------------------------ timers (S2 9-7, 9-8)
  if (remote.onTimer !== null && t >= remote.onTimer) { remote.onTimer = null; if (!remote.power) { remote.power = true; ev.push({ t, kind: 'user', msg: 'ON timer: unit started' }); } }
  if (remote.offTimer !== null && t >= remote.offTimer) { remote.offTimer = null; if (remote.power) { remote.power = false; ev.push({ t, kind: 'user', msg: 'OFF timer: unit stopped' }); } }
  if (remote.weeklyOn && remote.weekly.length) {
    const minuteOfWeek = Math.floor(t / 60) % (7 * 1440);
    if (minuteOfWeek !== c.lastWeeklyMinute) {
      c.lastWeeklyMinute = minuteOfWeek;
      const day = Math.floor(minuteOfWeek / 1440), tod = minuteOfWeek % 1440;
      for (const e of remote.weekly) if (e.day === day && e.time === tod) {
        remote.power = e.on; if (e.on) remote.setpoint = e.temp;
        ev.push({ t, kind: 'user', msg: `Weekly timer: ${e.on ? 'ON ' + e.temp + ' degC' : 'OFF'}` });
      }
    }
  }
  // experiment: turbo expiry
  if (ov.turbo && ov.turboUntil !== null && t >= ov.turboUntil) ev.push({ t, kind: 'info', msg: 'Turbo experiment window ended' });

  // ------------------------------------------------ fault latch and reset rule
  const sf = sensorFailure(faults);
  if (!c.fault) {
    if (sf && remote.power) c.fault = { code: 'SIM-S01', msg: `Sensor open/short: ${sf}. Unit stopped (cf. S3 p.47 no.2).`, t };
    if (faults.commFault && remote.power) {
      c.prot.commTimer += dt;
      if (c.prot.commTimer >= P.commTimeout) c.fault = { code: 'SIM-C01', msg: 'Indoor/outdoor serial signal lost for 3 minutes. Outdoor unit stopped (cf. S3 p.47 no.4).', t };
    } else c.prot.commTimer = 0;
    if (remote.power && c.ifanCmd > 100 && plant.ifanAct < 20) { c.prot.ifanTimer += dt; if (c.prot.ifanTimer >= P.ifanFaultTime) c.fault = { code: 'SIM-F01', msg: 'Indoor fan motor not rotating while commanded. Unit stopped (cf. S2 troubleshooting A).', t }; } else c.prot.ifanTimer = 0;
    if (c.ofanCmd > 100 && plant.ofanAct < 20) { c.prot.ofanTimer += dt; if (c.prot.ofanTimer >= P.ofanFaultTime) c.fault = { code: 'SIM-F02', msg: 'Outdoor fan stopped while commanded. Outdoor unit stopped (cf. S3 p.47 no.14).', t }; } else c.prot.ofanTimer = 0;
    if (c.fault) ev.push({ t, kind: 'fault', msg: `${c.fault.code}: ${c.fault.msg}` });
  }
  if (c.fault) {
    // reset: cause removed, then power OFF -> ON (simulator rule; documented in MODEL_NOTES)
    const causeGone = !sf && !faults.commFault && !(c.fault.code === 'SIM-F01' && faults.indoorFanFault) && !(c.fault.code === 'SIM-F02' && faults.outdoorFanFault);
    if (!remote.power && causeGone) c.faultClearArmed = true;
    if (remote.power && c.faultClearArmed) {
      ev.push({ t, kind: 'fault', msg: `${c.fault.code} cleared by power cycle after the cause was removed` });
      c.fault = null; c.faultClearArmed = false; c.prot.ofanTimer = 0; c.prot.ifanTimer = 0; c.prot.commTimer = 0;
    }
  }

  // ------------------------------------------------ operating mode
  const powerEdgeOn = remote.power && !c.prevPower;
  c.prevPower = remote.power;
  if (powerEdgeOn) {
    c.positioningUntil = t + 3; // vane confirms standard position at start (S2 9-6 (3))
    c.drySet = null;
    if (remote.mode === 'auto') { c.autoSide = c.sens.room > remote.setpoint ? 'cool' : 'heat'; c.autoSince = t; }
    if (remote.mode === 'dry') c.drySet = clamp(c.sens.room - P.dryOffset, 16, 31);
    ev.push({ t, kind: 'user', msg: `Power ON, ${remote.mode.toUpperCase()} ${remote.setpoint} degC` });
  }
  let mode: CtrlState['opMode'] = 'off';
  if (remote.power && !c.fault) {
    if (remote.mode === 'auto') {
      if (!c.autoSide) { c.autoSide = c.sens.room > remote.setpoint ? 'cool' : 'heat'; c.autoSince = t; }
      // S2 9-5: change after ~15 min 1 degC beyond the set temperature
      const beyond = c.autoSide === 'cool' ? c.sens.room <= remote.setpoint - P.autoBand : c.sens.room >= remote.setpoint + P.autoBand;
      if (!beyond) c.autoSince = t;
      else if (t - c.autoSince >= P.autoDwell) {
        c.autoSide = c.autoSide === 'cool' ? 'heat' : 'cool'; c.autoSince = t;
        ev.push({ t, kind: 'state', msg: `AUTO changeover to ${c.autoSide.toUpperCase()} after 15 min beyond 1 degC band` });
      }
      mode = c.autoSide;
    } else mode = remote.mode;
    if (remote.mode === 'dry' && c.drySet === null) c.drySet = clamp(c.sens.room - P.dryOffset, 16, 31);
  }
  if (mode !== c.opMode) {
    if (c.opMode !== 'off' && mode !== 'off') ev.push({ t, kind: 'state', msg: `Mode change ${c.opMode.toUpperCase()} -> ${mode.toUpperCase()}: compressor ramps down; valve and restart follow the start sequence` });
    c.opMode = mode; c.integ = 0; c.thermoOn = mode !== 'fan' && mode !== 'off';
  }
  const heat = mode === 'heat';
  const compMode = mode === 'cool' || mode === 'heat' || mode === 'dry';

  // ------------------------------------------------ effective setpoint
  let sleepOffset = 0;
  if (ov.sleep && ov.sleepSince !== null) sleepOffset = Math.min(ov.sleepMax, ((t - ov.sleepSince) / 3600) * ov.sleepRate) * (heat ? -1 : 1);
  const econo = remote.econoCool && mode === 'cool' ? P.econoOffset : 0;
  const tset = mode === 'dry' ? (c.drySet ?? remote.setpoint) : remote.setpoint + econo + sleepOffset;
  const err = heat ? tset - c.sens.room : c.sens.room - tset; // >0 = demand

  // ------------------------------------------------ protections that stop the compressor
  const running = plant.compRunning;
  if (!c.prot.tdStop && c.sens.dis > P.tdStop) { c.prot.tdStop = true; ev.push({ t, kind: 'protection', msg: `Discharge ${c.sens.dis.toFixed(0)} degC > ${P.tdStop}: compressor stop (S3 no.10)` }); }
  if (c.prot.tdStop && c.sens.dis <= P.tdRestart && t - c.lastStop >= P.restartDelay) { c.prot.tdStop = false; ev.push({ t, kind: 'protection', msg: 'Discharge temperature recovered: restart permitted' }); }
  if (!heat && !c.prot.frostStop && running && c.sens.coilIn < P.coilFrostStop && c.limits.frost.cap <= P.fMin + 0.5) { c.prot.frostStop = true; ev.push({ t, kind: 'protection', msg: `Indoor coil ${c.sens.coilIn.toFixed(1)} degC: coil frost prevention stops the compressor; indoor fan continues (S2 9-1)` }); }
  if (c.prot.frostStop && (c.sens.coilIn > 10 || heat)) { c.prot.frostStop = false; ev.push({ t, kind: 'protection', msg: 'Indoor coil recovered above 10 degC (assumed release)' }); }
  const hpSensor = heat ? c.sens.coilIn : c.sens.coilOut;
  const hpStopT = heat ? P.hpHeatStop : P.hpCoolStop;
  if (!c.prot.hpStop && running && hpSensor > hpStopT) { c.prot.hpStop = true; ev.push({ t, kind: 'protection', msg: `High pressure protection: ${heat ? 'indoor' : 'outdoor'} coil ${hpSensor.toFixed(0)} degC > ${hpStopT} (S3 no.12)` }); }
  if (c.prot.hpStop && hpSensor < hpStopT - 15 && t - c.lastStop >= P.restartDelay) c.prot.hpStop = false;
  if (!c.prot.finStop && c.sens.fin > P.finStop) { c.prot.finStop = true; ev.push({ t, kind: 'protection', msg: `Heat-sink ${c.sens.fin.toFixed(0)} degC > ${P.finStop}: compressor stop (S3 no.11)` }); }
  if (c.prot.finStop && c.sens.fin < P.finStop - 10 && t - c.lastStop >= P.restartDelay) c.prot.finStop = false;
  // low discharge temperature for 20 min (S3 no.21)
  if (running && c.sens.dis <= P.lowTdLimit) { c.prot.lowTdTimer += dt; if (c.prot.lowTdTimer >= P.lowTdTime && c.prot.lowTdTimer - dt < P.lowTdTime) ev.push({ t, kind: 'protection', msg: 'Discharge temperature at or below 50 degC for 20 min: low discharge temperature protection (S3 no.21), LEV check suggested' }); }
  else c.prot.lowTdTimer = 0;
  const lowTdTrip = c.prot.lowTdTimer >= P.lowTdTime;
  const protStop = c.prot.tdStop || c.prot.frostStop || c.prot.hpStop || c.prot.finStop || lowTdTrip;
  c.prot.envelope = env.outdoorT > P.envelopeCoolMax && !heat ? 'outdoor above published cooling data' : env.outdoorT < P.envelopeHeatMin && heat ? 'outdoor below guaranteed heating limit' : '';

  // ------------------------------------------------ thermostat
  if (compMode) {
    if (c.thermoOn && err < P.thermoOff && (!running || plant.fAct <= P.fMin + 1) && t - c.compOnSince >= P.minOnTime) {
      c.thermoOn = false; c.thermoSince = t; ev.push({ t, kind: 'state', msg: `Thermo-OFF: room ${c.sens.room.toFixed(1)} degC beyond set ${tset.toFixed(1)} with compressor at minimum` });
    } else if (!c.thermoOn && err > P.thermoOn) { c.thermoOn = true; c.thermoSince = t; ev.push({ t, kind: 'state', msg: 'Thermo-ON: room drifted from set temperature' }); }
  }

  // ------------------------------------------------ defrost (HEAT)
  if (heat && running && c.defrost.phase === 'none') {
    c.defrost.heatRun += dt;
    if (c.sens.coilOut <= P.defrostStartT) c.defrost.coldTimer += dt; else c.defrost.coldTimer = 0;
    if (c.defrost.heatRun >= P.defrostMinRun && c.defrost.coldTimer >= 60) {
      c.defrost.phase = 'stop'; c.defrost.since = t; c.defrost.count++;
      ev.push({ t, kind: 'state', msg: 'Defrost: outdoor coil too low; compressor stops, fans stop, 4-way valve reverses (S2 9-4 3.)' });
    }
  }
  if (!heat && c.defrost.phase !== 'none') { c.defrost.phase = 'none'; }
  const dfPhase = c.defrost.phase;
  if (dfPhase === 'stop' && t - c.defrost.since >= 30) { c.defrost.phase = 'reverse'; c.defrost.since = t; }
  if (dfPhase === 'reverse' && ((c.sens.coilOut >= P.defrostFinishT && t - c.defrost.since > 30) || t - c.defrost.since >= P.defrostMaxTime)) {
    c.defrost.phase = 'recover'; c.defrost.since = t;
    ev.push({ t, kind: 'state', msg: `Defrost end: outdoor coil ${c.sens.coilOut.toFixed(1)} degC (finish ${P.defrostFinishT} degC, S3 p.41) or max time` });
  }
  // the stop/reverse/restart inside the defrost sequence is not a system OFF: no 3-minute delay (S2 9-4; timing assumed)
  if (dfPhase === 'recover' && t - c.defrost.since >= 30) { c.defrost.phase = 'none'; c.defrost.heatRun = 0; c.defrost.coldTimer = 0; c.lastStop = t - P.restartDelay; }
  const defrosting = c.defrost.phase !== 'none';

  // ------------------------------------------------ compressor request
  const lockoutLeft = Math.max(0, P.restartDelay - (t - c.lastStop));
  const turbo = ov.turbo && (ov.turboUntil === null || t < ov.turboUntil);
  let fMax = heat ? P.fMaxHeat : P.fMaxCool;
  if (mode === 'dry') fMax = Math.min(fMax, P.dryFmax);
  if (remote.nightMode) fMax = Math.min(fMax, P.nightFcap);
  let wantComp = compMode && c.thermoOn && !protStop && !c.fault && remote.power;
  if (defrosting) wantComp = c.defrost.phase === 'reverse';
  if (ov.manual && ov.compHz !== null) wantComp = compMode && !protStop && !c.fault && remote.power && ov.compHz > 0 && (!defrosting || c.defrost.phase === 'reverse');

  // PI with conditional integration (anti-windup)
  let fReq = 0;
  if (wantComp) {
    if (ov.manual && ov.compHz !== null) fReq = ov.compHz;
    else if (defrosting) fReq = 70;
    else {
      const pTerm = P.kp * err;
      const unsat = pTerm + c.integ;
      const sat = unsat > fMax || unsat < P.fMin;
      if (!sat || (unsat > fMax && err < 0) || (unsat < P.fMin && err > 0)) c.integ += P.ki * err * dt;
      c.integ = clamp(c.integ, -fMax, fMax);
      fReq = pTerm + c.integ + (turbo ? 25 : 0);
    }
  } else if (!compMode || !c.thermoOn) c.integ *= Math.exp(-dt / 120);

  // limiters (derating) - each cap falls while its condition holds and recovers slowly
  const lim = c.limits;
  const updCap = (l: CtrlState['limits'][string], cond: boolean, msg: string) => {
    if (cond) { l.cap = Math.max(P.fMin, Math.min(l.cap, plant.fAct + 2) - 2 * dt); if (!l.active) ev.push({ t, kind: 'limit', msg }); l.active = true; }
    else { l.cap = Math.min(200, l.cap + 0.25 * dt); if (l.cap > 150) l.active = false; }
  };
  updCap(lim.discharge, running && c.sens.dis > P.tdFreqDrop, `Discharge > ${P.tdFreqDrop} degC: frequency lowered`);
  updCap(lim.frost, running && !heat && c.sens.coilIn <= P.coilFrostDrop, `Indoor coil <= ${P.coilFrostDrop} degC: coil frost prevention lowers frequency`);
  updCap(lim.hpHeat, running && heat && c.sens.coilIn > P.hpHeatDrop, `Indoor coil > ${P.hpHeatDrop} degC in HEAT: high pressure protection lowers frequency`);
  updCap(lim.hpCool, running && !heat && c.sens.coilOut > P.hpCoolDrop, `Outdoor coil > ${P.hpCoolDrop} degC: condensing limit lowers frequency (assumed threshold)`);
  updCap(lim.current, running && !!out && out.current > P.currentDrop, `Estimated input current > ${P.currentDrop} A: frequency lowered`);
  updCap(lim.eco, running && ov.ecoCapW !== null && !!out && out.Ptotal > ov.ecoCapW, `Eco experiment: total input above ${ov.ecoCapW} W cap`);
  updCap(lim.fin, running && c.sens.fin > P.finStop - 6, 'Heat-sink near limit: frequency lowered (assumed derate)');
  let fLimit = fMax, reason = '';
  for (const l of Object.values(lim)) if (l.active && l.cap < fLimit) { fLimit = l.cap; reason = l.name; }
  if (fReq > fMax + 1e-6 && !reason) reason = ov.manual && ov.compHz !== null ? `Manual request above envelope max ${fMax} Hz` : '';
  if (remote.nightMode && fReq > P.nightFcap) reason = reason || 'NIGHT MODE outdoor noise limit';

  // ------------------------------------------------ start / stop sequencing
  let fCmdTarget = 0;
  if (wantComp) {
    if (!running) {
      if (lockoutLeft > 0 && !(defrosting && c.defrost.phase === 'reverse')) {
        setSup(c, t, 'START_DELAY', ev, `restart lockout ${lockoutLeft.toFixed(0)} s (S2 9-13)`);
        c.startAt = null;
      } else {
        if (c.startAt === null) {
          c.startAt = t + Math.max(P.ofanOnLead, P.rvLead);
          c.rvPulseUntil = t + P.rvLead; // 4-way valve reverses for 5 s before start (S3 10-2)
          setSup(c, t, 'STARTING', ev, 'outdoor fan on 5 s before compressor; valve positioning');
        }
        if (t >= c.startAt) { fCmdTarget = Math.max(P.fMin, Math.min(P.fStart, fLimit)); c.compOnSince = t; c.startAt = null; ev.push({ t, kind: 'state', msg: 'Compressor start' }); }
      }
    } else {
      const inHold = t - c.compOnSince < P.tStartHold && !(ov.manual && ov.compHz !== null) && !defrosting;
      const target = inHold ? P.fStart : clamp(fReq, P.fMin, Math.min(fMax, fLimit));
      fCmdTarget = target;
    }
  } else {
    c.startAt = null;
  }
  // ramp limits on the command
  if (fCmdTarget > 0) {
    const base = c.fCmd > 0 ? c.fCmd : fCmdTarget;
    c.fCmd = fCmdTarget > base ? Math.min(fCmdTarget, base + P.rampUp * dt) : Math.max(fCmdTarget, base - P.rampDown * dt);
  } else if (c.fCmd > 0) {
    c.fCmd = 0; c.lastStop = t; c.ofanOffAt = t + P.ofanOffLag;
    ev.push({ t, kind: 'state', msg: 'Compressor stop; 3-minute restart delay starts; outdoor fan stops 15 s later (S3 10-1)' });
  }
  c.fReq = wantComp ? fReq : 0;
  c.limitReason = reason;
  if (running && !c.fCmd) { /* stopping */ }
  if (!heat && running) c.cumCompCool += dt;

  // ------------------------------------------------ supervisory state
  if (c.fault) setSup(c, t, 'FAULT', ev, c.fault.code);
  else if (!remote.power) setSup(c, t, running || plant.ifanAct > 5 || plant.vaneOpen > 0.05 ? 'STOPPING' : 'OFF', ev, 'power off');
  else if (defrosting) setSup(c, t, 'DEFROST', ev, 'defrost');
  else if (protStop && compMode) setSup(c, t, 'PROTECTION', ev, 'protection stop');
  else if (mode === 'fan') setSup(c, t, 'FAN_ONLY', ev, 'fan mode');
  else if (compMode && !c.thermoOn) setSup(c, t, 'STANDBY', ev, 'thermo-off');
  else if (compMode && running && t - c.compOnSince > 1) {
    const wasNear = c.sup === 'MODULATING';
    const near = wasNear ? Math.abs(err) < 1.3 && plant.fAct < 0.7 * fMax : Math.abs(err) < 0.7 && plant.fAct < 0.5 * fMax;
    setSup(c, t, near ? 'MODULATING' : mode === 'heat' ? 'HEATING' : mode === 'dry' ? 'DRY' : 'COOLING', ev, near ? 'near set temperature' : 'running');
  } else if (compMode && !wantComp && !running) setSup(c, t, 'STANDBY', ev, 'compressor not requested');

  // ------------------------------------------------ fans
  const fanSet: FanSetting = remote.isave && remote.isaveMem[heat ? 'heat' : 'cool'] ? remote.isaveMem[heat ? 'heat' : 'cool']!.fan : remote.fan;
  let ifan = 0;
  if (remote.power && !c.fault) {
    let step: Exclude<FanSetting, 'auto'>;
    if (fanSet === 'auto') {
      if (mode === 'fan') step = 'Low'; // S2 9-3: AUTO becomes Low
      else step = err > 3 ? 'SuperHigh' : err > 1.5 ? 'High' : err > 0.5 ? 'Med' : 'Low';
    } else step = fanSet;
    if (turbo && mode !== 'fan') step = 'SuperHigh';
    ifan = fanRpm(step, heat);
    if (mode === 'dry' && fanSet === 'auto') ifan = fanRpm('Low', false);
    if ((mode === 'cool' || mode === 'dry') && !c.thermoOn) ifan = P.ifanVeryLow; // S2 9-1 3.
    if (heat) {
      // cold air prevention (S2 9-4 1.)
      if (defrosting) ifan = 0;
      else if (c.sens.coilIn < P.coldAirVeryLow) ifan = 0;
      else if (c.sens.coilIn < P.coldAirFanOn) ifan = P.ifanVeryLow;
    }
    if (t < c.positioningUntil) ifan = 0;
  }
  if (ov.manual && ov.ifanRpm !== null && remote.power && !c.fault) ifan = clamp(ov.ifanRpm, 0, 1300);
  c.ifanCmd = ifan;

  let ofan = 0;
  const compActive = c.fCmd > 0 || (c.startAt !== null && t >= c.startAt - P.ofanOnLead);
  if (compActive && !defrosting) {
    if (heat) ofan = plant.fAct < 35 ? 640 : plant.fAct < 60 ? 780 : 900;
    else {
      ofan = plant.fAct < 30 ? 470 : plant.fAct < 50 ? 700 : 940;
      if (c.sens.coilOut > 52) ofan = 940;
      if (c.sens.amb < 20) ofan = Math.min(ofan, c.sens.amb < 10 ? 300 : 470); // low outside temperature operation (S2 9-1 2.)
    }
    if (remote.nightMode) ofan = Math.min(ofan, P.nightOfanCap);
    c.ofanOffAt = null;
  } else if (c.ofanOffAt !== null && t < c.ofanOffAt && !defrosting) ofan = c.ofanCmd;
  if (ov.manual && ov.ofanRpm !== null && (compActive || ov.ofanRpm > 0) && !c.fault) ofan = clamp(ov.ofanRpm, 0, 1100);
  if (c.fault) ofan = 0;
  c.ofanCmd = ofan;

  // ------------------------------------------------ LEV: discharge-temperature target (S3 10-3) surrogate
  if (running && c.fCmd > 0) {
    if (Math.floor(t) !== Math.floor(t - dt) || c.tdTarget === 70) {
      const Te = heat ? plant.ToutCoil : plant.TinCoil, Tc = heat ? plant.TinCoil : plant.ToutCoil;
      c.tdTarget = C.evalCycle(P, Math.max(P.fMin, plant.fAct), Te, Math.max(Tc, Te + 1), P.shTarget, 1, false).comp.T2;
    }
    const e = c.sens.dis - c.tdTarget; // hotter than target -> open
    const ff = 0.12 + 0.33 * (plant.fAct / P.fRatedCool);
    c.eevInteg = clamp(c.eevInteg + (P.eevKi / 100) * e * dt, -0.6, 0.6);
    let cmd = clamp(ff + (P.eevKp / 100) * e + c.eevInteg, 0.05, 1);
    if (defrosting) cmd = 0.6;
    c.eevCmd = cmd;
  } else c.eevCmd = 0.25; // standby opening (assumed)
  if (ov.manual && ov.eevPct !== null) c.eevCmd = clamp(ov.eevPct / 100, 0, 1);

  // ------------------------------------------------ vanes (S2 9-6)
  const vaneSet: VaneSetting = remote.isave && remote.isaveMem[heat ? 'heat' : 'cool'] ? remote.isaveMem[heat ? 'heat' : 'cool']!.vane : remote.vane;
  let up = -30, lowV = -30, open = 0;
  if (remote.power && !c.fault) {
    open = 1;
    let base: number;
    if (vaneSet === 'auto') base = heat ? vaneAngle(P, 4) : P.vaneAngAutoCool;
    else if (vaneSet === 'swing') base = vaneAngle(P, 3);
    else {
      let pos = vaneSet;
      if ((mode === 'cool' || mode === 'dry') && pos === 5 && c.cumCompCool > 3600) pos = 4; // dew prevention
      base = vaneAngle(P, pos);
    }
    up = base; lowV = base;
    const swingOn = vaneSet === 'swing' || (remote.econoCool && mode === 'cool');
    if (swingOn) {
      const lo = ov.manual && ov.swingLo !== null ? ov.swingLo : vaneAngle(P, 1);
      const hi = ov.manual && ov.swingHi !== null ? ov.swingHi : vaneAngle(P, 5);
      let period = P.swingPeriod;
      if (remote.econoCool && mode === 'cool') { c.econoPhase += dt; period = P.swingPeriod * (1 + 0.5 * Math.sin(c.econoPhase / 40)); }
      const ph = 0.5 - 0.5 * Math.cos((2 * Math.PI * t) / period);
      up = lo + (hi - lo) * ph;
      lowV = heat ? up : base; // COOL/DRY/FAN: only the upper vane swings (S2 9-6 (7))
    }
    if (heat && c.sens.coilIn < P.coldAirFanOn && !swingOn) { up = P.vaneAngAutoCool; lowV = P.vaneAngAutoCool; } // cold air prevention: upward
    if (ov.manual && ov.vaneAngle !== null) { up = ov.vaneAngle; lowV = ov.vaneAngle; }
    if (t < c.positioningUntil) { up = -30; lowV = -30; }
  }
  c.vaneUpperCmd = up; c.vaneLowerCmd = lowV; c.vaneOpenCmd = open;
  // wide vane (S2 9-6 2.)
  let wide = remote.wide === 'swing' ? wideAngle(P, 3) + P.wideMax * Math.sin((2 * Math.PI * t) / P.widePeriod) : wideAngle(P, remote.wide);
  if (ov.manual && ov.wideAngle !== null) wide = ov.wideAngle;
  c.wideCmd = wide;

  // ------------------------------------------------ 4-way valve
  let rv = heat ? 1 : 0;
  if (defrosting) rv = c.defrost.phase === 'reverse' ? 0 : 1;
  if (t < c.rvPulseUntil) rv = 1; // energised for 5 s right before start-up (S3 10-2)
  c.rvCmd = rv;

  // ------------------------------------------------ comm fault: outdoor holds last command until timeout
  // (handled by fault latch above; before timeout the outdoor unit continues)

  // ------------------------------------------------ narration
  makeNarration(c, x, err, tset, lockoutLeft, reason, defrosting);

  const cmd: ActuatorCmd = {
    f: c.fault ? 0 : c.fCmd, ifan: c.ifanCmd, ofan: c.ofanCmd, eev: c.eevCmd,
    vaneUpper: c.vaneUpperCmd, vaneLower: c.vaneLowerCmd, wide: c.wideCmd, vaneOpen: c.vaneOpenCmd, rv: c.rvCmd,
  };
  if (c.fault && c.fCmd > 0) { c.fCmd = 0; c.lastStop = t; }
  return { c, cmd, events: ev, remote };
}

function makeNarration(c: CtrlState, x: CtrlCtx, err: number, tset: number, lockoutLeft: number, reason: string, defrosting: boolean) {
  const { plant, faults } = x;
  if (c.fault) return narrate(c, 'fault', `${c.fault.code}: ${c.fault.msg} Remove the cause, then switch OFF and ON to reset.`);
  if (c.sup === 'OFF') return narrate(c, 'off', 'Unit is off. Vanes are closed.');
  if (c.sup === 'STOPPING') return narrate(c, 'stopping', 'Stopping: compressor off, vanes closing, outdoor fan runs on for 15 s.');
  if (c.sup === 'START_DELAY') return narrate(c, 'startDelay', `Waiting for the 3-minute compressor restart delay: ${lockoutLeft.toFixed(0)} s left.`);
  if (c.sup === 'STARTING') return narrate(c, 'starting', 'Starting: vanes open, outdoor fan starts 5 s before the compressor.');
  if (defrosting) return narrate(c, 'defrost', `Defrost (${c.defrost.phase}): the 4-way valve sends hot gas to the outdoor coil to melt frost; fans stopped. Frost ${plant.frost.toFixed(2)} kg.`);
  if (c.sup === 'PROTECTION') {
    if (c.prot.frostStop) return narrate(c, 'frostStop', 'Coil frost prevention stopped the compressor; indoor fan keeps running until the coil warms.');
    if (c.prot.tdStop) return narrate(c, 'tdStop', 'Discharge temperature too high: compressor stopped until it cools to 100 degC.');
    if (c.prot.hpStop) return narrate(c, 'hpStop', 'High pressure protection stopped the compressor.');
    return narrate(c, 'prot', 'Protection stop active.');
  }
  if (faults.filterRestriction > 1 && reason.startsWith('Indoor coil')) return narrate(c, 'filterFrost', 'Restricted filter reduced airflow; the indoor coil got colder and coil frost prevention is limiting the compressor.');
  if (reason) return narrate(c, 'limit', `${reason} is limiting the compressor.`);
  if (c.sup === 'FAN_ONLY') return narrate(c, 'fan', 'Fan mode: compressor and outdoor fan off; only the indoor fan circulates room air.');
  if (c.sup === 'STANDBY') return narrate(c, 'thermoOff', `Room reached the set temperature (${tset.toFixed(1)} degC). Compressor off (thermo-OFF); indoor fan at very low.`);
  if (c.opMode === 'dry') return narrate(c, 'dry', `DRY: low compressor speed and low airflow to remove moisture with limited overcooling. Target ${tset.toFixed(1)} degC.`);
  if (err > 2) return narrate(c, 'pulldown', `Room is ${err.toFixed(1)} K from target: compressor is driving toward full speed.`);
  if (err > 0.2) return narrate(c, 'approach', 'Room temperature is approaching target, compressor request is reducing.');
  return narrate(c, 'modulate', 'Near the set temperature: the compressor modulates at low speed to balance the room load.');
}

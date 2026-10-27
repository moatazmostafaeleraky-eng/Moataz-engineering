/**
 * Simulation engine: the single authoritative state. Fixed time step,
 * controller then plant each step, validated actions logged with time for
 * replay, bounded history and periodic full snapshots.
 */
import { defaultValues, type ProfileValues } from '../config/registry';
import { initialPlant, plantStep, checkPlant, refOutletArea } from '../model/plant';
import { controlStep, initialCtrl, type CtrlEvent } from '../control/controller';
import type { CtrlState, Environment, Faults, Outputs, Overrides, PlantState, RemoteSettings } from '../model/types';
import { validateAction, type Action, ActionError } from './schema';
import * as AF from '../model/airfield';
import * as PS from '../props/psychro';

export const SIM_VERSION = '1.0.0';

export interface ProbeDef {
  id: string; kind: 'airT' | 'airV' | 'airRH' | 'ref' | 'elec';
  pos?: [number, number, number]; point?: 'p1e' | 'p1' | 'p2' | 'p3' | 'p4'; label: string;
}
export interface ProbeState { def: ProbeDef; ideal: number | null; virt: number | null; lastSample: number; lagged: number | null }

export interface Metrics {
  bandK: number; dwell: number;
  inBandTime: number; pulldownTime: number | null; enteredBandAt: number | null;
  overshoot: number; compStarts: number; peakInput: number; energyToService: number | null;
  zone: AF.ZoneStats | null; zoneName: string;
  zoneSum: number; zoneN: number; uniformitySum: number; draftSum: number;
}

export interface SimState {
  version: string; t: number; seed: number; rng: number;
  plant: PlantState; ctrl: CtrlState; remote: RemoteSettings; overrides: Overrides; env: Environment; faults: Faults;
  profile: ProfileValues; profileName: string;
  probes: ProbeState[];
  metrics: Metrics;
  solverFaults: number;
  zone: AF.ZoneDef;
}

export interface SimEvent extends CtrlEvent { seq: number }
export interface InputRecord { t: number; action: Action }

export interface SimOptions { detailEvery?: number; dt?: number; fieldInterval?: number; historyInterval?: number; snapshotInterval?: number; historyCap?: number; snapshotCap?: number; computeField?: boolean }

export const HISTORY_CHANNELS = [
  't', 'Troom', 'RHroom', 'Tset', 'Tsup', 'Tmass', 'Tout', 'fReq', 'fCmd', 'fAct', 'ifan', 'ofan', 'eev', 'vaneU', 'wide',
  'Qnet', 'Qsens', 'Qlat', 'Qgross', 'Pcomp', 'Pfans', 'Ptotal', 'COP', 'condRate', 'Pe', 'Pc', 'Te', 'Tc', 'Tdis', 'SH', 'frost', 'sup',
  'zoneMean', 'zoneStd', 'current', 'Tcoil',
] as const;
export type Channel = (typeof HISTORY_CHANNELS)[number];
export const CHANNEL_UNITS: Record<Channel, string> = {
  t: 's', Troom: 'degC', RHroom: '%', Tset: 'degC', Tsup: 'degC', Tmass: 'degC', Tout: 'degC', fReq: 'Hz', fCmd: 'Hz', fAct: 'Hz', ifan: 'rpm', ofan: 'rpm', eev: '%', vaneU: 'deg', wide: 'deg',
  Qnet: 'W', Qsens: 'W', Qlat: 'W', Qgross: 'W', Pcomp: 'W', Pfans: 'W', Ptotal: 'W', COP: '-', condRate: 'L/h', Pe: 'bar(a)', Pc: 'bar(a)', Te: 'degC', Tc: 'degC', Tdis: 'degC', SH: 'K', frost: 'kg', sup: 'code',
  zoneMean: 'degC', zoneStd: 'K', current: 'A', Tcoil: 'degC',
};
export const SUP_CODES = ['OFF', 'STANDBY', 'START_DELAY', 'STARTING', 'COOLING', 'HEATING', 'DRY', 'FAN_ONLY', 'MODULATING', 'STOPPING', 'DEFROST', 'PROTECTION', 'FAULT'];

export function defaultRemote(): RemoteSettings {
  return {
    power: false, mode: 'cool', setpoint: 24, fan: 'auto', vane: 'auto', wide: 3, econoCool: false, nightMode: false,
    isave: false, isaveMem: { cool: null, heat: null }, onTimer: null, offTimer: null, weeklyOn: false, weekly: [], opLock: false,
  };
}
export function defaultOverrides(): Overrides {
  return { manual: false, compHz: null, ifanRpm: null, ofanRpm: null, eevPct: null, vaneAngle: null, wideAngle: null, swingLo: null, swingHi: null, ecoCapW: null, turbo: false, turboUntil: null, sleep: false, sleepRate: 1, sleepMax: 2, sleepSince: null };
}
export function defaultEnv(): Environment {
  return { outdoorT: 35, outdoorRH: 40, solar: 250, internal: 150, occupants: 1, ach: 0.5, doorOpen: false, patm: PS.P_ATM, chamber: null };
}
export function defaultFaults(): Faults {
  return { filterRestriction: 0, coilFouling: 0, outdoorFouling: 0, indoorFanFault: false, outdoorFanFault: false, roomSensorBias: 0, coilSensorBias: 0, sensorFail: 'none', commFault: false };
}
function newMetrics(zone: AF.ZoneDef): Metrics {
  return { bandK: zone.band, dwell: 300, inBandTime: 0, pulldownTime: null, enteredBandAt: null, overshoot: 0, compStarts: 0, peakInput: 0, energyToService: null, zone: null, zoneName: zone.name, zoneSum: 0, zoneN: 0, uniformitySum: 0, draftSum: 0 };
}

export interface InitSpec {
  profile?: ProfileValues; profileName?: string; remote?: Partial<RemoteSettings>; overrides?: Partial<Overrides>;
  env?: Partial<Environment>; faults?: Partial<Faults>; room?: { T: number; RH: number }; t0?: number; seed?: number; zone?: AF.ZoneDef;
}

/** Mulberry32 PRNG, state stored in the snapshot for reproducibility. */
export function rngNext(state: number): [number, number] {
  let t = (state + 0x6d2b79f5) | 0;
  let r = Math.imul(t ^ (t >>> 15), 1 | t);
  r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
  return [((r ^ (r >>> 14)) >>> 0) / 4294967296, t];
}

export function makeState(spec: InitSpec = {}): SimState {
  const profile = spec.profile ? { ...spec.profile } : defaultValues();
  const env = { ...defaultEnv(), ...spec.env };
  const room = spec.room ?? { T: 30, RH: 55 };
  const t0 = spec.t0 ?? 14 * 3600; // Monday 14:00 (day 0)
  const zone = spec.zone ?? AF.ZONE_PRESETS.even;
  return {
    version: SIM_VERSION, t: t0, seed: spec.seed ?? 1, rng: spec.seed ?? 1,
    plant: initialPlant(profile, env, room),
    ctrl: initialCtrl(profile, t0, room.T, env.outdoorT),
    remote: { ...defaultRemote(), ...spec.remote }, overrides: { ...defaultOverrides(), ...spec.overrides },
    env, faults: { ...defaultFaults(), ...spec.faults }, profile, profileName: spec.profileName ?? 'mitsubishi_ap35_reference',
    probes: [], metrics: newMetrics(zone), solverFaults: 0, zone,
  };
}

export class Simulation {
  s: SimState;
  out: Outputs | null = null;
  dt: number;
  fieldInterval: number;
  historyInterval: number;
  snapshotInterval: number;
  historyCap: number;
  snapshotCap: number;
  computeFieldOn: boolean;
  /** compute full cycle state points every N steps (display/probes); 0 = never */
  detailEvery: number;
  events: SimEvent[] = [];
  inputs: InputRecord[] = [];
  snapshots: { t: number; json: string; inputIndex: number }[] = [];
  history: Record<Channel, number[]>;
  grid: AF.FieldGrid;
  gridAvg: AF.FieldGrid;
  jet: AF.Jet | null = null;
  lastField = -1e9;
  lastHist = -1e9;
  lastSnap = -1e9;
  seq = 0;
  stepCount = 0;
  lastGood: string | null = null;
  startTime: number;

  constructor(spec: InitSpec | SimState = {}, opt: SimOptions = {}) {
    this.s = 'plant' in spec ? structuredClone(spec as SimState) : makeState(spec as InitSpec);
    this.startTime = this.s.t;
    this.dt = opt.dt ?? 0.1;
    this.fieldInterval = opt.fieldInterval ?? 2;
    this.historyInterval = opt.historyInterval ?? 2;
    this.snapshotInterval = opt.snapshotInterval ?? 60;
    this.historyCap = opt.historyCap ?? 12000;
    this.snapshotCap = opt.snapshotCap ?? 400;
    this.computeFieldOn = opt.computeField ?? true;
    this.detailEvery = opt.detailEvery ?? 5;
    this.history = Object.fromEntries(HISTORY_CHANNELS.map((c) => [c, [] as number[]])) as unknown as Record<Channel, number[]>;
    this.grid = AF.makeGrid(this.s.profile);
    this.gridAvg = AF.makeGrid(this.s.profile);
    this.gridAvg.T.fill(this.s.plant.Troom);
    this.takeSnapshot();
  }

  get P() { return this.s.profile; }

  /** Validate, log and apply an action at the current simulated time. */
  apply(action: Action, opts: { log?: boolean } = {}): { ok: true } | { ok: false; error: string } {
    try {
      const a = validateAction(action, { mode: this.s.remote.mode, opLock: this.s.remote.opLock });
      this.applyValidated(a);
      if (opts.log !== false) this.inputs.push({ t: this.s.t, action: structuredClone(a) });
      return { ok: true };
    } catch (e) {
      const msg = e instanceof ActionError ? e.message : String(e);
      this.pushEvent({ t: this.s.t, kind: 'user', msg: `Rejected: ${msg}` });
      return { ok: false, error: msg };
    }
  }

  private applyValidated(a: Action) {
    const s = this.s;
    switch (a.type) {
      case 'remote': {
        const prevPower = s.remote.power;
        Object.assign(s.remote, a.patch);
        if (a.patch.mode && a.patch.mode !== 'cool') s.remote.econoCool = false;
        if (a.patch.mode && a.patch.setpoint === undefined) {
          const [lo, hi] = a.patch.mode === 'heat' ? [10, 31] : [16, 31];
          s.remote.setpoint = Math.min(hi, Math.max(lo, s.remote.setpoint));
        }
        if (a.patch.power === true && !prevPower && s.overrides.sleep) s.overrides.sleepSince = s.t;
        this.pushEvent({ t: s.t, kind: 'user', msg: `Remote: ${JSON.stringify(a.patch)}` });
        break;
      }
      case 'override':
        Object.assign(s.overrides, a.patch);
        if (a.patch.turbo === true && s.overrides.turboUntil === null) s.overrides.turboUntil = s.t + 900;
        if (a.patch.turbo === false) s.overrides.turboUntil = null;
        if (a.patch.sleep === true) s.overrides.sleepSince = s.t;
        this.pushEvent({ t: s.t, kind: 'user', msg: `Experiment: ${JSON.stringify(a.patch)}` });
        break;
      case 'env': Object.assign(s.env, a.patch); this.pushEvent({ t: s.t, kind: 'user', msg: `Conditions: ${JSON.stringify(a.patch)}` }); break;
      case 'faults': Object.assign(s.faults, a.patch); this.pushEvent({ t: s.t, kind: 'user', msg: `Fault injection: ${JSON.stringify(a.patch)}` }); break;
      case 'isaveStore': {
        const heat = s.remote.mode === 'heat';
        s.remote.isaveMem[heat ? 'heat' : 'cool'] = { setpoint: s.remote.setpoint, fan: s.remote.fan, vane: s.remote.vane };
        this.pushEvent({ t: s.t, kind: 'user', msg: `i-save stored for ${heat ? 'HEAT' : 'COOL/ECONO COOL'}` });
        break;
      }
      case 'profile':
        Object.assign(s.profile, a.patch);
        if (s.profileName === 'mitsubishi_ap35_reference') s.profileName = 'experiment (unsaved)';
        this.pushEvent({ t: s.t, kind: 'user', msg: `Design change: ${JSON.stringify(a.patch)}` });
        break;
    }
  }

  pushEvent(e: CtrlEvent) {
    this.events.push({ ...e, seq: this.seq++ });
    if (this.events.length > 2000) this.events.splice(0, this.events.length - 2000);
  }

  /** One fixed step. */
  step() {
    const s = this.s, dt = this.dt;
    const before = this.lastGood;
    const r = controlStep(s.ctrl, { P: s.profile, t: s.t, dt, remote: s.remote, ov: s.overrides, env: s.env, faults: s.faults, plant: s.plant, out: this.out });
    for (const e of r.events) this.pushEvent(e);
    s.ctrl = r.c; s.remote = r.remote;
    const wasRunning = s.plant.compRunning;
    let res;
    try {
      res = plantStep(s.profile, s.plant, r.cmd, s.env, s.faults, dt, s.ctrl.defrost.phase !== "none", this.detailEvery > 0 && this.stepCount % this.detailEvery === 0);
    } catch (err) {
      res = null;
      this.pushEvent({ t: s.t, kind: 'fault', msg: `Solver exception: ${String(err)}` });
    }
    const bad = res ? checkPlant(res.s) : 'exception';
    if (!res || bad) {
      s.solverFaults++;
      this.pushEvent({ t: s.t, kind: 'fault', msg: `Numerical step rejected (${bad}); last valid state retained` });
      if (s.solverFaults > 20 && !s.ctrl.fault) {
        s.ctrl.fault = { code: 'SIM-N01', msg: 'Repeated numerical failure: controlled stop. Last valid state retained.', t: s.t };
      }
      if (before) { const g = JSON.parse(before); s.plant = g; }
      s.t += dt;
      return;
    }
    s.plant = res.s;
    res.out.fReq = s.ctrl.fReq;
    if (!res.out.points && res.out.running && this.out?.points) res.out.points = this.out.points;
    this.out = res.out;
    if (!wasRunning && s.plant.compRunning) s.metrics.compStarts++;
    s.t += dt;
    this.stepCount++;
    if (this.stepCount % 50 === 0) this.lastGood = JSON.stringify(s.plant);
    this.updateMetrics(dt);
    if (this.computeFieldOn && s.t - this.lastField >= this.fieldInterval) { this.updateField(Math.min(s.t - this.lastField, this.fieldInterval)); this.lastField = s.t; }
    if (s.t - this.lastHist >= this.historyInterval) { this.record(); this.lastHist = s.t; }
    if (s.t - this.lastSnap >= this.snapshotInterval) this.takeSnapshot();
    this.updateProbes();
  }

  /** Advance simulated time by `seconds` (bounded number of steps). */
  advance(seconds: number) {
    const n = Math.max(0, Math.round(seconds / this.dt));
    for (let i = 0; i < n; i++) this.step();
  }

  currentSetpoint(): number {
    const s = this.s;
    if (s.ctrl.opMode === 'dry' && s.ctrl.drySet !== null) return s.ctrl.drySet;
    return s.remote.setpoint + (s.remote.econoCool && s.ctrl.opMode === 'cool' ? s.profile.econoOffset : 0);
  }

  fieldInputs(): AF.FieldInputs | null {
    const o = this.out; if (!o) return null;
    return { q_m3h: o.qIn, area: o.outletArea, Tsup: o.Tsup, Troom: o.Troom, vaneDeg: 0.65 * o.vaneUpper + 0.35 * o.vaneLower, wideDeg: o.wideAct, outletOpen: o.vaneOpen };
  }

  updateField(elapsed: number) {
    const fi = this.fieldInputs(); if (!fi) return;
    this.jet = AF.traceJet(this.s.profile, fi);
    AF.computeField(this.s.profile, this.grid, this.jet, this.s.plant.Troom, fi);
    const a = Math.min(1, elapsed / 20); // 20 s time-average (captures swing)
    const g = this.gridAvg, gi = this.grid;
    for (let i = 0; i < g.T.length; i++) {
      g.T[i] += a * (gi.T[i] - g.T[i]); g.v[i] += a * (gi.v[i] - g.v[i]);
      g.vx[i] += a * (gi.vx[i] - g.vx[i]); g.vy[i] += a * (gi.vy[i] - g.vy[i]); g.vz[i] += a * (gi.vz[i] - g.vz[i]);
    }
    // keep the averaged field on the current room mean
    let sum = 0; for (let i = 0; i < g.T.length; i++) sum += g.T[i];
    const off = sum / g.T.length - this.s.plant.Troom;
    for (let i = 0; i < g.T.length; i++) g.T[i] -= off;
    const z = AF.zoneStats(g, this.s.profile, this.s.zone);
    const m = this.s.metrics;
    m.zone = z;
    if (Number.isFinite(z.mean)) { m.zoneSum += z.mean * elapsed; m.zoneN += elapsed; m.uniformitySum += z.std * elapsed; m.draftSum += z.draftFrac * elapsed; }
  }

  updateMetrics(dt: number) {
    const s = this.s, m = s.metrics, o = this.out;
    if (!o) return;
    const tset = this.currentSetpoint();
    const T = m.zone && Number.isFinite(m.zone.mean) ? m.zone.mean : s.plant.Troom;
    const inBand = Math.abs(T - tset) <= m.bandK && s.remote.power;
    if (inBand) {
      m.inBandTime += dt;
      if (m.enteredBandAt === null) m.enteredBandAt = s.t;
      if (m.pulldownTime === null && s.t - m.enteredBandAt >= m.dwell) {
        m.pulldownTime = m.enteredBandAt - this.startTime;
        m.energyToService = s.plant.E_total;
      }
    } else m.enteredBandAt = null;
    if (m.pulldownTime !== null) {
      const over = s.ctrl.opMode === 'heat' ? T - tset : tset - T;
      m.overshoot = Math.max(m.overshoot, over);
    }
    m.peakInput = Math.max(m.peakInput, o.Ptotal);
  }

  record() {
    const s = this.s, o = this.out; if (!o) return;
    const h = this.history;
    const z = s.metrics.zone;
    const row: Record<Channel, number> = {
      t: s.t, Troom: o.Troom, RHroom: o.RHroom * 100, Tset: this.currentSetpoint(), Tsup: o.Tsup, Tmass: o.Tmass, Tout: s.env.outdoorT,
      fReq: s.ctrl.fReq, fCmd: o.fCmd, fAct: o.fAct, ifan: o.ifanAct, ofan: o.ofanAct, eev: o.eevAct * 100, vaneU: o.vaneUpper, wide: o.wideAct,
      Qnet: o.Qnet, Qsens: o.Qsens, Qlat: o.Qlat, Qgross: o.Qgross, Pcomp: o.Pcomp, Pfans: o.Pifan + o.Pofan, Ptotal: o.Ptotal, COP: o.COP ?? NaN, condRate: o.condRate,
      Pe: o.Pe / 1e5, Pc: o.Pc / 1e5, Te: o.Te, Tc: o.Tc, Tdis: o.Tdis, SH: o.SHevap, frost: o.frost, sup: SUP_CODES.indexOf(s.ctrl.sup),
      zoneMean: z && Number.isFinite(z.mean) ? z.mean : NaN, zoneStd: z && Number.isFinite(z.std) ? z.std : NaN, current: o.current, Tcoil: o.coilInSurface,
    };
    for (const c of HISTORY_CHANNELS) {
      const arr = h[c]; arr.push(row[c]);
      if (arr.length > this.historyCap) arr.splice(0, arr.length - this.historyCap);
    }
  }

  takeSnapshot() {
    this.snapshots.push({ t: this.s.t, json: JSON.stringify(this.s), inputIndex: this.inputs.length });
    if (this.snapshots.length > this.snapshotCap) this.snapshots.splice(1, 1); // always keep the initial snapshot
    this.lastSnap = this.s.t;
  }

  addProbe(def: ProbeDef): { ok: boolean; error?: string } {
    if (def.kind === 'airT' || def.kind === 'airV' || def.kind === 'airRH') {
      const p = def.pos!;
      const P = this.s.profile;
      if (p[0] < 0 || p[1] < 0 || p[2] < 0 || p[0] > P.roomW || p[1] > P.roomH || p[2] > P.roomD) return { ok: false, error: 'Outside the room air domain: no air measurement is available there.' };
      for (const o of AF.DEFAULT_OBSTACLES) if (p[0] > o.min[0] && p[0] < o.max[0] && p[1] > o.min[1] && p[1] < o.max[1] && p[2] > o.min[2] && p[2] < o.max[2]) return { ok: false, error: `Inside solid ${o.name}: not an air cell.` };
    }
    if (def.kind === 'ref' && !def.point) return { ok: false, error: 'Refrigerant probes snap to state points 1e,1,2,3,4.' };
    this.s.probes.push({ def, ideal: null, virt: null, lastSample: -1e9, lagged: null });
    return { ok: true };
  }

  updateProbes() {
    const s = this.s; if (!s.probes.length || !this.out) return;
    const P = s.profile;
    for (const pr of s.probes) {
      let ideal: number | null = null;
      const d = pr.def;
      if ((d.kind === 'airT' || d.kind === 'airV' || d.kind === 'airRH') && d.pos) {
        const smp = AF.sampleField(this.gridAvg, P, ...d.pos);
        if (smp) ideal = d.kind === 'airT' ? smp.T : d.kind === 'airV' ? smp.v : 100 * PS.rh(smp.T, s.plant.wroom);
      } else if (d.kind === 'ref' && d.point) ideal = this.out.points ? this.out.points[d.point].T : null;
      else if (d.kind === 'elec') ideal = this.out.Ptotal;
      pr.ideal = ideal;
      if (ideal === null) { pr.virt = null; continue; }
      pr.lagged = pr.lagged === null ? ideal : pr.lagged + (ideal - pr.lagged) * Math.min(1, this.dt / Math.max(1e-3, P.sensorTau));
      if (s.t - pr.lastSample >= P.sensorPeriod) {
        const [u1, r1] = rngNext(s.rng); const [u2, r2] = rngNext(r1); s.rng = r2;
        const gauss = Math.sqrt(-2 * Math.log(Math.max(1e-12, u1))) * Math.cos(2 * Math.PI * u2);
        const scale = d.kind === 'airV' ? 0.02 : d.kind === 'elec' ? 5 : P.sensorNoise;
        pr.virt = pr.lagged + gauss * scale;
        pr.lastSample = s.t;
      }
    }
  }

  /** Build an independent simulation at time t by loading the nearest earlier snapshot and resimulating logged inputs. */
  replayTo(t: number, opts: SimOptions = {}): Simulation {
    let snap = this.snapshots[0];
    for (const sn of this.snapshots) if (sn.t <= t + 1e-9) snap = sn;
    const st = JSON.parse(snap.json) as SimState;
    const sim = new Simulation(st, { dt: this.dt, fieldInterval: this.fieldInterval, historyInterval: this.historyInterval, snapshotInterval: this.snapshotInterval, ...opts });
    sim.startTime = this.startTime;
    const pending = this.inputs.filter((r, i) => i >= snap.inputIndex && r.t <= t + 1e-9);
    let k = 0;
    while (sim.s.t < t - 1e-9) {
      while (k < pending.length && pending[k].t <= sim.s.t + 1e-9) { sim.apply(pending[k].action); k++; }
      sim.step();
    }
    while (k < pending.length) { sim.apply(pending[k].action); k++; }
    return sim;
  }

  exportRun() {
    return {
      kind: 'ap35-run', version: SIM_VERSION, dt: this.dt, seed: this.s.seed,
      initial: JSON.parse(this.snapshots[0].json) as SimState,
      inputs: this.inputs, endT: this.s.t,
    };
  }

  static fromRun(run: ReturnType<Simulation['exportRun']>, opts: SimOptions = {}): { sim: Simulation; warnings: string[] } {
    const warnings: string[] = [];
    if (run.version !== SIM_VERSION) warnings.push(`Run recorded with model version ${run.version}; current ${SIM_VERSION}. Results may differ.`);
    const sim = new Simulation(run.initial, { dt: run.dt, ...opts });
    let k = 0;
    while (sim.s.t < run.endT - 1e-9) {
      while (k < run.inputs.length && run.inputs[k].t <= sim.s.t + 1e-9) { sim.apply(run.inputs[k].action); k++; }
      sim.step();
    }
    return { sim, warnings };
  }

  /** Public snapshot for the UI (plain JSON). */
  view() {
    return { s: this.s, out: this.out, setpoint: this.currentSetpoint(), lockoutLeft: Math.max(0, this.s.profile.restartDelay - (this.s.t - this.s.ctrl.lastStop)) };
  }
}

export { refOutletArea };

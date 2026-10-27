/**
 * Headless experiment runner: scenarios, matched A/B runs, single-intervention
 * counterfactuals and a stable result hash for caching.
 */
import { Simulation, type InitSpec, type SimState, type Channel, HISTORY_CHANNELS } from './engine';
import type { Scenario, ScheduledAction } from './scenarios';
import type { Action } from './schema';
import * as AF from '../model/airfield';

export interface RunSummary {
  label: string;
  duration_s: number;
  reachedTarget: boolean;
  timeToTarget_s: number | null;
  energy_kWh: number;
  energyToService_kWh: number | null;
  avgUsefulCapacity_W: number;
  peakInput_W: number;
  condensate_L: number;
  occupiedMean_C: number | null;
  occupiedStd_K: number | null;
  draftFraction: number | null;
  inBandFraction: number;
  overshoot_K: number;
  compressorStarts: number;
  faults: string[];
  protections: number;
  finalRoom_C: number;
  finalRH_pct: number;
  serviceNote: string;
}

export interface RunResult { summary: RunSummary; history: Partial<Record<Channel, number[]>>; field: { T: number[]; v: number[]; nx: number; ny: number; nz: number } | null; jet: AF.JetPoint[]; events: { t: number; kind: string; msg: string }[] }

export function fnv1a(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export interface RunOpts { dt?: number; fieldInterval?: number; historyInterval?: number; onProgress?: (f: number) => void; cancelled?: () => boolean }

export function summarize(sim: Simulation, label: string, duration: number): RunSummary {
  const s = sim.s, m = s.metrics, p = s.plant;
  const faults = sim.events.filter((e) => e.kind === 'fault').map((e) => e.msg);
  const prots = sim.events.filter((e) => e.kind === 'protection').length;
  const occ = m.zoneN > 0 ? m.zoneSum / m.zoneN : null;
  return {
    label, duration_s: duration,
    reachedTarget: m.pulldownTime !== null,
    timeToTarget_s: m.pulldownTime,
    energy_kWh: p.E_total,
    energyToService_kWh: m.energyToService,
    avgUsefulCapacity_W: (p.Q_net * 1000 * 3600) / Math.max(1, duration),
    peakInput_W: m.peakInput,
    condensate_L: p.condensateL + p.film,
    occupiedMean_C: occ,
    occupiedStd_K: m.zoneN > 0 ? m.uniformitySum / m.zoneN : null,
    draftFraction: m.zoneN > 0 ? m.draftSum / m.zoneN : null,
    inBandFraction: m.inBandTime / Math.max(1, duration),
    overshoot_K: m.overshoot,
    compressorStarts: m.compStarts,
    faults, protections: prots,
    finalRoom_C: p.Troom, finalRH_pct: sim.out ? sim.out.RHroom * 100 : NaN,
    serviceNote: m.pulldownTime === null ? `Target band (+/-${m.bandK} K for ${m.dwell / 60} min in zone "${m.zoneName}") not reached within the run` : `Band reached and held for ${m.dwell / 60} min`,
  };
}

function applyDue(sim: Simulation, sched: ScheduledAction[], t0: number, k: number): number {
  while (k < sched.length && sched[k].at <= sim.s.t - t0 + 1e-9) { sim.apply(sched[k].action); k++; }
  return k;
}

export function runSchedule(init: InitSpec | SimState, schedule: ScheduledAction[], duration: number, label: string, opts: RunOpts = {}): RunResult {
  const sim = new Simulation(init, { dt: opts.dt ?? 0.1, fieldInterval: opts.fieldInterval ?? 10, historyInterval: opts.historyInterval ?? 10, detailEvery: 0, snapshotInterval: 1e9 });
  const t0 = sim.s.t;
  const sched = [...schedule].sort((a, b) => a.at - b.at);
  let k = applyDue(sim, sched, t0, 0);
  const nSteps = Math.round(duration / sim.dt);
  for (let i = 0; i < nSteps; i++) {
    sim.step();
    k = applyDue(sim, sched, t0, k);
    if (opts.onProgress && i % 3000 === 0) opts.onProgress(i / nSteps);
    if (opts.cancelled && i % 3000 === 0 && opts.cancelled()) break;
  }
  const history: Partial<Record<Channel, number[]>> = {};
  for (const c of HISTORY_CHANNELS) history[c] = sim.history[c].slice();
  return {
    summary: summarize(sim, label, duration),
    history,
    field: { T: Array.from(sim.gridAvg.T), v: Array.from(sim.gridAvg.v), nx: sim.gridAvg.nx, ny: sim.gridAvg.ny, nz: sim.gridAvg.nz },
    jet: sim.jet ? sim.jet.pts.filter((_, i) => i % 3 === 0) : [],
    events: sim.events.map((e) => ({ t: e.t - t0, kind: e.kind, msg: e.msg })),
  };
}

export function runScenario(sc: Scenario, variantIndex: number | null, opts: RunOpts = {}, extra: ScheduledAction[] = []): RunResult {
  const v = variantIndex !== null && sc.variants ? sc.variants[variantIndex] : null;
  const sched = [...sc.schedule, ...(v ? v.schedule : []), ...extra];
  return runSchedule(sc.init, sched, sc.duration, v ? v.label : sc.title, opts);
}

/** Run two or more variants from the identical initial state and schedule. */
export function runAB(sc: Scenario, opts: RunOpts = {}): RunResult[] {
  const vs = sc.variants ?? [];
  return vs.map((_, i) => runScenario(sc, i, opts));
}

/**
 * Single-intervention counterfactual: from a recorded pre-change snapshot, run
 * (a) the unchanged continuation and (b) the same continuation with one action
 * applied at the start; all other inputs identical.
 */
export function counterfactual(snapshot: SimState, intervention: Action, laterInputs: { t: number; action: Action }[], horizon: number, opts: RunOpts = {}) {
  const t0 = snapshot.t;
  const later: ScheduledAction[] = laterInputs.filter((r) => r.t >= t0).map((r) => ({ at: r.t - t0, action: r.action }));
  const base = runSchedule(snapshot, later, horizon, 'Unchanged', opts);
  const test = runSchedule(snapshot, [{ at: 0, action: intervention }, ...later], horizon, 'With intervention only', opts);
  return { base, test, matched: true, note: 'Both runs start from the same full snapshot (thermal storage, humidity, controller integrators, timers, actuators, RNG) with identical later inputs.' };
}

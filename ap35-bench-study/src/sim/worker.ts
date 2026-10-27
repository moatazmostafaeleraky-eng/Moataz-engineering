/// <reference lib="webworker" />
/**
 * Worker host. role 'live': owns the authoritative Simulation and advances it on
 * a fixed step independent of display FPS. role 'batch': runs headless jobs
 * (A/B, sweeps, robustness, counterfactuals, evidence calibration) away from
 * the render loop with progress and cancellation.
 */
import { Simulation, HISTORY_CHANNELS, type InitSpec, type SimState, type ProbeDef } from './engine';
import type { Action } from './schema';
import { runScenario, runSchedule, counterfactual, type RunResult } from './runner';
import { SCENARIO_BY_ID, type ScheduledAction } from './scenarios';
import { candidateRun, lhs, pareto, src, SWEEP_VARS, robustnessCases, type SweepSpec, type Candidate } from './doe';
import { explain } from './explain';
import { calibrateSteady, parseLabCSV } from './evidence';
import { runValidation } from '../model/validation';
import { observe, rankCandidates } from './diagnostics';
import type { ProfileValues } from '../config/registry';
import * as AF from '../model/airfield';

const ctx = self as unknown as DedicatedWorkerGlobalScope;
let role: 'live' | 'batch' | null = null;

// ------------------------------------------------------------------ live
let sim: Simulation | null = null;
let replay: Simulation | null = null;
let running = false;
let speed = 1;
let acc = 0;
let lastTick = 0;
let lastFrame = 0;
let histSent = 0;
let evSent = 0;
let lastFieldSent = -1;
const MAX_STEPS_PER_TICK = 4000;

function post(msg: unknown, transfer: Transferable[] = []) { ctx.postMessage(msg, transfer); }

function frame(force = false) {
  if (!sim) return;
  const now = performance.now();
  if (!force && now - lastFrame < 33) return;
  lastFrame = now;
  const v = sim.view();
  const n = sim.history.t.length;
  let hist: Record<string, number[]> | null = null;
  if (n !== histSent) {
    if (n < histSent) histSent = 0;
    hist = {};
    for (const c of HISTORY_CHANNELS) hist[c] = sim.history[c].slice(histSent);
    histSent = n;
  }
  const evs = sim.events.filter((e) => e.seq >= evSent);
  if (evs.length) evSent = evs[evs.length - 1].seq + 1;
  let field: { T: Float32Array; v: Float32Array; vx: Float32Array; vy: Float32Array; vz: Float32Array; nx: number; ny: number; nz: number; Tinst: Float32Array } | null = null;
  const transfer: Transferable[] = [];
  if (sim.lastField !== lastFieldSent) {
    lastFieldSent = sim.lastField;
    const g = sim.gridAvg;
    field = { T: g.T.slice(), v: g.v.slice(), vx: g.vx.slice(), vy: g.vy.slice(), vz: g.vz.slice(), nx: g.nx, ny: g.ny, nz: g.nz, Tinst: sim.grid.T.slice() };
    transfer.push(field.T.buffer, field.v.buffer, field.vx.buffer, field.vy.buffer, field.vz.buffer, field.Tinst.buffer);
  }
  post({ type: 'frame', view: v, running, speed, hist, histReset: hist && histSent === n && n > 0 && hist.t?.length === n ? true : false, events: evs, field, jet: sim.jet ? { pts: sim.jet.pts.filter((_, i) => i % 2 === 0), throw: sim.jet.throw, u0: sim.jet.u0, attached: sim.jet.attached } : null, stepCount: sim.stepCount, inputs: sim.inputs.length, snapshots: sim.snapshots.map((s) => s.t), startTime: sim.startTime, replay: replay ? replay.view() : null }, transfer);
}

function tick() {
  const now = performance.now();
  const realDt = Math.min(0.25, (now - lastTick) / 1000); // bounded catch-up
  lastTick = now;
  if (sim && running) {
    acc += realDt * speed;
    let steps = Math.floor(acc / sim.dt);
    if (steps > MAX_STEPS_PER_TICK) { steps = MAX_STEPS_PER_TICK; acc = 0; } else acc -= steps * sim.dt;
    for (let i = 0; i < steps; i++) sim.step();
  }
  frame();
}

function liveMessage(m: Record<string, unknown>) {
  switch (m.type) {
    case 'init': {
      sim = new Simulation((m.spec ?? {}) as InitSpec, { fieldInterval: 2, historyInterval: 2 });
      histSent = 0; evSent = 0; lastFieldSent = -1; replay = null;
      running = (m.run as boolean) ?? true; acc = 0;
      post({ type: 'reset' });
      frame(true);
      break;
    }
    case 'loadState': {
      sim = new Simulation(m.state as SimState, { fieldInterval: 2, historyInterval: 2 });
      histSent = 0; evSent = 0; lastFieldSent = -1; replay = null; acc = 0;
      post({ type: 'reset' }); frame(true); break;
    }
    case 'action': {
      if (!sim) return;
      const r = sim.apply(m.action as Action);
      post({ type: 'actionResult', id: m.id, result: r });
      frame(true);
      break;
    }
    case 'run': running = !!m.on; acc = 0; frame(true); break;
    case 'speed': speed = Number(m.speed) || 1; frame(true); break;
    case 'step': if (sim) { sim.advance(Number(m.seconds ?? sim.dt)); frame(true); } break;
    case 'addProbe': if (sim) { post({ type: 'probeResult', id: m.id, result: sim.addProbe(m.probe as ProbeDef) }); frame(true); } break;
    case 'removeProbe': if (sim) { sim.s.probes = sim.s.probes.filter((p) => p.def.id !== m.probeId); frame(true); } break;
    case 'setZone': if (sim) { sim.s.zone = m.zone as AF.ZoneDef; sim.s.metrics.zoneName = (m.zone as AF.ZoneDef).name; sim.s.metrics.bandK = (m.zone as AF.ZoneDef).band; frame(true); } break;
    case 'explain': if (sim) post({ type: 'explanation', id: m.id, result: explain(sim, m.quantity as 'fAct') }); break;
    case 'getRun': if (sim) post({ type: 'run', id: m.id, run: sim.exportRun(), history: sim.history }); break;
    case 'getCounterfactualInputs': {
      if (!sim) return;
      const idx = m.inputIndex as number;
      const rec = sim.inputs[idx];
      let snap = sim.snapshots[0];
      for (const sn of sim.snapshots) if (sn.t <= rec.t - 1e-9) snap = sn;
      const later = sim.inputs.filter((r, i) => i !== idx && r.t >= snap.t);
      // re-apply inputs between snapshot and the intervention to both runs: keep them in "later"
      post({ type: 'counterfactualInputs', id: m.id, snapshot: JSON.parse(snap.json), intervention: rec.action, later, horizon: Math.max(600, sim.s.t - snap.t) });
      break;
    }
    case 'replayTo': {
      if (!sim) return;
      replay = sim.replayTo(m.t as number);
      post({ type: 'replayReady', t: replay.s.t });
      frame(true);
      break;
    }
    case 'replayClose': replay = null; frame(true); break;
    case 'branch': {
      if (!sim || !replay) return;
      const keepStart = sim.startTime;
      sim = replay; sim.startTime = keepStart; replay = null;
      histSent = 0; evSent = 0; lastFieldSent = -1;
      post({ type: 'reset', branched: true });
      frame(true);
      break;
    }
    case 'diagnose': {
      if (!sim || !sim.out) return;
      const pr = sim.s.probes.find((p) => p.def.kind === 'airT');
      const obs = observe(sim.s.profile, sim.out, sim.s.plant, sim.s.ctrl.sens, pr?.virt ?? null, { T: sim.s.env.outdoorT, RH: sim.s.env.outdoorRH });
      post({ type: 'diagnosis', id: m.id, obs, rank: obs.length ? rankCandidates(obs) : null });
      break;
    }
    case 'visibility': if (m.hidden) { running = false; } break;
  }
}

// ------------------------------------------------------------------ batch
let cancelFlag = false;
const cache = new Map<string, Candidate['summary'] & object>();

function lite(r: RunResult) {
  const keep = ['t', 'Troom', 'Tset', 'zoneMean', 'Qnet', 'Ptotal', 'fAct', 'RHroom', 'ifan', 'Tsup'] as const;
  const h: Record<string, number[]> = {};
  for (const k of keep) h[k] = (r.history[k] ?? []).filter((_, i) => i % 3 === 0);
  return { summary: r.summary, history: h, field: r.field, jet: r.jet, events: r.events.slice(-40) };
}

/** Let queued messages (cancel) run between batch items. */
const yieldNow = () => new Promise<void>((r) => setTimeout(r, 0));

async function batchMessage(m: Record<string, unknown>) {
  const id = m.id;
  const progress = (f: number) => post({ type: 'progress', id, f });
  cancelFlag = false;
  const cancelled = () => cancelFlag;
  try {
    switch (m.type) {
      case 'cancel': cancelFlag = true; return;
      case 'scenarioAB': {
        const sc = SCENARIO_BY_ID[m.scenario as string];
        const n = sc.variants?.length ?? 1;
        const out = [];
        for (let i = 0; i < n; i++) { out.push(lite(runScenario(sc, sc.variants ? i : null, { onProgress: (f) => progress((i + f) / n), cancelled }))); await yieldNow(); if (cancelled()) break; }
        post({ type: 'done', id, result: out }); return;
      }
      case 'customAB': {
        const init = m.init as InitSpec; const base = m.schedule as ScheduledAction[]; const dur = m.duration as number;
        const a = runSchedule(init, [...base, ...(m.a as ScheduledAction[])], dur, (m.labels as string[])[0], { onProgress: (f) => progress(f / 2), cancelled });
        await yieldNow();
        const b = runSchedule(init, [...base, ...(m.b as ScheduledAction[])], dur, (m.labels as string[])[1], { onProgress: (f) => progress(0.5 + f / 2), cancelled });
        post({ type: 'done', id, result: [lite(a), lite(b)] }); return;
      }
      case 'counterfactual': {
        const r = counterfactual(m.snapshot as SimState, m.intervention as Action, m.later as { t: number; action: Action }[], m.horizon as number, { onProgress: progress, cancelled });
        post({ type: 'done', id, result: { base: lite(r.base), test: lite(r.test), matched: r.matched, note: r.note } }); return;
      }
      case 'sweep': {
        const spec = m.spec as SweepSpec;
        const d = spec.vars.length;
        const pts = lhs(spec.n, d, spec.seed);
        const cands: Candidate[] = [];
        const baseCand = candidateRun(spec, {}, {}, cache as never);
        baseCand.baseline = true; baseCand.values = {};
        cands.push(baseCand);
        await yieldNow();
        for (let i = 0; i < pts.length; i++) {
          if (cancelled()) break;
          const values: Record<string, number> = {};
          spec.vars.forEach((v, j) => { const def = SWEEP_VARS.find((x) => x.id === v.id)!; let x = v.lo + (v.hi - v.lo) * pts[i][j]; if (def.integer) x = Math.round(x); values[v.id] = x; });
          cands.push(candidateRun(spec, values, {}, cache as never));
          progress((i + 1) / pts.length);
          post({ type: 'partial', id, candidates: cands });
          await yieldNow();
        }
        const ids = spec.vars.map((v) => v.id);
        const sens = {
          energy: src(cands.filter((c) => !c.baseline), ids, (s) => s.energy_kWh),
          time: src(cands.filter((c) => !c.baseline), ids, (s) => s.timeToTarget_s),
          uniformity: src(cands.filter((c) => !c.baseline), ids, (s) => s.occupiedStd_K),
        };
        post({ type: 'done', id, result: { candidates: cands, pareto: pareto(cands).map((c) => c.id), sensitivity: sens, tested: cands.length, failed: cands.filter((c) => !c.feasible).length, cancelled: cancelled() } });
        return;
      }
      case 'robustness': {
        const cases = robustnessCases(m.init as InitSpec);
        const out = [];
        for (let i = 0; i < cases.length; i++) {
          const r = runSchedule(cases[i].init, m.schedule as ScheduledAction[], m.duration as number, cases[i].label, { onProgress: (f) => progress((i + f) / cases.length), cancelled });
          out.push(lite(r));
          await yieldNow();
          if (cancelled()) break;
        }
        post({ type: 'done', id, result: out }); return;
      }
      case 'evidence': {
        const data = parseLabCSV(m.csv as string);
        const r = calibrateSteady(m.profile as ProfileValues, data, (m.mode as 'cool' | 'heat') ?? 'cool', (m.valFraction as number) ?? 0.4);
        post({ type: 'done', id, result: { data: { columns: data.columns, warnings: data.warnings, unused: data.unused, meta: data.meta, n: data.rows.length }, fit: r, rows: data.rows } });
        return;
      }
      case 'validation': {
        const r = runValidation(m.profile as ProfileValues, { rowsStride: 3 });
        post({ type: 'done', id, result: r }); return;
      }
    }
  } catch (e) {
    post({ type: 'error', id, error: e instanceof Error ? e.message : String(e) });
  }
}

ctx.onmessage = (ev: MessageEvent) => {
  const m = ev.data as Record<string, unknown>;
  if (m.type === 'role') {
    role = m.role as 'live' | 'batch';
    if (role === 'live') { lastTick = performance.now(); setInterval(tick, 16); }
    return;
  }
  if (role === 'live') liveMessage(m);
  else if (role === 'batch') { if (m.type === 'cancel') { cancelFlag = true; return; } void batchMessage(m); }
};

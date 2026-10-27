/** Import/export, schema validation, profiles, optimisation, diagnostics, evidence and assistant tests. */
import { describe, it, expect } from 'vitest';
import { Simulation } from '../src/sim/engine';
import { validateAction, ActionError } from '../src/sim/schema';
import { settingsJSON, parseSettings, historyCSV } from '../src/sim/export';
import { mitsubishi_ap35_reference, newExperiment, setParam, changedParams, undo, redo } from '../src/config/profiles';
import { lhs, pareto, candidateRun, type Candidate } from '../src/sim/doe';
import { SCENARIO_BY_ID, SCENARIOS } from '../src/sim/scenarios';
import { runScenario } from '../src/sim/runner';
import { parseLabCSV, calibrateSteady, syntheticDemoCSV, templateCSV } from '../src/sim/evidence';
import { observe, rankCandidates } from '../src/sim/diagnostics';
import { parseCommand } from '../src/sim/assistant';
import { defaultValues } from '../src/config/registry';

const log = (k: string, v: unknown) => console.log(`[result] ${k}: ${typeof v === 'number' ? +v.toFixed(5) : JSON.stringify(v)}`);

describe('acceptance 15: schema validation and import/export', () => {
  it('rejects invalid ranges, units, keys and locked parameters', () => {
    const bad = [
      { type: 'remote', patch: { setpoint: 40 } }, { type: 'remote', patch: { setpoint: 12 } }, { type: 'remote', patch: { mode: 'turbo' } },
      { type: 'remote', patch: { foo: 1 } }, { type: 'env', patch: { outdoorT: 80 } }, { type: 'profile', patch: { capCoolNom: 4 } },
      { type: 'profile', patch: { Vd: 1 } }, { type: 'override', patch: { eevPct: 120 } },
    ];
    for (const a of bad) expect(() => validateAction(a as never, { mode: 'cool' })).toThrow(ActionError);
    expect(() => validateAction({ type: 'remote', patch: { setpoint: 12 } }, { mode: 'heat' })).not.toThrow();
    expect(() => validateAction({ type: 'remote', patch: { isave: true } }, { mode: 'dry' })).toThrow(/i-save/);
    expect(() => validateAction({ type: 'remote', patch: { mode: 'heat' } }, { mode: 'cool', opLock: true })).toThrow(/LOCK/);
    const w = Array.from({ length: 5 }, (_, i) => ({ day: 0, time: i * 60, on: true, temp: 24 }));
    expect(() => validateAction({ type: 'remote', patch: { weekly: w } }, { mode: 'cool' })).toThrow(/4 timers per day/);
  });
  it('settings round-trip and wrong schema is rejected', () => {
    const sim = new Simulation({}); sim.apply({ type: 'remote', patch: { power: true, setpoint: 25.5, fan: 'High' } }); sim.apply({ type: 'profile', patch: { outletH: 0.08 } });
    const j = settingsJSON(sim.s);
    const p = parseSettings(j);
    expect((p.remote as { setpoint: number }).setpoint).toBe(25.5);
    expect(p.profileOverrides!.outletH).toBe(0.08);
    expect(() => parseSettings('{"schema":"other"}')).toThrow();
    expect(() => parseSettings('not json')).toThrow();
  });
  it('CSV export carries units; lab CSV import validates units and keeps missing values', () => {
    const sim = new Simulation({}, { computeField: false }); sim.apply({ type: 'remote', patch: { power: true } }); sim.advance(60);
    const csv = historyCSV(sim.history, sim.startTime);
    expect(csv.split('\n')[1]).toContain('Troom [degC]');
    expect(() => parseLabCSV('time [s],indoor_db [furlong],outdoor_db [degC]\n0,1,2')).toThrow(/unit/);
    const d = parseLabCSV('time [s],indoor_db [degF],outdoor_db [degC],capacity [kW],mystery [x]\n0,80.6,35,\n60,80.6,35,3.4');
    expect(d.rows[0].capacity).toBeNull(); expect(d.rows[0].indoor_db).toBeCloseTo(27, 6); expect(d.rows[1].capacity).toBe(3400);
    expect(d.unused).toContain('mystery [x]');
    expect(templateCSV()).toContain('power_total [W]');
  });
});

describe('profiles: reference immutable, experiments branch, revert/undo', () => {
  it('reference cannot be modified and experiments track changes', () => {
    expect(Object.isFrozen(mitsubishi_ap35_reference)).toBe(true);
    const before = mitsubishi_ap35_reference.outletH;
    const e = newExperiment('t');
    expect(setParam(e, 'outletH', 0.08)).toBeNull();
    expect(setParam(e, 'capCoolNom', 4)).toMatch(/published/);
    expect(setParam(e, 'outletH', 5)).toMatch(/outside/);
    expect(changedParams(e).length).toBe(1);
    undo(e); expect(changedParams(e).length).toBe(0); redo(e); expect(changedParams(e).length).toBe(1);
    expect(mitsubishi_ap35_reference.outletH).toBe(before);
    const sim = new Simulation({ profile: { ...mitsubishi_ap35_reference } }); sim.apply({ type: 'profile', patch: { outletH: 0.09 } });
    expect(mitsubishi_ap35_reference.outletH).toBe(before);
  });
  it('supported geometry edit changes airflow operating point and jet', () => {
    const run = (h: number) => { const s = new Simulation({ profile: { ...defaultValues(), outletH: h } }); s.apply({ type: 'remote', patch: { power: true, fan: 'High' } }); s.advance(120); return s; };
    const a = run(0.05), b = run(0.09);
    log('outlet 50 mm vs 90 mm airflow m3/h', [a.out!.qIn, b.out!.qIn]); log('outlet 50 vs 90 mm jet u0', [a.jet!.u0, b.jet!.u0]);
    expect(b.out!.qIn).toBeGreaterThan(a.out!.qIn); expect(b.jet!.u0).toBeLessThan(a.jet!.u0);
  });
});

describe('scenarios run, A/B and optimisation', () => {
  it('all scenario presets run without solver faults', () => {
    for (const sc of SCENARIOS) {
      const r = runScenario({ ...sc, duration: Math.min(sc.duration, 1500) }, sc.variants ? 0 : null, { fieldInterval: 20 });
      const solver = r.events.filter((e) => e.msg.includes('Numerical step rejected'));
      expect(solver.length, sc.id).toBe(0);
      expect(Number.isFinite(r.summary.energy_kWh)).toBe(true);
    }
  });
  it('time-averaged zone metrics follow the room (first field update is not over-weighted)', () => {
    const sc = SCENARIO_BY_ID.pulldown;
    const r = runScenario({ ...sc, duration: 1800 }, null, { fieldInterval: 10 });
    const s = r.summary;
    log('pulldown 30 min: occupied-zone mean / std / final room', [s.occupiedMean_C, s.occupiedStd_K, s.finalRoom_C]);
    expect(s.occupiedMean_C!).toBeLessThan(29);
    expect(s.occupiedMean_C!).toBeGreaterThan(s.finalRoom_C - 0.5);
    expect(s.occupiedStd_K!).toBeGreaterThan(0.005);
  });
  it('fan A/B from identical states reports matched metrics', () => {
    const sc = SCENARIO_BY_ID.fanAB;
    const a = runScenario({ ...sc, duration: 2400 }, 0, { fieldInterval: 10 }), b = runScenario({ ...sc, duration: 2400 }, 1, { fieldInterval: 10 });
    log('fan Low vs High time to target s', [a.summary.timeToTarget_s, b.summary.timeToTarget_s]); log('fan Low vs High energy kWh', [a.summary.energy_kWh, b.summary.energy_kWh]);
    expect(a.summary.avgUsefulCapacity_W).not.toBe(b.summary.avgUsefulCapacity_W);
  });
  it('LHS is deterministic; Pareto returns only feasible candidates and the baseline is included', () => {
    expect(lhs(8, 2, 3)).toEqual(lhs(8, 2, 3));
    const spec = { vars: [{ id: 'ifan', lo: 0, hi: 4 }], n: 6, seed: 2, base: { init: { room: { T: 29, RH: 55 } }, schedule: [{ at: 0, action: { type: 'remote' as const, patch: { power: true, mode: 'cool' as const, setpoint: 25 } } }], duration: 1500 }, constraints: { maxDraft: 0.6, bandK: 1.5, requireTarget: true } };
    const cands: Candidate[] = [{ ...candidateRun(spec, {}, { fieldInterval: 20 }), baseline: true }];
    for (const p of lhs(spec.n, 1, spec.seed)) cands.push(candidateRun(spec, { ifan: Math.round(p[0] * 4) }, { fieldInterval: 20 }));
    const par = pareto(cands);
    log('sweep feasible / total', [cands.filter((c) => c.feasible).length, cands.length]);
    expect(cands.some((c) => c.baseline)).toBe(true);
    for (const c of par) expect(c.feasible).toBe(true);
    const vis = candidateRun({ ...spec, vars: [{ id: 'vaneCount', lo: 8, hi: 20 }] }, { vaneCount: 12 }, { fieldInterval: 20 });
    expect(vis.feasible).toBe(false); expect(vis.reasons.join()).toMatch(/visual-only/);
  });
});

describe('diagnostics, evidence, assistant', () => {
  it('filter restriction ranks an airflow-related cause first and flags ambiguity', () => {
    const sim = new Simulation({ room: { T: 27, RH: 50 }, env: { chamber: { T: 27, RH: 50 } } }, { computeField: false });
    sim.apply({ type: 'remote', patch: { power: true, mode: 'cool', setpoint: 16, fan: 'Med' } });
    sim.apply({ type: 'override', patch: { manual: true, compHz: 50 } });
    sim.apply({ type: 'faults', patch: { filterRestriction: 3 } }); sim.advance(1500);
    const obs = observe(sim.P, sim.out!, sim.s.plant, sim.s.ctrl.sens, null, { T: sim.s.env.outdoorT, RH: sim.s.env.outdoorRH });
    const r = rankCandidates(obs);
    log('diagnosis ranking', r.candidates.slice(0, 3).map((c) => c.id)); log('ambiguity', r.ambiguous);
    expect(['filter', 'inFoul']).toContain(r.candidates[0].id);
  });
  it('steady calibration on synthetic data moves the identifiable scale the right way and keeps validation separate', () => {
    const data = parseLabCSV(syntheticDemoCSV(defaultValues()));
    const r = calibrateSteady(defaultValues(), data, 'cool', 0.4);
    log('evidence scales', r.scales); log('evidence validation', r.validation);
    expect(r.scales.uaInAir).toBeLessThan(1);
    expect(r.calibration.n + r.validation.n).toBe(data.rows.length);
    expect(Object.isFrozen(mitsubishi_ap35_reference)).toBe(true);
  });
  it('assistant produces structured actions that still pass validation', () => {
    expect(parseCommand('Compare Low and High indoor fan from the same starting state').actions[0].kind).toBe('runComparison');
    expect(parseCommand('Why did compressor speed fall?').actions[0].kind).toBe('explainEvent');
    expect(parseCommand('Find the best tested louver/fan setting for the desk zone').actions[0].kind).toBe('runSweep');
    expect(parseCommand('Show where heat leaves the room').actions[0].kind).toBe('showHeatFlows');
    const r = parseCommand('set temperature to 45');
    const a = r.actions[0] as { kind: string; action: never };
    const sim = new Simulation({});
    expect(sim.apply(a.action).ok).toBe(false);
    expect(parseCommand('make me a sandwich').ok).toBe(false);
  });
});

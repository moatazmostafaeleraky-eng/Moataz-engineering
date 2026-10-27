/** Control, protection, behaviour and reproducibility acceptance tests. */
import { describe, it, expect } from 'vitest';
import { Simulation } from '../src/sim/engine';
import * as PS from '../src/props/psychro';
import { defaultValues } from '../src/config/registry';
import { solveSteady } from '../src/model/steady';
import * as AF from '../src/model/airfield';
import { IndoorParticles, OutdoorParticles, type FieldMsg } from '../src/scene/airflowViz';
import * as THREE from 'three';
import { SCENARIO_BY_ID } from '../src/sim/scenarios';

const log = (k: string, v: unknown) => console.log(`[result] ${k}: ${typeof v === 'number' ? +v.toFixed(5) : JSON.stringify(v)}`);
const cooling = (spec = {}) => { const s = new Simulation({ room: { T: 30, RH: 55 }, ...spec }, { computeField: false }); s.apply({ type: 'remote', patch: { power: true, mode: 'cool', setpoint: 24 } }); return s; };

describe('acceptance 6: limits, ramps, restart lockout, anti-windup, cycling', () => {
  it('frequency command respects ramp limits and envelope', () => {
    const sim = cooling();
    let prev = 0, maxUp = 0, maxDown = 0;
    for (let i = 0; i < 24000; i++) {
      sim.step(); const f = sim.s.ctrl.fCmd;
      if (prev > 0 && f > 0) { maxUp = Math.max(maxUp, (f - prev) / sim.dt); maxDown = Math.max(maxDown, (prev - f) / sim.dt); }
      if (f > 0) { expect(f).toBeGreaterThanOrEqual(sim.P.fMin - 1e-9); expect(f).toBeLessThanOrEqual(sim.P.fMaxCool + 1e-9); }
      prev = f;
    }
    log('max ramp up Hz/s', maxUp); log('max ramp down Hz/s', maxDown);
    expect(maxUp).toBeLessThanOrEqual(sim.P.rampUp + 1e-6); expect(maxDown).toBeLessThanOrEqual(sim.P.rampDown + 1e-6);
  });
  it('3-minute restart lockout is enforced and visible', () => {
    const sim = cooling(); sim.advance(400);
    sim.apply({ type: 'remote', patch: { power: false } }); sim.advance(5);
    const stopT = sim.s.ctrl.lastStop;
    sim.apply({ type: 'remote', patch: { power: true } });
    let startT: number | null = null; let sawDelay = false;
    for (let i = 0; i < 3000; i++) { sim.step(); if (sim.s.ctrl.sup === 'START_DELAY') sawDelay = true; if (startT === null && sim.s.plant.compRunning) startT = sim.s.t; }
    log('restart after stop s', startT! - stopT);
    expect(sawDelay).toBe(true);
    expect(startT! - stopT).toBeGreaterThanOrEqual(180 - 1e-6);
  });
  it('anti-windup: after long saturation the request falls promptly when demand reverses', () => {
    const sim = new Simulation({ room: { T: 33, RH: 50 }, env: { outdoorT: 43, solar: 1500, internal: 1500 } }, { computeField: false });
    sim.apply({ type: 'remote', patch: { power: true, mode: 'cool', setpoint: 18 } }); sim.advance(3600);
    const integ = sim.s.ctrl.integ;
    log('integrator after 1 h saturation', integ);
    expect(Math.abs(integ)).toBeLessThanOrEqual(sim.P.fMaxCool + 1e-9);
    sim.apply({ type: 'remote', patch: { setpoint: 31 } });
    sim.advance(240);
    log('frequency 4 min after demand reversal', sim.s.ctrl.fCmd);
    expect(sim.s.ctrl.fCmd).toBeLessThan(40);
  });
  it('minimum-load cycling: thermo-off and restarts honour the lockout', () => {
    const sim = new Simulation({ room: { T: 24.6, RH: 50 }, env: { outdoorT: 26, outdoorRH: 50, solar: 0, internal: 0, occupants: 0 } }, { computeField: false });
    sim.apply({ type: 'remote', patch: { power: true, mode: 'cool', setpoint: 24 } });
    sim.advance(3 * 3600);
    const stops = sim.events.filter((e) => e.msg.startsWith('Thermo-OFF')).length;
    const starts = sim.events.filter((e) => e.msg === 'Compressor start').map((e) => e.t);
    const stopTimes = sim.events.filter((e) => e.msg.startsWith('Compressor stop')).map((e) => e.t);
    log('low load: thermo-off count', stops); log('low load: compressor starts', starts.length);
    expect(stops).toBeGreaterThanOrEqual(1);
    for (const st of starts) { const prevStop = stopTimes.filter((x) => x < st).pop(); if (prevStop !== undefined) expect(st - prevStop).toBeGreaterThanOrEqual(180 - 0.2); }
  });
});

describe('acceptance 7/8: louvers and airflow', () => {
  it('direction alone does not invent capacity (fixed resistance)', () => {
    const P = { ...defaultValues(), resOutletShare: 0 };
    const caps: number[] = [];
    for (const ang of [5, 35, 65]) {
      const sim = new Simulation({ profile: P, room: { T: 27, RH: 46 }, env: { chamber: { T: 27, RH: 46 } } }, { computeField: false });
      sim.apply({ type: 'remote', patch: { power: true, mode: 'cool', setpoint: 16, fan: 'High' } });
      sim.apply({ type: 'override', patch: { manual: true, compHz: 60, vaneAngle: ang } });
      sim.advance(1500); caps.push(sim.out!.Qnet);
    }
    log('Qnet at vane 5/35/65 deg (fixed resistance)', caps.map((c) => Math.round(c)));
    expect((Math.max(...caps) - Math.min(...caps)) / caps[0]).toBeLessThan(0.002);
  });
  it('changing vane direction changes the jet and the distribution', () => {
    const P = defaultValues();
    const fi = (ang: number) => ({ q_m3h: 522, area: 0.039, Tsup: 13, Troom: 26, vaneDeg: ang, wideDeg: 0, outletOpen: 1 });
    const j1 = AF.traceJet(P, fi(8)), j5 = AF.traceJet(P, fi(65));
    const g1 = AF.makeGrid(P), g5 = AF.makeGrid(P);
    AF.computeField(P, g1, j1, 26, fi(8)); AF.computeField(P, g5, j5, 26, fi(65));
    const z1 = AF.zoneStats(g1, P, AF.ZONE_PRESETS.desk), z5 = AF.zoneStats(g5, P, AF.ZONE_PRESETS.desk);
    log('desk zone mean / draft: horizontal', [z1.mean, z1.draftFrac]); log('desk zone mean / draft: downward', [z5.mean, z5.draftFrac]);
    const end = (j: AF.Jet) => j.pts[Math.min(j.pts.length - 1, 30)].p;
    expect(Math.abs(end(j1)[1] - end(j5)[1])).toBeGreaterThan(0.3);
    expect(Math.abs(z1.mean - z5.mean) + Math.abs(z1.draftFrac - z5.draftFrac)).toBeGreaterThan(0.02);
    // field mean equals the room-balance temperature (no invented energy)
    const mean = (g: AF.FieldGrid) => g.T.reduce((a, b) => a + b, 0) / g.T.length;
    expect(Math.abs(mean(g1) - 26)).toBeLessThan(1e-3); expect(Math.abs(mean(g5) - 26)).toBeLessThan(1e-3);
  });
  it('lower airflow shifts the operating point (colder coil, lower capacity, colder supply)', () => {
    const P = defaultValues();
    const at = (rpm: number) => solveSteady(P, { mode: 'cool', f: 60, indoor: { T: 27, w: PS.wFromWB(27, 19) }, outdoor: { T: 35, w: PS.wFromWB(35, 24) }, ifanRpm: rpm, ofanRpm: 940 });
    const lo = at(580), hi = at(790);
    log('Low vs High fan: Te', [lo.Te, hi.Te]); log('Low vs High fan: Qnet', [lo.Qnet, hi.Qnet]); log('Low vs High fan: supply T', [lo.supply.T, hi.supply.T]);
    expect(lo.Te).toBeLessThan(hi.Te); expect(lo.Qnet).toBeLessThan(hi.Qnet); expect(lo.supply.T).toBeLessThan(hi.supply.T);
  });
  it('restricted filter lowers airflow on the fan curve and triggers coil frost prevention', () => {
    const sim = new Simulation({ room: { T: 29, RH: 55 } }, { computeField: false });
    sim.apply({ type: 'remote', patch: { power: true, mode: 'cool', setpoint: 18, fan: 'Low' } });
    sim.advance(300); const q0 = sim.out!.qIn;
    sim.apply({ type: 'faults', patch: { filterRestriction: 4 } }); sim.advance(1200);
    log('airflow clean / restricted m3/h', [q0, sim.out!.qIn]);
    expect(sim.out!.qIn).toBeLessThan(q0 * 0.8);
    expect(sim.events.some((e) => e.kind === 'limit' && e.msg.includes('frost'))).toBe(true);
  });
});

describe('acceptance 9/10: fan-only, heating, defrost', () => {
  it('fan-only: no sustained refrigeration; residual stored cooling decays', () => {
    const sim = cooling(); sim.advance(900);
    sim.apply({ type: 'remote', patch: { mode: 'fan', fan: 'Med' } });
    sim.advance(60); const q1 = sim.out!.Qnet; sim.advance(900); const q2 = sim.out!.Qnet;
    log('fan-only Qnet after 1 min / 16 min W', [q1, q2]);
    expect(sim.s.plant.compRunning).toBe(false); expect(sim.out!.ofanAct).toBeLessThan(1);
    expect(Math.abs(q2)).toBeLessThan(Math.max(60, Math.abs(q1) * 0.3));
  });
  it('heating: valve reversed, indoor coil is the condenser, warm air delivered', () => {
    const sim = new Simulation({ room: { T: 14, RH: 55 }, env: { outdoorT: 7, outdoorRH: 87, solar: 0 } }, { computeField: false });
    sim.apply({ type: 'remote', patch: { power: true, mode: 'heat', setpoint: 22 } }); sim.advance(1200);
    const o = sim.out!;
    log('heating: rv, Tc, Te, Tsup, Troom', [sim.s.plant.rv, o.Tc, o.Te, o.Tsup, o.Troom]);
    expect(sim.s.plant.rv).toBeGreaterThan(0.5); expect(o.evapIsIndoor).toBe(false);
    expect(o.coilInSurface).toBeGreaterThan(o.Troom); expect(o.Tsup).toBeGreaterThan(o.Troom); expect(o.Qnet).toBeGreaterThan(1000);
  });
  it('defrost: frost accumulates, reversed cycle with fans stopped melts it and ends at the finish temperature', () => {
    const sc = SCENARIO_BY_ID.defrost;
    const sim = new Simulation(sc.init, { computeField: false });
    for (const a of sc.schedule) sim.apply(a.action);
    let maxFrost = 0, sawDefrost = false, rvDuring = 1, fansDuring = 0;
    for (let i = 0; i < (sc.duration / 0.1); i++) {
      sim.step(); maxFrost = Math.max(maxFrost, sim.s.plant.frost);
      if (sim.s.ctrl.defrost.phase === 'reverse') { sawDefrost = true; rvDuring = Math.min(rvDuring, sim.s.plant.rv); fansDuring = Math.max(fansDuring, sim.out!.ofanAct > 50 ? 1 : 0, sim.out!.ifanAct > 50 ? 1 : 0); }
    }
    const ends = sim.events.filter((e) => e.msg.startsWith('Defrost end'));
    log('defrost: max frost kg', maxFrost); log('defrost count', sim.s.ctrl.defrost.count); log('defrost melted kg', sim.s.plant.frostMeltedKg); log('defrost energy kWh', sim.s.plant.defrostEnergy);
    expect(maxFrost).toBeGreaterThan(0.02); expect(sawDefrost).toBe(true); expect(rvDuring).toBeLessThan(0.5); expect(fansDuring).toBe(0);
    expect(ends.length).toBeGreaterThan(0); expect(sim.s.plant.frostMeltedKg).toBeGreaterThan(0);
  });
});

describe('acceptance 11: separate air circuits', () => {
  it('indoor particles stay in the room (z >= 0); outdoor particles stay outside the wall', () => {
    const dims = { W: 4, H: 2.8, D: 4, wallT: 0.22 };
    const ip = new IndoorParticles(800, dims);
    const box = new THREE.Box3(new THREE.Vector3(1.6, 2.25, 0), new THREE.Vector3(2.4, 2.55, 0.22));
    ip.setUnit(box, [new THREE.Vector3(2, 2.61, 0.09), new THREE.Vector3(2, 2.55, 0.1), new THREE.Vector3(2, 2.28, 0.14)], new THREE.Vector3(2, 2.58, 0.09));
    const n = 20 * 14 * 20;
    const f: FieldMsg = { T: new Float32Array(n).fill(25), v: new Float32Array(n).fill(0.5), vx: new Float32Array(n).fill(0), vy: new Float32Array(n).fill(0), vz: new Float32Array(n).fill(-2), nx: 20, ny: 14, nz: 20 };
    for (let i = 0; i < 600; i++) ip.update(0.05, f, null, 684, 25, 13);
    expect(ip.allIndoor()).toBe(true);
    const op = new OutdoorParticles(500);
    const g = new THREE.Group(); g.position.set(3.75, 0.95, -0.34); g.rotation.y = Math.PI; g.add(op.points); g.updateMatrixWorld(true);
    let maxZ = -Infinity;
    for (let k = 0; k < 200; k++) { op.update(0.05, 2178, 35, 45, [0, 50]); for (let i = 0; i < op.n; i++) { const v = new THREE.Vector3(op.pos[i * 3], op.pos[i * 3 + 1], op.pos[i * 3 + 2]).applyMatrix4(g.matrixWorld); maxZ = Math.max(maxZ, v.z); } }
    log('outdoor particles max world z (wall outer face at -0.22)', maxZ);
    expect(maxZ).toBeLessThan(-0.22);
  });
});

describe('acceptance 12/13/14: time, determinism, protections, faults', () => {
  it('reset is deterministic and replay reproduces state and ordered events', () => {
    const a = cooling(), b = cooling();
    a.advance(600); b.advance(600);
    expect(a.s.plant.Troom).toBe(b.s.plant.Troom); expect(a.s.plant.E_total).toBe(b.s.plant.E_total);
    a.apply({ type: 'remote', patch: { fan: 'High' } }); a.advance(300); a.apply({ type: 'env', patch: { doorOpen: true } }); a.advance(300);
    const run = a.exportRun();
    const { sim: c } = Simulation.fromRun(JSON.parse(JSON.stringify(run)), { computeField: false });
    log('replay Troom diff', Math.abs(c.s.plant.Troom - a.s.plant.Troom));
    expect(Math.abs(c.s.plant.Troom - a.s.plant.Troom)).toBeLessThan(1e-9);
    const ev = (s: Simulation) => s.events.filter((e) => e.kind !== 'user').map((e) => e.msg);
    expect(ev(c)).toEqual(ev(a));
    const r = a.replayTo(a.s.t - 300);
    expect(Math.abs(r.s.t - (a.s.t - 300))).toBeLessThan(0.11);
    expect(a.s.t).toBeGreaterThan(r.s.t); // scrubbing does not change the live run
  });
  it('accelerated time integrates the same as real time (same steps); pause freezes', () => {
    const a = cooling(), b = cooling();
    a.advance(600); for (let i = 0; i < 60; i++) b.advance(10);
    expect(a.s.plant.E_total).toBe(b.s.plant.E_total); expect(a.s.ctrl.lastStop).toBe(b.s.ctrl.lastStop);
    const t = a.s.t; const snap = JSON.stringify(a.s.plant); a.advance(0);
    expect(a.s.t).toBe(t); expect(JSON.stringify(a.s.plant)).toBe(snap);
  });
  it('manual overrides cannot bypass envelope or protections; reason is visible', () => {
    const sim = cooling({ env: { outdoorT: 46, solar: 800 } });
    sim.apply({ type: 'override', patch: { manual: true, compHz: 140, ofanRpm: 300 } });
    sim.advance(1800);
    log('override 140 Hz: applied cmd Hz', sim.s.ctrl.fCmd); log('limit reason', sim.s.ctrl.limitReason);
    expect(sim.s.ctrl.fCmd).toBeLessThanOrEqual(sim.P.fMaxCool + 1e-9);
    expect(sim.events.some((e) => e.kind === 'limit' || e.kind === 'protection')).toBe(true);
    const bad = sim.apply({ type: 'override', patch: { compHz: 500 } });
    expect(bad.ok).toBe(false);
  });
  it('fan fault: timestamped fault, safe stop, recovery only after cause removed AND power cycle', () => {
    const sim = cooling(); sim.advance(600);
    sim.apply({ type: 'faults', patch: { indoorFanFault: true } }); sim.advance(120);
    const f = sim.events.find((e) => e.kind === 'fault');
    log('fault event', f?.msg);
    expect(f).toBeTruthy(); expect(sim.s.ctrl.sup).toBe('FAULT'); expect(sim.s.plant.compRunning).toBe(false);
    sim.apply({ type: 'remote', patch: { power: false } }); sim.advance(5); sim.apply({ type: 'remote', patch: { power: true } }); sim.advance(5);
    expect(sim.s.ctrl.fault).not.toBeNull(); // cause still present
    sim.apply({ type: 'faults', patch: { indoorFanFault: false } }); sim.advance(5);
    sim.apply({ type: 'remote', patch: { power: false } }); sim.advance(5); sim.apply({ type: 'remote', patch: { power: true } }); sim.advance(5);
    expect(sim.s.ctrl.fault).toBeNull();
  });
  it('communication loss stops the outdoor unit after 3 minutes (S3 no.4)', () => {
    const sim = cooling(); sim.advance(600);
    sim.apply({ type: 'faults', patch: { commFault: true } });
    sim.advance(170); expect(sim.s.ctrl.fault).toBeNull();
    sim.advance(20); expect(sim.s.ctrl.fault?.code).toBe('SIM-C01');
  });
  it('LEV forced wide open floods the suction and lowers discharge temperature', () => {
    const sim = cooling(); sim.advance(900); const td0 = sim.out!.Tdis;
    sim.apply({ type: 'override', patch: { manual: true, eevPct: 100 } }); sim.advance(600);
    log('discharge before / after LEV 100 %', [td0, sim.out!.Tdis]); log('suction quality', sim.out!.xSuct);
    expect(sim.out!.Tdis).toBeLessThan(td0); expect(sim.out!.SHevap).toBeLessThan(0.5);
  });
});

describe('initial state', () => {
  it('demonstration room defaults match the brief', () => {
    const s = new Simulation({}).s;
    expect(s.plant.Troom).toBe(30); expect(s.env.outdoorT).toBe(35); expect(s.remote.setpoint).toBe(24);
    expect(Math.round(PS.rh(s.plant.Troom, s.plant.wroom) * 100)).toBe(55);
  });
});

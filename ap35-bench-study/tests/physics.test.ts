/**
 * Numerical acceptance tests. Every check runs the model; nothing is compared
 * against the constant used to display it. Achieved values are printed so the
 * test log doubles as the validation record (docs/TEST_RESULTS.md).
 */
import { describe, it, expect } from 'vitest';
import * as R32 from '../src/props/r32';
import * as PS from '../src/props/psychro';
import { Simulation, makeState } from '../src/sim/engine';
import { defaultValues } from '../src/config/registry';
import { runValidation, ratedPoints } from '../src/model/validation';
import { solveSteady } from '../src/model/steady';
import { RATED } from '../src/config/published';

const log = (k: string, v: unknown) => console.log(`[result] ${k}: ${typeof v === 'number' ? +v.toFixed(5) : JSON.stringify(v)}`);
const rhOf = (db: number, wb: number) => PS.rh(db, PS.wFromWB(db, wb)) * 100;

function chamberRun(mode: 'cool' | 'heat', minutes = 25, dt = 0.1) {
  const cool = mode === 'cool';
  const sim = new Simulation({
    room: cool ? { T: 27, RH: rhOf(27, 19) } : { T: 20, RH: 50 },
    env: cool ? { outdoorT: 35, outdoorRH: rhOf(35, 24), chamber: { T: 27, RH: rhOf(27, 19) } } : { outdoorT: 7, outdoorRH: rhOf(7, 6), chamber: { T: 20, RH: 50 } },
  }, { dt, computeField: false });
  sim.apply({ type: 'remote', patch: { power: true, mode, setpoint: cool ? 16 : 31, fan: 'SuperHigh' } });
  sim.apply({ type: 'override', patch: { manual: true, compHz: cool ? sim.P.fRatedCool : sim.P.fRatedHeat, ofanRpm: cool ? 940 : 900 } });
  sim.advance(minutes * 60);
  return sim;
}

describe('R32 property tables (CoolProp)', () => {
  it('reproduce CoolProp check points off the table grid', () => {
    for (const c of R32.R32_CHECK_POINTS) {
      const Ts = R32.tsat(c.P);
      const st = c.T > Ts ? R32.vapour(Ts, c.T - Ts) : R32.liquid(Ts, Ts - c.T);
      const err = Math.abs(st.h - c.h) / Math.abs(c.h);
      log(`R32 h error at P=${c.P} T=${c.T}`, err);
      expect(err).toBeLessThan(0.004);
    }
  });
  it('round-trips saturation pressure and never assigns quality outside the dome', () => {
    for (const T of [-20, 0, 10, 45, 60]) expect(Math.abs(R32.tsat(R32.psat(T)) - T)).toBeLessThan(0.02);
    const sp = R32.satProps(40);
    expect(R32.stateFromTsatH(40, sp.hv + 20e3).x).toBeNull();
    expect(R32.stateFromTsatH(40, sp.hl - 10e3).x).toBeNull();
    const mid = R32.stateFromTsatH(40, (sp.hl + sp.hv) / 2);
    expect(mid.phase).toBe('two-phase'); expect(mid.x!).toBeCloseTo(0.5, 2);
  });
});

describe('psychrometrics', () => {
  it('is self-consistent', () => {
    const w = PS.wFromWB(27, 19);
    expect(PS.wetBulb(27, w)).toBeCloseTo(19, 1);
    expect(PS.rh(27, w)).toBeGreaterThan(0.4); expect(PS.rh(27, w)).toBeLessThan(0.5);
    expect(PS.dewPoint(PS.wsat(15))).toBeCloseTo(15, 1);
  });
});

describe('acceptance 2: rating points from the DYNAMIC simulator', () => {
  it('cooling 3.50 kW / 0.99 kW within 5 %', () => {
    const o = chamberRun('cool').out!;
    log('dynamic rated cooling capacity kW', o.Qnet / 1000); log('dynamic rated cooling input kW', o.Ptotal / 1000);
    expect(Math.abs(o.Qnet / 1000 - RATED.cool.capacity_kW) / RATED.cool.capacity_kW).toBeLessThan(0.05);
    expect(Math.abs(o.Ptotal / 1000 - RATED.cool.input_kW) / RATED.cool.input_kW).toBeLessThan(0.05);
  });
  it('heating 4.00 kW / 1.03 kW within 5 %', () => {
    const o = chamberRun('heat').out!;
    log('dynamic rated heating capacity kW', o.Qnet / 1000); log('dynamic rated heating input kW', o.Ptotal / 1000);
    expect(Math.abs(o.Qnet / 1000 - RATED.heat.capacity_kW) / RATED.heat.capacity_kW).toBeLessThan(0.05);
    expect(Math.abs(o.Ptotal / 1000 - RATED.heat.input_kW) / RATED.heat.input_kW).toBeLessThan(0.05);
  });
  it('held-out published table rows (S3 p.29-30) and catalogue range', () => {
    const r = runValidation(defaultValues());
    const v = r.summary.table_validation_heldout;
    log('held-out rows', v.n); log('held-out capacity RMSE %', v.capacity_rmse_pct); log('held-out capacity max %', v.capacity_max_abs_pct);
    log('held-out input RMSE %', v.input_rmse_pct); log('held-out input max %', v.input_max_abs_pct);
    log('heating freq-curve held-out capacity RMSE (factor)', r.summary.freq_heat_cap_heldout.rmse);
    expect(v.n).toBeGreaterThan(200);
    expect(v.capacity_rmse_pct).toBeLessThan(5);
    expect(v.input_rmse_pct).toBeLessThan(6);
    const P = defaultValues();
    const at = (f: number) => solveSteady(P, { mode: 'cool', f, indoor: { T: 27, w: PS.wFromWB(27, 19) }, outdoor: { T: 35, w: PS.wFromWB(35, 24) }, ifanRpm: 970, ofanRpm: 940 }).Qnet / 1000;
    log('capacity at fMin kW (catalogue min 1.1)', at(P.fMin)); log('capacity at fMaxCool kW (catalogue max 3.8)', at(P.fMaxCool));
    expect(Math.abs(at(P.fMaxCool) - 3.8) / 3.8).toBeLessThan(0.06);
    expect(Math.abs(at(P.fMin) - 1.1) / 1.1).toBeLessThan(0.25);
  });
});

describe('acceptance 3/5: energy, moisture and phase consistency', () => {
  it('core cycle residual < 2 % and whole-system residual < 5 % at steady state', () => {
    const sim = chamberRun('cool', 30);
    const o = sim.out!;
    log('core cycle residual (air-side, steady)', o.coreResidual);
    expect(Math.abs(o.coreResidual!)).toBeLessThan(0.02);
    // whole system: heat added to outdoor air == heat removed from indoor air + all electrical input (boundary: both units)
    const maOut = o.qOut / 3600 / PS.specVol(35, PS.wFromRH(35, sim.s.env.outdoorRH / 100));
    const qOutAir = maOut * PS.cpMoist(PS.wFromRH(35, sim.s.env.outdoorRH / 100)) * (o.ToutLeave - o.ToutIn);
    const resid = (qOutAir - (o.Qnet + o.Ptotal)) / (o.Qnet + o.Ptotal);
    log('whole-system residual', resid);
    expect(Math.abs(resid)).toBeLessThan(0.05);
  });
  it('steady dynamic state equals the steady solver (same equations)', () => {
    const o = chamberRun('cool', 30).out!;
    const r = ratedPoints(defaultValues()).cool;
    log('dynamic vs steady Te diff K', o.Te - r.Te);
    expect(Math.abs(o.Te - r.Te)).toBeLessThan(0.15); expect(Math.abs(o.Tc - r.Tc)).toBeLessThan(0.15);
  });
  it('room energy balance closes over a transient (storage included)', () => {
    const sim = new Simulation({ room: { T: 30, RH: 55 } }, { computeField: false });
    sim.apply({ type: 'remote', patch: { power: true, mode: 'cool', setpoint: 24 } });
    const P = sim.P, V = P.roomW * P.roomH * P.roomD;
    const U = () => { const s = sim.s.plant; const Mda = V / PS.specVol(s.Troom, s.wroom); return Mda * PS.cpMoist(s.wroom) * s.Troom + P.cMass * s.Tmass; };
    sim.advance(5); const U0 = U(); let gains = 0, removed = 0;
    for (let i = 0; i < 18000; i++) {
      const s = sim.s.plant, e = sim.s.env, o = sim.out!;
      const Mda = V / PS.specVol(s.Troom, s.wroom); const mInf = (e.ach * V) / 3600 * (Mda / V);
      gains += (P.uaAirOut * (e.outdoorT - s.Troom) + mInf * PS.cpMoist(s.wroom) * (e.outdoorT - s.Troom) + e.solar + e.internal + e.occupants * P.occSens + P.uaMassOut * (e.outdoorT - s.Tmass)) * sim.dt;
      removed += o.Qsens * sim.dt;
      sim.step();
    }
    const dU = U() - U0;
    const resid = (dU - (gains - removed)) / Math.max(1, Math.abs(gains) + Math.abs(removed));
    log('room transient energy residual', resid);
    expect(Math.abs(resid)).toBeLessThan(0.01);
  });
  it('humidity ratio stays non-negative and RH bounded; condensate is bookkept, not discarded', () => {
    const sim = new Simulation({ room: { T: 27, RH: 80 }, env: { outdoorT: 30, outdoorRH: 75 } }, { computeField: false });
    sim.apply({ type: 'remote', patch: { power: true, mode: 'dry' } });
    let cond = 0, minW = 1, maxRH = 0;
    for (let i = 0; i < 36000; i++) { sim.step(); const o = sim.out!; cond += (o.condRate / 3600) * sim.dt; minW = Math.min(minW, sim.s.plant.wroom); maxRH = Math.max(maxRH, o.RHroom, o.RHsup); }
    const stored = sim.s.plant.condensateL + sim.s.plant.film;
    log('DRY 60 min: condensate kg', cond); log('DRY: bookkept (tray + film) kg', stored); log('DRY final RH %', sim.out!.RHroom * 100);
    expect(minW).toBeGreaterThan(0); expect(maxRH).toBeLessThanOrEqual(1.0000001);
    expect(Math.abs(cond - stored) / Math.max(1e-6, cond)).toBeLessThan(0.02);
    expect(sim.out!.RHroom).toBeLessThan(0.8);
  });
});

describe('acceptance 4: timestep convergence', () => {
  it('halving dt changes settled outputs < 2 %', () => {
    const run = (dt: number) => { const sim = new Simulation({ room: { T: 30, RH: 55 } }, { dt, computeField: false }); sim.apply({ type: 'remote', patch: { power: true, mode: 'cool', setpoint: 24 } }); sim.advance(2400); return sim; };
    const a = run(0.1), b = run(0.05);
    const d = (x: number, y: number) => Math.abs(x - y) / Math.max(1e-6, Math.abs(y));
    log('dt 0.1 vs 0.05: Troom rel diff', d(a.s.plant.Troom, b.s.plant.Troom)); log('dt: energy rel diff', d(a.s.plant.E_total, b.s.plant.E_total)); log('dt: Qnet rel diff', d(a.out!.Qnet, b.out!.Qnet));
    expect(d(a.s.plant.Troom, b.s.plant.Troom)).toBeLessThan(0.02);
    expect(d(a.s.plant.E_total, b.s.plant.E_total)).toBeLessThan(0.02);
    expect(d(a.out!.Qnet, b.out!.Qnet)).toBeLessThan(0.02);
    const firstStart = (s: Simulation) => s.events.find((e) => e.msg === 'Compressor start')!.t;
    expect(Math.abs(firstStart(a) - firstStart(b))).toBeLessThanOrEqual(0.1 + 1e-9);
  });
});

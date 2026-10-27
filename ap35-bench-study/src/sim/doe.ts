/**
 * Design of experiments on supported variables: deterministic Latin-hypercube
 * sampling, Pareto filtering with explicit feasibility, local and global
 * sensitivity, and scenario envelopes over uncertain assumed inputs.
 * Results are "best among evaluated candidates under this model".
 */
import type { InitSpec } from './engine';
import { rngNext, defaultEnv } from './engine';
import type { ScheduledAction } from './scenarios';
import type { Action } from './schema';
import { runSchedule, fnv1a, type RunSummary, type RunOpts } from './runner';
import { defaultValues, type ProfileValues } from '../config/registry';
import { fanRpm } from '../control/controller';

export interface SweepVar {
  id: string; label: string; unit: string; lo: number; hi: number; integer?: boolean;
  /** how the value enters the run: as an initial action, or a profile (design) change */
  apply: (v: number) => { actions?: Action[]; profile?: Partial<ProfileValues> };
  support: 'empirical-model' | 'imported' | 'visual-only';
}

export const SWEEP_VARS: SweepVar[] = [
  { id: 'ifan', label: 'Indoor fan step (0 Silent .. 4 Super High)', unit: 'step', lo: 0, hi: 4, integer: true, support: 'empirical-model',
    apply: (v) => ({ actions: [{ type: 'remote', patch: { fan: (['Silent', 'Low', 'Med', 'High', 'SuperHigh'] as const)[Math.round(v)] } }] }) },
  { id: 'vane', label: 'Horizontal vane angle (experiment override)', unit: 'deg below horizontal', lo: 5, hi: 70, support: 'empirical-model',
    apply: (v) => ({ actions: [{ type: 'override', patch: { manual: true, vaneAngle: v } }] }) },
  { id: 'setpoint', label: 'Set temperature', unit: 'degC', lo: 22, hi: 27, support: 'empirical-model',
    apply: (v) => ({ actions: [{ type: 'remote', patch: { setpoint: Math.round(v * 2) / 2 } }] }) },
  { id: 'outletH', label: 'Outlet opening height (design)', unit: 'm', lo: 0.045, hi: 0.09, support: 'empirical-model',
    apply: (v) => ({ profile: { outletH: v } }) },
  { id: 'mountH', label: 'Indoor unit top height (design)', unit: 'm', lo: 2.1, hi: 2.7, support: 'empirical-model',
    apply: (v) => ({ profile: { mountH: v } }) },
  { id: 'kp', label: 'Frequency PI gain Kp (controller tuning)', unit: 'Hz/K', lo: 4, hi: 30, support: 'empirical-model',
    apply: (v) => ({ profile: { kp: v } }) },
  { id: 'ecoCap', label: 'Eco power cap (experiment)', unit: 'W', lo: 400, hi: 1300, support: 'empirical-model',
    apply: (v) => ({ actions: [{ type: 'override', patch: { ecoCapW: v } }] }) },
  { id: 'vaneCount', label: 'Vertical vane count (visual-only geometry)', unit: '-', lo: 8, hi: 20, integer: true, support: 'visual-only',
    apply: (v) => ({ profile: { vaneCount: Math.round(v) } }) },
];
void fanRpm;

export interface Candidate { id: string; values: Record<string, number>; summary: RunSummary | null; feasible: boolean; reasons: string[]; baseline: boolean; hash: string; outOfDomain: boolean }
export interface SweepSpec {
  vars: { id: string; lo: number; hi: number }[];
  n: number; seed: number;
  base: { init: InitSpec; schedule: ScheduledAction[]; duration: number };
  constraints: { maxDraft: number; bandK: number; requireTarget: boolean };
}

export function lhs(n: number, d: number, seed: number): number[][] {
  let r = seed >>> 0 || 1;
  const rnd = () => { const [u, nr] = rngNext(r); r = nr; return u; };
  const cols: number[][] = [];
  for (let j = 0; j < d; j++) {
    const perm = Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i--) { const k = Math.floor(rnd() * (i + 1)); [perm[i], perm[k]] = [perm[k], perm[i]]; }
    cols.push(perm.map((p) => (p + rnd()) / n));
  }
  return Array.from({ length: n }, (_, i) => cols.map((c) => c[i]));
}

export function candidateRun(spec: SweepSpec, values: Record<string, number>, opts: RunOpts = {}, cache?: Map<string, RunSummary>): Candidate {
  const actions: ScheduledAction[] = [];
  const profile: ProfileValues = { ...(spec.base.init.profile ?? defaultValues()) };
  let visualOnly = false;
  for (const [id, v] of Object.entries(values)) {
    const def = SWEEP_VARS.find((x) => x.id === id)!;
    const r = def.apply(def.integer ? Math.round(v) : v);
    if (def.support === 'visual-only') visualOnly = true;
    for (const a of r.actions ?? []) actions.push({ at: 0, action: a });
    Object.assign(profile, r.profile ?? {});
  }
  const init: InitSpec = { ...spec.base.init, profile };
  const hash = fnv1a(JSON.stringify({ init, s: spec.base.schedule, actions, d: spec.base.duration, dt: opts.dt ?? 0.1 }));
  let summary = cache?.get(hash) ?? null;
  if (!summary) {
    summary = runSchedule(init, [...spec.base.schedule, ...actions], spec.base.duration, JSON.stringify(values), opts).summary;
    cache?.set(hash, summary);
  }
  const reasons: string[] = [];
  if (spec.constraints.requireTarget && !summary.reachedTarget) reasons.push('comfort target band not reached and held');
  if ((summary.draftFraction ?? 0) > spec.constraints.maxDraft) reasons.push(`draft fraction ${(100 * (summary.draftFraction ?? 0)).toFixed(0)} % > ${(100 * spec.constraints.maxDraft).toFixed(0)} %`);
  if (summary.faults.length) reasons.push('fault occurred');
  if (visualOnly) reasons.push('visual-only geometry: performance ranking disabled');
  return { id: hash, values, summary, feasible: reasons.length === 0, reasons, baseline: false, hash, outOfDomain: false };
}

/** Nondominated feasible candidates minimising energy-to-service and time-to-target. */
export function pareto(cands: Candidate[]): Candidate[] {
  const f = cands.filter((c) => c.feasible && c.summary && c.summary.timeToTarget_s !== null && c.summary.energyToService_kWh !== null);
  return f.filter((a) => !f.some((b) => b !== a && b.summary!.energyToService_kWh! <= a.summary!.energyToService_kWh! && b.summary!.timeToTarget_s! <= a.summary!.timeToTarget_s! && (b.summary!.energyToService_kWh! < a.summary!.energyToService_kWh! || b.summary!.timeToTarget_s! < a.summary!.timeToTarget_s!)));
}

/** Standardised regression coefficients (global, over the sampled ranges) for one metric. */
export function src(cands: Candidate[], varIds: string[], metric: (s: RunSummary) => number | null): Record<string, number> {
  const rows = cands.filter((c) => c.summary && metric(c.summary) !== null && Number.isFinite(metric(c.summary)!));
  const n = rows.length; const out: Record<string, number> = {};
  if (n < varIds.length + 2) return out;
  const y = rows.map((c) => metric(c.summary!)!);
  const my = y.reduce((a, b) => a + b, 0) / n; const sy = Math.sqrt(y.reduce((a, b) => a + (b - my) ** 2, 0) / n) || 1;
  const X = rows.map((c) => varIds.map((v) => c.values[v]));
  const mx = varIds.map((_, j) => X.reduce((a, r) => a + r[j], 0) / n);
  const sx = varIds.map((_, j) => Math.sqrt(X.reduce((a, r) => a + (r[j] - mx[j]) ** 2, 0) / n) || 1);
  const Z = X.map((r) => r.map((v, j) => (v - mx[j]) / sx[j]));
  const zy = y.map((v) => (v - my) / sy);
  // normal equations with small ridge
  const d = varIds.length;
  const A = Array.from({ length: d }, (_, i) => Array.from({ length: d }, (_, j) => Z.reduce((a, r) => a + r[i] * r[j], 0) + (i === j ? 1e-6 : 0)));
  const b = Array.from({ length: d }, (_, i) => Z.reduce((a, r, k) => a + r[i] * zy[k], 0));
  for (let i = 0; i < d; i++) {
    let p = i; for (let k = i + 1; k < d; k++) if (Math.abs(A[k][i]) > Math.abs(A[p][i])) p = k;
    [A[i], A[p]] = [A[p], A[i]]; [b[i], b[p]] = [b[p], b[i]];
    for (let k = i + 1; k < d; k++) { const f = A[k][i] / A[i][i]; for (let j = i; j < d; j++) A[k][j] -= f * A[i][j]; b[k] -= f * b[i]; }
  }
  const beta = new Array(d).fill(0);
  for (let i = d - 1; i >= 0; i--) { let s = b[i]; for (let j = i + 1; j < d; j++) s -= A[i][j] * beta[j]; beta[i] = s / A[i][i]; }
  varIds.forEach((v, i) => (out[v] = beta[i]));
  return out;
}

/** Scenario envelope: vary uncertain assumed inputs at their declared bounds (corner cases). */
export const UNCERTAIN = [
  { key: 'uaMassOut' as const, rel: 0.3, label: 'Envelope conductance' },
  { key: 'uaInAir' as const, rel: 0.15, label: 'Indoor coil air-side UA' },
  { key: 'internal' as const, rel: 0.5, label: 'Internal gains', env: true },
];
export function robustnessCases(base: InitSpec): { label: string; init: InitSpec }[] {
  const P0 = base.profile ?? defaultValues();
  const env0 = { ...defaultEnv(), ...base.env };
  const cases: { label: string; init: InitSpec }[] = [{ label: 'nominal', init: base }];
  for (const sgn of [-1, 1]) {
    const P = { ...P0 }; const env = { ...env0 };
    const parts: string[] = [];
    for (const u of UNCERTAIN) {
      if (u.env) { env.internal = env0.internal * (1 + sgn * u.rel); }
      else (P as Record<string, number>)[u.key] = (P0[u.key] as number) * (1 + (u.key === 'uaInAir' ? -sgn : sgn) * u.rel);
      parts.push(`${u.label} ${sgn > 0 ? '+' : '-'}${u.rel * 100}%`);
    }
    cases.push({ label: (sgn > 0 ? 'high-load corner: ' : 'low-load corner: ') + parts.join(', '), init: { ...base, profile: P, env } });
  }
  return cases;
}

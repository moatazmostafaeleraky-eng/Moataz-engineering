/**
 * Equipment profiles. `mitsubishi_ap35_reference` is built from the registry
 * and deep-frozen; experiments are named copies storing only their overrides,
 * so the changed-parameter count, per-parameter revert and baseline diff are exact.
 */
import { defaultValues, PARAM_BY_KEY, PARAM_DEFS, type ProfileValues } from './registry';

export const REFERENCE_NAME = 'mitsubishi_ap35_reference';
export const mitsubishi_ap35_reference: Readonly<ProfileValues> = Object.freeze(defaultValues());

export interface ExperimentProfile {
  name: string;
  basedOn: string;
  created: string;
  overrides: Partial<ProfileValues>;
  note: string;
  kind: 'experiment' | 'calibrated';
  history: Partial<ProfileValues>[]; // undo stack
  future: Partial<ProfileValues>[]; // redo stack
}

export function resolve(p: ExperimentProfile | null): ProfileValues {
  return { ...mitsubishi_ap35_reference, ...(p ? p.overrides : {}) };
}

export function newExperiment(name: string, from: ExperimentProfile | null = null, kind: ExperimentProfile['kind'] = 'experiment'): ExperimentProfile {
  return { name, basedOn: from ? from.name : REFERENCE_NAME, created: new Date().toISOString(), overrides: { ...(from?.overrides ?? {}) }, note: '', kind, history: [], future: [] };
}

export function setParam(p: ExperimentProfile, key: keyof ProfileValues, value: number): string | null {
  const def = PARAM_BY_KEY[key];
  if (!def) return `unknown parameter ${key}`;
  if (def.editable === 'locked') return `${def.label} is a published value; it cannot be changed in an experiment.`;
  if (!(value >= def.range[0] && value <= def.range[1])) return `${def.label}: ${value} outside ${def.range[0]}..${def.range[1]} ${def.unit}`;
  p.history.push({ ...p.overrides });
  p.future = [];
  if (value === mitsubishi_ap35_reference[key]) delete p.overrides[key];
  else p.overrides[key] = value;
  return null;
}
export function revertParam(p: ExperimentProfile, key: keyof ProfileValues) { p.history.push({ ...p.overrides }); p.future = []; delete p.overrides[key]; }
export function undo(p: ExperimentProfile) { const prev = p.history.pop(); if (prev) { p.future.push({ ...p.overrides }); p.overrides = prev; } }
export function redo(p: ExperimentProfile) { const nx = p.future.pop(); if (nx) { p.history.push({ ...p.overrides }); p.overrides = nx; } }

export function changedParams(p: ExperimentProfile | null) {
  if (!p) return [];
  return (Object.keys(p.overrides) as (keyof ProfileValues)[]).map((k) => ({ key: k, def: PARAM_BY_KEY[k], ref: mitsubishi_ap35_reference[k], value: p.overrides[k] as number }));
}

export function geometrySupport(keys: (keyof ProfileValues)[]): 'empirical-model' | 'visual-only' | 'none' {
  if (!keys.length) return 'none';
  return keys.every((k) => PARAM_BY_KEY[k].editable === 'geometry') ? 'visual-only' : 'empirical-model';
}

export const EDITABLE_DEFS = PARAM_DEFS.filter((d) => d.editable !== 'locked');

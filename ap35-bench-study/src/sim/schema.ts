/**
 * Typed action schema shared by the UI, scenarios, imports and the command
 * assistant. Every action is validated (keys, types, ranges, units) before it
 * reaches the simulation, so no path can bypass limits.
 */
import type { Environment, Faults, Overrides, RemoteSettings } from '../model/types';
import { PARAM_BY_KEY, type ProfileValues } from '../config/registry';

export type Action =
  | { type: 'remote'; patch: Partial<RemoteSettings> }
  | { type: 'override'; patch: Partial<Overrides> }
  | { type: 'env'; patch: Partial<Environment> }
  | { type: 'faults'; patch: Partial<Faults> }
  | { type: 'isaveStore' }
  | { type: 'profile'; patch: Partial<ProfileValues> };

export class ActionError extends Error {}

const MODES = ['cool', 'heat', 'dry', 'fan', 'auto'];
const FANS = ['auto', 'Silent', 'Low', 'Med', 'High', 'SuperHigh'];
const VANES = ['auto', 1, 2, 3, 4, 5, 'swing'];
const WIDES = [1, 2, 3, 4, 5, 'swing'];
const SENSORS = ['none', 'room', 'indoorCoil', 'discharge', 'outdoorCoil', 'ambient'];

function num(v: unknown, lo: number, hi: number, name: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new ActionError(`${name}: number required`);
  if (v < lo || v > hi) throw new ActionError(`${name}: ${v} outside ${lo}..${hi}`);
  return v;
}
const nullableNum = (v: unknown, lo: number, hi: number, name: string) => (v === null ? null : num(v, lo, hi, name));
function bool(v: unknown, name: string) { if (typeof v !== 'boolean') throw new ActionError(`${name}: boolean required`); return v; }
function oneOf<T>(v: unknown, list: T[], name: string): T { if (!list.includes(v as T)) throw new ActionError(`${name}: must be one of ${list.join(', ')}`); return v as T; }

export function setpointRange(mode: string): [number, number] {
  return mode === 'heat' ? [10, 31] : [16, 31]; // S2 p.22-23, p.27
}

/** Validate and normalise an action. Throws ActionError with a readable reason. */
export function validateAction(a: Action, ctx: { mode: string; opLock?: boolean }): Action {
  if (!a || typeof a !== 'object' || !('type' in a)) throw new ActionError('malformed action');
  switch (a.type) {
    case 'remote': {
      const p: Partial<RemoteSettings> = {};
      const src = a.patch as Record<string, unknown>;
      for (const k of Object.keys(src)) {
        const v = src[k];
        switch (k) {
          case 'power': p.power = bool(v, k); break;
          case 'mode':
            if (ctx.opLock && v !== ctx.mode) throw new ActionError('OPERATION LOCK is enabled: mode is locked (S2 9-11)');
            p.mode = oneOf(v, MODES, k) as RemoteSettings['mode']; break;
          case 'setpoint': {
            const mode = (src.mode as string) ?? ctx.mode;
            const [lo, hi] = setpointRange(mode);
            p.setpoint = num(v, lo, hi, `setpoint (${mode})`); break;
          }
          case 'fan': p.fan = oneOf(v, FANS, k) as RemoteSettings['fan']; break;
          case 'vane': p.vane = oneOf(v, VANES, k) as RemoteSettings['vane']; break;
          case 'wide': p.wide = oneOf(v, WIDES, k) as RemoteSettings['wide']; break;
          case 'econoCool': p.econoCool = bool(v, k); break;
          case 'nightMode': p.nightMode = bool(v, k); break;
          case 'isave': p.isave = bool(v, k); break;
          case 'onTimer': p.onTimer = nullableNum(v, 0, 1e9, k); break;
          case 'offTimer': p.offTimer = nullableNum(v, 0, 1e9, k); break;
          case 'weeklyOn': p.weeklyOn = bool(v, k); break;
          case 'opLock': p.opLock = bool(v, k); break;
          case 'weekly': {
            if (!Array.isArray(v)) throw new ActionError('weekly: array required');
            if (v.length > 28) throw new ActionError('weekly: max 28 timers per week (S2 9-8)');
            const perDay = new Map<number, number>();
            p.weekly = v.map((e: Record<string, unknown>, i: number) => {
              const day = num(e.day, 0, 6, `weekly[${i}].day`);
              perDay.set(day, (perDay.get(day) ?? 0) + 1);
              if ((perDay.get(day) ?? 0) > 4) throw new ActionError('weekly: max 4 timers per day (S2 9-8)');
              return { day, time: num(e.time, 0, 1439, `weekly[${i}].time`), on: bool(e.on, `weekly[${i}].on`), temp: num(e.temp, 10, 31, `weekly[${i}].temp`) };
            });
            break;
          }
          case 'isaveMem': p.isaveMem = v as RemoteSettings['isaveMem']; break;
          default: throw new ActionError(`remote: unknown field ${k}`);
        }
      }
      if (p.isave && (ctx.mode === 'dry' || ctx.mode === 'auto')) throw new ActionError('i-save cannot be selected in DRY or AUTO (S2 9-10)');
      if (p.econoCool && (p.mode ?? ctx.mode) !== 'cool') throw new ActionError('ECONO COOL is available in COOL mode only (S2 9-6 (9))');
      return { type: 'remote', patch: p };
    }
    case 'override': {
      const p: Partial<Overrides> = {};
      const src = a.patch as Record<string, unknown>;
      for (const k of Object.keys(src)) {
        const v = src[k];
        switch (k) {
          case 'manual': case 'turbo': case 'sleep': (p as Record<string, unknown>)[k] = bool(v, k); break;
          case 'compHz': p.compHz = nullableNum(v, 0, 140, 'compressor Hz request'); break;
          case 'ifanRpm': p.ifanRpm = nullableNum(v, 0, 1400, 'indoor fan rpm'); break;
          case 'ofanRpm': p.ofanRpm = nullableNum(v, 0, 1200, 'outdoor fan rpm'); break;
          case 'eevPct': p.eevPct = nullableNum(v, 0, 100, 'LEV %'); break;
          case 'vaneAngle': p.vaneAngle = nullableNum(v, -10, 90, 'vane angle'); break;
          case 'wideAngle': p.wideAngle = nullableNum(v, -60, 60, 'wide vane angle'); break;
          case 'swingLo': p.swingLo = nullableNum(v, -10, 90, 'swing lower limit'); break;
          case 'swingHi': p.swingHi = nullableNum(v, -10, 90, 'swing upper limit'); break;
          case 'ecoCapW': p.ecoCapW = nullableNum(v, 150, 2500, 'eco cap W'); break;
          case 'turboUntil': p.turboUntil = nullableNum(v, 0, 1e9, k); break;
          case 'sleepRate': p.sleepRate = num(v, 0, 3, k); break;
          case 'sleepMax': p.sleepMax = num(v, 0, 4, k); break;
          case 'sleepSince': p.sleepSince = nullableNum(v, 0, 1e9, k); break;
          default: throw new ActionError(`override: unknown field ${k}`);
        }
      }
      return { type: 'override', patch: p };
    }
    case 'env': {
      const p: Partial<Environment> = {};
      const src = a.patch as Record<string, unknown>;
      for (const k of Object.keys(src)) {
        const v = src[k];
        switch (k) {
          case 'outdoorT': p.outdoorT = num(v, -25, 52, 'outdoor temperature degC'); break;
          case 'outdoorRH': p.outdoorRH = num(v, 5, 100, 'outdoor RH %'); break;
          case 'solar': p.solar = num(v, 0, 3000, 'solar W'); break;
          case 'internal': p.internal = num(v, 0, 5000, 'internal gain W'); break;
          case 'occupants': p.occupants = num(v, 0, 12, 'occupants'); break;
          case 'ach': p.ach = num(v, 0, 15, 'infiltration 1/h'); break;
          case 'doorOpen': p.doorOpen = bool(v, k); break;
          case 'patm': p.patm = num(v, 70000, 108000, 'atmospheric pressure Pa'); break;
          case 'chamber': {
            if (v === null) { p.chamber = null; break; }
            const c = v as Record<string, unknown>;
            p.chamber = { T: num(c.T, 10, 40, 'chamber T'), RH: num(c.RH, 5, 95, 'chamber RH') };
            break;
          }
          default: throw new ActionError(`env: unknown field ${k}`);
        }
      }
      return { type: 'env', patch: p };
    }
    case 'faults': {
      const p: Partial<Faults> = {};
      const src = a.patch as Record<string, unknown>;
      for (const k of Object.keys(src)) {
        const v = src[k];
        switch (k) {
          case 'filterRestriction': p.filterRestriction = num(v, 0, 6, k); break;
          case 'coilFouling': p.coilFouling = num(v, 0, 1, k); break;
          case 'outdoorFouling': p.outdoorFouling = num(v, 0, 1, k); break;
          case 'indoorFanFault': case 'outdoorFanFault': case 'commFault': (p as Record<string, unknown>)[k] = bool(v, k); break;
          case 'roomSensorBias': case 'coilSensorBias': (p as Record<string, unknown>)[k] = num(v, -5, 5, k); break;
          case 'sensorFail': p.sensorFail = oneOf(v, SENSORS, k) as Faults['sensorFail']; break;
          default: throw new ActionError(`faults: unknown field ${k}`);
        }
      }
      return { type: 'faults', patch: p };
    }
    case 'isaveStore': return a;
    case 'profile': {
      const p: Partial<ProfileValues> = {};
      for (const [k, v] of Object.entries(a.patch)) {
        const def = PARAM_BY_KEY[k as keyof ProfileValues];
        if (!def) throw new ActionError(`profile: unknown parameter ${k}`);
        if (def.editable === 'locked') throw new ActionError(`profile: ${def.label} is a published value and is locked`);
        (p as Record<string, number>)[k] = num(v, def.range[0], def.range[1], `${def.label} [${def.unit}]`);
      }
      return { type: 'profile', patch: p };
    }
    default: throw new ActionError('unknown action type');
  }
}

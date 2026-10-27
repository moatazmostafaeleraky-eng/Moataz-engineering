/**
 * Diagnostic training aid. Observations are compared with a clean-unit model
 * expectation at the same conditions and actuator states; each candidate
 * simulated fault has a symptom signature. Not repair instructions for a real
 * appliance; simulator fault identifiers only. Refrigerant charge faults are
 * not offered (no inventory model).
 */
import type { ProfileValues } from '../config/registry';
import type { Faults, Outputs, PlantState } from '../model/types';
import { solveSteady } from '../model/steady';
import * as PS from '../props/psychro';

export interface HiddenFault { id: string; label: string; labelAr: string; patch: Partial<Faults> }
export const HIDDEN_FAULTS: HiddenFault[] = [
  { id: 'filter', label: 'Restricted indoor filter', labelAr: 'فلتر داخلي مسدود', patch: { filterRestriction: 3 } },
  { id: 'inFoul', label: 'Fouled indoor coil', labelAr: 'ملف داخلي متسخ', patch: { coilFouling: 0.7 } },
  { id: 'outFoul', label: 'Fouled outdoor coil', labelAr: 'ملف خارجي متسخ', patch: { outdoorFouling: 0.8 } },
  { id: 'roomBias', label: 'Room thermistor reading 2 K low', labelAr: 'حساس الأوضة بيقرا أقل بدرجتين', patch: { roomSensorBias: -2 } },
  { id: 'coilBias', label: 'Indoor coil thermistor reading 4 K low', labelAr: 'حساس الملف الداخلي بيقرا أقل', patch: { coilSensorBias: -4 } },
];

export interface Observation { key: string; label: string; observed: number; expected: number; unit: string; z: number }
export interface Candidate { id: string; label: string; score: number; consistent: string[]; inconsistent: string[] }

/** Signatures: expected sign of (observed - expected) for each feature; 0 = no change, null = not informative. */
const SIG: Record<string, Record<string, number | null>> = {
  filter: { airflow: -1, coilT: -1, Tc: 0, Tdis: null, sensorGap: 0, coilSensorGap: 0, Pfan: null },
  inFoul: { airflow: -1, coilT: -1, Tc: 0, Tdis: null, sensorGap: 0, coilSensorGap: 0, Pfan: null },
  outFoul: { airflow: 0, coilT: 1, Tc: 1, Tdis: 1, sensorGap: 0, coilSensorGap: 0, Pfan: null },
  roomBias: { airflow: 0, coilT: 0, Tc: 0, Tdis: null, sensorGap: -1, coilSensorGap: 0, Pfan: null },
  coilBias: { airflow: 0, coilT: 0, Tc: 0, Tdis: null, sensorGap: 0, coilSensorGap: -1, Pfan: null },
};
/** Feature a hypothesis cannot be tested without (an independent probe). */
const NEEDS: Record<string, string> = { roomBias: 'sensorGap' };

export function observe(P: ProfileValues, out: Outputs, plant: PlantState, sensed: { room: number; coilIn: number }, probeRoomT: number | null, ambient: { T: number; RH: number }): Observation[] {
  if (!out.running || !out.evapIsIndoor) return [];
  const exp = solveSteady(P, {
    mode: 'cool', f: out.fAct, indoor: { T: plant.Troom, w: plant.wroom }, outdoor: { T: ambient.T, w: PS.wFromRH(ambient.T, ambient.RH / 100) }, ifanRpm: out.ifanAct, ofanRpm: out.ofanAct,
    outletAreaRatio: 1,
  });
  const obs: Observation[] = [
    { key: 'airflow', label: 'Indoor airflow (velocity-probe estimate)', observed: out.qIn, expected: exp.ifan.q_m3h, unit: 'm3/h', z: (out.qIn - exp.ifan.q_m3h) / 25 },
    { key: 'coilT', label: 'Indoor coil surface temperature', observed: out.coilInSurface, expected: exp.evapCoil.Ts, unit: 'degC', z: (out.coilInSurface - exp.evapCoil.Ts) / 0.8 },
    { key: 'Tc', label: 'Condensing temperature (from pressure)', observed: out.Tc, expected: exp.Tc, unit: 'degC', z: (out.Tc - exp.Tc) / 0.8 },
    { key: 'Tdis', label: 'Discharge temperature', observed: out.Tdis, expected: exp.cyc.comp.T2, unit: 'degC', z: (out.Tdis - exp.cyc.comp.T2) / 2.5 },
    { key: 'Pfan', label: 'Indoor fan input', observed: out.Pifan, expected: exp.ifan.power, unit: 'W', z: (out.Pifan - exp.ifan.power) / 0.8 },
    { key: 'coilSensorGap', label: 'Coil thermistor minus coil probe', observed: sensed.coilIn - out.coilInSurface, expected: 0, unit: 'K', z: (sensed.coilIn - out.coilInSurface) / 0.6 },
  ];
  if (probeRoomT !== null) obs.push({ key: 'sensorGap', label: 'Room thermistor minus independent air probe', observed: sensed.room - probeRoomT, expected: 0, unit: 'K', z: (sensed.room - probeRoomT) / 0.5 });
  return obs;
}

export function rankCandidates(obs: Observation[]): { candidates: Candidate[]; ambiguous: string | null; nextMeasurement: string } {
  const byKey = Object.fromEntries(obs.map((o) => [o.key, o]));
  const cands: Candidate[] = HIDDEN_FAULTS.map((f) => {
    const sig = SIG[f.id]; let score = 0; const consistent: string[] = [], inconsistent: string[] = [];
    for (const [k, sgn] of Object.entries(sig)) {
      const o = byKey[k]; if (!o || sgn === null) continue;
      const obsSign = Math.abs(o.z) < 1.0 ? 0 : Math.sign(o.z);
      if (obsSign === 0 && sgn === 0) continue; // uninformative: nothing expected, nothing seen
      if (obsSign === sgn) { score += 1; consistent.push(o.label); }
      else { score -= 1; inconsistent.push(o.label); }
    }
    const need = NEEDS[f.id];
    let label = f.label;
    if (need && !byKey[need]) { score = Math.min(score, 0) - 0.5; label += ' (untestable without an independent probe)'; }
    return { id: f.id, label, score, consistent, inconsistent };
  }).sort((a, b) => b.score - a.score);
  let ambiguous: string | null = null;
  if (cands.length > 1 && Math.abs(cands[0].score - cands[1].score) < 0.5) ambiguous = `${cands[0].label} and ${cands[1].label} explain the observations about equally well.`;
  let next = 'Observations are consistent with a clean unit; keep watching or change the operating point.';
  const pair = new Set([cands[0].id, cands[1]?.id]);
  if (pair.has('filter') && pair.has('inFoul')) next = 'Measure the filter pressure drop or compare airflow before/after the filter: filter restriction lowers airflow without reducing coil UA, fouling also lowers UA (look at supply-air approach to coil temperature).';
  else if (pair.has('roomBias') || !byKey.sensorGap) next = 'Place an independent air-temperature probe near the return grille: it separates a thermistor bias from a real room condition.';
  else if (pair.has('outFoul')) next = 'Check outdoor coil approach (condensing minus outdoor air temperature) at a known fan speed.';
  else if (ambiguous) next = 'Change one condition (fan step or frequency) and see which signature follows.';
  return { candidates: cands, ambiguous, nextMeasurement: next };
}

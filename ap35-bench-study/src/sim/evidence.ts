/**
 * Laboratory evidence: CSV import with units, alignment, gap detection,
 * steady-state calibration of identifiable parameters with bounds and
 * regularisation, and separate calibration / validation statistics.
 * Missing fields stay missing; nothing is filled in.
 */
import type { ProfileValues } from '../config/registry';
import { solveSteady } from '../model/steady';
import * as PS from '../props/psychro';

export const LAB_COLUMNS = [
  { key: 'time', unit: 's', required: true, note: 'elapsed time or seconds since start' },
  { key: 'indoor_db', unit: 'degC', required: true, note: 'return / chamber dry bulb' },
  { key: 'indoor_rh', unit: '%', required: false, note: 'give indoor_rh or indoor_wb' },
  { key: 'indoor_wb', unit: 'degC', required: false, note: '' },
  { key: 'outdoor_db', unit: 'degC', required: true, note: '' },
  { key: 'outdoor_rh', unit: '%', required: false, note: 'give outdoor_rh or outdoor_wb' },
  { key: 'outdoor_wb', unit: 'degC', required: false, note: '' },
  { key: 'supply_db', unit: 'degC', required: false, note: '' },
  { key: 'supply_rh', unit: '%', required: false, note: '' },
  { key: 'comp_hz', unit: 'Hz', required: false, note: 'operational frequency command' },
  { key: 'ifan_rpm', unit: 'rpm', required: false, note: '' },
  { key: 'ofan_rpm', unit: 'rpm', required: false, note: '' },
  { key: 'airflow', unit: 'm3/h', required: false, note: '' },
  { key: 'power_total', unit: 'W', required: false, note: 'total electrical input' },
  { key: 'capacity', unit: 'W', required: false, note: 'measured capacity (state boundary in notes)' },
  { key: 'steady', unit: '0/1', required: false, note: '1 marks steady-state rows' },
] as const;

export const UNIT_ALIASES: Record<string, Record<string, (v: number) => number>> = {
  degC: { degC: (v) => v, C: (v) => v, degF: (v) => ((v - 32) * 5) / 9, K: (v) => v - 273.15 },
  W: { W: (v) => v, kW: (v) => v * 1000 },
  'm3/h': { 'm3/h': (v) => v, 'l/s': (v) => v * 3.6, cfm: (v) => v * 1.699 },
  '%': { '%': (v) => v }, Hz: { Hz: (v) => v }, rpm: { rpm: (v) => v }, s: { s: (v) => v, min: (v) => v * 60 }, '0/1': { '0/1': (v) => v, '-': (v) => v },
};

export function templateCSV(): string {
  const head = LAB_COLUMNS.map((c) => `${c.key} [${c.unit}]`).join(',');
  return `# AP35 bench study lab data template. Units in brackets. Leave unknown cells empty.\n# metadata: sensor_location=..., sample_rate_s=..., test_conditions=...\n${head}\n`;
}

export interface LabData { columns: string[]; units: Record<string, string>; rows: Record<string, number | null>[]; meta: Record<string, string>; warnings: string[]; unused: string[] }

export function parseLabCSV(text: string): LabData {
  const lines = text.split(/\r?\n/);
  const meta: Record<string, string> = {}; const warnings: string[] = [];
  let header: string | null = null; const body: string[] = [];
  for (const l of lines) {
    if (!l.trim()) continue;
    if (l.startsWith('#')) { const m = l.match(/#\s*metadata:\s*(.*)/); if (m) for (const kv of m[1].split(',')) { const [k, v] = kv.split('='); if (k && v) meta[k.trim()] = v.trim(); } continue; }
    if (header === null) header = l; else body.push(l);
  }
  if (!header) throw new Error('No header row found.');
  const cols = header.split(',').map((h) => h.trim());
  const keys: string[] = [], units: Record<string, string> = {}, conv: ((v: number) => number)[] = [], unused: string[] = [];
  for (const c of cols) {
    const m = c.match(/^([a-z_]+)\s*\[(.+)\]$/i);
    if (!m) throw new Error(`Column "${c}" must be written as name [unit].`);
    const key = m[1], unit = m[2].trim();
    const def = LAB_COLUMNS.find((d) => d.key === key);
    if (!def) { unused.push(c); keys.push(''); conv.push((v) => v); continue; }
    const fn = UNIT_ALIASES[def.unit]?.[unit];
    if (!fn) throw new Error(`Column ${key}: unit "${unit}" not accepted (expected ${def.unit} or ${Object.keys(UNIT_ALIASES[def.unit] ?? {}).join(', ')}).`);
    keys.push(key); units[key] = def.unit; conv.push(fn);
  }
  for (const d of LAB_COLUMNS) if (d.required && !keys.includes(d.key)) throw new Error(`Required column ${d.key} [${d.unit}] missing.`);
  const rows = body.map((l, i) => {
    const cells = l.split(',');
    const r: Record<string, number | null> = {};
    keys.forEach((k, j) => {
      if (!k) return;
      const raw = (cells[j] ?? '').trim();
      if (raw === '') { r[k] = null; return; }
      const v = Number(raw);
      if (!Number.isFinite(v)) throw new Error(`Row ${i + 1}, ${k}: "${raw}" is not a number.`);
      r[k] = conv[j](v);
    });
    return r;
  });
  // gaps
  for (let i = 1; i < rows.length; i++) {
    const dt = (rows[i].time ?? 0) - (rows[i - 1].time ?? 0);
    if (dt <= 0) throw new Error(`Row ${i + 1}: time is not increasing.`);
    if (i > 1) { const prev = (rows[i - 1].time ?? 0) - (rows[i - 2].time ?? 0); if (dt > 3 * prev) warnings.push(`Gap of ${dt.toFixed(0)} s before row ${i + 1}`); }
  }
  for (const k of keys) if (k) { const miss = rows.filter((r) => r[k] === null).length; if (miss) warnings.push(`${k}: ${miss} missing values (kept missing)`); }
  return { columns: keys.filter(Boolean), units, rows, meta, warnings, unused };
}

function airFrom(db: number | null, rh: number | null, wb: number | null) {
  if (db === null) return null;
  if (rh !== null) return { T: db, w: PS.wFromRH(db, rh / 100) };
  if (wb !== null) return { T: db, w: PS.wFromWB(db, wb) };
  return null;
}

export interface FitParam { key: keyof ProfileValues; label: string; lo: number; hi: number }
export const IDENTIFIABLE: FitParam[] = [
  { key: 'uaInAir', label: 'Indoor coil air-side UA scale', lo: 0.6, hi: 1.5 },
  { key: 'etaIsPeak', label: 'Compressor efficiency scale', lo: 0.8, hi: 1.15 },
  { key: 'Vd', label: 'Displacement scale', lo: 0.8, hi: 1.2 },
];

export interface EvidenceResult {
  fitted: Partial<ProfileValues>; scales: Record<string, number>;
  calibration: { n: number; cap_bias_W: number; cap_mae_W: number; cap_rmse_W: number; pow_bias_W: number; pow_mae_W: number; pow_rmse_W: number };
  validation: { n: number; cap_bias_W: number; cap_mae_W: number; cap_rmse_W: number; pow_bias_W: number; pow_mae_W: number; pow_rmse_W: number };
  residuals: { i: number; set: 'cal' | 'val'; capMeas: number | null; capSim: number; powMeas: number | null; powSim: number }[];
  coverage: string; notes: string[];
}

/** Steady-state calibration of a few identifiable scales with bounds and ridge regularisation toward 1. */
export function calibrateSteady(base: ProfileValues, data: LabData, mode: 'cool' | 'heat', valFraction = 0.4): EvidenceResult {
  const notes: string[] = [];
  const steadyRows = data.rows.map((r, i) => ({ r, i })).filter(({ r }) => (r.steady ?? 1) >= 0.5);
  const usable = steadyRows.filter(({ r }) => airFrom(r.indoor_db, r.indoor_rh ?? null, r.indoor_wb ?? null) && airFrom(r.outdoor_db, r.outdoor_rh ?? null, r.outdoor_wb ?? null) && r.comp_hz !== null && r.comp_hz !== undefined && (r.capacity != null || r.power_total != null));
  if (usable.length < 3) throw new Error('Need at least 3 steady rows with indoor/outdoor states, comp_hz and a measured capacity or power.');
  const nVal = Math.max(1, Math.round(usable.length * valFraction));
  const cal = usable.slice(0, usable.length - nVal), val = usable.slice(usable.length - nVal);
  notes.push(`Calibration rows: first ${cal.length} steady rows; validation rows: last ${val.length} (independent).`);
  const simRow = (P: ProfileValues, r: Record<string, number | null>) => {
    const s = solveSteady(P, { mode, f: r.comp_hz!, indoor: airFrom(r.indoor_db, r.indoor_rh ?? null, r.indoor_wb ?? null)!, outdoor: airFrom(r.outdoor_db, r.outdoor_rh ?? null, r.outdoor_wb ?? null)!, ifanRpm: r.ifan_rpm ?? (mode === 'cool' ? 970 : 1070), ofanRpm: r.ofan_rpm ?? (mode === 'cool' ? 940 : 900) });
    return { cap: s.Qnet, pow: s.Ptotal };
  };
  const apply = (sc: number[]) => { const P = { ...base }; IDENTIFIABLE.forEach((f, i) => ((P as Record<string, number>)[f.key] = (base[f.key] as number) * sc[i])); return P; };
  const J = (sc: number[]) => {
    const P = apply(sc); let e = 0;
    for (const { r } of cal) { const s = simRow(P, r); if (r.capacity != null) e += ((s.cap - r.capacity) / 1000) ** 2; if (r.power_total != null) e += ((s.pow - r.power_total) / 300) ** 2; }
    return e / cal.length + 0.05 * sc.reduce((a, v) => a + (v - 1) ** 2, 0);
  };
  // coordinate search within bounds (deterministic, small budget)
  let sc = IDENTIFIABLE.map(() => 1), best = J(sc), step = 0.08;
  for (let it = 0; it < 40 && step > 0.002; it++) {
    let improved = false;
    for (let i = 0; i < sc.length; i++) for (const d of [-1, 1]) {
      const tr = [...sc]; tr[i] = Math.min(IDENTIFIABLE[i].hi, Math.max(IDENTIFIABLE[i].lo, tr[i] + d * step));
      const v = J(tr); if (v < best) { best = v; sc = tr; improved = true; }
    }
    if (!improved) step /= 2;
  }
  const P = apply(sc);
  const residuals: EvidenceResult['residuals'] = [];
  const stat = (rows: typeof usable, set: 'cal' | 'val') => {
    const ec: number[] = [], ep: number[] = [];
    for (const { r, i } of rows) { const s = simRow(P, r); residuals.push({ i, set, capMeas: r.capacity ?? null, capSim: s.cap, powMeas: r.power_total ?? null, powSim: s.pow }); if (r.capacity != null) ec.push(s.cap - r.capacity); if (r.power_total != null) ep.push(s.pow - r.power_total); }
    const m = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
    const mae = (a: number[]) => (a.length ? a.reduce((x, y) => x + Math.abs(y), 0) / a.length : NaN);
    const rm = (a: number[]) => (a.length ? Math.sqrt(a.reduce((x, y) => x + y * y, 0) / a.length) : NaN);
    return { n: rows.length, cap_bias_W: m(ec), cap_mae_W: mae(ec), cap_rmse_W: rm(ec), pow_bias_W: m(ep), pow_mae_W: mae(ep), pow_rmse_W: rm(ep) };
  };
  const calibration = stat(cal, 'cal'), validation = stat(val, 'val');
  const fitted: Partial<ProfileValues> = {}; const scales: Record<string, number> = {};
  IDENTIFIABLE.forEach((f, i) => { (fitted as Record<string, number>)[f.key] = P[f.key] as number; scales[f.key] = sc[i]; });
  const dbs = usable.map(({ r }) => r.outdoor_db!), hz = usable.map(({ r }) => r.comp_hz!);
  const coverage = `Outdoor ${Math.min(...dbs).toFixed(1)}..${Math.max(...dbs).toFixed(1)} degC, compressor ${Math.min(...hz).toFixed(0)}..${Math.max(...hz).toFixed(0)} Hz, ${mode.toUpperCase()} only. Evidence applies to this domain only.`;
  if (data.rows.some((r) => r.capacity == null)) notes.push('Rows without measured capacity were not used for capacity residuals.');
  return { fitted, scales, calibration, validation, residuals, coverage, notes };
}

/** Bundled SYNTHETIC demonstration data: generated from the model with altered parameters and seeded noise. Not measurements. */
export function syntheticDemoCSV(base: ProfileValues): string {
  const P = { ...base, uaInAir: base.uaInAir * 0.88, etaIsPeak: base.etaIsPeak * 0.96 };
  let seed = 7;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 - 0.5; };
  const lines = ['# SYNTHETIC DEMONSTRATION DATA - generated by the simulator with modified UA and efficiency plus noise. NOT a measurement of a real AP35.', '# metadata: sensor_location=virtual, sample_rate_s=60, test_conditions=synthetic chamber', LAB_COLUMNS.filter((c) => !['supply_db', 'supply_rh', 'airflow', 'indoor_wb', 'outdoor_wb'].includes(c.key)).map((c) => `${c.key} [${c.unit}]`).join(',')];
  let t = 0;
  for (const od of [25, 30, 35, 40]) for (const hz of [40, 60, 84]) {
    const s = solveSteady(P, { mode: 'cool', f: hz, indoor: { T: 27, w: PS.wFromWB(27, 19) }, outdoor: { T: od, w: PS.wFromRH(od, 0.4) }, ifanRpm: 970, ofanRpm: 940 });
    lines.push([t, 27, (PS.rh(27, PS.wFromWB(27, 19)) * 100).toFixed(1), od, 40, hz, 970, 940, (s.Ptotal + rnd() * 20).toFixed(0), (s.Qnet + rnd() * 60).toFixed(0), 1].join(','));
    t += 600;
  }
  return lines.join('\n') + '\n';
}

/** Exports: versioned settings JSON, CSV with units, and a self-contained HTML experiment report. */
import { CHANNEL_UNITS, HISTORY_CHANNELS, SIM_VERSION, type Channel, type SimState } from './engine';
import { PARAM_DEFS, CALIBRATION_META } from '../config/registry';
import { SOURCES, DISCREPANCIES } from '../config/sources';
import type { RunSummary } from './runner';

export const SETTINGS_SCHEMA = 'ap35-bench-settings';

export function settingsJSON(s: SimState, extra: Record<string, unknown> = {}) {
  return JSON.stringify({ schema: SETTINGS_SCHEMA, version: SIM_VERSION, exported: new Date().toISOString(), profileName: s.profileName, profileOverrides: diffProfile(s), remote: s.remote, overrides: s.overrides, env: s.env, faults: s.faults, zone: s.zone, ...extra }, null, 2);
}

function diffProfile(s: SimState) {
  const out: Record<string, number> = {};
  for (const d of PARAM_DEFS) if ((s.profile as unknown as Record<string, number>)[d.key] !== d.value) out[d.key] = (s.profile as unknown as Record<string, number>)[d.key];
  return out;
}

export interface ImportedSettings { remote?: unknown; overrides?: unknown; env?: unknown; faults?: unknown; profileOverrides?: Record<string, number>; warnings: string[] }
export function parseSettings(text: string): ImportedSettings {
  let j: Record<string, unknown>;
  try { j = JSON.parse(text); } catch { throw new Error('Not valid JSON.'); }
  if (j.schema !== SETTINGS_SCHEMA) throw new Error(`Unexpected schema "${String(j.schema)}" (expected ${SETTINGS_SCHEMA}).`);
  const warnings: string[] = [];
  if (j.version !== SIM_VERSION) warnings.push(`Settings from model version ${String(j.version)}; current ${SIM_VERSION}.`);
  return { remote: j.remote, overrides: j.overrides, env: j.env, faults: j.faults, profileOverrides: (j.profileOverrides ?? {}) as Record<string, number>, warnings };
}

export function historyCSV(h: Partial<Record<Channel, number[]>>, t0: number): string {
  const cols = HISTORY_CHANNELS.filter((c) => h[c]);
  const head = cols.map((c) => `${c === 't' ? 'time_from_start' : c} [${CHANNEL_UNITS[c]}]`).join(',');
  const n = h.t?.length ?? 0;
  const lines = [`# AP35 bench study time series, model ${SIM_VERSION}. Modelled values, not measurements.`, head];
  for (let i = 0; i < n; i++) lines.push(cols.map((c) => { const v = h[c]![i]; if (c === 't') return (v - t0).toFixed(1); return Number.isFinite(v) ? +v.toFixed(4) : ''; }).join(','));
  return lines.join('\n') + '\n';
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export function htmlReport(opts: {
  title: string; state: SimState; summaries: RunSummary[]; images: { caption: string; dataUrl: string }[];
  changed: { label: string; ref: string; value: string; status: string }[]; notes: string[]; probes?: { label: string; ideal: string; virt: string }[];
}): string {
  const rows = (r: RunSummary) => `<tr><td>${esc(r.label)}</td><td>${r.timeToTarget_s !== null ? (r.timeToTarget_s / 60).toFixed(1) + ' min' : 'not reached'}</td><td>${r.energy_kWh.toFixed(3)}</td><td>${r.energyToService_kWh !== null ? r.energyToService_kWh.toFixed(3) : '-'}</td><td>${r.avgUsefulCapacity_W.toFixed(0)}</td><td>${r.peakInput_W.toFixed(0)}</td><td>${r.condensate_L.toFixed(2)}</td><td>${r.occupiedMean_C !== null ? r.occupiedMean_C.toFixed(2) : '-'}</td><td>${r.occupiedStd_K !== null ? r.occupiedStd_K.toFixed(2) : '-'}</td><td>${r.draftFraction !== null ? (100 * r.draftFraction).toFixed(0) + ' %' : '-'}</td><td>${r.compressorStarts}</td></tr>`;
  const assumptions = PARAM_DEFS.filter((d) => d.status === 'assumed').slice(0, 400).map((d) => `<li>${esc(d.label)}: ${d.value} ${esc(d.unit)} (${esc(d.origin)})</li>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(opts.title)}</title>
<style>body{font:14px/1.5 system-ui,sans-serif;max-width:1000px;margin:24px auto;padding:0 16px;color:#22211f;background:#f7f4ee}h1{font-weight:600}h2{margin-top:28px;border-bottom:1px solid #ddd}table{border-collapse:collapse;width:100%;font-size:12px}td,th{border:1px solid #ccc;padding:4px 6px;text-align:right}td:first-child,th:first-child{text-align:left}img{max-width:100%;border:1px solid #ccc;margin:6px 0}.note{background:#fff;border-left:3px solid #c0272d;padding:8px 12px}</style></head><body>
<h1>${esc(opts.title)}</h1>
<p class="note">Independent study based on published Mitsubishi Electric documentation; unverified internals and dynamics are modelled. Not a Mitsubishi Electric product or official digital twin. Results are model outputs, not measurements. Approximate airflow model, not CFD validation.</p>
<p>Model ${SIM_VERSION}; profile <b>${esc(opts.state.profileName)}</b>; calibration ${esc(String(CALIBRATION_META._generated ?? ''))}; exported ${new Date().toISOString()}.</p>
<h2>Starting state and conditions</h2>
<p>Room ${opts.state.plant.Troom.toFixed(1)} degC; outdoor ${opts.state.env.outdoorT} degC / ${opts.state.env.outdoorRH} % RH; solar ${opts.state.env.solar} W; internal ${opts.state.env.internal} W; occupants ${opts.state.env.occupants}; infiltration ${opts.state.env.ach} 1/h. Mode ${opts.state.remote.mode.toUpperCase()} ${opts.state.remote.setpoint} degC, fan ${opts.state.remote.fan}, vane ${opts.state.remote.vane}.</p>
<h2>Changed variables</h2>${opts.changed.length ? `<table><tr><th>Parameter</th><th>Reference</th><th>Experiment</th><th>Status</th></tr>${opts.changed.map((c) => `<tr><td>${esc(c.label)}</td><td>${esc(c.ref)}</td><td>${esc(c.value)}</td><td>${esc(c.status)}</td></tr>`).join('')}</table>` : '<p>None (published reference profile).</p>'}
<h2>Results</h2><table><tr><th>Run</th><th>Time to target</th><th>Energy kWh</th><th>Energy to service kWh</th><th>Avg useful W</th><th>Peak input W</th><th>Condensate L</th><th>Zone mean degC</th><th>Zone std K</th><th>Draft cells</th><th>Starts</th></tr>${opts.summaries.map(rows).join('')}</table>
<p>Service level: target band and dwell as declared per run; energy comparisons are only meaningful at equal service. Efficiency boundary: total appliance input (compressor, both fans, controls).</p>
${opts.probes && opts.probes.length ? `<h2>Probes</h2><table><tr><th>Probe</th><th>Ideal model value</th><th>Virtual sensor</th></tr>${opts.probes.map((p) => `<tr><td>${esc(p.label)}</td><td>${esc(p.ideal)}</td><td>${esc(p.virt)}</td></tr>`).join('')}</table>` : ''}
<h2>Views and plots</h2>${opts.images.map((i) => `<figure><img src="${i.dataUrl}" alt="${esc(i.caption)}"><figcaption>${esc(i.caption)}</figcaption></figure>`).join('')}
<h2>Notes</h2><ul>${opts.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>
<h2>Sources</h2><ul>${Object.values(SOURCES).map((s) => `<li>${s.id} (${s.kind}): ${esc(s.title)}, ${esc(s.docNo)} ${esc(s.revision)}</li>`).join('')}</ul>
<h2>Discrepancies</h2><ul>${DISCREPANCIES.map((d) => `<li>${d.id} ${esc(d.field)}: ${esc(d.detail)}</li>`).join('')}</ul>
<h2>Model limitations</h2><ul><li>Reduced-order cycle; compressor map shape assumed and calibrated to S3 data; not a manufacturer map.</li><li>Room airflow is an entraining-jet / zonal approximation constrained to the room mean; not CFD.</li><li>Controller is a surrogate of documented behaviour; thresholds not in the manuals are assumed.</li><li>No refrigerant inventory model; charge faults are not simulated.</li></ul>
<h2>Assumed parameters</h2><ul style="columns:2;font-size:11px">${assumptions}</ul>
</body></html>`;
}

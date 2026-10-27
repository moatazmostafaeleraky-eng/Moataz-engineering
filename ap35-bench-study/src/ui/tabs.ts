/** Bottom tabs: instruments, drawings, experiments and evidence. */
import { h, clear, fmt, fmtDur, download, toast, modal, readFile } from './dom';
import { S, activeProfile, save, notify } from './state';
import { bridge, scene, act, applyProfile, loadScenario, currentScenario, initSpecFor, dataUrlToBlob, setView, extras } from './app';
import { LineChart } from './charts';
import { drawPH } from './ph';
import { circuitSVG } from './circuit';
import { tempColor } from '../scene/kit';
import { HISTORY_CHANNELS, type Channel, type ProbeDef } from '../sim/engine';
import { historyCSV, htmlReport, settingsJSON, parseSettings } from '../sim/export';
import { SCENARIOS, SCENARIO_BY_ID, type ScheduledAction } from '../sim/scenarios';
import { SWEEP_VARS, type Candidate } from '../sim/doe';
import { templateCSV, syntheticDemoCSV } from '../sim/evidence';
import { HIDDEN_FAULTS } from '../sim/diagnostics';
import { PARAM_DEFS, CALIBRATION_META } from '../config/registry';
import { SOURCES, DISCREPANCIES } from '../config/sources';
import { changedParams, mitsubishi_ap35_reference, newExperiment, REFERENCE_NAME } from '../config/profiles';
import { ZONE_PRESETS } from '../model/airfield';
import type { RunSummary } from '../sim/runner';
import type { Action } from '../sim/schema';
import type { ProfileValues } from '../config/registry';
import { FEATURE_MATRIX } from './features';

type TabId = 'trends' | 'states' | 'circuit' | 'ph' | 'slices' | 'drawings' | 'probes' | 'replay' | 'compare' | 'sweep' | 'robust' | 'evidence' | 'diag' | 'validation' | 'assumptions';
const TABS: { id: TabId; label: string; ws: ('explore' | 'engineer' | 'lab')[] }[] = [
  { id: 'trends', label: 'Trends', ws: ['explore', 'engineer', 'lab'] },
  { id: 'states', label: 'States & events', ws: ['explore', 'engineer', 'lab'] },
  { id: 'circuit', label: 'Refrigeration circuit', ws: ['explore', 'engineer', 'lab'] },
  { id: 'ph', label: 'P-h cycle', ws: ['explore', 'engineer', 'lab'] },
  { id: 'slices', label: 'Room slices & comfort', ws: ['explore', 'engineer', 'lab'] },
  { id: 'drawings', label: 'Assembly drawings', ws: ['explore', 'engineer', 'lab'] },
  { id: 'probes', label: 'Probes', ws: ['engineer', 'lab'] },
  { id: 'replay', label: 'Timeline & replay', ws: ['engineer', 'lab'] },
  { id: 'diag', label: 'Diagnostics', ws: ['engineer', 'lab'] },
  { id: 'compare', label: 'A/B compare', ws: ['lab'] },
  { id: 'sweep', label: 'Sweep & Pareto', ws: ['lab'] },
  { id: 'robust', label: 'Robustness', ws: ['lab'] },
  { id: 'evidence', label: 'Lab evidence', ws: ['lab'] },
  { id: 'validation', label: 'Validation', ws: ['engineer', 'lab'] },
  { id: 'assumptions', label: 'Assumptions & sources', ws: ['explore', 'engineer', 'lab'] },
];

const COL = { red: '#c4161c', blue: '#2f7fc1', amber: '#d9861c', ink: '#23221f', green: '#2e7d4f', violet: '#7b4bb3', grey: '#8a857a', copper: '#b87333' };

export class BottomTabs {
  root: HTMLElement; bar: HTMLElement; body: HTMLElement;
  cur: TabId = 'trends';
  panes = new Map<TabId, HTMLElement>();
  charts: Record<string, LineChart> = {};
  phCanvas = h('canvas', { style: { width: '100%', height: '100%' } });
  circuitEl = h('div', { style: { height: '100%' } });
  sliceCanvases = { plan: h('canvas', { width: 400, height: 400 }), section: h('canvas', { width: 400, height: 280 }) };
  scoreEl = h('div');
  evEl = h('div', { class: 'evlist' });
  probeEl = h('div');
  probeChart = new LineChart('Probe: ideal vs virtual sensor', [{ key: 'ideal', label: 'ideal model value', color: COL.ink, unit: '' }, { key: 'virt', label: 'virtual sensor reading', color: COL.red, unit: '', dash: [4, 3] }]);
  replayEl = h('div');
  compareEl = h('div'); sweepEl = h('div'); robustEl = h('div'); evidenceEl = h('div'); diagEl = h('div'); validationEl = h('div');
  lastCompare: { results: { summary: RunSummary; history: Record<string, number[]>; field: { T: number[]; v: number[]; nx: number; ny: number; nz: number } | null; jet: unknown[] }[]; labels: string[] } | null = null;
  lastSweep: { candidates: Candidate[]; pareto: string[]; sensitivity: Record<string, Record<string, number>>; tested: number; failed: number; cancelled: boolean; spec: unknown } | null = null;
  constructor(root: HTMLElement) {
    this.root = root;
    this.bar = h('div', { class: 'tabs', role: 'tablist' });
    this.body = h('div', { class: 'tabbody' });
    root.append(this.bar, this.body);
    this.build();
    this.workspaceChanged();
    this.open(this.cur);
  }
  workspaceChanged() {
    clear(this.bar);
    for (const t of TABS) if (t.ws.includes(S.workspace)) this.bar.append(h('button', { role: 'tab', class: t.id === this.cur ? 'on' : '', 'data-tab': t.id, onclick: () => this.open(t.id) }, t.label));
    if (!TABS.find((t) => t.id === this.cur)!.ws.includes(S.workspace)) this.open('trends');
  }
  open(id: TabId) {
    const t = TABS.find((x) => x.id === id)!;
    if (!t.ws.includes(S.workspace)) { /* allow assumptions everywhere */ }
    this.cur = id;
    this.bar.querySelectorAll('button').forEach((b) => b.classList.toggle('on', (b as HTMLElement).dataset.tab === id));
    clear(this.body); this.body.append(this.panes.get(id)!);
    if (id === 'drawings') this.renderDrawings();
    if (id === 'assumptions') this.renderAssumptions();
    if (id === 'validation' && !this.validationEl.dataset.done) this.renderValidationIntro();
    this.update(true);
  }

  build() {
    // ---------------- trends
    this.charts.temp = new LineChart('Temperatures', [
      { key: 'Troom', label: 'room', color: COL.ink, unit: '°C' }, { key: 'Tset', label: 'target', color: COL.red, unit: '°C', dash: [5, 3] },
      { key: 'Tsup', label: 'supply', color: COL.blue, unit: '°C' }, { key: 'zoneMean', label: 'occupied zone', color: COL.green, unit: '°C' }, { key: 'Tmass', label: 'mass', color: COL.grey, unit: '°C' }]);
    this.charts.act = new LineChart('Compressor & fans', [
      { key: 'fCmd', label: 'comp cmd', color: COL.red, unit: 'Hz' }, { key: 'fAct', label: 'comp actual', color: COL.ink, unit: 'Hz' }, { key: 'fReq', label: 'PI request', color: COL.grey, unit: 'Hz', dash: [3, 3] },
      { key: 'ifan', label: 'indoor fan', color: COL.blue, unit: 'rpm', axis: 'R' }, { key: 'ofan', label: 'outdoor fan', color: COL.amber, unit: 'rpm', axis: 'R' }]);
    this.charts.pow = new LineChart('Capacity, power, COP', [
      { key: 'Qnet', label: 'useful capacity', color: COL.blue, unit: 'W' }, { key: 'Qsens', label: 'sensible', color: COL.green, unit: 'W', on: false }, { key: 'Ptotal', label: 'total input', color: COL.red, unit: 'W' },
      { key: 'COP', label: 'COP', color: COL.ink, unit: '-', axis: 'R' }]);
    const trends = h('div', { class: 'charts' }, this.charts.temp.el, this.charts.act.el, this.charts.pow.el);
    this.panes.set('trends', trends);
    // ---------------- states
    this.charts.rh = new LineChart('Humidity & condensate', [{ key: 'RHroom', label: 'room RH', color: COL.blue, unit: '%' }, { key: 'condRate', label: 'condensate', color: COL.violet, unit: 'L/h', axis: 'R' }]);
    this.charts.ref = new LineChart('Refrigerant states', [
      { key: 'Te', label: 'Te', color: COL.blue, unit: '°C' }, { key: 'Tc', label: 'Tc', color: COL.amber, unit: '°C' }, { key: 'Tdis', label: 'discharge', color: COL.red, unit: '°C' },
      { key: 'SH', label: 'superheat', color: COL.green, unit: 'K' }, { key: 'Pc', label: 'HP', color: COL.copper, unit: 'bar(a)', axis: 'R', on: false }, { key: 'Pe', label: 'LP', color: COL.violet, unit: 'bar(a)', axis: 'R', on: false }]);
    this.panes.set('states', h('div', { class: 'charts' }, this.charts.rh.el, this.charts.ref.el, h('div', { class: 'chart', style: { overflow: 'auto', padding: '4px 6px' } }, h('div', { class: 'ct' }, h('b', {}, 'Event timeline (timestamped)')), this.evEl)));
    this.panes.set('circuit', this.circuitEl);
    this.panes.set('ph', h('div', { style: { height: '100%', minHeight: '200px' } }, this.phCanvas));
    // ---------------- slices
    const zoneSel = h('select', { onchange: () => bridge.setZone(ZONE_PRESETS[zoneSel.value]) }, ...Object.entries(ZONE_PRESETS).map(([k, z]) => h('option', { value: k, selected: k === 'even' }, z.name))) as HTMLSelectElement;
    this.panes.set('slices', h('div', { class: 'split3' },
      h('div', {}, h('div', { class: 'small muted' }, 'Plan at the horizontal slice height (time-averaged 20 s). Probes ◆. Approximate airflow model, not CFD validation.'), this.sliceCanvases.plan),
      h('div', {}, h('div', { class: 'small muted' }, 'Section through the indoor unit (x = unit centre): jet direction from the actual vane angles.'), this.sliceCanvases.section),
      h('div', {}, h('div', { class: 'row' }, h('b', {}, 'Comfort scorecard'), h('span', { class: 'spacer' }), zoneSel), this.scoreEl)));
    // ---------------- drawings
    this.panes.set('drawings', h('div', { id: 'drawWrap' }));
    // ---------------- probes
    this.panes.set('probes', h('div', { class: 'split' }, this.probeEl, this.probeChart.el));
    this.panes.set('replay', this.replayEl);
    this.panes.set('compare', this.compareEl);
    this.panes.set('sweep', this.sweepEl);
    this.panes.set('robust', this.robustEl);
    this.panes.set('evidence', this.evidenceEl);
    this.panes.set('diag', this.diagEl);
    this.panes.set('validation', this.validationEl);
    this.panes.set('assumptions', h('div', { id: 'assumpWrap' }));
    this.buildProbes(); this.buildReplay(); this.buildCompare(); this.buildSweep(); this.buildRobust(); this.buildEvidence(); this.buildDiag();
  }

  private lastUpdate = 0;
  update(force = false) {
    const now = performance.now();
    if (!force && now - this.lastUpdate < 400) return;
    this.lastUpdate = now;
    const v = S.replay ?? S.view; if (!v) return;
    const x0 = S.startTime;
    switch (this.cur) {
      case 'trends': for (const k of ['temp', 'act', 'pow']) this.charts[k].draw(S.hist, 't', x0); break;
      case 'states': this.charts.rh.draw(S.hist, 't', x0); this.charts.ref.draw(S.hist, 't', x0); this.renderEvents(); break;
      case 'circuit': this.circuitEl.innerHTML = circuitSVG(v.out, v.s.plant.rv, { gauge: S.gauge, patm: v.s.env.patm }); break;
      case 'ph': drawPH(this.phCanvas, v.out, { gauge: S.gauge, patm: v.s.env.patm, heat: v.s.plant.rv > 0.5 }); break;
      case 'slices': this.renderSlices(); break;
      case 'probes': this.renderProbes(); break;
      case 'replay': this.renderReplay(); break;
    }
  }

  renderEvents() {
    const evs = S.events.filter((e) => !(S.trainingFault && !S.trainingFault.revealed && e.msg.startsWith('Fault injection'))).slice(-200).reverse();
    this.evEl.innerHTML = evs.map((e) => `<div class="${e.kind}">[${((e.t - S.startTime) / 60).toFixed(2)} min] ${e.kind.toUpperCase()} · ${e.msg.replace(/</g, '&lt;')}</div>`).join('');
  }

  // ---------------------------------------------------------------- slices + scorecard
  renderSlices() {
    const f = S.field, v = S.view; if (!f || !v) return;
    const P = v.s.profile;
    const T = v.s.plant.Troom, lo = Math.min(10, T - 12), hi = Math.max(34, T + 10);
    const mode = scene.colorMode;
    const plan = this.sliceCanvases.plan, sec = this.sliceCanvases.section;
    const drawGrid = (c: HTMLCanvasElement, nx: number, ny: number, val: (i: number, j: number) => { T: number; v: number }, title: string) => {
      const g = c.getContext('2d')!; const w = c.width, hh = c.height - 16;
      for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
        const s = val(i, j); const col = mode === 'temperature' ? tempColor(s.T, lo, hi) : null;
        g.fillStyle = col ? '#' + col.getHexString() : `hsl(${(0.62 - Math.min(1, s.v / 1.5) * 0.62) * 360},75%,50%)`;
        g.fillRect((i * w) / nx, (j * hh) / ny, w / nx + 1, hh / ny + 1);
      }
      g.fillStyle = '#fbfaf6'; g.fillRect(0, hh, w, 16); g.fillStyle = '#23221f'; g.font = '11px system-ui'; g.fillText(title, 4, hh + 12);
    };
    const yIdx = Math.min(f.ny - 1, Math.floor((scene.sliceHeight / P.roomH) * f.ny));
    drawGrid(plan, f.nx, f.nz, (i, k) => { const idx = i + f.nx * (yIdx + f.ny * k); return { T: f.T[idx], v: f.v[idx] }; }, `Plan y = ${scene.sliceHeight.toFixed(2)} m · unit wall at top · ${mode} ${mode === 'temperature' ? `${lo.toFixed(0)}–${hi.toFixed(0)} °C` : '0–1.5 m/s'}`);
    const gp = plan.getContext('2d')!;
    const sx = plan.width / P.roomW, sz = (plan.height - 16) / P.roomD;
    gp.fillStyle = '#23221f'; gp.fillRect((P.mountX - 0.4) * sx, 0, 0.8 * sx, 4);
    for (const p of v.s.probes) if (p.def.pos) { gp.fillStyle = '#c4161c'; gp.beginPath(); gp.arc(p.def.pos[0] * sx, p.def.pos[2] * sz, 5, 0, Math.PI * 2); gp.fill(); }
    const xIdx = Math.min(f.nx - 1, Math.floor((P.mountX / P.roomW) * f.nx));
    drawGrid(sec, f.nz, f.ny, (k, j) => { const idx = xIdx + f.nx * ((f.ny - 1 - j) + f.ny * k); return { T: f.T[idx], v: f.v[idx] }; }, 'Section x = unit centre · wall at left · floor at bottom');
    if (S.jet && S.jet.pts.length) {
      const gs = sec.getContext('2d')!; const hh = sec.height - 16;
      gs.strokeStyle = '#23221f'; gs.lineWidth = 2; gs.beginPath();
      S.jet.pts.forEach((p, i) => { const x = (p.p[2] / P.roomD) * sec.width, y = hh - (p.p[1] / P.roomH) * hh; if (i === 0) gs.moveTo(x, y); else gs.lineTo(x, y); });
      gs.stroke();
      gs.fillStyle = '#23221f'; gs.font = '10px monospace';
      gs.fillText(`throw (u<${P.terminalV} m/s): ${S.jet.throw !== null ? S.jet.throw.toFixed(2) + ' m' : '> traced length'} · u0 ${S.jet.u0.toFixed(2)} m/s`, 4, 12);
    }
    const m = v.s.metrics, z = m.zone;
    const occMean = m.zoneN ? m.zoneSum / m.zoneN : null;
    this.scoreEl.innerHTML = `<table class="data">
      <tr><td>Zone</td><td>${v.s.zone.name} (band ±${v.s.zone.band} K, draft > ${v.s.zone.draftV} m/s)</td></tr>
      <tr><td>Occupied mean now</td><td>${z ? fmt(z.mean, 2, '°C') : '—'}</td></tr>
      <tr><td>Warmest / coldest cell</td><td>${z ? `${fmt(z.max, 1)} / ${fmt(z.min, 1)} °C` : '—'}</td></tr>
      <tr><td>Spatial std (uniformity)</td><td>${z ? fmt(z.std, 2, 'K') : '—'}</td></tr>
      <tr><td>Draft cells</td><td>${z ? (100 * z.draftFrac).toFixed(0) + ' %' : '—'}</td></tr>
      <tr><td>Time in band</td><td>${fmtDur(m.inBandTime)}</td></tr>
      <tr><td>Pull-down (band held ${m.dwell / 60} min)</td><td>${m.pulldownTime !== null ? fmtDur(m.pulldownTime) : 'not yet'}</td></tr>
      <tr><td>Energy to service</td><td>${m.energyToService !== null ? m.energyToService.toFixed(3) + ' kWh' : '—'}</td></tr>
      <tr><td>Overshoot / compressor starts</td><td>${m.overshoot.toFixed(2)} K / ${m.compStarts}</td></tr>
      <tr><td>Run-average occupied mean</td><td>${occMean !== null ? occMean.toFixed(2) + ' °C' : '—'}</td></tr></table>
      <div class="small muted" style="margin-top:4px">No PMV/PPD: clothing, metabolic rate and mean radiant temperature are not modelled. Zones are editable preferences, not certified standards.</div>`;
  }

  // ---------------------------------------------------------------- drawings
  renderDrawings() {
    const wrap = document.getElementById('drawWrap'); if (!wrap) return;
    clear(wrap);
    const views: { id: 'front' | 'side' | 'section' | 'plan' | 'outdoorFront'; label: string; dims: string }[] = [
      { id: 'front', label: 'Indoor front', dims: 'W 798 mm (sourced S2 p.11)' },
      { id: 'side', label: 'Indoor side', dims: 'H 299 × D 219 mm (sourced); profile curvature modelled' },
      { id: 'section', label: 'Section A-A through blower and vanes', dims: 'Internal geometry modelled (not manufacturing data)' },
      { id: 'plan', label: 'Plan (indoor + outdoor)', dims: 'Outdoor 800 × 285 mm (sourced); placement assumed' },
      { id: 'outdoorFront', label: 'Outdoor front', dims: '800 × 550 mm; fan centre 302.5 / 280 mm (sourced S3 p.11)' },
    ];
    const grid = h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(240px,1fr))', gap: '8px' } });
    for (const vv of views) {
      const img = h('img', { alt: vv.label, style: { width: '100%', border: '1px solid var(--line)', background: '#fff' } }) as HTMLImageElement;
      try { img.src = scene.renderOrtho(vv.id, 520, 340); } catch { img.alt = 'render failed'; }
      grid.append(h('figure', { style: { margin: 0 } }, img, h('figcaption', { class: 'small' }, h('b', {}, vv.label), ' · ', h('span', { class: 'muted' }, vv.dims)),
        h('button', { class: 'btn sm', onclick: () => download(`ap35-${vv.id}.png`, dataUrlToBlob(img.src)) }, 'PNG')));
    }
    wrap.append(h('div', { class: 'small muted', style: { marginBottom: '6px' } }, 'Orthographic renders of the same procedural geometry. Only published envelope dimensions are dimensioned; everything else is modelled. Not manufacturing drawings.'), grid);
  }

  // ---------------------------------------------------------------- probes
  buildProbes() {
    const add = (def: Omit<ProbeDef, 'id'>) => bridge.addProbe({ ...def, id: 'pr' + Date.now().toString(36) }).then((r) => { if (!r.ok) toast(r.error ?? 'probe rejected', 4000); });
    const presets: Record<string, [number, number, number]> = { desk: [0.85, 1.1, 2.9], bed: [3.0, 0.75, 2.6], return: [2.0, 2.3, 0.6], occupied: [2.0, 1.1, 2.0] };
    clear(this.probeEl).append(
      h('div', { class: 'row wrap' },
        h('b', {}, 'Add probe'),
        ...Object.keys(presets).map((k) => h('button', { class: 'btn sm', onclick: () => add({ kind: 'airT', pos: presets[k], label: `Air T @ ${k}` }) }, `T @ ${k}`)),
        h('button', { class: 'btn sm', onclick: () => add({ kind: 'airV', pos: presets.desk, label: 'Velocity @ desk' }) }, 'v @ desk'),
        h('button', { class: 'btn sm', onclick: () => add({ kind: 'airRH', pos: presets.bed, label: 'RH @ bed' }) }, 'RH @ bed'),
        h('button', { class: 'btn sm', onclick: () => add({ kind: 'ref', point: 'p2', label: 'Refrigerant point 2 (discharge)' }) }, 'Ref point 2'),
        h('button', { class: 'btn sm', onclick: () => add({ kind: 'ref', point: 'p4', label: 'Refrigerant point 4 (after LEV)' }) }, 'Ref point 4'),
        h('button', { class: 'btn sm', onclick: () => add({ kind: 'elec', label: 'Electrical card (total input)' }) }, 'Electrical'),
        h('button', { class: 'btn sm', onclick: () => { scene.probePlacing = !scene.probePlacing; toast(scene.probePlacing ? 'Click in the room to place an air-temperature probe at 1.1 m (supported air cells only).' : 'Placement off'); } }, 'Place by click'),
        h('button', { class: 'btn sm', onclick: () => add({ kind: 'airT', pos: [0.85, 0.4, 2.5], label: 'Inside the desk (should be rejected)' }) }, 'Try solid cell')),
      h('div', { id: 'probeList', style: { marginTop: '6px' } }));
    scene.onPickRoom = (p) => { if (p.x < 0 || p.z < 0) { toast('Outside the room air domain: no measurement there.'); return; } void add({ kind: 'airT', pos: [p.x, 1.1, p.z], label: `Air T @ (${p.x.toFixed(1)}, 1.1, ${p.z.toFixed(1)})` }); scene.probePlacing = false; };
  }
  renderProbes() {
    const v = S.view; if (!v) return;
    const list = document.getElementById('probeList'); if (!list) return;
    const unit = (k: string) => (k === 'airV' ? 'm/s' : k === 'airRH' ? '%' : k === 'elec' ? 'W' : '°C');
    list.innerHTML = '';
    list.append(h('table', { class: 'data' }, h('tr', {}, h('th', {}, 'Probe'), h('th', {}, 'Ideal model value'), h('th', {}, 'Virtual sensor'), h('th', {}, '')),
      ...v.s.probes.map((p) => h('tr', { style: { cursor: 'pointer' }, onclick: () => (this.probeSel = p.def.id) },
        h('td', {}, p.def.label), h('td', {}, fmt(p.ideal, 2, unit(p.def.kind))), h('td', {}, fmt(p.virt, 2, unit(p.def.kind))),
        h('td', {}, h('button', { class: 'btn sm', onclick: (e: Event) => { e.stopPropagation(); bridge.removeProbe(p.def.id); } }, '✕'))))));
    list.append(h('div', { class: 'small muted' }, `Virtual sensor: lag ${v.s.profile.sensorTau} s, sample ${v.s.profile.sensorPeriod} s, seeded noise ${v.s.profile.sensorNoise} K (user assumptions, not an instrument spec). Air probes read the time-averaged zonal field.`));
    const id = this.probeSel ?? v.s.probes[0]?.def.id;
    const ph = id ? S.probeHist.get(id) : null;
    if (ph) this.probeChart.draw({ t: ph.t, ideal: ph.ideal, virt: ph.virt }, 't', S.startTime);
  }
  probeSel: string | null = null;

  // ---------------------------------------------------------------- replay / branching
  buildReplay() {
    const slider = h('input', { type: 'range', min: 0, max: 1, step: 0.001, value: 1, style: { width: '100%' } }) as HTMLInputElement;
    const label = h('span', { class: 'mono' });
    slider.oninput = () => { const t = this.replayT(Number(slider.value)); label.textContent = `t = ${((t - S.startTime) / 60).toFixed(1)} min`; };
    this.replayEl.append(
      h('div', { class: 'small muted' }, 'Rewind loads the nearest checkpoint and re-simulates the logged inputs forward (no backward integration). Scrubbing does not change the live experiment until you branch.'),
      h('div', { class: 'row' }, slider, label),
      h('div', { class: 'row wrap', style: { marginTop: '6px' } },
        h('button', { class: 'btn sm', onclick: () => bridge.replayTo(this.replayT(Number(slider.value))) }, 'Load replay at this time'),
        h('button', { class: 'btn sm primary', onclick: () => { bridge.branch(); toast('Branched: the live experiment now continues from the replayed state.'); } }, 'Branch experiment from here'),
        h('button', { class: 'btn sm', onclick: () => bridge.replayClose() }, 'Close replay'),
        h('button', { class: 'btn sm', onclick: () => this.verifyReplay() }, 'Verify replay reproducibility'),
        h('button', { class: 'btn sm', onclick: async () => { const r = await bridge.getRun() as { run: unknown }; download('ap35-run.json', JSON.stringify(r.run)); } }, 'Export run (inputs + initial state)'),
        h('button', { class: 'btn sm', onclick: () => this.presentation() }, 'Presentation mode'),
        h('button', { class: 'btn sm', onclick: () => extras.record() }, 'Record WebM')),
      h('div', { id: 'replayInfo', class: 'small', style: { marginTop: '6px' } }));
  }
  replayT(f: number) { const v = S.view; if (!v) return 0; return S.startTime + f * (v.s.t - S.startTime); }
  renderReplay() {
    const el = document.getElementById('replayInfo'); if (!el) return;
    el.innerHTML = `Snapshots: ${S.snapshots.length} (bounded) · logged inputs: ${S.inputs} · ${S.replay ? `<b>Replay view at ${((S.replay.s.t - S.startTime) / 60).toFixed(1)} min</b> (readouts show the replay)` : 'Live view'}`;
  }
  async verifyReplay() {
    const v = S.view; if (!v) return;
    const r = await bridge.getRun() as { run: { initial: unknown; inputs: { t: number; action: Action }[]; endT: number; dt: number } };
    const t0 = performance.now();
    const res = await bridge.job({ type: 'customAB', init: r.run.initial, schedule: r.run.inputs.map((x) => ({ at: x.t - (r.run.initial as { t: number }).t, action: x.action })), duration: r.run.endT - (r.run.initial as { t: number }).t, a: [], b: [], labels: ['replay A', 'replay B'] }) as { summary: RunSummary }[];
    const a = res[0].summary, b = res[1].summary;
    const same = Math.abs(a.energy_kWh - b.energy_kWh) < 1e-9 && Math.abs(a.finalRoom_C - b.finalRoom_C) < 1e-9;
    modal('Replay reproducibility', h('div', {},
      h('p', {}, `Two independent re-simulations of the recorded run (initial snapshot + ${r.run.inputs.length} logged inputs) took ${((performance.now() - t0) / 1000).toFixed(1)} s.`),
      h('p', {}, `Final room: ${a.finalRoom_C.toFixed(6)} vs ${b.finalRoom_C.toFixed(6)} °C · energy ${a.energy_kWh.toFixed(6)} vs ${b.energy_kWh.toFixed(6)} kWh · ${same ? 'identical' : 'DIFFERENT'}.`),
      h('p', {}, `Live run: room ${v.s.plant.Troom.toFixed(4)} °C, energy ${v.s.plant.E_total.toFixed(5)} kWh (the batch replay uses a coarser field update, so comfort metrics may differ slightly; thermal states match within numerical tolerance).`)));
  }
  presentation() {
    document.body.classList.toggle('present');
    const on = document.body.classList.contains('present');
    const st = document.getElementById('presentStyle') ?? document.head.appendChild(h('style', { id: 'presentStyle' }));
    st.textContent = on ? '#left,#bottom{display:none!important}#shell{grid-template-columns:1fr 340px!important;grid-template-areas:"hdr hdr" "stage right" "stage right"!important}.kpi .v{font-size:34px!important}' : '';
    scene.resize();
    toast(on ? 'Presentation mode: press the button again (Timeline tab) or Esc to exit.' : 'Presentation mode off');
    if (on) { const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { document.removeEventListener('keydown', esc); this.presentation(); } }; document.addEventListener('keydown', esc); }
  }

  // ---------------------------------------------------------------- A/B compare
  buildCompare() {
    const kinds: Record<string, { label: string; a: () => ScheduledAction[]; b: () => ScheduledAction[]; la: string; lb: string; profileB?: Partial<ProfileValues>; disabled?: string }> = {
      fan: { label: 'Indoor fan Low vs High', a: () => [{ at: 0, action: { type: 'remote', patch: { fan: 'Low' } } }], b: () => [{ at: 0, action: { type: 'remote', patch: { fan: 'High' } } }], la: 'fan Low', lb: 'fan High' },
      swing: { label: 'Fixed vane 2 vs swing', a: () => [{ at: 0, action: { type: 'remote', patch: { vane: 2 } } }], b: () => [{ at: 0, action: { type: 'remote', patch: { vane: 'swing' } } }], la: 'vane 2', lb: 'swing' },
      dir: { label: 'Horizontal (1) vs downward (5)', a: () => [{ at: 0, action: { type: 'remote', patch: { vane: 1 } } }], b: () => [{ at: 0, action: { type: 'remote', patch: { vane: 5 } } }], la: 'vane 1', lb: 'vane 5' },
      outlet: { label: 'Outlet opening 65 mm vs 80 mm (design)', a: () => [], b: () => [{ at: 0, action: { type: 'profile', patch: { outletH: 0.08 } } }], la: 'outlet 65 mm', lb: 'outlet 80 mm' },
      mount: { label: 'Unit top at 2.55 m vs 2.2 m (design)', a: () => [], b: () => [{ at: 0, action: { type: 'profile', patch: { mountH: 2.2 } } }], la: 'mount 2.55 m', lb: 'mount 2.2 m' },
      tuning: { label: 'Controller Kp 12 vs 25', a: () => [], b: () => [{ at: 0, action: { type: 'profile', patch: { kp: 25 } } }], la: 'Kp 12', lb: 'Kp 25' },
      filter: { label: 'Clean vs restricted filter', a: () => [], b: () => [{ at: 0, action: { type: 'faults', patch: { filterRestriction: 3 } } }], la: 'clean', lb: 'filter +300 %' },
      map: { label: 'Imported compressor map', a: () => [], b: () => [], la: '', lb: '', disabled: 'No validated alternative compressor map has been imported. Use Lab evidence to create a calibrated derivative, then compare profiles.' },
    };
    const sel = h('select', {}, ...Object.entries(kinds).map(([k, v]) => h('option', { value: k }, v.label))) as HTMLSelectElement;
    const base = h('select', {}, ...SCENARIOS.filter((s) => !s.variants).map((s) => h('option', { value: s.id, selected: s.id === 'pulldown' }, s.title))) as HTMLSelectElement;
    const dur = h('select', {}, ...[1800, 3600, 5400].map((d) => h('option', { value: d, selected: d === 3600 }, `${d / 60} min`))) as HTMLSelectElement;
    const prog = h('div', { class: 'progress' }, h('div'));
    const res = h('div', { style: { marginTop: '8px' } });
    const run = async () => {
      const k = kinds[sel.value];
      if (k.disabled) { toast(k.disabled, 6000); return; }
      const sc = SCENARIO_BY_ID[base.value];
      (prog.firstChild as HTMLElement).style.width = '0%';
      try {
        const out = await bridge.job({ type: 'customAB', init: initSpecFor(sc.id), schedule: sc.schedule, duration: Number(dur.value), a: k.a(), b: k.b(), labels: [k.la, k.lb] }, (f) => { if (f >= 0) (prog.firstChild as HTMLElement).style.width = `${(f * 100).toFixed(0)}%`; });
        this.lastCompare = { results: out as never, labels: [k.la, k.lb] };
        this.renderCompare(res);
      } catch (e) { toast(String(e)); }
    };
    this.compareEl.append(
      h('div', { class: 'row wrap' }, h('b', {}, 'Experiment'), sel, h('span', {}, 'from'), base, h('span', {}, 'for'), dur, h('button', { class: 'btn sm primary', onclick: run }, 'Run A/B'), h('button', { class: 'btn sm', onclick: () => bridge.cancelJob() }, 'Cancel'),
        h('button', { class: 'btn sm', onclick: () => this.runScenarioVariants('louverAB', res, prog) }, 'Preset: louver A/B/C'), h('button', { class: 'btn sm', onclick: () => this.runScenarioVariants('fanAB', res, prog) }, 'Preset: fan A/B')),
      h('div', { class: 'small muted' }, 'Both runs start from the identical initial state, room/load schedule and solver settings; plots share scales and colour limits. Energy comparisons are only meaningful at equal service.'),
      prog, res);
  }
  async runScenarioVariants(id: string, res: HTMLElement, prog: HTMLElement) {
    const out = await bridge.job({ type: 'scenarioAB', scenario: id }, (f) => { if (f >= 0) (prog.firstChild as HTMLElement).style.width = `${(f * 100).toFixed(0)}%`; });
    this.lastCompare = { results: out as never, labels: SCENARIO_BY_ID[id].variants!.map((v) => v.label) };
    this.renderCompare(res);
  }
  renderCompare(res: HTMLElement) {
    const c = this.lastCompare; if (!c) return;
    clear(res);
    const S2 = c.results.map((r) => r.summary);
    const row = (label: string, f: (s: RunSummary) => string, diff?: (a: RunSummary, b: RunSummary) => string) => h('tr', {}, h('td', {}, label), ...S2.map((s) => h('td', {}, f(s))), S2.length === 2 && diff ? h('td', {}, diff(S2[0], S2[1])) : null);
    res.append(h('div', { class: 'split' },
      h('table', { class: 'data' }, h('tr', {}, h('th', {}, 'Metric'), ...c.labels.map((l) => h('th', {}, l)), S2.length === 2 ? h('th', {}, 'B − A') : null),
        row('Time to target (band held)', (s) => s.timeToTarget_s !== null ? fmtDur(s.timeToTarget_s) : 'not reached', (a, b) => a.timeToTarget_s !== null && b.timeToTarget_s !== null ? fmtDur(b.timeToTarget_s - a.timeToTarget_s) : 'n/a'),
        row('Energy (run)', (s) => s.energy_kWh.toFixed(3) + ' kWh', (a, b) => (b.energy_kWh - a.energy_kWh).toFixed(3)),
        row('Energy to service', (s) => s.energyToService_kWh !== null ? s.energyToService_kWh.toFixed(3) : '—', (a, b) => a.energyToService_kWh !== null && b.energyToService_kWh !== null ? (b.energyToService_kWh - a.energyToService_kWh).toFixed(3) : 'n/a'),
        row('Avg useful capacity', (s) => s.avgUsefulCapacity_W.toFixed(0) + ' W', (a, b) => (b.avgUsefulCapacity_W - a.avgUsefulCapacity_W).toFixed(0)),
        row('Peak input', (s) => s.peakInput_W.toFixed(0) + ' W', (a, b) => (b.peakInput_W - a.peakInput_W).toFixed(0)),
        row('Condensate', (s) => s.condensate_L.toFixed(2) + ' L', (a, b) => (b.condensate_L - a.condensate_L).toFixed(2)),
        row('Occupied mean (run avg)', (s) => fmt(s.occupiedMean_C, 2, '°C'), (a, b) => a.occupiedMean_C !== null && b.occupiedMean_C !== null ? (b.occupiedMean_C - a.occupiedMean_C).toFixed(2) : ''),
        row('Occupied uniformity (std)', (s) => fmt(s.occupiedStd_K, 2, 'K'), (a, b) => a.occupiedStd_K !== null && b.occupiedStd_K !== null ? (b.occupiedStd_K - a.occupiedStd_K).toFixed(2) : ''),
        row('Draft cells', (s) => s.draftFraction !== null ? (100 * s.draftFraction).toFixed(0) + ' %' : '—'),
        row('Time in band', (s) => (100 * s.inBandFraction).toFixed(0) + ' %'),
        row('Compressor starts / protections', (s) => `${s.compressorStarts} / ${s.protections}`),
        row('Service note', (s) => s.serviceNote)),
      h('div', {}, this.compareChart(c), this.compareSlices(c))));
    res.append(h('div', { class: 'row' }, h('button', { class: 'btn sm', onclick: () => { const j = c.results[1]?.jet as { p: [number, number, number] }[] | undefined; if (j) extras.ghostJet(j); toast('B jet shown as a ghost line in 3D'); } }, 'Show B jet as ghost in 3D'),
      h('button', { class: 'btn sm', onclick: () => tabs2Story(c) }, 'Export experiment story (HTML)')));
  }
  compareChart(c: NonNullable<BottomTabs['lastCompare']>) {
    const colors = [COL.ink, COL.red, COL.blue];
    const tr = c.results.flatMap((r, i) => [{ key: `T${i}`, label: `${c.labels[i]} room`, color: colors[i], unit: '°C' }, { key: `Q${i}`, label: `${c.labels[i]} Qnet`, color: colors[i], unit: 'W', axis: 'R' as const, dash: [4, 3] }]);
    const ch = new LineChart('Same clock, common scales', tr);
    const data: Record<string, number[]> = { t: c.results[0].history.t };
    c.results.forEach((r, i) => { data[`T${i}`] = r.history.Troom; data[`Q${i}`] = r.history.Qnet; });
    ch.el.style.height = '170px';
    requestAnimationFrame(() => ch.draw(data, 't', c.results[0].history.t[0]));
    return ch.el;
  }
  compareSlices(c: NonNullable<BottomTabs['lastCompare']>) {
    const fs = c.results.map((r) => r.field).filter(Boolean) as { T: number[]; v: number[]; nx: number; ny: number; nz: number }[];
    if (fs.length < 2) return h('div');
    const wrap = h('div', { class: 'row' });
    const all = fs.flatMap((f) => f.T);
    const lo = Math.min(...all), hi = Math.max(...all);
    const y = Math.floor(fs[0].ny * (1.1 / 2.8));
    const draw = (vals: (i: number, k: number) => number, l: number, hh: number, title: string, diff = false) => {
      const cv = h('canvas', { width: 160, height: 176 }) as HTMLCanvasElement; const g = cv.getContext('2d')!;
      const f = fs[0];
      for (let i = 0; i < f.nx; i++) for (let k = 0; k < f.nz; k++) {
        const v = vals(i, k);
        if (diff) { const a = Math.max(-1, Math.min(1, v / Math.max(0.2, hh))); g.fillStyle = a >= 0 ? `rgba(196,22,28,${a})` : `rgba(47,127,193,${-a})`; }
        else g.fillStyle = '#' + tempColor(v, l, hh).getHexString();
        g.fillRect((i * 160) / f.nx, (k * 160) / f.nz, 160 / f.nx + 1, 160 / f.nz + 1);
      }
      g.fillStyle = '#23221f'; g.font = '10px system-ui'; g.fillText(title, 2, 172);
      return cv;
    };
    const idx = (f: { nx: number; ny: number }, i: number, k: number) => i + f.nx * (y + f.ny * k);
    wrap.append(draw((i, k) => fs[0].T[idx(fs[0], i, k)], lo, hi, `A ${lo.toFixed(1)}–${hi.toFixed(1)} °C`), draw((i, k) => fs[1].T[idx(fs[1], i, k)], lo, hi, 'B (same scale)'));
    const dmax = Math.max(...fs[0].T.map((v, i) => Math.abs(fs[1].T[i] - v)));
    wrap.append(draw((i, k) => fs[1].T[idx(fs[1], i, k)] - fs[0].T[idx(fs[0], i, k)], 0, dmax, `B − A (±${dmax.toFixed(2)} K)`, true));
    return h('div', {}, h('div', { class: 'small muted' }, 'Plan at 1.1 m, time-averaged field at end of run. Frozen common colour limits.'), wrap);
  }

  // ---------------------------------------------------------------- sweep
  buildSweep() {
    const rows = SWEEP_VARS.map((v) => {
      const on = h('input', { type: 'checkbox', checked: v.id === 'vane' || v.id === 'ifan' }) as HTMLInputElement;
      const lo = h('input', { type: 'number', value: v.lo, step: 'any', style: { width: '70px' } }) as HTMLInputElement;
      const hi = h('input', { type: 'number', value: v.hi, step: 'any', style: { width: '70px' } }) as HTMLInputElement;
      return { v, on, lo, hi, el: h('tr', {}, h('td', {}, on), h('td', {}, v.label, v.support === 'visual-only' ? h('span', { class: 'badge conceptual', style: { marginLeft: '4px' } }, 'visual-only') : null), h('td', {}, lo), h('td', {}, hi), h('td', { class: 'muted' }, v.unit)) };
    });
    const n = h('input', { type: 'number', value: 16, min: 8, max: 64, style: { width: '60px' } }) as HTMLInputElement;
    const seed = h('input', { type: 'number', value: 1, style: { width: '60px' } }) as HTMLInputElement;
    const draft = h('input', { type: 'number', value: 0.15, step: 0.05, style: { width: '60px' } }) as HTMLInputElement;
    const zone = h('select', {}, ...Object.entries(ZONE_PRESETS).map(([k, z]) => h('option', { value: k }, z.name))) as HTMLSelectElement;
    const dur = h('select', {}, ...[1800, 2700, 3600].map((d) => h('option', { value: d }, `${d / 60} min`))) as HTMLSelectElement;
    const prog = h('div', { class: 'progress' }, h('div'));
    const status = h('div', { class: 'small' });
    const res = h('div');
    const run = async () => {
      const vars = rows.filter((r) => r.on.checked).map((r) => ({ id: r.v.id, lo: Number(r.lo.value), hi: Number(r.hi.value) }));
      if (!vars.length) { toast('Select at least one variable'); return; }
      const nn = Math.max(8, Math.min(64, Number(n.value)));
      const sc = SCENARIO_BY_ID.pulldown;
      const spec = { vars, n: nn, seed: Number(seed.value), base: { init: { ...initSpecFor('pulldown'), zone: ZONE_PRESETS[zone.value] }, schedule: sc.schedule, duration: Number(dur.value) }, constraints: { maxDraft: Number(draft.value), bandK: ZONE_PRESETS[zone.value].band, requireTarget: true } };
      status.textContent = `Running ${nn} candidates + baseline (≈ ${(nn * Number(dur.value) / 3600 * 1.5).toFixed(0)} s)…`;
      (prog.firstChild as HTMLElement).style.width = '0%';
      try {
        const out = await bridge.job({ type: 'sweep', spec }, (f, partial) => { if (f >= 0) (prog.firstChild as HTMLElement).style.width = `${(f * 100).toFixed(0)}%`; else if (partial) status.textContent = `${(partial as unknown[]).length - 1}/${nn} candidates evaluated…`; });
        this.lastSweep = { ...(out as object), spec } as never;
        this.renderSweep(res);
        status.textContent = '';
      } catch (e) { status.textContent = String(e); }
    };
    this.sweepEl.append(h('div', { class: 'split' },
      h('div', {}, h('table', { class: 'data' }, h('tr', {}, h('th', {}, ''), h('th', {}, 'Variable (supported)'), h('th', {}, 'min'), h('th', {}, 'max'), h('th', {}, 'unit')), ...rows.map((r) => r.el)),
        h('div', { class: 'row wrap', style: { marginTop: '6px' } }, 'Runs', n, 'seed', seed, 'zone', zone, 'max draft', draft, dur, h('button', { class: 'btn sm primary', onclick: run }, 'Run sweep'), h('button', { class: 'btn sm', onclick: () => bridge.cancelJob() }, 'Cancel')),
        h('div', { class: 'small muted' }, 'Latin-hypercube design, deterministic seed, results cached by hash of model+parameters+scenario+solver settings. Objective: energy to reach and hold the comfort band, and time to target. Infeasible designs are listed but never ranked feasible.'),
        prog, status),
      res));
  }
  renderSweep(res: HTMLElement) {
    const r = this.lastSweep; if (!r) return;
    clear(res);
    const par = new Set(r.pareto);
    const cands = [...r.candidates].sort((a, b) => (a.baseline ? -1 : b.baseline ? 1 : (a.summary?.energyToService_kWh ?? 99) - (b.summary?.energyToService_kWh ?? 99)));
    const cv = h('canvas', { width: 360, height: 200 }) as HTMLCanvasElement;
    const g = cv.getContext('2d')!;
    const pts = cands.filter((c) => c.summary && c.summary.timeToTarget_s !== null && c.summary.energyToService_kWh !== null);
    if (pts.length) {
      const xs = pts.map((c) => c.summary!.timeToTarget_s! / 60), ys = pts.map((c) => c.summary!.energyToService_kWh!);
      const x0 = Math.min(...xs), x1 = Math.max(...xs) + 1e-6, y0 = Math.min(...ys), y1 = Math.max(...ys) + 1e-6;
      g.fillStyle = '#fff'; g.fillRect(0, 0, 360, 200); g.font = '10px system-ui'; g.fillStyle = '#8a857a';
      g.fillText('time to target [min] →', 230, 196); g.fillText('energy to service [kWh] ↑', 4, 10);
      for (const c of pts) {
        const x = 30 + ((c.summary!.timeToTarget_s! / 60 - x0) / (x1 - x0)) * 310, y = 185 - ((c.summary!.energyToService_kWh! - y0) / (y1 - y0)) * 165;
        g.fillStyle = c.baseline ? '#23221f' : !c.feasible ? '#c9c2b4' : par.has(c.id) ? '#c4161c' : '#2f7fc1';
        g.beginPath(); g.arc(x, y, c.baseline ? 6 : 4, 0, Math.PI * 2); g.fill();
      }
    }
    const varIds = Object.keys((r.spec as { vars: { id: string }[] }).vars.reduce((o: Record<string, 1>, v) => ((o[v.id] = 1), o), {}));
    const sens = h('table', { class: 'data' }, h('tr', {}, h('th', {}, 'Global sensitivity (standardised regression coeff.)'), ...varIds.map((v) => h('th', {}, v))),
      ...Object.entries(r.sensitivity).map(([m, row]) => h('tr', {}, h('td', {}, m), ...varIds.map((v) => h('td', {}, row[v] !== undefined ? row[v].toFixed(2) : '—')))));
    const visualOnly = cands.some((c) => c.reasons.some((x) => x.includes('visual-only')));
    res.append(
      h('div', {}, h('b', {}, 'Best among evaluated candidates under this model'), h('span', { class: 'small muted' }, ` · ${r.tested} tested (incl. baseline) · ${r.failed} infeasible/failed${r.cancelled ? ' · CANCELLED early' : ''}`)),
      visualOnly ? h('div', { class: 'exp-banner' }, 'Visual-only geometry was included: performance ranking for those candidates is disabled.') : '',
      h('div', { class: 'row', style: { alignItems: 'flex-start' } }, cv, h('div', { class: 'small' }, h('div', {}, h('span', { class: 'sw', style: { background: '#23221f' } }), ' baseline (unchanged reference)'), h('div', {}, h('span', { class: 'sw', style: { background: '#c4161c' } }), ' Pareto (feasible, nondominated)'), h('div', {}, h('span', { class: 'sw', style: { background: '#2f7fc1' } }), ' feasible'), h('div', {}, h('span', { class: 'sw', style: { background: '#c9c2b4' } }), ' infeasible'), h('div', { class: 'muted', style: { marginTop: '4px' } }, 'Local sensitivity is not shown as global importance; the coefficients describe only the tested ranges.'))),
      sens,
      h('table', { class: 'data', style: { marginTop: '6px' } }, h('tr', {}, h('th', {}, 'Candidate'), h('th', {}, 'feasible'), h('th', {}, 'time to target'), h('th', {}, 'energy to service'), h('th', {}, 'zone std'), h('th', {}, 'draft'), h('th', {}, 'why not feasible'), h('th', {}, '')),
        ...cands.slice(0, 40).map((c) => h('tr', { class: c.baseline ? 'best' : !c.feasible ? 'infeasible' : '' },
          h('td', {}, c.baseline ? 'baseline' : Object.entries(c.values).map(([k, v]) => `${k}=${(+v).toFixed(2)}`).join(' ')), h('td', {}, c.feasible ? (par.has(c.id) ? 'Pareto' : 'yes') : 'no'),
          h('td', {}, c.summary?.timeToTarget_s != null ? fmtDur(c.summary.timeToTarget_s) : 'not reached'), h('td', {}, c.summary?.energyToService_kWh != null ? c.summary.energyToService_kWh.toFixed(3) : '—'),
          h('td', {}, fmt(c.summary?.occupiedStd_K, 2)), h('td', {}, c.summary?.draftFraction != null ? (100 * c.summary.draftFraction).toFixed(0) + '%' : '—'), h('td', { class: 'small' }, c.reasons.join('; ')),
          h('td', {}, c.baseline ? '' : h('button', { class: 'btn sm', onclick: () => this.inspectCandidate(c) }, 'Inspect in 3D'))))));
  }
  async inspectCandidate(c: Candidate) {
    const spec = this.lastSweep!.spec as { base: { init: unknown } };
    loadScenario('pulldown', { run: true });
    for (const [id, v] of Object.entries(c.values)) {
      const def = SWEEP_VARS.find((x) => x.id === id)!;
      const r = def.apply(def.integer ? Math.round(v) : v);
      for (const a of r.actions ?? []) await act(a, true);
      if (r.profile) await act({ type: 'profile', patch: r.profile }, true);
    }
    void spec; setView('airflow');
    toast('Candidate loaded into the live simulator (pull-down scenario). Its design changes are unsaved: create a profile in Design Lab to keep them.');
  }

  // ---------------------------------------------------------------- robustness
  buildRobust() {
    const res = h('div'); const prog = h('div', { class: 'progress' }, h('div'));
    this.robustEl.append(h('div', { class: 'small muted' }, 'Scenario envelope: the current profile is run nominal and at two corners of declared uncertainty (envelope conductance ±30 %, indoor coil UA ±15 %, internal gains ±50 %). These are scenario envelopes, not statistical confidence intervals.'),
      h('div', { class: 'row' }, h('button', { class: 'btn sm primary', onclick: async () => { const sc = SCENARIO_BY_ID.pulldown; const out = await bridge.job({ type: 'robustness', init: initSpecFor('pulldown'), schedule: sc.schedule, duration: 3600 }, (f) => { if (f >= 0) (prog.firstChild as HTMLElement).style.width = `${(f * 100).toFixed(0)}%`; }) as { summary: RunSummary; history: Record<string, number[]> }[]; this.renderRobust(res, out); } }, 'Run envelope (pull-down, 60 min)')), prog, res);
  }
  renderRobust(res: HTMLElement, out: { summary: RunSummary; history: Record<string, number[]> }[]) {
    clear(res);
    const ch = new LineChart('Room temperature envelope', out.map((r, i) => ({ key: `T${i}`, label: i === 0 ? 'nominal' : i === 1 ? 'low-load corner' : 'high-load corner', color: [COL.ink, COL.blue, COL.red][i], unit: '°C' })));
    const data: Record<string, number[]> = { t: out[0].history.t }; out.forEach((r, i) => (data[`T${i}`] = r.history.Troom));
    ch.el.style.height = '170px';
    res.append(h('div', { class: 'split' }, h('table', { class: 'data' }, h('tr', {}, h('th', {}, 'Case'), h('th', {}, 'time to target'), h('th', {}, 'energy'), h('th', {}, 'avg capacity')),
      ...out.map((r) => h('tr', {}, h('td', { class: 'small', style: { whiteSpace: 'normal' } }, r.summary.label), h('td', {}, r.summary.timeToTarget_s !== null ? fmtDur(r.summary.timeToTarget_s) : 'not reached'), h('td', {}, r.summary.energy_kWh.toFixed(3)), h('td', {}, r.summary.avgUsefulCapacity_W.toFixed(0))))), ch.el));
    requestAnimationFrame(() => ch.draw(data, 't', out[0].history.t[0]));
  }

  // ---------------------------------------------------------------- evidence
  buildEvidence() {
    const res = h('div');
    let csv = '';
    const info = h('div', { class: 'small' });
    const valFrac = h('input', { type: 'number', value: 0.4, step: 0.1, min: 0.2, max: 0.6, style: { width: '60px' } }) as HTMLInputElement;
    const run = async () => {
      if (!csv) { toast('Import a CSV or load the synthetic sample first'); return; }
      try {
        const p = { ...mitsubishi_ap35_reference, ...(activeProfile()?.overrides ?? {}) };
        const out = await bridge.job({ type: 'evidence', csv, profile: p, mode: 'cool', valFraction: Number(valFrac.value) }) as { data: { columns: string[]; warnings: string[]; unused: string[]; meta: Record<string, string>; n: number }; fit: { fitted: Partial<ProfileValues>; scales: Record<string, number>; calibration: Record<string, number>; validation: Record<string, number>; residuals: { i: number; set: string; capMeas: number | null; capSim: number; powMeas: number | null; powSim: number }[]; coverage: string; notes: string[] } };
        this.renderEvidence(res, out);
      } catch (e) { toast(String(e instanceof Error ? e.message : e), 6000); }
    };
    this.evidenceEl.append(
      h('div', { class: 'row wrap' },
        h('button', { class: 'btn sm', onclick: () => download('ap35-lab-template.csv', templateCSV()) }, 'Download column template'),
        h('button', { class: 'btn sm', onclick: async () => { try { csv = await readFile('.csv,text/csv'); info.textContent = `Loaded ${csv.split('\n').length} lines.`; } catch { /* cancelled */ } } }, 'Import lab CSV'),
        h('button', { class: 'btn sm', onclick: () => { csv = syntheticDemoCSV({ ...mitsubishi_ap35_reference }); info.innerHTML = '<b>SYNTHETIC sample loaded</b> (generated by the simulator with altered UA/efficiency plus noise; not a measurement).'; } }, 'Load synthetic sample'),
        'validation fraction', valFrac,
        h('button', { class: 'btn sm primary', onclick: run }, 'Calibrate (steady rows)')),
      h('div', { class: 'small muted' }, 'Columns carry units in brackets; unsupported columns stay unused; missing cells stay missing. Only identifiable scales (indoor coil UA, compressor efficiency, displacement) are fitted, with bounds and regularisation toward the reference. The last rows are held out for validation. Transient calibration is not automated: compare traces in Timeline/Trends.'),
      info, res);
  }
  renderEvidence(res: HTMLElement, out: { data: { columns: string[]; warnings: string[]; unused: string[]; meta: Record<string, string>; n: number }; fit: { fitted: Partial<ProfileValues>; scales: Record<string, number>; calibration: Record<string, number>; validation: Record<string, number>; residuals: { i: number; set: string; capMeas: number | null; capSim: number; powMeas: number | null; powSim: number }[]; coverage: string; notes: string[] } }) {
    clear(res);
    const f = out.fit;
    const st = (s: Record<string, number>) => `n=${s.n} · capacity bias ${fmt(s.cap_bias_W, 0)} W, MAE ${fmt(s.cap_mae_W, 0)}, RMSE ${fmt(s.cap_rmse_W, 0)} · power bias ${fmt(s.pow_bias_W, 0)} W, MAE ${fmt(s.pow_mae_W, 0)}, RMSE ${fmt(s.pow_rmse_W, 0)}`;
    const cv = h('canvas', { width: 320, height: 180 }) as HTMLCanvasElement; const g = cv.getContext('2d')!;
    g.fillStyle = '#fff'; g.fillRect(0, 0, 320, 180); g.strokeStyle = '#ddd'; g.beginPath(); g.moveTo(20, 160); g.lineTo(300, 20); g.stroke();
    const caps = f.residuals.filter((r) => r.capMeas !== null);
    const lo = Math.min(...caps.map((r) => Math.min(r.capMeas!, r.capSim))), hi = Math.max(...caps.map((r) => Math.max(r.capMeas!, r.capSim)));
    for (const r of caps) { const x = 20 + ((r.capMeas! - lo) / (hi - lo + 1)) * 280, y = 160 - ((r.capSim - lo) / (hi - lo + 1)) * 140; g.fillStyle = r.set === 'cal' ? '#2f7fc1' : '#c4161c'; g.beginPath(); g.arc(x, y, 3.5, 0, 7); g.fill(); }
    g.fillStyle = '#5b5850'; g.font = '10px system-ui'; g.fillText('measured capacity → (blue cal, red val)', 120, 175); g.fillText('simulated ↑', 4, 12);
    res.append(h('div', { class: 'split' },
      h('div', { class: 'small' },
        h('div', {}, `Columns used: ${out.data.columns.join(', ')}`), out.data.unused.length ? h('div', { class: 'muted' }, `Unused: ${out.data.unused.join(', ')}`) : '',
        ...out.data.warnings.map((w) => h('div', { style: { color: '#8a5a12' } }, '⚠ ' + w)),
        h('div', {}, h('b', {}, 'Fitted scales: '), Object.entries(f.scales).map(([k, v]) => `${k} ×${v.toFixed(3)}`).join(', ')),
        h('div', {}, h('b', {}, 'Calibration: '), st(f.calibration)), h('div', {}, h('b', {}, 'Validation (held out): '), st(f.validation)),
        h('div', { class: 'muted' }, f.coverage), ...f.notes.map((n) => h('div', { class: 'muted' }, n)),
        h('button', { class: 'btn sm primary', style: { marginTop: '6px' }, onclick: async () => {
          const name = `Calibrated ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;
          const p = newExperiment(name, activeProfile(), 'calibrated');
          Object.assign(p.overrides, f.fitted); p.note = `Steady calibration. ${f.coverage}`;
          S.profiles.push(p); save(); await applyProfile(name);
          toast(`Created calibrated derivative "${name}"; the manufacturer reference is unchanged. Run Validation to check regression against the published table.`, 6000);
        } }, 'Create calibrated derivative profile')),
      cv));
  }

  // ---------------------------------------------------------------- diagnostics
  buildDiag() {
    const res = h('div');
    this.diagEl.append(
      h('div', { class: 'small muted' }, 'Training aid: a hidden simulated fault is injected; observe the unit, place probes, then compare candidate explanations. Not repair instructions for a real appliance. Charge faults are not offered (no refrigerant inventory model).'),
      h('div', { class: 'row wrap' },
        h('button', { class: 'btn sm primary', onclick: async () => {
          const pick = HIDDEN_FAULTS[Math.floor(Math.random() * HIDDEN_FAULTS.length)];
          loadScenario('pulldown', { run: true });
          await new Promise((r) => setTimeout(r, 400));
          await act({ type: 'remote', patch: { power: true, mode: 'cool', setpoint: 22, fan: 'Med' } }, true);
          await act({ type: 'faults', patch: pick.patch }, true);
          S.trainingFault = { id: pick.id, label: pick.label, revealed: false };
          bridge.speed(30);
          toast('Training exercise started (hidden fault, 30× speed). Let it run a few minutes, then Observe.');
        } }, 'Start training exercise'),
        h('button', { class: 'btn sm', onclick: async () => { const r = await bridge.diagnose() as { obs: { label: string; observed: number; expected: number; unit: string; z: number }[]; rank: { candidates: { label: string; score: number; consistent: string[]; inconsistent: string[] }[]; ambiguous: string | null; nextMeasurement: string } | null }; this.renderDiag(res, r); } }, 'Observe & rank explanations'),
        h('button', { class: 'btn sm', onclick: async () => { const p = await bridge.addProbe({ id: 'diagProbe', kind: 'airT', pos: [2.0, 2.2, 0.5], label: 'Independent probe near return' }); if (!p.ok) toast(p.error ?? ''); } }, 'Place independent return-air probe'),
        h('button', { class: 'btn sm', onclick: () => { if (S.trainingFault) { S.trainingFault.revealed = true; toast(`Hidden fault: ${S.trainingFault.label}`, 6000); notify(); } } }, 'Reveal'),
        h('button', { class: 'btn sm', onclick: async () => { S.trainingFault = null; await act({ type: 'faults', patch: { filterRestriction: 0, coilFouling: 0, outdoorFouling: 0, roomSensorBias: 0, coilSensorBias: 0 } }); } }, 'End exercise')),
      res);
  }
  renderDiag(res: HTMLElement, r: { obs: { label: string; observed: number; expected: number; unit: string; z: number }[]; rank: { candidates: { label: string; score: number; consistent: string[]; inconsistent: string[] }[]; ambiguous: string | null; nextMeasurement: string } | null }) {
    clear(res);
    if (!r.rank) { res.append(h('div', { class: 'small' }, 'Observation needs the unit running in COOL (compressor on).')); return; }
    res.append(h('div', { class: 'split' },
      h('table', { class: 'data' }, h('tr', {}, h('th', {}, 'Observation'), h('th', {}, 'observed'), h('th', {}, 'clean-unit model'), h('th', {}, 'z')),
        ...r.obs.map((o) => h('tr', {}, h('td', {}, o.label), h('td', {}, `${o.observed.toFixed(2)} ${o.unit}`), h('td', {}, `${o.expected.toFixed(2)} ${o.unit}`), h('td', { style: { color: Math.abs(o.z) > 1.5 ? '#c4161c' : '' } }, o.z.toFixed(1))))),
      h('div', {}, h('table', { class: 'data' }, h('tr', {}, h('th', {}, 'Candidate (simulated faults)'), h('th', {}, 'score'), h('th', {}, 'consistent with')),
        ...r.rank.candidates.map((c) => h('tr', {}, h('td', {}, c.label), h('td', {}, c.score.toFixed(1)), h('td', { class: 'small', style: { whiteSpace: 'normal' } }, c.consistent.join(', '))))),
        r.rank.ambiguous ? h('div', { class: 'exp-banner' }, 'Ambiguous: ' + r.rank.ambiguous) : '',
        h('div', { class: 'small' }, h('b', {}, 'Next measurement: '), r.rank.nextMeasurement),
        S.trainingFault?.revealed ? h('div', { class: 'small' }, h('b', {}, 'Revealed: '), S.trainingFault.label) : '')));
  }

  // ---------------------------------------------------------------- validation
  renderValidationIntro() {
    clear(this.validationEl).append(
      h('div', { class: 'small muted' }, 'Runs the current profile against the official MUZ-AP35VG data: rated points (S1/S3 p.6), the COOL performance table at rated frequency (S3 p.29-30; calibration rows vs held-out rows) and the S3 p.23 frequency-correction curves (digitised). Residuals come from the running model, not stored constants.'),
      h('button', { class: 'btn sm primary', onclick: async () => {
        this.validationEl.dataset.done = '1';
        const p = { ...mitsubishi_ap35_reference, ...(activeProfile()?.overrides ?? {}) };
        const r = await bridge.job({ type: 'validation', profile: p }) as { summary: Record<string, Record<string, number>>; rows: { set: string; Q: number; Qm: number; P: number; Pm: number }[]; freq: { curve: string; set: string; hz: number; published: number; model: number }[] };
        this.renderValidation(r);
      } }, `Run validation for ${activeProfile()?.name ?? REFERENCE_NAME}`));
  }
  renderValidation(r: { summary: Record<string, Record<string, number>>; rows: { set: string; Q: number; Qm: number; P: number; Pm: number }[]; freq: { curve: string; set: string; hz: number; published: number; model: number }[] }) {
    const s = r.summary;
    const rc = s.rated_cooling, rh = s.rated_heating;
    const stat = (x: Record<string, number>) => `n=${x.n} · capacity bias ${x.capacity_bias_pct.toFixed(1)} %, RMSE ${x.capacity_rmse_pct.toFixed(1)} %, max ${x.capacity_max_abs_pct.toFixed(1)} % · input bias ${x.input_bias_pct.toFixed(1)} %, RMSE ${x.input_rmse_pct.toFixed(1)} %, max ${x.input_max_abs_pct.toFixed(1)} %`;
    const scat = (key: 'Q' | 'P') => {
      const cv = h('canvas', { width: 230, height: 190 }) as HTMLCanvasElement; const g = cv.getContext('2d')!;
      const pts = r.rows.filter((x) => x.set !== 'dry-row');
      const a = pts.map((x) => key === 'Q' ? x.Q : x.P / 1000), b = pts.map((x) => key === 'Q' ? x.Qm : x.Pm / 1000);
      const lo = Math.min(...a, ...b), hi = Math.max(...a, ...b);
      g.fillStyle = '#fff'; g.fillRect(0, 0, 230, 190); g.strokeStyle = '#bbb'; g.beginPath(); g.moveTo(20, 170); g.lineTo(220, 10); g.stroke();
      pts.forEach((x, i) => { g.fillStyle = x.set === 'calibration' ? '#2f7fc1' : '#c4161c'; g.fillRect(20 + ((a[i] - lo) / (hi - lo)) * 200 - 1.5, 170 - ((b[i] - lo) / (hi - lo)) * 160 - 1.5, 3, 3); });
      g.fillStyle = '#5b5850'; g.font = '10px system-ui'; g.fillText(`${key === 'Q' ? 'capacity' : 'input'} kW: published → / model ↑`, 22, 186);
      return cv;
    };
    const fq = (curve: string) => r.freq.filter((x) => x.curve === curve).map((x) => `${x.hz}:${x.published.toFixed(2)}/${x.model.toFixed(2)}${x.set === 'validation' ? '*' : ''}`).join('  ');
    clear(this.validationEl).append(h('div', { class: 'split' },
      h('div', { class: 'small' },
        h('div', {}, h('b', {}, 'Rated cooling (27/19, 35/24, rated Hz, fan MAX): '), `${rc.cap_kW.toFixed(3)} kW (${rc.cap_err_pct.toFixed(1)} %) · ${rc.input_kW.toFixed(3)} kW (${rc.input_err_pct.toFixed(1)} %) · COP ${rc.cop.toFixed(2)} vs 3.54 · SHF ${rc.shf.toFixed(2)} vs 0.88 · dehum ${rc.dehum_L_h.toFixed(2)} vs 0.6 L/h`),
        h('div', {}, h('b', {}, 'Rated heating (20, 7/6): '), `${rh.cap_kW.toFixed(3)} kW (${rh.cap_err_pct.toFixed(1)} %) · ${rh.input_kW.toFixed(3)} kW (${rh.input_err_pct.toFixed(1)} %) · COP ${rh.cop.toFixed(2)} vs 3.88`),
        h('div', {}, h('b', {}, 'Table, calibration rows: '), stat(s.table_calibration)),
        h('div', {}, h('b', {}, 'Table, held-out rows: '), stat(s.table_validation_heldout)),
        h('div', {}, h('b', {}, 'Table, dry rows (SHF 1.0, formulaic in the source): '), stat(s.table_dry_rows)),
        h('div', { class: 'mono', style: { fontSize: '10px', marginTop: '4px' } }, 'cool cap Hz:pub/model ', fq('cool_cap')), h('div', { class: 'mono', style: { fontSize: '10px' } }, 'cool in  ', fq('cool_in')),
        h('div', { class: 'mono', style: { fontSize: '10px' } }, 'heat cap ', fq('heat_cap')), h('div', { class: 'mono', style: { fontSize: '10px' } }, 'heat in  ', fq('heat_in'), ' (* held out)'),
        h('div', { class: 'muted' }, 'D6: SHF 0.88 at 684 m³/h and 3.5 kW implies leaving air above saturation; the physical coil model saturates near 0.85. Calibration agreement is not experimental proof.')),
      h('div', { class: 'row' }, scat('Q'), scat('P'))));
  }

  // ---------------------------------------------------------------- assumptions
  renderAssumptions() {
    const wrap = document.getElementById('assumpWrap'); if (!wrap) return;
    clear(wrap);
    const filter = h('select', {}, ...['all', 'sourced', 'digitised', 'calibrated', 'assumed', 'supplied'].map((x) => h('option', { value: x }, x))) as HTMLSelectElement;
    const tbody = h('tbody');
    const fill = () => { clear(tbody); for (const d of PARAM_DEFS) if (filter.value === 'all' || d.status === filter.value) tbody.append(h('tr', {}, h('td', {}, d.label), h('td', {}, `${fmtv(d.value)} ${d.unit}`), h('td', {}, h('span', { class: `badge ${d.status}` }, d.status)), h('td', { class: 'small', style: { whiteSpace: 'normal' } }, d.origin), h('td', {}, `${fmtv(d.range[0])}–${fmtv(d.range[1])}`), h('td', { class: 'small', style: { whiteSpace: 'normal' } }, d.note))); };
    filter.onchange = fill; fill();
    wrap.append(
      h('div', { class: 'row' }, h('b', {}, 'Parameter registry'), filter, h('span', { class: 'small muted' }, `calibration ${String(CALIBRATION_META._generated ?? '')}`), h('span', { class: 'spacer' }), h('button', { class: 'btn sm', onclick: () => this.featureMatrix() }, 'Original vs experimental feature matrix')),
      h('table', { class: 'data assump-table' }, h('thead', {}, h('tr', {}, h('th', {}, 'Parameter'), h('th', {}, 'Value'), h('th', {}, 'Status'), h('th', {}, 'Origin'), h('th', {}, 'Valid range'), h('th', {}, 'Explanation'))), tbody),
      h('h4', {}, 'Sources'), h('ul', { class: 'small' }, ...Object.values(SOURCES).map((s) => h('li', {}, h('b', {}, s.id), ` (${s.kind}) ${s.title} — ${s.docNo}, ${s.revision}. ${s.covers}`))),
      h('h4', {}, 'Discrepancies'), h('ul', { class: 'small' }, ...DISCREPANCIES.map((d) => h('li', {}, h('b', {}, `${d.id} ${d.field}: `), d.detail)),
        h('li', {}, h('b', {}, 'D6 SHF at rating: '), 'SHF 0.88 with 3.5 kW at 684 m³/h implies leaving air above saturation (≈102 % RH). The model keeps physics and reports ≈0.85.')));
  }
  featureMatrix() {
    modal('Original product operation vs engineering experiment', h('table', { class: 'data' }, h('tr', {}, h('th', {}, 'Function'), h('th', {}, 'AP35 original?'), h('th', {}, 'Source'), h('th', {}, 'In this app')),
      ...FEATURE_MATRIX.map((f) => h('tr', {}, h('td', {}, f.fn), h('td', {}, f.original), h('td', { class: 'small' }, f.source), h('td', { class: 'small', style: { whiteSpace: 'normal' } }, f.app)))), { wide: true });
  }

  // ---------------------------------------------------------------- export
  exportMenu() {
    const v = S.view; if (!v) return;
    const close = modal('Export', h('div', { class: 'row wrap' },
      h('button', { class: 'btn', onclick: () => download('ap35-settings.json', settingsJSON(v.s, { scenario: currentScenario })) }, 'Settings / scenario JSON'),
      h('button', { class: 'btn', onclick: () => download('ap35-timeseries.csv', historyCSV(S.hist, S.startTime)) }, 'Time series CSV (with units)'),
      h('button', { class: 'btn', onclick: () => download(`ap35-${scene.mode}.png`, dataUrlToBlob(scene.screenshot())) }, 'Screenshot PNG'),
      h('button', { class: 'btn', onclick: () => this.screenshotPresets() }, 'Screenshot presets'),
      h('button', { class: 'btn', onclick: () => this.report() }, 'HTML experiment report'),
      h('button', { class: 'btn', onclick: async () => { try { const t = await readFile('.json'); const st = parseSettings(t); for (const w of st.warnings) toast(w); if (st.remote) await act({ type: 'remote', patch: st.remote as never }); if (st.env) await act({ type: 'env', patch: st.env as never }); if (st.faults) await act({ type: 'faults', patch: st.faults as never }); if (st.overrides) await act({ type: 'override', patch: st.overrides as never }); if (st.profileOverrides && Object.keys(st.profileOverrides).length) { const p = newExperiment(`Imported ${new Date().toISOString().slice(11, 19)}`); p.overrides = st.profileOverrides as Partial<ProfileValues>; S.profiles.push(p); await applyProfile(p.name); } toast('Settings imported and validated.'); close(); } catch (e) { toast('Import rejected: ' + (e instanceof Error ? e.message : String(e)), 6000); } } }, 'Import settings JSON'),
    ));
  }
  screenshotPresets() {
    const prev = scene.mode;
    const shots: [string, () => void][] = [['System', () => scene.setMode('system', true)], ['Section', () => scene.setMode('cutaway', true)], ['Airflow', () => scene.setMode('airflow', true)], ['Refrigeration cycle', () => scene.setMode('cycle', true)]];
    let i = 0;
    const next = () => {
      if (i >= shots.length) { scene.setMode(prev, true); return; }
      const [name, set] = shots[i++]; set();
      setTimeout(() => { download(`ap35-${name.toLowerCase().replace(/ /g, '-')}.png`, dataUrlToBlob(scene.screenshot())); next(); }, 900);
    };
    next();
    if (this.lastCompare) toast('A/B comparison: use "Export experiment story" in the A/B tab for its views.');
  }
  report() {
    const v = S.view; if (!v) return;
    const imgs = [{ caption: `3D view (${scene.mode})`, dataUrl: scene.screenshot() }];
    for (const k of ['temp', 'act', 'pow']) { const c = this.charts[k]; c.draw(S.hist, 't', S.startTime); try { imgs.push({ caption: c.title, dataUrl: c.canvas.toDataURL('image/png') }); } catch { /* not rendered */ } }
    const ch = changedParams(activeProfile()).map((c) => ({ label: c.def.label, ref: `${c.ref} ${c.def.unit}`, value: `${c.value} ${c.def.unit}`, status: c.def.editable === 'geometry' ? 'visual-only' : c.def.status }));
    const m = v.s.metrics;
    const sum: RunSummary = { label: 'live run', duration_s: v.s.t - S.startTime, reachedTarget: m.pulldownTime !== null, timeToTarget_s: m.pulldownTime, energy_kWh: v.s.plant.E_total, energyToService_kWh: m.energyToService, avgUsefulCapacity_W: (v.s.plant.Q_net * 3.6e6) / Math.max(1, v.s.t - S.startTime), peakInput_W: m.peakInput, condensate_L: v.s.plant.condensateL + v.s.plant.film, occupiedMean_C: m.zoneN ? m.zoneSum / m.zoneN : null, occupiedStd_K: m.zoneN ? m.uniformitySum / m.zoneN : null, draftFraction: m.zoneN ? m.draftSum / m.zoneN : null, inBandFraction: m.inBandTime / Math.max(1, v.s.t - S.startTime), overshoot_K: m.overshoot, compressorStarts: m.compStarts, faults: [], protections: 0, finalRoom_C: v.s.plant.Troom, finalRH_pct: (v.out?.RHroom ?? 0) * 100, serviceNote: '' };
    const sums = [sum, ...(this.lastCompare?.results.map((r) => r.summary) ?? [])];
    const html = htmlReport({ title: 'AP35 Live Inverter Bench Study — experiment report', state: v.s, summaries: sums, images: imgs, changed: ch, notes: [`Scenario: ${SCENARIO_BY_ID[currentScenario]?.title ?? currentScenario}`, `Simulated duration ${((v.s.t - S.startTime) / 60).toFixed(1)} min`], probes: v.s.probes.map((p) => ({ label: p.def.label, ideal: fmt(p.ideal, 2), virt: fmt(p.virt, 2) })) });
    download('ap35-report.html', html, 'text/html');
  }
}
const fmtv = (v: number) => (Math.abs(v) > 0 && (Math.abs(v) < 1e-3 || Math.abs(v) >= 1e5) ? v.toExponential(2) : String(+v.toFixed(4)));

function tabs2Story(c: NonNullable<BottomTabs['lastCompare']>) {
  const v = S.view!;
  const imgs: { caption: string; dataUrl: string }[] = [];
  scene.setMode('airflow', true);
  imgs.push({ caption: 'Current 3D airflow view', dataUrl: scene.screenshot() });
  document.querySelectorAll('#bottom canvas').forEach((cv, i) => { try { if ((cv as HTMLCanvasElement).width > 50) imgs.push({ caption: `Comparison plot ${i + 1}`, dataUrl: (cv as HTMLCanvasElement).toDataURL() }); } catch { /* */ } });
  const html = htmlReport({ title: `Experiment story: ${c.labels.join(' vs ')}`, state: v.s, summaries: c.results.map((r) => r.summary), images: imgs, changed: changedParams(activeProfile()).map((x) => ({ label: x.def.label, ref: String(x.ref), value: String(x.value), status: x.def.status })), notes: ['Matched A/B runs from the identical initial state and schedule.', 'Before/after views: A and B plan slices share frozen colour limits.'] });
  download('ap35-experiment-story.html', html, 'text/html');
}

void HISTORY_CHANNELS; void ({} as Channel); void save; void SCENARIOS;

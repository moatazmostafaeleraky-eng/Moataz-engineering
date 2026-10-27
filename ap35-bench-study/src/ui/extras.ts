/** Tours, command assistant, inspectors, timers, sound, design handles, recording. */
import * as THREE from 'three';
import { h, clear, toast, modal, fmt, fmtTime, download } from './dom';
import { S, notify } from './state';
import { bridge, scene, act, setView, setProfileParam, loadScenario, tabs, setWorkspace } from './app';
import { PARTS } from '../scene/kit';
import { TOUR, FOLLOW_AIR, FOLLOW_REF, FOLLOW_CTRL, NARRATION_AR } from './i18n';
import { parseCommand, EXAMPLES, type AssistantAction } from '../sim/assistant';
import type { Explanation } from '../sim/explain';
import type { Action } from '../sim/schema';
import type { RunSummary } from '../sim/runner';
import { LineChart } from './charts';
import { mitsubishi_ap35_reference } from '../config/profiles';
import type { ProfileValues } from '../config/registry';
import { IND } from '../scene/indoorUnit';
import { ZONE_PRESETS } from '../model/airfield';

export class Extras {
  stage: HTMLElement;
  tourEl = h('div', { class: 'tour hidden', role: 'dialog', 'aria-label': 'Guided tour' });
  inspEl = h('div', { class: 'inspector hidden', role: 'complementary' });
  labelsEl = h('div', { class: 'labels' });
  paletteEl: HTMLElement | null = null;
  history: { text: string; undo?: Action }[] = [];
  private tour: { kind: string; i: number; steps: { part: string; title?: string; text: string; textAr: string; mode?: string }[]; paused: boolean } | null = null;
  private ghostLine: THREE.Line | null = null;
  private audio: { ctx: AudioContext; fan: GainNode; fanF: BiquadFilterNode; bp: OscillatorNode; bpG: GainNode; hum: OscillatorNode; humG: GainNode; ofan: GainNode; master: GainNode } | null = null;
  handlesOn = false;
  private handles = new THREE.Group();
  private baselineGhost: THREE.Object3D | null = null;
  private dragging: { kind: string; y0: number; v0: number } | null = null;
  private staleUntil = 0;

  constructor(stage: HTMLElement) {
    this.stage = stage;
    stage.append(this.labelsEl, this.tourEl, this.inspEl);
    scene.onSelect = (id) => this.inspectPart(id);
    scene.root.add(this.handles);
    this.setupHandles();
  }

  frame() {
    this.updateLabels();
    this.updateAudio();
    this.updateHandles();
    if (this.inspPart && performance.now() - this.lastInsp > 500) { this.inspectPart(this.inspPart, true); }
  }

  // ------------------------------------------------------------------ exploded labels with leaders and overlap handling
  private lastLabels = 0;
  updateLabels() {
    if (!scene.show.labels) { if (this.labelsEl.childElementCount) clear(this.labelsEl); return; }
    const now = performance.now(); if (now - this.lastLabels < 120) return; this.lastLabels = now;
    const anchors = scene.labelAnchors().filter((a) => a.visible);
    const r = this.stage.getBoundingClientRect();
    // two columns (left/right of centre), stacked to avoid overlap
    const leftCol = anchors.filter((a) => a.x < r.width / 2).sort((a, b) => a.y - b.y);
    const rightCol = anchors.filter((a) => a.x >= r.width / 2).sort((a, b) => a.y - b.y);
    clear(this.labelsEl);
    if (r.width < 700) {
      // narrow stage: numbered tap targets instead of a wall of labels; names in the inspector
      anchors.forEach((a, i) => this.labelsEl.append(h('button', { class: 'lbldot', title: `${a.name} (${a.fidelity})`, 'aria-label': a.name, style: { left: `${a.x - 9}px`, top: `${a.y - 9}px` }, onclick: () => { scene.select(a.id); this.inspectPart(a.id); } }, String(i + 1))));
      return;
    }
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.labelsEl.append(svg);
    const place = (col: typeof anchors, x: number, align: 'left' | 'right') => {
      let y = 70;
      const step = Math.max(17, Math.min(26, (r.height - 90) / Math.max(1, col.length)));
      for (const a of col) {
        y = Math.max(y, Math.min(a.y, r.height - 20));
        const lbl = h('div', { class: 'lbl', style: { top: `${y - 9}px`, [align]: `${x}px` }, onclick: () => { scene.select(a.id); this.inspectPart(a.id); } }, a.name.length > 46 ? a.name.slice(0, 44) + '…' : a.name, h('span', { class: 'f' }, a.fidelity));
        this.labelsEl.append(lbl);
        const lx = align === 'left' ? x + 170 : r.width - x - 170;
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        line.setAttribute('d', `M${lx},${y} L${a.x},${a.y}`); line.setAttribute('stroke', '#c4161c'); line.setAttribute('stroke-width', '1'); line.setAttribute('fill', 'none');
        const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        dot.setAttribute('cx', String(a.x)); dot.setAttribute('cy', String(a.y)); dot.setAttribute('r', '2.5'); dot.setAttribute('fill', '#c4161c');
        svg.append(line, dot);
        y += step;
      }
    };
    place(leftCol, 10, 'left'); place(rightCol, 10, 'right');
  }

  // ------------------------------------------------------------------ component inspector
  private inspPart: string | null = null; private lastInsp = 0;
  inspectPart(id: string | null, refresh = false) {
    this.inspPart = id; this.lastInsp = performance.now();
    if (!id) { this.inspEl.classList.add('hidden'); return; }
    const p = PARTS.get(id); if (!p) return;
    const info = p.info; const o = S.view?.out; const st = scene.pipeStates()[id.replace('pipe.', '')];
    const live: string[] = [];
    if (o) {
      if (id === 'out.compressor') live.push(`Frequency ${o.fAct.toFixed(1)} Hz (${o.rpmComp.toFixed(0)} rpm, elec ${o.fElec.toFixed(0)} Hz) · input ${o.Pcomp.toFixed(0)} W`, `Mass flow ${(o.m * 1000).toFixed(2)} g/s · discharge ${o.T2.toFixed(1)} °C · PR ${(o.Pc / o.Pe).toFixed(2)}`);
      if (id === 'in.fan' || id === 'in.fanMotor') live.push(`${o.ifanAct.toFixed(0)} rpm · ${o.qIn.toFixed(0)} m³/h · Δp ${o.dpIn.toFixed(0)} Pa · ${o.Pifan.toFixed(1)} W`);
      if (id === 'out.fan' || id === 'out.fanMotor') live.push(`${o.ofanAct.toFixed(0)} rpm · ${o.qOut.toFixed(0)} m³/h · ${o.Pofan.toFixed(1)} W`);
      if (id === 'in.coil') live.push(`Surface ${o.coilInSurface.toFixed(1)} °C · ${o.evapIsIndoor ? 'evaporating' : 'condensing'} at ${(o.evapIsIndoor ? o.Te : o.Tc).toFixed(1)} °C · condensate ${o.condRate.toFixed(2)} L/h`);
      if (id === 'out.coil') live.push(`Surface ${o.coilOutSurface.toFixed(1)} °C · ${o.evapIsIndoor ? 'condensing' : 'evaporating'} at ${(o.evapIsIndoor ? o.Tc : o.Te).toFixed(1)} °C · frost ${o.frost.toFixed(3)} kg`);
      if (id === 'out.lev') live.push(`Opening ${(o.eevAct * 100).toFixed(0)} % (cmd ${(o.eevCmd * 100).toFixed(0)} %) · LEV flow ${(o.mEev * 1000).toFixed(2)} g/s · SH ${o.SHevap.toFixed(1)} K`);
      if (id.startsWith('in.vane')) live.push(`Upper ${o.vaneUpper.toFixed(0)}° (cmd ${o.vaneUpperCmd.toFixed(0)}°) · lower ${o.vaneLower.toFixed(0)}° · wide ${o.wideAct.toFixed(0)}° · outlet ${(o.outletArea * 1e4).toFixed(0)} cm²`);
      if (id === 'out.fourWay') live.push(S.view!.s.plant.rv > 0.5 ? 'HEAT position (R.V. coil energised)' : 'COOL position');
      if (id === 'out.inverter') live.push(`Heat sink ${S.view!.s.plant.Tfin.toFixed(1)} °C · est. current ${o.current.toFixed(2)} A`);
      if (id.startsWith('in.filter')) live.push(`Filter resistance share ${o.resIn.filter.toFixed(2)} (restriction ${S.view!.s.faults.filterRestriction.toFixed(1)})`);
      if (st) live.push(`${st.phase} · ${st.T.toFixed(1)} °C · ${(st.P / 1e5).toFixed(2)} bar(a) · flow ${st.dir}`, 'Pipe markers are schematic, not fluid velocity.');
    }
    clear(this.inspEl).append(
      h('button', { class: 'btn sm', style: { float: 'right' }, onclick: () => { scene.select(null); this.inspectPart(null); } }, '✕'),
      h('h4', {}, info.name), h('span', { class: `badge ${info.fidelity}` }, info.fidelity), ' ', h('span', { class: 'small muted' }, info.source),
      h('p', {}, info.fn), ...live.map((l) => h('div', { class: 'mono small' }, l)),
      info.links.length ? h('div', { class: 'small', style: { marginTop: '6px' } }, h('b', {}, 'Linked: '), info.links.join(' · ')) : '',
      h('div', { class: 'row wrap', style: { marginTop: '6px' } }, h('button', { class: 'btn sm', onclick: () => scene.focusPart(id) }, 'Focus camera'),
        id === 'out.compressor' ? h('button', { class: 'btn sm', onclick: () => this.compressorExplainer() }, 'Conceptual rotary explainer') : ''));
    this.inspEl.classList.remove('hidden');
    if (!refresh) this.inspEl.scrollTop = 0;
  }
  compressorExplainer() {
    const c = h('canvas', { width: 420, height: 300 }) as HTMLCanvasElement;
    let a = 0; let raf = 0;
    const draw = () => {
      const g = c.getContext('2d')!; g.clearRect(0, 0, 420, 300);
      const f = S.view?.out?.fAct ?? 0; a += Math.min(0.25, (f / 60) * 0.25) ;
      const cx = 210, cy = 150, R = 110, r = 70, e = R - r;
      g.fillStyle = '#ece7dd'; g.beginPath(); g.arc(cx, cy, R + 14, 0, 7); g.fill();
      g.fillStyle = '#fff'; g.beginPath(); g.arc(cx, cy, R, 0, 7); g.fill(); g.strokeStyle = '#23221f'; g.lineWidth = 2; g.stroke();
      const rx = cx + Math.cos(a) * e, ry = cy + Math.sin(a) * e;
      g.fillStyle = '#b87333'; g.beginPath(); g.arc(rx, ry, r, 0, 7); g.fill();
      g.fillStyle = '#2d2c2a'; g.beginPath(); g.arc(cx, cy, 10, 0, 7); g.fill();
      const vy = cy - R; const tip = Math.max(vy, ry - Math.sqrt(Math.max(0, r * r - (cx - rx) ** 2)));
      g.fillStyle = '#5b5850'; g.fillRect(cx - 6, vy - 40, 12, tip - vy + 40);
      g.fillStyle = '#2f7fc1'; g.fillText('suction', cx - 100, vy + 4); g.fillStyle = '#c4161c'; g.fillText('discharge', cx + 40, vy + 4);
      g.fillStyle = '#23221f'; g.font = '11px system-ui'; g.fillText(`CONCEPTUAL rolling-piston explainer · ${f.toFixed(0)} Hz (visual speed limited)`, 10, 290);
      raf = requestAnimationFrame(draw);
    };
    draw();
    modal('Conceptual rotary (rolling-piston) mechanism', h('div', {}, c, h('p', { class: 'small muted' }, 'Not a reconstruction of the KVB073FYXMC: its internal dimensions and mechanism are not published in S3/S5. The shell, side accumulator and 3 rubber mounts in the 3D model follow S3 p.18 and S5. Mitsubishi residential K/S series compressors are rotary per secondary source X2.')), { onClose: () => cancelAnimationFrame(raf) });
  }

  // ------------------------------------------------------------------ why inspector + counterfactual
  async explain(quantity: string) {
    const ex = await bridge.explain(quantity) as Explanation;
    const res = h('div');
    const body = h('div', {},
      h('div', { class: 'eq' }, ex.equation), h('div', { class: 'small' }, ex.rule),
      h('h4', {}, 'Recorded causes'), h('ul', { class: 'small' }, ...ex.causes.map((c) => h('li', {}, c))),
      h('div', { class: 'small muted' }, ex.separable),
      h('h4', {}, 'Recent inputs (test one at a time)'),
      ex.recentInputs.length ? h('table', { class: 'data' }, ...ex.recentInputs.map((r) => h('tr', {}, h('td', {}, `${((r.t - S.startTime) / 60).toFixed(1)} min`), h('td', { style: { whiteSpace: 'normal' } }, r.summary), h('td', {}, h('button', { class: 'btn sm', onclick: () => this.testExplanation(r, res) }, 'Test this explanation'))))) : h('div', { class: 'small' }, 'No inputs changed in the last 15 simulated minutes.'),
      h('div', { class: 'small', style: { marginTop: '4px' } }, 'Related components: ', ...ex.related.map((r) => h('button', { class: 'btn sm', onclick: () => { const id = [...PARTS.keys()].find((k) => PARTS.get(k)!.info.name.toLowerCase().includes(r.split(' ')[0].toLowerCase())); if (id) { scene.select(id); scene.focusPart(id); } } }, r))),
      res);
    modal(`Why did "${ex.title}" change?`, body, { wide: true });
  }
  async testExplanation(r: { t: number; action: Action }, res: HTMLElement) {
    // find the index of this input in the live log
    const run = await bridge.getRun() as { run: { inputs: { t: number; action: Action }[] } };
    const idx = run.run.inputs.findIndex((x) => x.t === r.t && JSON.stringify(x.action) === JSON.stringify(r.action));
    if (idx < 0) { toast('Input not found in the log'); return; }
    const cf = await bridge.cfInputs(idx) as { snapshot: unknown; intervention: Action; later: { t: number; action: Action }[]; horizon: number };
    clear(res).append(h('div', { class: 'small' }, 'Running matched counterfactual…'));
    const out = await bridge.job({ type: 'counterfactual', snapshot: cf.snapshot, intervention: cf.intervention, later: cf.later, horizon: Math.min(3600, cf.horizon) }) as { base: { summary: RunSummary; history: Record<string, number[]> }; test: { summary: RunSummary; history: Record<string, number[]> }; matched: boolean; note: string };
    const ch = new LineChart('Matched counterfactual (same snapshot, same other inputs)', [{ key: 'b', label: 'unchanged', color: '#23221f', unit: 'Hz' }, { key: 'x', label: 'with this input only', color: '#c4161c', unit: 'Hz' }, { key: 'bq', label: 'unchanged Qnet', color: '#8a857a', unit: 'W', axis: 'R', dash: [4, 3] }, { key: 'xq', label: 'with input Qnet', color: '#2f7fc1', unit: 'W', axis: 'R', dash: [4, 3] }]);
    ch.el.style.height = '180px';
    clear(res).append(h('div', { class: 'small' }, out.matched ? 'MATCHED: ' + out.note : 'UNMATCHED comparison: conditions or model version differ.'),
      h('table', { class: 'data' }, h('tr', {}, h('th', {}, ''), h('th', {}, 'unchanged'), h('th', {}, 'with input')),
        h('tr', {}, h('td', {}, 'final room'), h('td', {}, out.base.summary.finalRoom_C.toFixed(2)), h('td', {}, out.test.summary.finalRoom_C.toFixed(2))),
        h('tr', {}, h('td', {}, 'energy kWh'), h('td', {}, out.base.summary.energy_kWh.toFixed(3)), h('td', {}, out.test.summary.energy_kWh.toFixed(3))),
        h('tr', {}, h('td', {}, 'avg useful W'), h('td', {}, out.base.summary.avgUsefulCapacity_W.toFixed(0)), h('td', {}, out.test.summary.avgUsefulCapacity_W.toFixed(0)))), ch.el);
    requestAnimationFrame(() => ch.draw({ t: out.base.history.t, b: out.base.history.fAct, x: out.test.history.fAct, bq: out.base.history.Qnet, xq: out.test.history.Qnet }, 't', out.base.history.t[0]));
  }

  // ------------------------------------------------------------------ tours
  startTour(kind: 'guided' | 'air' | 'ref' | 'ctrl') {
    const steps = kind === 'guided' ? TOUR : kind === 'air' ? FOLLOW_AIR : kind === 'ref' ? FOLLOW_REF : FOLLOW_CTRL;
    this.tour = { kind, i: 0, steps: steps as never, paused: false };
    if (kind === 'guided' && S.view && !S.view.s.remote.power) {
      toast('Tour uses a labelled demonstration: the pull-down scenario is started (state is not edited to fit the story).');
      void act({ type: 'remote', patch: { power: true, mode: 'cool', setpoint: 24 } });
    }
    this.showStep();
  }
  showStep() {
    const t = this.tour; if (!t) { this.tourEl.classList.add('hidden'); return; }
    const s = t.steps[t.i];
    if (s.mode) setView(s.mode as never);
    scene.select(s.part); if (!S.reducedMotion) setTimeout(() => scene.focusPart(s.part), s.mode ? 1250 : 0); else scene.focusPart(s.part);
    const o = S.view?.out;
    const state = o ? `Live: room ${S.view!.s.plant.Troom.toFixed(1)} °C · ${o.fAct.toFixed(0)} Hz · Qnet ${(o.Qnet / 1000).toFixed(2)} kW · Te ${o.Te.toFixed(1)} °C · Tc ${o.Tc.toFixed(1)} °C · ${o.Ptotal.toFixed(0)} W` : '';
    const title = (s as { title?: string }).title ?? `${t.kind === 'air' ? 'Follow room air' : t.kind === 'ref' ? 'Follow refrigerant' : t.kind === 'ctrl' ? 'Follow control command' : ''} · ${t.i + 1}/${t.steps.length}`;
    clear(this.tourEl).append(
      h('h4', {}, title), h('div', {}, s.text), h('div', { class: 't-ar', lang: 'ar' }, s.textAr), h('div', { class: 'mono small muted', style: { marginTop: '4px' } }, state),
      h('div', { class: 'row', style: { marginTop: '6px' } },
        h('button', { class: 'btn sm', disabled: t.i === 0, onclick: () => { t.i--; this.showStep(); } }, '◀ Back'),
        h('button', { class: 'btn sm', onclick: () => { t.paused = !t.paused; bridge.run(!t.paused); } }, t.paused ? 'Resume sim' : 'Pause sim'),
        h('label', { class: 'small' }, h('input', { type: 'checkbox', checked: S.reducedMotion, onchange: (e: Event) => { S.reducedMotion = (e.target as HTMLInputElement).checked; scene.reducedMotion = S.reducedMotion; } }), ' reduced motion'),
        h('span', { class: 'spacer' }),
        h('button', { class: 'btn sm', onclick: () => this.endTour() }, 'Skip'),
        h('button', { class: 'btn sm primary', onclick: () => { if (t.i < t.steps.length - 1) { t.i++; this.showStep(); } else this.endTour(); } }, t.i < t.steps.length - 1 ? 'Next ▶' : 'Finish')));
    this.tourEl.classList.remove('hidden');
  }
  endTour() { this.tour = null; this.tourEl.classList.add('hidden'); scene.select(null); bridge.run(true); }

  // ------------------------------------------------------------------ command palette
  openPalette() {
    if (this.paletteEl) { this.paletteEl.remove(); this.paletteEl = null; return; }
    const msg = h('div', { class: 'msg' }, 'Limited offline command parser (not a language model). All actions are validated like normal controls.');
    const inp = h('input', { type: 'text', placeholder: 'Type a command…', 'aria-label': 'Command' }) as HTMLInputElement;
    const close = () => { this.paletteEl?.remove(); this.paletteEl = null; };
    const run = async (text: string) => {
      const r = parseCommand(text);
      msg.textContent = r.message;
      if (!r.ok) return;
      this.history.push({ text });
      for (const a of r.actions) await this.runAssistant(a);
    };
    inp.onkeydown = (e) => { if (e.key === 'Enter') void run(inp.value); if (e.key === 'Escape') close(); };
    this.paletteEl = h('div', { class: 'palette', role: 'dialog', 'aria-label': 'Command assistant' }, inp,
      h('div', { class: 'ex' }, ...EXAMPLES.map((x) => h('div', { onclick: () => { inp.value = x; void run(x); } }, '› ' + x)),
        this.history.length ? h('div', { class: 'muted' }, 'History: ' + this.history.slice(-4).map((x) => x.text).join(' · ')) : '',
        h('div', {}, h('button', { class: 'btn sm', onclick: () => this.undoLast() }, 'Undo last parameter change'))), msg);
    document.body.append(this.paletteEl);
    inp.focus();
  }
  private undoStack: Action[] = [];
  async undoLast() { const a = this.undoStack.pop(); if (a) { await act(a); toast('Reverted'); } else toast('Nothing to undo'); }
  async runAssistant(a: AssistantAction) {
    switch (a.kind) {
      case 'selectComponent': {
        const id = [...PARTS.keys()].find((k) => PARTS.get(k)!.info.name.toLowerCase().includes(a.id));
        if (id) { scene.select(id); scene.focusPart(id); this.inspectPart(id); } else toast('No such component'); break;
      }
      case 'setScenarioParameter': {
        const v = S.view!;
        const prev: Action | null = a.action.type === 'remote' ? { type: 'remote', patch: Object.fromEntries(Object.keys(a.action.patch).map((k) => [k, (v.s.remote as unknown as Record<string, unknown>)[k]])) } : a.action.type === 'env' ? { type: 'env', patch: Object.fromEntries(Object.keys(a.action.patch).map((k) => [k, (v.s.env as unknown as Record<string, unknown>)[k]])) } : null;
        if (await act(a.action) && prev) this.undoStack.push(prev);
        break;
      }
      case 'placeProbe': {
        const P: Record<string, [number, number, number]> = { desk: [0.85, 1.1, 2.9], bed: [3.0, 0.75, 2.6], return: [2.0, 2.3, 0.6], occupied: [2.0, 1.1, 2.0] };
        const r = await bridge.addProbe({ id: 'pa' + Date.now().toString(36), kind: a.probe, pos: P[a.preset], label: `${a.probe === 'airV' ? 'v' : 'T'} @ ${a.preset}` });
        if (!r.ok) toast(r.error ?? ''); else { if (S.workspace === 'explore') setWorkspace('engineer'); tabs.open('probes'); }
        break;
      }
      case 'runComparison': {
        if (S.workspace !== 'lab') setWorkspace('lab'); tabs.open('compare');
        const sc = { schedule: [{ at: 0, action: { type: 'remote', patch: { power: true, mode: 'cool', setpoint: 24 } } }] };
        const out = await bridge.job({ type: 'customAB', init: { room: { T: 30, RH: 55 }, env: { outdoorT: 35, outdoorRH: 40 }, profile: S.view!.s.profile }, schedule: sc.schedule, duration: 3600, a: a.a.map((x) => ({ at: 0, action: x })), b: a.b.map((x) => ({ at: 0, action: x })), labels: a.labels });
        tabs.lastCompare = { results: out as never, labels: a.labels };
        const target = tabs.compareEl.lastElementChild as HTMLElement; tabs.renderCompare(target);
        break;
      }
      case 'runSweep': {
        if (S.workspace !== 'lab') setWorkspace('lab'); tabs.open('sweep');
        toast(`Running a 16-run sweep (vane angle × fan step) for the ${ZONE_PRESETS[a.zone].name} zone…`);
        const spec = { vars: [{ id: 'vane', lo: 5, hi: 70 }, { id: 'ifan', lo: 0, hi: 4 }], n: 16, seed: 1, base: { init: { room: { T: 30, RH: 55 }, env: { outdoorT: 35, outdoorRH: 40 }, profile: S.view!.s.profile, zone: ZONE_PRESETS[a.zone] }, schedule: [{ at: 0, action: { type: 'remote', patch: { power: true, mode: 'cool', setpoint: 24 } } }], duration: 2700 }, constraints: { maxDraft: 0.2, bandK: ZONE_PRESETS[a.zone].band, requireTarget: true } };
        const out = await bridge.job({ type: 'sweep', spec });
        tabs.lastSweep = { ...(out as object), spec } as never;
        tabs.renderSweep(tabs.sweepEl.lastElementChild!.lastElementChild as HTMLElement);
        break;
      }
      case 'explainEvent': await this.explain(a.quantity); break;
      case 'showHeatFlows': setView('cycle'); toast('Cycle view: blue = heat absorbed from room air, amber = heat rejected outdoors, red = compressor work. Room envelope gains are listed in Engineer → Conditions.'); break;
      case 'exportExperiment': if (a.format === 'html') tabs.report(); else if (a.format === 'png') download('ap35.png', await (await fetch(scene.screenshot())).blob()); else tabs.exportMenu(); break;
      case 'loadScenario': loadScenario(a.id, { run: true }); break;
    }
  }

  // ------------------------------------------------------------------ timers dialog
  timerDialog() {
    const v = S.view; if (!v) return;
    const r = v.s.remote;
    const onIn = h('input', { type: 'number', min: 0, step: 10, value: 30, style: { width: '70px' } }) as HTMLInputElement;
    const offIn = h('input', { type: 'number', min: 0, step: 10, value: 60, style: { width: '70px' } }) as HTMLInputElement;
    const weekly = [...r.weekly];
    const list = h('div', { class: 'small' });
    const renderList = () => { clear(list).append(...weekly.map((e, i) => h('div', {}, `${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][e.day]} ${String(Math.floor(e.time / 60)).padStart(2, '0')}:${String(e.time % 60).padStart(2, '0')} ${e.on ? 'ON ' + e.temp + ' °C' : 'OFF'} `, h('button', { class: 'btn sm', onclick: () => { weekly.splice(i, 1); renderList(); } }, '✕')))); };
    renderList();
    const day = h('select', {}, ...['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d, i) => h('option', { value: i }, d))) as HTMLSelectElement;
    const time = h('input', { type: 'time', value: '06:00' }) as HTMLInputElement;
    const onoff = h('select', {}, h('option', { value: '1' }, 'ON'), h('option', { value: '0' }, 'OFF')) as HTMLSelectElement;
    const temp = h('input', { type: 'number', value: 24, min: 10, max: 31, step: 0.5, style: { width: '60px' } }) as HTMLInputElement;
    modal('Timers (S2 9-7, 9-8)', h('div', {},
      h('p', { class: 'small muted' }, `Simulated clock: ${fmtTime(v.s.t)}. ON/OFF timer in 10-minute steps; weekly timer up to 4 per day and 28 per week.`),
      h('div', { class: 'row' }, 'ON timer in', onIn, 'min', h('button', { class: 'btn sm', onclick: () => act({ type: 'remote', patch: { onTimer: v.s.t + Math.round(Number(onIn.value) / 10) * 600 } }) }, 'Set'), h('button', { class: 'btn sm', onclick: () => act({ type: 'remote', patch: { onTimer: null } }) }, 'Cancel')),
      h('div', { class: 'row', style: { marginTop: '4px' } }, 'OFF timer in', offIn, 'min', h('button', { class: 'btn sm', onclick: () => act({ type: 'remote', patch: { offTimer: v.s.t + Math.round(Number(offIn.value) / 10) * 600 } }) }, 'Set'), h('button', { class: 'btn sm', onclick: () => act({ type: 'remote', patch: { offTimer: null } }) }, 'Cancel')),
      h('h4', {}, 'Weekly timer'), list,
      h('div', { class: 'row wrap' }, day, time, onoff, temp, h('button', { class: 'btn sm', onclick: () => { const [hh, mm] = time.value.split(':').map(Number); weekly.push({ day: Number(day.value), time: hh * 60 + mm, on: onoff.value === '1', temp: Number(temp.value) }); renderList(); } }, 'Add')),
      h('div', { class: 'row', style: { marginTop: '6px' } }, h('button', { class: 'btn sm primary', onclick: () => act({ type: 'remote', patch: { weekly, weeklyOn: true } }) }, 'Transmit & turn weekly timer ON'), h('button', { class: 'btn sm', onclick: () => act({ type: 'remote', patch: { weeklyOn: false } }) }, 'Weekly timer OFF'))));
  }

  // ------------------------------------------------------------------ ghost jet (A/B)
  ghostJet(pts: { p: [number, number, number] }[]) {
    if (this.ghostLine) { scene.root.remove(this.ghostLine); this.ghostLine.geometry.dispose(); }
    this.ghostLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts.map((p) => new THREE.Vector3(...p.p))), new THREE.LineDashedMaterial({ color: 0xc4161c, dashSize: 0.06, gapSize: 0.04 }));
    this.ghostLine.computeLineDistances();
    scene.root.add(this.ghostLine);
  }

  // ------------------------------------------------------------------ sound (Web Audio, illustrative)
  toggleSound() {
    if (!this.audio) {
      const ctx = new AudioContext();
      const master = ctx.createGain(); master.gain.value = 0.25; master.connect(ctx.destination);
      const noise = ctx.createBufferSource(); const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate); const d = buf.getChannelData(0);
      let s = 1; for (let i = 0; i < d.length; i++) { s = (s * 1664525 + 1013904223) >>> 0; d[i] = (s / 4294967296) * 2 - 1; }
      noise.buffer = buf; noise.loop = true;
      const fanF = ctx.createBiquadFilter(); fanF.type = 'lowpass'; fanF.frequency.value = 800;
      const fan = ctx.createGain(); fan.gain.value = 0; noise.connect(fanF).connect(fan).connect(master);
      const ofanF = ctx.createBiquadFilter(); ofanF.type = 'lowpass'; ofanF.frequency.value = 400;
      const ofan = ctx.createGain(); ofan.gain.value = 0; noise.connect(ofanF).connect(ofan).connect(master);
      const bp = ctx.createOscillator(); bp.type = 'sine'; const bpG = ctx.createGain(); bpG.gain.value = 0; bp.connect(bpG).connect(master);
      const hum = ctx.createOscillator(); hum.type = 'sawtooth'; const humF = ctx.createBiquadFilter(); humF.type = 'lowpass'; humF.frequency.value = 600; const humG = ctx.createGain(); humG.gain.value = 0; hum.connect(humF).connect(humG).connect(master);
      noise.start(); bp.start(); hum.start();
      this.audio = { ctx, fan, fanF, bp, bpG, hum, humG, ofan, master };
      S.sound = true;
    } else if (S.sound) { void this.audio.ctx.suspend(); S.sound = false; }
    else { void this.audio.ctx.resume(); S.sound = true; }
    toast(S.sound ? 'Sound on: synthesised from fan rpm and compressor frequency (illustrative, not measured dB(A)).' : 'Sound off');
    notify();
  }
  updateAudio() {
    if (!this.audio || !S.sound) return;
    const o = S.view?.out; const a = this.audio, t = a.ctx.currentTime;
    const ifan = o?.ifanAct ?? 0, ofan = o?.ofanAct ?? 0, f = o?.fAct ?? 0;
    a.fan.gain.setTargetAtTime(Math.min(0.5, (ifan / 1070) ** 2 * 0.45), t, 0.2);
    a.fanF.frequency.setTargetAtTime(300 + ifan * 1.2, t, 0.2);
    a.bp.frequency.setTargetAtTime(Math.max(20, (ifan / 60) * 35), t, 0.2);
    a.bpG.gain.setTargetAtTime(ifan > 50 ? 0.015 : 0, t, 0.2);
    a.ofan.gain.setTargetAtTime(Math.min(0.4, (ofan / 940) ** 2 * 0.25), t, 0.2);
    a.hum.frequency.setTargetAtTime(Math.max(20, f * 2), t, 0.2);
    a.humG.gain.setTargetAtTime(f > 1 ? 0.04 : 0, t, 0.3);
  }

  // ------------------------------------------------------------------ 3D design handles (Design Lab)
  enableHandles(on: boolean) { this.handlesOn = on; this.handles.visible = on; if (on) toast('Drag the red handles vertically: flap angle, opening height, mounting height. Results recompute on release (marked stale meanwhile).', 5000); }
  private handleMeshes: Record<string, THREE.Mesh> = {};
  private valueTag = h('div', { class: 'lbl hidden', style: { position: 'absolute', zIndex: '6' } });
  setupHandles() {
    const mk = (kind: string, color: number) => { const m = new THREE.Mesh(new THREE.SphereGeometry(0.03, 16, 12), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.4 })); m.userData.handle = kind; this.handles.add(m); this.handleMeshes[kind] = m; };
    mk('vane', 0xc4161c); mk('outletH', 0xd9861c); mk('mountH', 0x2f7fc1);
    this.handles.visible = false;
    this.stage.append(this.valueTag);
    const ray = new THREE.Raycaster();
    scene.canvas.addEventListener('pointerdown', (e) => {
      if (!this.handlesOn) return;
      const r = scene.canvas.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), scene.camera);
      const hit = ray.intersectObjects(Object.values(this.handleMeshes))[0];
      if (!hit) return;
      const kind = hit.object.userData.handle as string;
      const P = S.view!.s.profile;
      const v0 = kind === 'vane' ? (S.view!.s.overrides.vaneAngle ?? S.view!.out?.vaneUpper ?? 20) : kind === 'outletH' ? P.outletH : P.mountH;
      this.dragging = { kind, y0: e.clientY, v0 };
      scene.controls.enabled = false;
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    });
    scene.canvas.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      const dy = this.dragging.y0 - e.clientY;
      const d = this.dragging;
      const val = this.handleValue(d.kind, d.v0, dy);
      this.valueTag.classList.remove('hidden');
      this.valueTag.style.left = `${e.clientX - this.stage.getBoundingClientRect().left + 14}px`; this.valueTag.style.top = `${e.clientY - this.stage.getBoundingClientRect().top - 10}px`;
      this.valueTag.textContent = this.handleLabel(d.kind, val) + ' · stale until release';
    });
    scene.canvas.addEventListener('pointerup', (e) => {
      if (!this.dragging) return;
      const d = this.dragging; this.dragging = null; scene.controls.enabled = true;
      const val = this.handleValue(d.kind, d.v0, d.y0 - e.clientY);
      this.valueTag.classList.add('hidden');
      this.staleUntil = performance.now() + 2500;
      if (d.kind === 'vane') void act({ type: 'override', patch: { manual: true, vaneAngle: Math.round(val) } });
      else void setProfileParam(d.kind as keyof ProfileValues, +val.toFixed(3));
      toast(`${this.handleLabel(d.kind, val)} applied: airflow operating point and jet recomputed.`);
    });
  }
  private handleValue(kind: string, v0: number, dy: number) {
    if (kind === 'vane') return Math.max(-10, Math.min(90, v0 - dy * 0.3));
    if (kind === 'outletH') return Math.max(0.03, Math.min(0.12, v0 + dy * 0.0003));
    return Math.max(1.9, Math.min(2.75, v0 + dy * 0.003));
  }
  private handleLabel(kind: string, v: number) {
    if (kind === 'vane') return `Flap angle ${v.toFixed(0)}° (bounds −10…90°)`;
    if (kind === 'outletH') return `Outlet opening ${(v * 1000).toFixed(0)} mm (30…120 mm, supported model)`;
    return `Unit top height ${v.toFixed(2)} m (1.90…2.75 m, supported)`;
  }
  updateHandles() {
    if (!this.handlesOn || !S.view) return;
    const ig = scene.indoor.group;
    const o = S.view.out;
    const vp = ig.localToWorld(new THREE.Vector3(0.2, 0.052, 0.19));
    const ang = ((o?.vaneUpper ?? 0) * Math.PI) / 180;
    this.handleMeshes.vane.position.copy(vp).add(new THREE.Vector3(0, -Math.sin(ang) * 0.08, Math.cos(ang) * 0.08));
    this.handleMeshes.outletH.position.copy(ig.localToWorld(new THREE.Vector3(-0.2, 0.03, 0.16)));
    this.handleMeshes.mountH.position.copy(ig.localToWorld(new THREE.Vector3(IND.W / 2 + 0.06, IND.H, 0.1)));
    const changed = Math.abs(S.view.s.profile.mountH - mitsubishi_ap35_reference.mountH) > 1e-6 || Math.abs(S.view.s.profile.mountX - mitsubishi_ap35_reference.mountX) > 1e-6;
    if (changed && !this.baselineGhost) {
      const g = scene.indoor.group.clone(true);
      g.traverse((m) => { const mm = m as THREE.Mesh; if (mm.isMesh) mm.material = new THREE.MeshBasicMaterial({ color: 0x8a857a, transparent: true, opacity: 0.15, depthWrite: false }); });
      g.position.set(mitsubishi_ap35_reference.mountX, mitsubishi_ap35_reference.mountH - IND.H, 0);
      this.baselineGhost = g; scene.root.add(g);
    } else if (!changed && this.baselineGhost) { scene.root.remove(this.baselineGhost); this.baselineGhost = null; }
    if (this.staleUntil > performance.now()) this.valueTag.classList.add('hidden');
  }

  // ------------------------------------------------------------------ recording
  record() {
    const canvas = scene.canvas;
    const types = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
    const type = types.find((t) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t));
    if (!type || !(canvas as HTMLCanvasElement & { captureStream?: unknown }).captureStream) { toast('Browser recording is not supported here. Export screenshots and the replay JSON instead (no MP4 is produced).', 6000); return; }
    const stream = (canvas as HTMLCanvasElement & { captureStream: (fps: number) => MediaStream }).captureStream(30);
    const rec = new MediaRecorder(stream, { mimeType: type });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => chunks.push(e.data);
    rec.onstop = () => download('ap35-recording.webm', new Blob(chunks, { type: 'video/webm' }));
    const label = h('div', { class: 'overlay-card', style: { position: 'absolute', top: '46px', left: '10px', zIndex: '5' } });
    this.stage.append(label);
    const tick = setInterval(() => { label.textContent = `REC (WebM) · simulated ${S.view ? fmtTime(S.view.s.t) : ''}`; }, 200);
    rec.start();
    toast('Recording 12 s of the 3D view as WebM (not MP4)…');
    setTimeout(() => { rec.stop(); clearInterval(tick); label.remove(); }, 12000);
  }
}

void NARRATION_AR; void fmt;

/**
 * Application shell. One authoritative simulation lives in the live worker;
 * every panel here renders the latest frame and sends validated actions.
 */
import { h, clear, fmt, fmtTime, toast, modal, isTyping, download } from './dom';
import { S, load, save, resetHistory, appendHistory, activeProfile, notify } from './state';
import { Bridge } from './bridge';
import { Scene3D, VIEW_MODES, type ViewMode } from '../scene/app3d';
import { PARTS } from '../scene/kit';
import type { Action } from '../sim/schema';
import type { FanSetting, VaneSetting, WideSetting, Mode } from '../model/types';
import { NARRATION_AR, UI_AR } from './i18n';
import { mitsubishi_ap35_reference, newExperiment, setParam, revertParam, changedParams, undo, redo, REFERENCE_NAME } from '../config/profiles';
import { PARAM_BY_KEY, type ProfileValues } from '../config/registry';
import { SCENARIOS, SCENARIO_BY_ID } from '../sim/scenarios';
import type { InitSpec } from '../sim/engine';
import { BottomTabs } from './tabs';
import { Extras } from './extras';
import { setpointRange } from '../sim/schema';

export const bridge = new Bridge();
export let scene: Scene3D;
export let tabs: BottomTabs;
export let extras: Extras;

const MODES: Mode[] = ['auto', 'cool', 'dry', 'heat', 'fan'];
const FANS: FanSetting[] = ['auto', 'Silent', 'Low', 'Med', 'High', 'SuperHigh'];
const VANES: VaneSetting[] = ['auto', 1, 2, 3, 4, 5, 'swing'];
const WIDES: WideSetting[] = [1, 2, 3, 4, 5, 'swing'];
export let currentScenario = 'pulldown';

export async function act(a: Action, quiet = false): Promise<boolean> {
  const r = await bridge.act(a);
  if (!r.ok) { toast('Rejected: ' + r.error, 4200); return false; }
  if (!quiet) notify();
  return true;
}

/** Apply a design/profile change, creating a named experiment if the reference is active. */
export async function setProfileParam(key: keyof ProfileValues, value: number) {
  let p = activeProfile();
  if (!p) {
    const name = `Experiment ${S.profiles.length + 1}`;
    p = newExperiment(name); S.profiles.push(p); S.active = name;
    toast(`Created "${name}" (copy of ${REFERENCE_NAME}). The published reference stays unchanged.`);
  }
  const err = setParam(p, key, value);
  if (err) { toast(err, 4000); return; }
  await act({ type: 'profile', patch: { [key]: value } as Partial<ProfileValues> }, true);
  save(); notify();
}
export async function applyProfile(name: string | null) {
  const target = name ? S.profiles.find((x) => x.name === name) ?? null : null;
  const P: Record<string, number> = {};
  for (const d of Object.values(PARAM_BY_KEY)) if (d.editable !== 'locked') P[d.key] = (target?.overrides[d.key] as number | undefined) ?? (mitsubishi_ap35_reference[d.key] as number);
  const cur = S.view?.s.profile as unknown as Record<string, number> | undefined;
  const patch: Record<string, number> = {};
  for (const [k, v] of Object.entries(P)) if (!cur || cur[k] !== v) patch[k] = v;
  if (Object.keys(patch).length) await act({ type: 'profile', patch: patch as Partial<ProfileValues> }, true);
  S.active = name; save(); notify();
}
export async function revert(key: keyof ProfileValues) {
  const p = activeProfile(); if (!p) return;
  revertParam(p, key);
  await act({ type: 'profile', patch: { [key]: mitsubishi_ap35_reference[key] } as Partial<ProfileValues> }, true);
  save(); notify();
}
export async function undoRedo(dir: 'undo' | 'redo') {
  const p = activeProfile(); if (!p) return;
  if (dir === 'undo') undo(p); else redo(p);
  await applyProfile(p.name);
}

export function initSpecFor(id: string): InitSpec {
  const sc = SCENARIO_BY_ID[id];
  const p = activeProfile();
  return { ...sc.init, profile: { ...mitsubishi_ap35_reference, ...(p?.overrides ?? {}) }, profileName: p?.name ?? REFERENCE_NAME };
}

export function loadScenario(id: string, opts: { run?: boolean } = {}) {
  currentScenario = id;
  const sc = SCENARIO_BY_ID[id];
  resetHistory();
  bridge.init(initSpecFor(id), opts.run ?? true);
  // apply the scenario schedule at t=0 now; later entries are applied by the scenario clock
  pendingSchedule = [...sc.schedule].sort((a, b) => a.at - b.at);
  scenarioStart = null;
  notify();
}
let pendingSchedule: { at: number; action: Action }[] = [];
let scenarioStart: number | null = null;
function runScenarioClock() {
  const v = S.view; if (!v || !pendingSchedule.length) return;
  if (scenarioStart === null) scenarioStart = v.s.t;
  while (pendingSchedule.length && pendingSchedule[0].at <= v.s.t - scenarioStart + 1e-6) {
    const a = pendingSchedule.shift()!; void act(a.action, true);
  }
}

// ======================================================================= build
export function startApp(root: HTMLElement) {
  load();
  document.body.classList.add('ws-' + S.workspace);
  const shell = h('div', { id: 'shell' });
  const hdr = buildHeader();
  const left = h('aside', { id: 'left', 'aria-label': 'Controls' });
  const stage = h('main', { id: 'stage' });
  const right = h('aside', { id: 'right', 'aria-label': 'Live measurements' });
  const bottom = h('section', { id: 'bottom', 'aria-label': 'Charts and tools' });
  shell.append(hdr, left, stage, right, bottom);
  root.append(shell);
  const canvas = h('canvas', { id: 'c3d', 'aria-label': '3D view of the indoor and outdoor units' });
  stage.append(canvas);
  scene = new Scene3D(canvas);
  scene.reducedMotion = S.reducedMotion;
  extras = new Extras(stage);
  buildStageOverlays(stage);
  buildLeft(left);
  buildRight(right);
  tabs = new BottomTabs(bottom);
  wireBridge();
  wireKeys();
  new ResizeObserver(() => scene.resize()).observe(stage);
  document.addEventListener('visibilitychange', () => { if (document.hidden && S.running) { bridge.run(false); wasRunningBeforeHide = true; } else if (!document.hidden && wasRunningBeforeHide) { bridge.run(true); wasRunningBeforeHide = false; } });
  loadScenario('pulldown', { run: true });
  // first minute: do not auto-start the unit; the user presses Start cooling
  pendingSchedule = [];
  if (S.recoveryNote) toast(S.recoveryNote, 6000);
  const loop = () => { scene.render(); extras.frame(); requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
  setInterval(() => { refreshPanels(); runScenarioClock(); }, 120);
}
let wasRunningBeforeHide = false;

function wireBridge() {
  bridge.onFrame = (m) => {
    S.view = m.view as typeof S.view;
    S.replay = (m.replay as typeof S.replay) ?? null;
    S.running = m.running as boolean; S.speed = m.speed as number;
    S.startTime = m.startTime as number; S.snapshots = m.snapshots as number[]; S.inputs = m.inputs as number;
    if (m.hist) appendHistory(m.hist as Record<string, number[]>);
    if (m.events && (m.events as unknown[]).length) { S.events.push(...(m.events as typeof S.events)); if (S.events.length > 1500) S.events.splice(0, S.events.length - 1500); }
    if (m.field) S.field = m.field as typeof S.field;
    if (m.jet) S.jet = m.jet as typeof S.jet;
    const v = S.replay ?? S.view;
    if (v) scene.setFrame(v, m.field as typeof S.field, m.jet as typeof S.jet);
    if (v) for (const p of v.s.probes) {
      let ph = S.probeHist.get(p.def.id); if (!ph) { ph = { t: [], ideal: [], virt: [] }; S.probeHist.set(p.def.id, ph); }
      const last = ph.t[ph.t.length - 1] ?? -1e9;
      if (v.s.t - last >= 2) { ph.t.push(v.s.t); ph.ideal.push(p.ideal ?? NaN); ph.virt.push(p.virt ?? NaN); if (ph.t.length > 3000) { ph.t.shift(); ph.ideal.shift(); ph.virt.shift(); } }
    }
  };
  bridge.onReset = () => { resetHistory(); };
  bridge.onReplay = () => toast('Replay loaded: the live experiment is unchanged until you branch.');
}

function wireKeys() {
  document.addEventListener('keydown', (e) => {
    if (isTyping(e)) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); extras.openPalette(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const vm = VIEW_MODES.find((m) => m.key === e.key);
    if (vm) { setView(vm.id); return; }
    if (e.key === ' ') { e.preventDefault(); bridge.run(!S.running); }
    if (e.key === '?') showShortcuts();
  });
}

function showShortcuts() {
  modal('Keyboard shortcuts', h('div', {},
    h('p', {}, h('span', { class: 'kbd' }, '1'), '–', h('span', { class: 'kbd' }, '8'), ' view modes · ', h('span', { class: 'kbd' }, 'Space'), ' pause/run · ', h('span', { class: 'kbd' }, 'Ctrl+K'), ' command assistant · ', h('span', { class: 'kbd' }, '?'), ' this help'),
    h('p', { class: 'muted small' }, 'Shortcuts are ignored while typing in an input.')));
}

// ======================================================================= header
const timeEl = h('span', { class: 'time mono' }, '—');
const profileChip = h('button', { class: 'chip', title: 'Active equipment profile' }, '');
const fidelityChip = h('button', { class: 'chip', title: 'Model fidelity and assumptions' }, 'Modelled ⓘ');
function buildHeader() {
  const ws = h('div', { class: 'ws-tabs', role: 'tablist' },
    ...(['explore', 'engineer', 'lab'] as const).map((w) => h('button', { role: 'tab', class: S.workspace === w ? 'on' : '', 'data-ws': w, onclick: () => setWorkspace(w) }, w === 'explore' ? 'Explore' : w === 'engineer' ? 'Engineer' : 'Design Lab')));
  const speedSel = h('select', { class: 'btn sm', 'aria-label': 'Simulation speed', onchange: (e: Event) => bridge.speed(Number((e.target as HTMLSelectElement).value)) },
    ...[1, 5, 30, 60].map((s) => h('option', { value: s, selected: s === 1 }, `${s}×`)));
  const playBtn = h('button', { class: 'iconbtn', title: 'Pause / run (Space)', 'aria-label': 'Pause or run', onclick: () => bridge.run(!S.running) }, '❚❚');
  const stepBtn = h('button', { class: 'iconbtn', title: 'Single step (paused): +1 s', 'aria-label': 'Single step', onclick: () => { if (S.running) bridge.run(false); bridge.step(1); } }, '⏭');
  const resetBtn = h('button', { class: 'iconbtn', title: 'Reset scenario (deterministic)', 'aria-label': 'Reset', onclick: () => loadScenario(currentScenario, { run: true }) }, '↺');
  S.listeners.add(() => { playBtn.textContent = S.running ? '❚❚' : '▶'; playBtn.classList.toggle('on', !S.running); });
  const langBtn = h('button', { class: 'chip', title: 'Explanation language', onclick: () => { S.lang = S.lang === 'en' ? 'ar' : 'en'; save(); notify(); } }, 'EN / عربي');
  S.listeners.add(() => { langBtn.textContent = S.lang === 'en' ? 'EN · عربي' : 'عربي · EN'; langBtn.classList.toggle('on', S.lang === 'ar'); });
  const soundBtn = h('button', { class: 'chip', title: 'Synthesised sound (illustrative, not measured dB(A))', onclick: () => extras.toggleSound() }, '♪ off');
  S.listeners.add(() => { soundBtn.textContent = S.sound ? '♪ on' : '♪ off'; soundBtn.classList.toggle('on', S.sound); });
  const cmdBtn = h('button', { class: 'chip', title: 'Command assistant (Ctrl+K)', onclick: () => extras.openPalette() }, '⌘ Ask');
  const exportBtn = h('button', { class: 'chip', title: 'Export', onclick: () => tabs.exportMenu() }, '⤓ Export');
  const helpBtn = h('button', { class: 'chip', title: 'Shortcuts', onclick: showShortcuts }, '?');
  fidelityChip.onclick = () => tabs.open('assumptions');
  profileChip.onclick = () => { if (S.workspace !== 'lab') setWorkspace('lab'); };
  S.listeners.add(() => {
    const p = activeProfile();
    const n = changedParams(p).length;
    profileChip.textContent = p ? `${p.name} · ${n} changed` : 'Reference';
    profileChip.classList.toggle('red', !!p);
    profileChip.title = p ? 'Experimental profile (copy). Published reference unchanged.' : 'mitsubishi_ap35_reference (published values; immutable)';
  });
  return h('header', { id: 'hdr' },
    h('div', { class: 'brand' }, h('div', { class: 'ap' }, 'AP', h('span', {}, '35')), h('div', { class: 'sub' }, h('b', {}, 'Mitsubishi Electric · Live Inverter Bench Study'), h('i', {}, 'MSZ-AP35VGK + MUZ-AP35VG · R32 · 3.5 kW (11,943 Btu/h)'))),
    ws,
    h('div', { class: 'clock' }, playBtn, stepBtn, resetBtn, speedSel, timeEl),
    h('div', { class: 'spacer' }),
    h('div', { class: 'hdr-tools' }, profileChip, fidelityChip, cmdBtn, exportBtn, langBtn, soundBtn, helpBtn),
  );
}

export function setWorkspace(w: typeof S.workspace) {
  document.body.classList.remove('ws-' + S.workspace);
  S.workspace = w; save();
  document.body.classList.add('ws-' + w);
  document.querySelectorAll('[data-ws]').forEach((b) => b.classList.toggle('on', (b as HTMLElement).dataset.ws === w));
  tabs.workspaceChanged();
  notify();
}

export function setView(m: ViewMode) {
  if (m === 'exploded' && scene.mode !== 'exploded') {
    explodeResume = S.running;
    if (S.running) bridge.run(false);
    toast('Exploded view: simulation paused at a snapshot. Reassemble to resume.');
  }
  if (m !== 'exploded' && scene.mode === 'exploded' && explodeResume) { bridge.run(true); explodeResume = false; }
  scene.setMode(m);
  document.querySelectorAll('.modes button').forEach((b) => b.classList.toggle('on', (b as HTMLElement).dataset.mode === m));
  notify();
}
let explodeResume = false;

// ======================================================================= stage overlays
const legendEl = h('div', { class: 'overlay-card legend' });
const cfdNote = h('div', { class: 'overlay-card cfd-note' }, 'Approximate airflow model, not CFD validation');
const explodeBar = h('div', { class: 'explode-bar overlay-card hidden' });
function buildStageOverlays(stage: HTMLElement) {
  const modes = h('nav', { class: 'modes', 'aria-label': 'View modes' }, ...VIEW_MODES.map((m) => h('button', { 'data-mode': m.id, class: m.id === 'system' ? 'on' : '', title: `${m.label} (${m.key})`, onclick: () => setView(m.id) }, m.label)));
  stage.append(modes);
  stage.append(h('div', { class: 'stage-tr' }, h('div', { class: 'overlay-card study', id: 'studyLabel' }, 'Independent study based on published Mitsubishi Electric documentation; unverified internals and dynamics are modelled. Not a Mitsubishi Electric product.')));
  const slowBtn = h('button', { class: 'btn sm', title: 'Slows visual fan/compressor/particle motion only; numerical rpm unchanged', onclick: () => { scene.slow = !scene.slow; slowBtn.classList.toggle('on', scene.slow); slowBtn.textContent = scene.slow ? 'Mechanism slow view: ON (visual only)' : 'Mechanism slow view'; } }, 'Mechanism slow view');
  const colorBtn = h('button', { class: 'btn sm', onclick: () => { scene.colorMode = scene.colorMode === 'temperature' ? 'velocity' : 'temperature'; colorBtn.textContent = 'Colour: ' + scene.colorMode; } }, 'Colour: temperature');
  const shotBtn = h('button', { class: 'btn sm', onclick: () => download(`ap35-${scene.mode}.png`, dataUrlToBlob(scene.screenshot())) }, 'PNG');
  const sliceBox = h('div', { class: 'overlay-card eng-only', style: { display: 'flex', flexDirection: 'column', gap: '2px' } },
    h('label', { class: 'small' }, 'Horizontal slice height ', h('input', { type: 'range', min: 0.1, max: 2.6, step: 0.05, value: 1.1, oninput: (e: Event) => { scene.sliceHeight = Number((e.target as HTMLInputElement).value); scene.show.sliceH = true; } })),
    h('label', { class: 'small' }, 'Vertical slice x ', h('input', { type: 'range', min: 0.1, max: 3.9, step: 0.05, value: 2, oninput: (e: Event) => { scene.sliceX = Number((e.target as HTMLInputElement).value); scene.show.sliceV = true; } })),
    h('div', { class: 'row' },
      toggleBtn('Streamlines', () => scene.show.stream, (v) => (scene.show.stream = v)),
      toggleBtn('Plume', () => scene.show.plume, (v) => (scene.show.plume = v)),
      toggleBtn('Arrows', () => scene.show.arrows, (v) => (scene.show.arrows = v)),
      toggleBtn('Particles', () => scene.show.particles, (v) => { scene.show.particles = v; scene.show.outdoorParticles = v; })));
  stage.append(h('div', { class: 'stage-tl' }, cfdNote, legendEl, sliceBox));
  stage.append(h('div', { class: 'stage-br' }, slowBtn, colorBtn, shotBtn));
  stage.append(explodeBar);
  explodeBar.append(h('span', { class: 'small' }, 'Exploded assembly · simulation paused at a snapshot '), h('button', { class: 'btn sm primary', onclick: () => setView('system') }, 'Reassemble and resume'));
  S.listeners.add(() => {
    explodeBar.classList.toggle('hidden', scene.mode !== 'exploded');
    const v = S.view; if (!v) return;
    const T = v.s.plant.Troom;
    const lo = Math.min(10, T - 12), hi = Math.max(34, T + 10);
    legendEl.innerHTML = scene.colorMode === 'temperature'
      ? `<span>${lo.toFixed(0)}°C</span><span class="bar" style="background:linear-gradient(90deg,#2b5cc7,#40a0eb,#9ecce0,#e6dcb8,#f5a84d,#e35c29,#b81a1a)"></span><span>${hi.toFixed(0)}°C</span><span class="muted">air · pipes −5…95 °C${scene.show.sliceH || scene.show.sliceV ? ` · slices ${(T - 4).toFixed(1)}…${(T + 4).toFixed(1)} °C` : ''}</span>`
      : `<span>0 m/s</span><span class="bar" style="background:linear-gradient(90deg,hsl(223,80%,50%),hsl(112,80%,50%),hsl(0,80%,50%))"></span><span>≥3 m/s</span>`;
  });
}
function toggleBtn(label: string, get: () => boolean, set: (v: boolean) => void) {
  const b = h('button', { class: 'btn sm' + (get() ? ' on' : ''), onclick: () => { set(!get()); b.classList.toggle('on', get()); } }, label);
  return b;
}
export function dataUrlToBlob(u: string) { const [m, b] = u.split(','); const bin = atob(b); const a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return new Blob([a], { type: m.split(':')[1].split(';')[0] }); }

// ======================================================================= left column
const startBtn = h('button', { class: 'startcta' }, 'Start cooling');
const lcd = h('div', { class: 'lcd', 'aria-live': 'polite' });
const remoteBtns: Record<string, HTMLButtonElement> = {};
function rb(id: string, label: string, sub: string, onclick: () => void, title = '') {
  const b = h('button', { class: 'rb', title, onclick }, label, h('small', {}, sub)) as HTMLButtonElement; remoteBtns[id] = b; return b;
}
function cycle<T>(list: T[], cur: T): T { return list[(list.indexOf(cur) + 1) % list.length]; }

function buildLeft(left: HTMLElement) {
  startBtn.onclick = async () => {
    const v = S.view; if (!v) return;
    if (v.s.remote.power) { await act({ type: 'remote', patch: { power: false } }); return; }
    await act({ type: 'remote', patch: { power: true, mode: 'cool' } });
    if (scene.mode === 'system') { scene.show.plume = false; }
  };
  const remote = h('div', { class: 'remote', 'aria-label': 'Remote controller (SG17B functions)' }, lcd,
    h('div', { class: 'grid' },
      h('button', { class: 'rb power', id: 'powerBtn', onclick: () => act({ type: 'remote', patch: { power: !S.view?.s.remote.power } }) }, 'STOP / OPERATE'),
      rb('mode', 'MODE', 'operation select', () => { const r = S.view!.s.remote; void act({ type: 'remote', patch: { mode: cycle(MODES, r.mode) } }); }),
      rb('tdown', 'TEMP ▼', '−0.5 °C', () => setTemp(-0.5)),
      rb('tup', 'TEMP ▲', '+0.5 °C', () => setTemp(0.5)),
      rb('fan', 'FAN', 'speed', () => { const r = S.view!.s.remote; void act({ type: 'remote', patch: { fan: cycle(FANS, r.fan) } }); }),
      rb('vane', 'VANE', 'up / down', () => { const r = S.view!.s.remote; void act({ type: 'remote', patch: { vane: cycle(VANES, r.vane) } }); }),
      rb('wide', 'WIDE VANE', 'left / right', () => { const r = S.view!.s.remote; void act({ type: 'remote', patch: { wide: cycle(WIDES, r.wide) } }); }),
      rb('econo', 'ECONO COOL', '+2 °C · swing', () => { const r = S.view!.s.remote; void act({ type: 'remote', patch: { econoCool: !r.econoCool } }); }, 'COOL only (S2 9-6 (9))'),
      rb('night', 'NIGHT MODE', 'quiet outdoor', () => { const r = S.view!.s.remote; void act({ type: 'remote', patch: { nightMode: !r.nightMode } }); }, 'S2 9-9: dims lamp, mutes beeps, limits outdoor noise; capacity may drop'),
      rb('isave', 'i-save', 'recall preset', () => { const r = S.view!.s.remote; void act({ type: 'remote', patch: { isave: !r.isave } }); }, 'S2 9-10: one preset for COOL/ECONO COOL, one for HEAT; not in DRY/AUTO'),
      rb('isaveStore', 'i-save SET', 'store current', () => void act({ type: 'isaveStore' }), 'Store current temperature, fan and vane as the i-save preset'),
      rb('timer', 'TIMER', 'ON / OFF', () => extras.timerDialog(), 'ON/OFF timer in 10-minute steps; weekly timer up to 4 per day, 28 per week (S2 9-7, 9-8)'),
      rb('lock', 'LOCK', 'operation lock', () => { const r = S.view!.s.remote; void act({ type: 'remote', patch: { opLock: !r.opLock } }); }, 'S2 9-11: locks the operation mode only'),
    ));
  const scenarioSel = h('select', { 'aria-label': 'Scenario', onchange: (e: Event) => loadScenario((e.target as HTMLSelectElement).value, { run: true }) },
    ...SCENARIOS.map((s) => h('option', { value: s.id }, s.title)));
  const scenarioPanel = h('div', { class: 'panel' }, h('h3', {}, 'Scenario'), h('div', { class: 'field' }, scenarioSel, h('div', { class: 'why', id: 'scDesc' }, SCENARIOS[0].description)),
    h('div', { class: 'row wrap' },
      h('button', { class: 'btn sm', onclick: () => loadScenario(scenarioSel.value, { run: true }) }, 'Load & run'),
      h('button', { class: 'btn sm', onclick: () => extras.startTour('guided') }, 'Guided tour'),
      h('button', { class: 'btn sm', onclick: () => extras.startTour('air') }, 'Follow room air'),
      h('button', { class: 'btn sm', onclick: () => extras.startTour('ref') }, 'Follow refrigerant'),
      h('button', { class: 'btn sm', onclick: () => extras.startTour('ctrl') }, 'Follow control command')));
  scenarioSel.addEventListener('change', () => { const d = document.getElementById('scDesc'); if (d) d.textContent = SCENARIO_BY_ID[scenarioSel.value].description; });
  left.append(
    h('div', { class: 'panel' }, h('h3', {}, 'Original product operation', h('span', { class: 'spacer' }), h('span', { class: 'badge sourced' }, 'S2 §9')), startBtn, h('div', { class: 'small muted', id: 'startHint', style: { margin: '2px 0 8px' } }, ''), remote),
    scenarioPanel,
    buildConsole(),
    buildLabPanel(),
  );
}

async function setTemp(d: number) {
  const r = S.view!.s.remote;
  const [lo, hi] = setpointRange(r.mode);
  const v = Math.min(hi, Math.max(lo, Math.round((r.setpoint + d) * 2) / 2));
  if (r.mode === 'dry') { toast('DRY: the set temperature is determined from the initial room temperature (S2 9-2)'); return; }
  await act({ type: 'remote', patch: { setpoint: v } });
}

// ---------------- engineering console (experiment layer)
interface Ctl { el: HTMLElement; update: () => void }
const ctls: Ctl[] = [];
function slider(label: string, min: number, max: number, step: number, get: () => number, set: (v: number) => void, unit: string, why = '', actual?: () => string): HTMLElement {
  const val = h('span', { class: 'val' });
  const inp = h('input', { type: 'range', min, max, step, 'aria-label': label }) as HTMLInputElement;
  let dragging = false;
  inp.addEventListener('pointerdown', () => (dragging = true));
  inp.addEventListener('pointerup', () => (dragging = false));
  inp.oninput = () => { val.textContent = `${Number(inp.value).toFixed(step < 1 ? (step < 0.1 ? 2 : 1) : 0)} ${unit}`; };
  inp.onchange = () => set(Number(inp.value));
  const act2 = h('div', { class: 'act' });
  const el = h('div', { class: 'field' }, h('label', {}, label), val, inp, actual ? act2 : null, why ? h('div', { class: 'why' }, why) : null);
  ctls.push({ el, update: () => { if (!dragging && document.activeElement !== inp) { const g = get(); inp.value = String(g); val.textContent = `${g.toFixed(step < 1 ? (step < 0.1 ? 2 : 1) : 0)} ${unit}`; } if (actual) act2.innerHTML = actual(); } });
  return el;
}
function checkbox(label: string, get: () => boolean, set: (v: boolean) => void, why = ''): HTMLElement {
  const cb = h('input', { type: 'checkbox' }) as HTMLInputElement;
  cb.onchange = () => set(cb.checked);
  const el = h('label', { class: 'check', title: why }, cb, label);
  ctls.push({ el, update: () => { cb.checked = get(); } });
  return el;
}
const ov = () => S.view!.s.overrides;
const env = () => S.view!.s.env;
const flt = () => S.view!.s.faults;
const prof = () => S.view!.s.profile;
const out = () => S.view!.out;
const actLine = (req: string, applied: string, actual: string, lim = '') => `<span>req <b>${req}</b></span><span>applied <b>${applied}</b></span><span>actual <b>${actual}</b></span>${lim ? `<span class="lim">${lim}</span>` : ''}`;

function buildConsole(): HTMLElement {
  const P = (k: keyof ProfileValues) => () => prof()[k] as number;
  const setP = (k: keyof ProfileValues) => (v: number) => void setProfileParam(k, v);
  const manual = checkbox('Manual engineering override', () => ov().manual, (v) => void act({ type: 'override', patch: { manual: v } }), 'Requests still pass envelope limits and protections');
  return h('div', { class: 'eng-only' },
    h('details', { class: 'panel', open: true },
      h('summary', {}, 'Engineering console'),
      h('div', { class: 'exp-banner' }, 'Simulator experiments, not original remote functions.'),
      h('div', { class: 'row wrap', style: { marginBottom: '6px' } },
        h('button', { class: 'btn sm red', onclick: () => resetBaseline() }, 'Reset to published baseline')),
      manual,
      slider('Compressor request', 0, 120, 1, () => ov().compHz ?? 0, (v) => void act({ type: 'override', patch: { manual: true, compHz: v } }), 'Hz', 'Operational frequency (treated as rev/s, assumption A1). 0 = stop.',
        () => { const o = out(); const c = S.view!.s.ctrl; return o ? actLine(`${(ov().compHz ?? c.fReq).toFixed(0)} Hz`, `${o.fCmd.toFixed(1)} Hz`, `${o.fAct.toFixed(1)} Hz = ${o.rpmComp.toFixed(0)} rpm, elec ${o.fElec.toFixed(0)} Hz (p=${prof().pPolePairs})`, c.limitReason) : ''; }),
      slider('Indoor fan', 0, 1300, 10, () => ov().ifanRpm ?? S.view!.out?.ifanCmd ?? 0, (v) => void act({ type: 'override', patch: { manual: true, ifanRpm: v } }), 'rpm', '',
        () => { const o = out(); return o ? actLine(`${(ov().ifanRpm ?? o.ifanCmd).toFixed(0)}`, `${o.ifanCmd.toFixed(0)}`, `${o.ifanAct.toFixed(0)} rpm → ${o.qIn.toFixed(0)} m³/h`, S.view!.s.faults.indoorFanFault ? 'fan fault' : '') : ''; }),
      slider('Outdoor fan', 0, 1100, 10, () => ov().ofanRpm ?? S.view!.out?.ofanCmd ?? 0, (v) => void act({ type: 'override', patch: { manual: true, ofanRpm: v } }), 'rpm', '',
        () => { const o = out(); return o ? actLine(`${(ov().ofanRpm ?? o.ofanCmd).toFixed(0)}`, `${o.ofanCmd.toFixed(0)}`, `${o.ofanAct.toFixed(0)} rpm → ${o.qOut.toFixed(0)} m³/h`) : ''; }),
      slider('LEV opening', 0, 100, 1, () => ov().eevPct ?? (S.view!.out?.eevCmd ?? 0.25) * 100, (v) => void act({ type: 'override', patch: { manual: true, eevPct: v } }), '%', 'Percent only: the LEV pulse count is not documented.',
        () => { const o = out(); return o ? actLine(`${(ov().eevPct ?? o.eevCmd * 100).toFixed(0)} %`, `${(o.eevCmd * 100).toFixed(0)} %`, `${(o.eevAct * 100).toFixed(0)} % · SH ${o.SHevap.toFixed(1)} K`) : ''; }),
      slider('Vane angle (both flaps)', -10, 90, 1, () => ov().vaneAngle ?? S.view!.out?.vaneUpper ?? 0, (v) => void act({ type: 'override', patch: { manual: true, vaneAngle: v } }), '° below horiz.', '0° = horizontal; positions 1–5 sourced, angles assumed.',
        () => { const o = out(); return o ? actLine(`${(ov().vaneAngle ?? o.vaneUpperCmd).toFixed(0)}°`, `${o.vaneUpperCmd.toFixed(0)}°`, `upper ${o.vaneUpper.toFixed(0)}° lower ${o.vaneLower.toFixed(0)}°`) : ''; }),
      slider('Wide vane angle', -60, 60, 1, () => ov().wideAngle ?? S.view!.out?.wideAct ?? 0, (v) => void act({ type: 'override', patch: { manual: true, wideAngle: v } }), '°', 'Negative = left (seen from the room).'),
      slider('Swing lower limit', -10, 90, 1, () => ov().swingLo ?? 12, (v) => void act({ type: 'override', patch: { manual: true, swingLo: v } }), '°'),
      slider('Swing upper limit', -10, 90, 1, () => ov().swingHi ?? 68, (v) => void act({ type: 'override', patch: { manual: true, swingHi: v } }), '°'),
      h('div', { class: 'row wrap' }, h('button', { class: 'btn sm', onclick: () => act({ type: 'override', patch: { manual: false, compHz: null, ifanRpm: null, ofanRpm: null, eevPct: null, vaneAngle: null, wideAngle: null, swingLo: null, swingHi: null } }) }, 'Release overrides (automatic control)')),
    ),
    h('details', { class: 'panel' }, h('summary', {}, 'Experimental functions'),
      h('div', { class: 'exp-banner' }, 'Not original AP35 functions: POWERFUL and LONG exist only on AP60/71 (S2 p.24-25).'),
      slider('Eco power cap', 150, 2500, 25, () => ov().ecoCapW ?? 2500, (v) => void act({ type: 'override', patch: { ecoCapW: v >= 2500 ? null : v } }), 'W', 'Declared cap on total input; comfort may suffer. No fixed saving is claimed.'),
      checkbox('Turbo (15 min, higher demand within envelope)', () => ov().turbo, (v) => void act({ type: 'override', patch: { turbo: v } })),
      checkbox('Sleep schedule', () => ov().sleep, (v) => void act({ type: 'override', patch: { sleep: v } })),
      slider('Sleep setpoint drift', 0, 3, 0.25, () => ov().sleepRate, (v) => void act({ type: 'override', patch: { sleepRate: v } }), 'K/h'),
      slider('Sleep drift limit', 0, 4, 0.5, () => ov().sleepMax, (v) => void act({ type: 'override', patch: { sleepMax: v } }), 'K'),
    ),
    h('details', { class: 'panel' }, h('summary', {}, 'Conditions & room loads'),
      slider('Outdoor temperature', -20, 50, 0.5, () => env().outdoorT, (v) => void act({ type: 'env', patch: { outdoorT: v } }), '°C', 'Published cooling data to 46 °C; heating guaranteed to −15 °C.'),
      slider('Outdoor RH', 5, 100, 1, () => env().outdoorRH, (v) => void act({ type: 'env', patch: { outdoorRH: v } }), '%'),
      slider('Solar gain', 0, 2000, 25, () => env().solar, (v) => void act({ type: 'env', patch: { solar: v } }), 'W'),
      slider('Internal sensible gain', 0, 3000, 25, () => env().internal, (v) => void act({ type: 'env', patch: { internal: v } }), 'W'),
      slider('Occupants', 0, 8, 1, () => env().occupants, (v) => void act({ type: 'env', patch: { occupants: v } }), ''),
      slider('Infiltration', 0, 6, 0.1, () => env().ach, (v) => void act({ type: 'env', patch: { ach: v } }), '1/h'),
      checkbox('Door open (+6 1/h)', () => env().doorOpen, (v) => void act({ type: 'env', patch: { doorOpen: v } })),
      checkbox('Psychrometric chamber (hold indoor air at rating 27/19)', () => !!env().chamber, (v) => void act({ type: 'env', patch: { chamber: v ? { T: 27, RH: 46.4 } : null } }), 'Bypasses the room balance; used for rating-point checks'),
    ),
    h('details', { class: 'panel' }, h('summary', {}, 'Room & geometry (design)'),
      h('div', { class: 'small muted' }, 'Changes create or modify an experimental profile.'),
      slider('Unit top height', 1.9, 2.75, 0.01, P('mountH'), setP('mountH'), 'm', 'Supported: moves the outlet; jet and comfort update.'),
      slider('Unit position from left wall', 0.5, 3.5, 0.05, P('mountX'), setP('mountX'), 'm'),
      slider('Outlet opening height', 0.03, 0.12, 0.002, P('outletH'), setP('outletH'), 'm', 'Supported: free area → resistance → airflow on the fan curve, and jet velocity.'),
      slider('Outlet width', 0.3, 0.75, 0.01, P('outletW'), setP('outletW'), 'm'),
      slider('Vertical vane count', 6, 24, 1, P('vaneCount'), setP('vaneCount'), '', 'Visual-only geometry: no performance model; ranking disabled.'),
      slider('Room width', 2.5, 8, 0.1, P('roomW'), setP('roomW'), 'm', 'Thermal balance only; the 3D room is drawn at 4 × 4 m.'),
      slider('Room depth', 2.5, 8, 0.1, P('roomD'), setP('roomD'), 'm'),
      slider('Envelope UA (walls)', 0, 150, 1, P('uaMassOut'), setP('uaMassOut'), 'W/K'),
      slider('Thermal mass', 1e5, 5e6, 1e5, P('cMass'), setP('cMass'), 'J/K'),
      slider('Pipe length (geometry-only)', 3, 20, 0.5, P('pipeLen'), setP('pipeLen'), 'm', 'No documented line-loss model: does not change performance.'),
    ),
    h('details', { class: 'panel' }, h('summary', {}, 'Faults'),
      slider('Filter restriction', 0, 6, 0.1, () => flt().filterRestriction, (v) => void act({ type: 'faults', patch: { filterRestriction: v } }), '× extra', 'Raises filter resistance; airflow falls on the fan curve.'),
      slider('Indoor coil fouling', 0, 1, 0.05, () => flt().coilFouling, (v) => void act({ type: 'faults', patch: { coilFouling: v } }), ''),
      slider('Outdoor coil fouling', 0, 1, 0.05, () => flt().outdoorFouling, (v) => void act({ type: 'faults', patch: { outdoorFouling: v } }), ''),
      checkbox('Indoor fan seized', () => flt().indoorFanFault, (v) => void act({ type: 'faults', patch: { indoorFanFault: v } })),
      checkbox('Outdoor fan seized', () => flt().outdoorFanFault, (v) => void act({ type: 'faults', patch: { outdoorFanFault: v } })),
      checkbox('Indoor/outdoor communication lost', () => flt().commFault, (v) => void act({ type: 'faults', patch: { commFault: v } })),
      slider('Room sensor bias', -5, 5, 0.1, () => flt().roomSensorBias, (v) => void act({ type: 'faults', patch: { roomSensorBias: v } }), 'K'),
      slider('Coil sensor bias', -5, 5, 0.1, () => flt().coilSensorBias, (v) => void act({ type: 'faults', patch: { coilSensorBias: v } }), 'K'),
      h('div', { class: 'field' }, h('label', {}, 'Sensor open/short'), h('span'), selectCtl(['none', 'room', 'indoorCoil', 'discharge', 'outdoorCoil', 'ambient'], () => flt().sensorFail, (v) => void act({ type: 'faults', patch: { sensorFail: v as 'none' } }))),
      h('div', { class: 'small muted' }, 'Refrigerant charge faults are not offered: there is no inventory model. Fault codes are simulator identifiers (SIM-…), not manufacturer codes.'),
    ),
    h('details', { class: 'panel' }, h('summary', {}, 'Controller (advanced, surrogate)'),
      slider('PI gain Kp', 1, 80, 0.5, P('kp'), setP('kp'), 'Hz/K'),
      slider('PI integral Ki', 0, 0.2, 0.001, P('ki'), setP('ki'), 'Hz/(K·s)'),
      slider('Thermo-OFF offset', -3, 0, 0.1, P('thermoOff'), setP('thermoOff'), 'K'),
      slider('Thermo-ON offset', 0, 3, 0.1, P('thermoOn'), setP('thermoOn'), 'K'),
      slider('Superheat target', 1, 15, 0.5, P('shTarget'), setP('shTarget'), 'K'),
      slider('Ramp-up limit', 0.1, 5, 0.1, P('rampUp'), setP('rampUp'), 'Hz/s'),
      slider('Swing period', 4, 60, 1, P('swingPeriod'), setP('swingPeriod'), 's'),
    ),
    h('details', { class: 'panel' }, h('summary', {}, 'Virtual sensors'),
      slider('Sensor lag', 0, 120, 1, P('sensorTau'), setP('sensorTau'), 's', 'User assumption, not a real instrument spec.'),
      slider('Sample period', 0.5, 30, 0.5, P('sensorPeriod'), setP('sensorPeriod'), 's'),
      slider('Noise (1σ)', 0, 1, 0.01, P('sensorNoise'), setP('sensorNoise'), 'K'),
    ),
  );
}
function selectCtl(options: string[], get: () => string, set: (v: string) => void) {
  const s = h('select', { onchange: () => set(s.value) }, ...options.map((o) => h('option', { value: o }, o))) as HTMLSelectElement;
  ctls.push({ el: s, update: () => { if (document.activeElement !== s) s.value = get(); } });
  return s;
}

async function resetBaseline() {
  await applyProfile(null);
  await act({ type: 'override', patch: { manual: false, compHz: null, ifanRpm: null, ofanRpm: null, eevPct: null, vaneAngle: null, wideAngle: null, swingLo: null, swingHi: null, ecoCapW: null, turbo: false, sleep: false } });
  await act({ type: 'faults', patch: { filterRestriction: 0, coilFouling: 0, outdoorFouling: 0, indoorFanFault: false, outdoorFanFault: false, commFault: false, roomSensorBias: 0, coilSensorBias: 0, sensorFail: 'none' } });
  toast('Published baseline restored (profile, overrides and faults). Experiments are kept in Design Lab.');
}

// ---------------- Design Lab: profile manager
const labList = h('div');
function buildLabPanel(): HTMLElement {
  const name = h('input', { type: 'text', placeholder: 'experiment name' }) as HTMLInputElement;
  return h('div', { class: 'lab-only' },
    h('div', { class: 'panel' }, h('h3', {}, 'Design Lab · profiles'),
      h('div', { class: 'small muted' }, `The published reference "${REFERENCE_NAME}" is immutable. Experiments are named copies storing only their changes.`),
      h('div', { class: 'row', style: { margin: '6px 0' } }, name, h('button', { class: 'btn sm', onclick: () => { const n = name.value.trim() || `Experiment ${S.profiles.length + 1}`; if (S.profiles.some((p) => p.name === n)) { toast('Name exists'); return; } const p = newExperiment(n, activeProfile()); S.profiles.push(p); void applyProfile(n); name.value = ''; } }, 'New copy')),
      h('div', { class: 'row wrap' },
        h('button', { class: 'btn sm', onclick: () => undoRedo('undo') }, 'Undo'), h('button', { class: 'btn sm', onclick: () => undoRedo('redo') }, 'Redo'),
        h('button', { class: 'btn sm', onclick: () => applyProfile(null) }, 'Use reference'),
        h('button', { class: 'btn sm', onclick: () => { scene.setMode('indoor'); extras.enableHandles(true); } }, 'Edit outlet with 3D handles')),
      labList),
  );
}
function renderLab() {
  clear(labList);
  const list = h('div', { style: { marginTop: '8px' } },
    h('div', { class: 'row', style: { padding: '3px 0' } }, h('input', { type: 'radio', name: 'prof', checked: !S.active, onchange: () => applyProfile(null) }), h('b', {}, REFERENCE_NAME), h('span', { class: 'badge sourced' }, 'published')),
    ...S.profiles.map((p) => h('div', { class: 'row', style: { padding: '3px 0' } },
      h('input', { type: 'radio', name: 'prof', checked: S.active === p.name, onchange: () => applyProfile(p.name) }),
      h('span', { class: 'grow' }, p.name, h('span', { class: 'muted small' }, ` · ${Object.keys(p.overrides).length} changed${p.kind === 'calibrated' ? ' · calibrated' : ''}`)),
      h('button', { class: 'btn sm', title: 'Delete', onclick: () => { S.profiles = S.profiles.filter((x) => x !== p); if (S.active === p.name) void applyProfile(null); save(); notify(); } }, '✕'))));
  labList.append(list);
  const p = activeProfile();
  if (p) {
    const ch = changedParams(p);
    labList.append(h('h3', { style: { marginTop: '10px' } }, `Changed parameters (${ch.length})`),
      ...ch.map((c) => h('div', { class: 'row small', style: { padding: '2px 0', borderBottom: '1px dotted var(--line-2)' } },
        h('span', { class: 'grow' }, c.def.label, h('br'), h('span', { class: 'mono muted' }, `${fmtV(c.ref)} → ${fmtV(c.value)} ${c.def.unit}`)),
        h('span', { class: `badge ${c.def.editable === 'geometry' ? 'conceptual' : 'assumed'}` }, c.def.editable === 'geometry' ? 'visual-only' : 'model'),
        h('button', { class: 'btn sm', onclick: () => revert(c.key) }, 'Revert'))));
  }
}
const fmtV = (v: number) => (Math.abs(v) < 1e-3 || Math.abs(v) > 1e4 ? v.toExponential(3) : +v.toFixed(4) + '');

// ======================================================================= right column
const kpiT = kpi('Room temperature', 'Troom'), kpiQ = kpi('Useful capacity', 'Qnet'), kpiP = kpi('Electrical input', 'Ptotal');
const statePill = h('span', { class: 'pill' }, '—');
const stateWhy = h('div', { class: 'narr' });
const limitsEl = h('div', { class: 'limits' });
const flagsEl = h('div', { class: 'flags' });
const readTable = h('table', { class: 'read' });
function kpi(label: string, q: string) {
  const v = h('div', { class: 'v' }), d = h('div', { class: 'd' });
  const el = h('button', { class: 'kpi', title: 'Why did this change?', onclick: () => extras.explain(q) }, h('div', { class: 'k' }, label), v, d);
  return { el, v, d };
}
function buildRight(right: HTMLElement) {
  right.append(
    h('div', { class: 'panel' }, h('div', { class: 'kpis' }, kpiT.el, kpiQ.el, kpiP.el)),
    h('div', { class: 'panel' }, h('h3', {}, 'Controller', h('span', { class: 'spacer' }), h('span', { class: 'badge assumed', title: 'Surrogate of documented behaviour; not firmware' }, 'surrogate')), h('div', { class: 'state' }, statePill), stateWhy, limitsEl, flagsEl),
    h('div', { class: 'panel eng-only' }, h('h3', {}, 'Live measurements', h('span', { class: 'spacer' }), h('label', { class: 'small', style: { textTransform: 'none', letterSpacing: 0 } }, h('input', { type: 'checkbox', checked: S.gauge, onchange: (e: Event) => { S.gauge = (e.target as HTMLInputElement).checked; save(); } }), ' bar(g)')), readTable),
    h('div', { class: 'panel explore-only small muted' }, 'Switch to Engineer for refrigerant states, probes, sections and fault experiments; Design Lab for modified designs, comparisons and optimisation.'),
  );
}

type Row = [string, string, string?];
function refreshPanels() {
  const v = S.replay ?? S.view; if (!v) return;
  const o = v.out, s = v.s;
  timeEl.textContent = (S.replay ? 'REPLAY ' : '') + fmtTime(s.t);
  // start button
  const lock = v.lockoutLeft;
  if (s.remote.power) { startBtn.textContent = s.ctrl.sup === 'START_DELAY' ? `Waiting ${lock.toFixed(0)} s (3-min restart delay)` : 'Stop'; startBtn.className = 'startcta ' + (s.ctrl.sup === 'START_DELAY' ? 'wait' : 'stop'); }
  else { startBtn.textContent = s.remote.mode === 'heat' ? 'Start (HEAT selected)' : 'Start cooling'; startBtn.className = 'startcta'; }
  const hint = document.getElementById('startHint');
  if (hint) hint.textContent = !s.remote.power && lock > 0 ? `Compressor restart delay: ${lock.toFixed(0)} s left after the last stop (S2 9-13).` : '';
  // LCD
  const r = s.remote;
  lcd.innerHTML = `<div><div class="temp">${r.mode === 'dry' ? (s.ctrl.drySet?.toFixed(1) ?? '--') : r.mode === 'fan' ? '--' : r.setpoint.toFixed(1)}<small>°C</small></div><div>${r.power ? r.mode.toUpperCase() : 'OFF'}${r.econoCool ? ' · ECONO' : ''}${r.isave ? ' · i-save' : ''}</div></div>
   <div class="flags">FAN ${r.fan}<br>VANE ${r.vane}<br>WIDE ${r.wide}${r.nightMode ? '<br>NIGHT' : ''}${r.onTimer !== null ? '<br>ON ' + fmtTime(r.onTimer).slice(4, 9) : ''}${r.offTimer !== null ? '<br>OFF ' + fmtTime(r.offTimer).slice(4, 9) : ''}${r.weeklyOn ? '<br>WEEKLY' : ''}${r.opLock ? '<br>LOCK' : ''}</div>`;
  document.getElementById('powerBtn')?.classList.toggle('on', r.power);
  remoteBtns.econo?.classList.toggle('on', r.econoCool);
  remoteBtns.night?.classList.toggle('on', r.nightMode);
  remoteBtns.isave?.classList.toggle('on', r.isave);
  remoteBtns.lock?.classList.toggle('on', r.opLock);
  if (remoteBtns.econo) remoteBtns.econo.disabled = r.mode !== 'cool';
  if (remoteBtns.isave) remoteBtns.isave.disabled = r.mode === 'dry' || r.mode === 'auto';
  // KPIs
  kpiT.v.innerHTML = `${fmt(s.plant.Troom, 1)}<small> °C</small>`;
  kpiT.d.textContent = `target ${v.setpoint.toFixed(1)} °C · RH ${o ? (o.RHroom * 100).toFixed(0) : '—'} %`;
  const coolSide = o ? o.evapIsIndoor : true;
  kpiQ.v.innerHTML = o ? `${(o.Qnet / 1000).toFixed(2)}<small> kW ${o.Qnet >= 0 ? (coolSide ? 'cooling' : 'heating') : ''}</small>` : '—';
  kpiQ.d.textContent = o ? `sens ${(o.Qsens / 1000).toFixed(2)} · lat ${(o.Qlat / 1000).toFixed(2)} kW · SHR ${o.SHR !== null ? o.SHR.toFixed(2) : '—'}` : '';
  kpiP.v.innerHTML = o ? `${(o.Ptotal / 1000).toFixed(3)}<small> kW</small>` : '—';
  kpiP.d.textContent = o ? `COP ${o.COP !== null ? o.COP.toFixed(2) : '— (output too small)'} · ${s.plant.E_total.toFixed(3)} kWh` : '';
  // state + narration
  statePill.textContent = s.ctrl.sup; statePill.className = 'pill ' + s.ctrl.sup;
  if (S.lang === 'ar') { stateWhy.setAttribute('dir', 'rtl'); stateWhy.setAttribute('lang', 'ar'); stateWhy.textContent = NARRATION_AR[s.ctrl.narrationKey] ?? s.ctrl.narration; }
  else { stateWhy.removeAttribute('dir'); stateWhy.setAttribute('lang', 'en'); stateWhy.textContent = s.ctrl.narration; }
  const study = document.getElementById('studyLabel');
  if (study) { if (S.lang === 'ar') { study.textContent = UI_AR.independent; study.classList.add('ar'); } else { study.textContent = 'Independent study based on published Mitsubishi Electric documentation; unverified internals and dynamics are modelled.'; study.classList.remove('ar'); } }
  cfdNote.textContent = S.lang === 'ar' ? UI_AR.cfd : 'Approximate airflow model, not CFD validation';
  if (S.lang === 'ar') cfdNote.classList.add('ar'); else cfdNote.classList.remove('ar');
  const lims = Object.values(s.ctrl.limits).filter((l) => l.active);
  limitsEl.innerHTML = lims.length ? lims.map((l) => `<div class="l">▼ ${l.name}: cap ${l.cap.toFixed(0)} Hz</div>`).join('') : (s.ctrl.prot.envelope ? `<div class="l">${s.ctrl.prot.envelope}</div>` : '');
  flagsEl.textContent = o && o.flags.length ? '⚠ ' + o.flags.join(' · ') : '';
  // readouts
  if (S.workspace !== 'explore' && o) {
    const bar = (p: number) => S.gauge ? `${((p - s.env.patm) / 1e5).toFixed(2)} bar(g)` : `${(p / 1e5).toFixed(2)} bar(a)`;
    const rows: (Row | string)[] = [
      'Air',
      ['Return (room) air', `${o.Tret.toFixed(1)} °C · ${(o.RHroom * 100).toFixed(0)} %`, 'Troom'],
      ['Supply air', `${o.Tsup.toFixed(1)} °C · ${(o.RHsup * 100).toFixed(0)} %`, 'Qnet'],
      ['Thermal mass node', `${o.Tmass.toFixed(1)} °C`, 'Troom'],
      ['Outdoor in → leaving', `${o.ToutIn.toFixed(1)} → ${o.ToutLeave.toFixed(1)} °C`, 'Tc'],
      ['Indoor airflow', `${o.qIn.toFixed(0)} m³/h · Δp ${o.dpIn.toFixed(0)} Pa`, 'airflow'],
      ['Resistance ratio', `${o.resIn.total.toFixed(2)} (f ${o.resIn.filter.toFixed(2)} c ${o.resIn.coil.toFixed(2)} o ${o.resIn.outlet.toFixed(2)})`, 'airflow'],
      ['Outdoor airflow', `${o.qOut.toFixed(0)} m³/h`, 'Tc'],
      'Actuators',
      ['Compressor req / cmd / actual', `${s.ctrl.fReq.toFixed(0)} / ${o.fCmd.toFixed(1)} / ${o.fAct.toFixed(1)} Hz`, 'fAct'],
      ['Mechanical / electrical', `${o.rpmComp.toFixed(0)} rpm / ${o.fElec.toFixed(0)} Hz`, 'fAct'],
      ['Indoor fan cmd / actual', `${o.ifanCmd.toFixed(0)} / ${o.ifanAct.toFixed(0)} rpm`, 'airflow'],
      ['Outdoor fan cmd / actual', `${o.ofanCmd.toFixed(0)} / ${o.ofanAct.toFixed(0)} rpm`, 'Tc'],
      ['LEV cmd / actual', `${(o.eevCmd * 100).toFixed(0)} / ${(o.eevAct * 100).toFixed(0)} %`, 'Te'],
      ['Vanes upper / lower / wide', `${o.vaneUpper.toFixed(0)}° / ${o.vaneLower.toFixed(0)}° / ${o.wideAct.toFixed(0)}°`, 'airflow'],
      ['4-way valve', s.plant.rv > 0.5 ? 'HEAT position (R.V. on)' : 'COOL position', 'Qnet'],
      'Capacity & power',
      ['Useful (net) capacity', `${o.Qnet.toFixed(0)} W`, 'Qnet'],
      ['Gross coil capacity', `${o.Qgross.toFixed(0)} W`, 'Qnet'],
      ['Sensible / latent / SHR', `${o.Qsens.toFixed(0)} / ${o.Qlat.toFixed(0)} W / ${o.SHR !== null ? o.SHR.toFixed(2) : '—'}`, 'Qnet'],
      ['Compressor / fans / controls', `${o.Pcomp.toFixed(0)} / ${(o.Pifan + o.Pofan).toFixed(0)} / ${o.Pctrl.toFixed(0)} W`, 'Ptotal'],
      ['Total input · current', `${o.Ptotal.toFixed(0)} W · ${o.current.toFixed(2)} A (PF ${s.profile.pfCool})`, 'Ptotal'],
      ['COP · EER', `${o.COP !== null ? o.COP.toFixed(2) : '—'} · ${o.EER_btu !== null ? o.EER_btu.toFixed(1) + ' Btu/(W·h)' : '—'}`, 'Ptotal'],
      ['Energy (simulated time)', `${s.plant.E_total.toFixed(3)} kWh`, 'Ptotal'],
      ['Condensate rate · total', `${o.condRate.toFixed(2)} L/h · ${(s.plant.condensateL + s.plant.film).toFixed(2)} L`, 'Qnet'],
      'Refrigerant (CoolProp R32 tables)',
      ['High / low pressure', `${bar(o.Pc)} / ${bar(o.Pe)}`, 'Tc'],
      ['Condensing / evaporating sat.', `${o.Tc.toFixed(1)} / ${o.Te.toFixed(1)} °C`, 'Te'],
      ['Suction / discharge temp', `${o.Tsuct.toFixed(1)} / ${o.Tdis.toFixed(1)} °C`, 'Te'],
      ['SH evap outlet / comp inlet', `${o.SHevap.toFixed(1)} / ${o.SHsuct.toFixed(1)} K`, 'Te'],
      ['Subcooling (assumed)', `${o.SC.toFixed(1)} K`, 'Tc'],
      ['Mass flow comp / LEV', `${(o.m * 1000).toFixed(2)} / ${(o.mEev * 1000).toFixed(2)} g/s`, 'Te'],
      ['Coil surface in / out', `${o.coilInSurface.toFixed(1)} / ${o.coilOutSurface.toFixed(1)} °C`, 'Te'],
      ['Frost on outdoor coil', `${o.frost.toFixed(3)} kg`, 'Tc'],
      ['Core cycle residual', o.coreResidual !== null ? `${(o.coreResidual * 100).toFixed(2)} % (incl. storage transients)` : '—', 'Qnet'],
    ];
    readTable.innerHTML = rows.map((r2) => typeof r2 === 'string' ? `<tr class="sec"><td colspan="2">${r2}</td></tr>` : `<tr class="clickable" data-q="${r2[2] ?? ''}"><td>${r2[0]}</td><td>${r2[1]}</td></tr>`).join('');
    readTable.querySelectorAll('tr.clickable').forEach((tr) => tr.addEventListener('click', () => extras.explain((tr as HTMLElement).dataset.q || 'fAct')));
  }
  fidelityChip.textContent = o && o.flags.length ? 'Modelled ⚠' : 'Modelled ⓘ';
  for (const c of ctls) c.update();
  if (S.workspace === 'lab') renderLab();
  tabs.update();
  scene.updateHeatArrows();
  scene.setProbes(s.probes.map((p) => ({ id: p.def.id, pos: p.def.pos, kind: p.def.kind })));
  notify();
}

export { PARTS };

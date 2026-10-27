/** Client-side app state: latest frame, accumulated history, preferences and persisted experiment profiles. */
import { HISTORY_CHANNELS, type Channel, type SimEvent } from '../sim/engine';
import type { SimView } from '../scene/viewTypes';
import type { FieldMsg, JetMsg } from '../scene/airflowViz';
import { newExperiment, type ExperimentProfile } from '../config/profiles';
import type { Lang } from './i18n';

export const STORE_KEY = 'ap35-bench.v1';
export const STORE_VERSION = 1;

export interface Persisted { version: number; profiles: ExperimentProfile[]; active: string | null; lang: Lang; workspace: Workspace; gauge: boolean; reducedMotion: boolean }
export type Workspace = 'explore' | 'engineer' | 'lab';

export const S = {
  view: null as SimView | null,
  replay: null as SimView | null,
  field: null as FieldMsg | null,
  jet: null as JetMsg | null,
  running: true,
  speed: 1,
  startTime: 0,
  hist: Object.fromEntries(HISTORY_CHANNELS.map((c) => [c, [] as number[]])) as Record<Channel, number[]>,
  events: [] as SimEvent[],
  snapshots: [] as number[],
  inputs: 0,
  workspace: 'explore' as Workspace,
  lang: 'en' as Lang,
  gauge: false,
  reducedMotion: false,
  sound: false,
  profiles: [] as ExperimentProfile[],
  active: null as string | null,
  trainingFault: null as null | { id: string; label: string; revealed: boolean },
  probeHist: new Map<string, { t: number[]; ideal: number[]; virt: number[] }>(),
  recoveryNote: '' as string,
  listeners: new Set<() => void>(),
};

export function activeProfile(): ExperimentProfile | null { return S.profiles.find((p) => p.name === S.active) ?? null; }

export function resetHistory() {
  for (const c of HISTORY_CHANNELS) S.hist[c] = [];
  S.events = []; S.probeHist.clear();
}

export function appendHistory(h: Record<string, number[]>) {
  const cap = 20000;
  for (const c of HISTORY_CHANNELS) {
    const add = h[c]; if (!add || !add.length) continue;
    const arr = S.hist[c];
    for (const v of add) arr.push(v);
    if (arr.length > cap) arr.splice(0, arr.length - cap);
  }
}

export function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return;
    const p = JSON.parse(raw) as Persisted;
    if (p.version !== STORE_VERSION || !Array.isArray(p.profiles)) throw new Error('incompatible saved data version');
    S.profiles = p.profiles.filter((x) => x && typeof x.name === 'string' && x.overrides && typeof x.overrides === 'object').map((x) => ({ ...newExperiment(x.name), ...x, history: [], future: [] }));
    S.active = S.profiles.some((x) => x.name === p.active) ? p.active : null;
    S.lang = p.lang === 'ar' ? 'ar' : 'en';
    S.workspace = (['explore', 'engineer', 'lab'] as Workspace[]).includes(p.workspace) ? p.workspace : 'explore';
    S.gauge = !!p.gauge; S.reducedMotion = !!p.reducedMotion;
  } catch (e) {
    try { const raw = localStorage.getItem(STORE_KEY); if (raw) localStorage.setItem(STORE_KEY + '.corrupt-backup', raw); localStorage.removeItem(STORE_KEY); } catch { /* storage unavailable */ }
    S.recoveryNote = `Saved data could not be read (${e instanceof Error ? e.message : String(e)}). It was moved to a backup key and defaults were loaded.`;
  }
}

export function save() {
  try {
    const p: Persisted = { version: STORE_VERSION, profiles: S.profiles.map((x) => ({ ...x, history: [], future: [] })), active: S.active, lang: S.lang, workspace: S.workspace, gauge: S.gauge, reducedMotion: S.reducedMotion };
    localStorage.setItem(STORE_KEY, JSON.stringify(p));
  } catch { /* private mode etc. */ }
}

export function notify() { for (const f of S.listeners) f(); }

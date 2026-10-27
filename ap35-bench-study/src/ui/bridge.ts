/** Worker bridge: live simulation worker and batch worker with request/response ids. */
import type { Action } from '../sim/schema';
import type { InitSpec, SimState, ProbeDef } from '../sim/engine';

type Handler = (m: Record<string, unknown>) => void;

export class Bridge {
  live: Worker; batch: Worker;
  private seq = 1;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; progress?: (f: number, partial?: unknown) => void; batch?: boolean }>();
  onFrame: Handler = () => {};
  onReset: Handler = () => {};
  onReplay: Handler = () => {};

  constructor() {
    this.live = new Worker(new URL('../sim/worker.ts', import.meta.url), { type: 'module' });
    this.live.postMessage({ type: 'role', role: 'live' });
    this.live.onmessage = (e) => this.handle(e.data);
    this.batch = this.spawnBatch();
  }
  private spawnBatch() {
    const w = new Worker(new URL('../sim/worker.ts', import.meta.url), { type: 'module' });
    w.postMessage({ type: 'role', role: 'batch' });
    w.onmessage = (e) => this.handle(e.data);
    return w;
  }
  private handle(m: Record<string, unknown>) {
    if (m.type === 'frame') return this.onFrame(m);
    if (m.type === 'reset') return this.onReset(m);
    if (m.type === 'replayReady') return this.onReplay(m);
    const id = m.id as number | undefined;
    if (id === undefined) return;
    const p = this.pending.get(id);
    if (!p) return;
    if (m.type === 'progress') { p.progress?.(m.f as number); return; }
    if (m.type === 'partial') { p.progress?.(-1, m.candidates); return; }
    this.pending.delete(id);
    if (m.type === 'error') p.reject(new Error(String(m.error)));
    else p.resolve(m.result ?? m);
  }
  private req(w: Worker, msg: Record<string, unknown>, progress?: (f: number, partial?: unknown) => void): Promise<unknown> {
    const id = this.seq++;
    return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject, progress, batch: w === this.batch }); w.postMessage({ ...msg, id }); });
  }
  init(spec: InitSpec, run = true) { this.live.postMessage({ type: 'init', spec, run }); }
  loadState(state: SimState) { this.live.postMessage({ type: 'loadState', state }); }
  act(action: Action) { return this.req(this.live, { type: 'action', action }) as Promise<{ ok: boolean; error?: string }>; }
  run(on: boolean) { this.live.postMessage({ type: 'run', on }); }
  speed(s: number) { this.live.postMessage({ type: 'speed', speed: s }); }
  step(seconds: number) { this.live.postMessage({ type: 'step', seconds }); }
  addProbe(probe: ProbeDef) { return this.req(this.live, { type: 'addProbe', probe }) as Promise<{ ok: boolean; error?: string }>; }
  removeProbe(probeId: string) { this.live.postMessage({ type: 'removeProbe', probeId }); }
  setZone(zone: unknown) { this.live.postMessage({ type: 'setZone', zone }); }
  explain(quantity: string) { return this.req(this.live, { type: 'explain', quantity }); }
  getRun() { return this.req(this.live, { type: 'getRun' }); }
  cfInputs(inputIndex: number) { return this.req(this.live, { type: 'getCounterfactualInputs', inputIndex }); }
  replayTo(t: number) { this.live.postMessage({ type: 'replayTo', t }); }
  replayClose() { this.live.postMessage({ type: 'replayClose' }); }
  branch() { this.live.postMessage({ type: 'branch' }); }
  diagnose() { return this.req(this.live, { type: 'diagnose' }); }
  visibility(hidden: boolean) { this.live.postMessage({ type: 'visibility', hidden }); }
  job(msg: Record<string, unknown>, progress?: (f: number, partial?: unknown) => void) { return this.req(this.batch, msg, progress); }
  /**
   * Cooperative cancel first (the batch worker yields between runs and inside
   * long runs, returning partial results). If the job has not returned within
   * 2 s the batch worker is terminated and respawned; its pending jobs reject.
   */
  cancelJob() {
    const ids = [...this.pending.entries()].filter(([, p]) => p.batch).map(([id]) => id);
    if (!ids.length) return;
    this.batch.postMessage({ type: 'cancel' });
    setTimeout(() => {
      const still = ids.filter((id) => this.pending.has(id));
      if (!still.length) return;
      this.batch.terminate();
      for (const id of still) { this.pending.get(id)!.reject(new Error('Cancelled (batch worker stopped)')); this.pending.delete(id); }
      this.batch = this.spawnBatch();
    }, 2000);
  }
}

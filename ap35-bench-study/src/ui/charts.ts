/** Lightweight canvas line chart with labelled axes, selectable traces and a time cursor. */
import { h } from './dom';

export interface Trace { key: string; label: string; color: string; unit: string; axis?: 'L' | 'R'; on?: boolean; dash?: number[] }

export class LineChart {
  el: HTMLElement;
  canvas: HTMLCanvasElement;
  traces: Trace[];
  title: string;
  fixed?: { L?: [number, number]; R?: [number, number] };
  onClick?: (key: string) => void;
  constructor(title: string, traces: Trace[], opts: { fixed?: { L?: [number, number]; R?: [number, number] }; onTitle?: () => void } = {}) {
    this.title = title; this.traces = traces.map((t) => ({ on: true, axis: 'L', ...t })); this.fixed = opts.fixed;
    this.canvas = h('canvas', { role: 'img', 'aria-label': title });
    const ct = h('div', { class: 'ct' }, h('b', { style: { cursor: opts.onTitle ? 'pointer' : 'default' }, onclick: opts.onTitle }, title),
      ...this.traces.map((t) => {
        const cb = h('input', { type: 'checkbox', checked: t.on }) as HTMLInputElement;
        cb.onchange = () => { t.on = cb.checked; };
        return h('label', {}, cb, h('span', { class: 'sw', style: { background: t.color } }), t.label);
      }));
    this.el = h('div', { class: 'chart' }, ct, this.canvas);
  }
  draw(data: Record<string, ArrayLike<number>>, xKey = 't', x0 = 0, cursor: number | null = null) {
    const c = this.canvas, dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = c.clientWidth, hh = c.clientHeight;
    if (w < 10 || hh < 10) return;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(hh * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(hh * dpr); }
    const g = c.getContext('2d')!; g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, hh);
    const X = data[xKey]; if (!X || X.length < 2) { g.fillStyle = '#8a857a'; g.font = '11px system-ui'; g.fillText('waiting for data…', 8, 20); return; }
    const pad = { l: 40, r: 40, t: 6, b: 18 };
    const n = X.length;
    const xs = (X[0] - x0) / 60, xe = (X[n - 1] - x0) / 60;
    const range = (axis: 'L' | 'R'): [number, number] | null => {
      if (this.fixed?.[axis]) return this.fixed[axis]!;
      let lo = Infinity, hi = -Infinity;
      for (const t of this.traces) if (t.on && t.axis === axis && data[t.key]) { const a = data[t.key]; for (let i = 0; i < a.length; i++) { const v = a[i]; if (Number.isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); } } }
      if (!Number.isFinite(lo)) return null;
      if (hi - lo < 1e-6) { hi += 1; lo -= 1; }
      const m = (hi - lo) * 0.08; return [lo - m, hi + m];
    };
    const rL = range('L'), rR = range('R');
    const px = (t: number) => pad.l + ((t - xs) / Math.max(1e-6, xe - xs)) * (w - pad.l - pad.r);
    const py = (v: number, r: [number, number]) => hh - pad.b - ((v - r[0]) / (r[1] - r[0])) * (hh - pad.t - pad.b);
    g.strokeStyle = '#e7e1d5'; g.lineWidth = 1; g.font = '10px ' + getComputedStyle(document.body).getPropertyValue('--mono'); g.fillStyle = '#8a857a';
    const ticks = (r: [number, number]) => { const s = niceStep((r[1] - r[0]) / 4); const out: number[] = []; for (let v = Math.ceil(r[0] / s) * s; v <= r[1]; v += s) out.push(v); return out; };
    const dec = (r: [number, number]) => { const st = niceStep((r[1] - r[0]) / 4); return st >= 1 ? 0 : Math.min(3, Math.ceil(-Math.log10(st))); };
    if (rL) { const d = dec(rL); for (const v of ticks(rL)) { const y = py(v, rL); g.beginPath(); g.moveTo(pad.l, y); g.lineTo(w - pad.r, y); g.stroke(); g.textAlign = 'right'; g.fillText(fmtTick(v, d), pad.l - 4, y + 3); } }
    if (rR) { const d = dec(rR); for (const v of ticks(rR)) { const y = py(v, rR); g.textAlign = 'left'; g.fillText(fmtTick(v, d), w - pad.r + 4, y + 3); } }
    const tx = ticks([xs, xe]); const dx = xe - xs < 4 ? 1 : 0;
    g.textAlign = 'center';
    for (const t of tx) { const x = px(t); g.fillText(t.toFixed(dx), x, hh - 5); }
    g.textAlign = 'left'; g.fillText('min', w - pad.r + 4, hh - 5);
    const unitsL = [...new Set(this.traces.filter((t) => t.on && t.axis === 'L').map((t) => t.unit))].join(', ');
    const unitsR = [...new Set(this.traces.filter((t) => t.on && t.axis === 'R').map((t) => t.unit))].join(', ');
    g.save(); g.translate(10, hh / 2); g.rotate(-Math.PI / 2); g.textAlign = 'center'; g.fillText(unitsL, 0, 0); g.restore();
    if (unitsR) { g.save(); g.translate(w - 8, hh / 2); g.rotate(Math.PI / 2); g.textAlign = 'center'; g.fillText(unitsR, 0, 0); g.restore(); }
    for (const t of this.traces) {
      if (!t.on || !data[t.key]) continue;
      const r = t.axis === 'R' ? rR : rL; if (!r) continue;
      const a = data[t.key];
      g.strokeStyle = t.color; g.lineWidth = 1.6; g.setLineDash(t.dash ?? []);
      g.beginPath(); let pen = false;
      const stride = Math.max(1, Math.floor(n / (w * 1.5)));
      for (let i = 0; i < n; i += stride) { const v = a[i]; if (!Number.isFinite(v)) { pen = false; continue; } const x = px((X[i] - x0) / 60), y = py(v, r); if (!pen) { g.moveTo(x, y); pen = true; } else g.lineTo(x, y); }
      g.stroke(); g.setLineDash([]);
    }
    if (cursor !== null) { const x = px((cursor - x0) / 60); g.strokeStyle = '#c4161c'; g.beginPath(); g.moveTo(x, pad.t); g.lineTo(x, hh - pad.b); g.stroke(); }
  }
}
function niceStep(raw: number) { const p = Math.pow(10, Math.floor(Math.log10(Math.max(1e-9, raw)))); const f = raw / p; return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p; }
function fmtTick(v: number, d?: number) { const a = Math.abs(v); if (a >= 1000) return (v / 1000).toFixed(d !== undefined && d > 0 ? 2 : 1) + 'k'; return d !== undefined ? v.toFixed(d) : a >= 10 ? v.toFixed(0) : a >= 1 ? v.toFixed(1) : v.toFixed(2); }

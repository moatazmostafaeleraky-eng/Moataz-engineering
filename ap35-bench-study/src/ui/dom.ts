/** Minimal DOM helpers (no framework). */
export type Child = Node | string | number | null | undefined | false;
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, unknown> = {}, ...children: (Child | Child[])[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = String(v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    else if (k === 'html') el.innerHTML = String(v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}
export function clear(el: Element) { while (el.firstChild) el.removeChild(el.firstChild); return el; }
export const fmt = (v: number | null | undefined, d = 1, unit = '') => (v === null || v === undefined || !Number.isFinite(v) ? '—' : v.toFixed(d) + (unit ? ' ' + unit : ''));
export function fmtTime(s: number) {
  const day = Math.floor(s / 86400) % 7, r = s % 86400;
  const hh = Math.floor(r / 3600), mm = Math.floor((r % 3600) / 60), ss = Math.floor(r % 60);
  return `${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][day]} ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}
export function fmtDur(s: number | null | undefined) {
  if (s === null || s === undefined || !Number.isFinite(s)) return '—';
  if (s < 90) return `${s.toFixed(0)} s`;
  return `${(s / 60).toFixed(1)} min`;
}
export function download(name: string, data: string | Blob, type = 'text/plain') {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; document.body.append(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
export function toast(msg: string, ms = 2800) {
  const t = h('div', { class: 'toast', role: 'status' }, msg);
  document.body.append(t);
  setTimeout(() => t.remove(), ms);
}
export function modal(title: string, body: Node, opts: { wide?: boolean; onClose?: () => void } = {}) {
  const close = () => { bg.remove(); opts.onClose?.(); document.removeEventListener('keydown', esc); };
  const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
  const bg = h('div', { class: 'modal-bg', onclick: (e: Event) => { if (e.target === bg) close(); } },
    h('div', { class: 'modal', role: 'dialog', 'aria-label': title, style: opts.wide ? { maxWidth: '1100px' } : undefined },
      h('button', { class: 'btn sm close', onclick: close }, 'Close'), h('h2', {}, title), body));
  document.body.append(bg);
  document.addEventListener('keydown', esc);
  return close;
}
export function isTyping(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
}
export function readFile(accept: string): Promise<string> {
  return new Promise((res, rej) => {
    const i = h('input', { type: 'file', accept }) as HTMLInputElement;
    i.onchange = () => { const f = i.files?.[0]; if (!f) return rej(new Error('no file')); const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(r.error); r.readAsText(f); };
    i.click();
  });
}

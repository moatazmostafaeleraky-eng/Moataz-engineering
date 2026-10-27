import './ui/styles.css';
import { startApp } from './ui/app';
import { toast } from './ui/dom';

// A cancelled batch job rejects its promise; tell the user instead of leaving an
// unhandled rejection. Anything else is still reported as an error.
window.addEventListener('unhandledrejection', (ev) => {
  const msg = ev.reason instanceof Error ? ev.reason.message : String(ev.reason);
  if (/^Cancelled/.test(msg)) { ev.preventDefault(); toast('Job cancelled: no result was produced.'); return; }
  toast(`Job failed: ${msg}`, 5000);
});

const root = document.getElementById('app')!;
try {
  startApp(root);
} catch (e) {
  root.innerHTML = `<div style="padding:24px;font:14px system-ui">The 3D bench study could not start: ${String(e instanceof Error ? e.message : e)}. A browser with WebGL and module Web Workers is required.</div>`;
  throw e;
}

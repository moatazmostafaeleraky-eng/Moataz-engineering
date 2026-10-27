/** Live P-h diagram: log pressure axis, R32 saturation dome from the CoolProp tables, solver state points. */
import { dome, R32_META } from '../props/r32';
import type { Outputs } from '../model/types';

const D = dome();

export function drawPH(c: HTMLCanvasElement, o: Outputs | null, opts: { gauge: boolean; patm: number; heat: boolean }) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = c.clientWidth, hh = c.clientHeight; if (w < 20 || hh < 20) return;
  if (c.width !== Math.round(w * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(hh * dpr); }
  const g = c.getContext('2d')!; g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, hh);
  const pad = { l: 52, r: 12, t: 12, b: 28 };
  const hMin = 150e3, hMax = 650e3, pMin = 4e5, pMax = 50e5;
  const X = (hv: number) => pad.l + ((hv - hMin) / (hMax - hMin)) * (w - pad.l - pad.r);
  const Y = (p: number) => hh - pad.b - ((Math.log(p) - Math.log(pMin)) / (Math.log(pMax) - Math.log(pMin))) * (hh - pad.t - pad.b);
  g.font = '10px monospace'; g.fillStyle = '#8a857a'; g.strokeStyle = '#ece6da';
  for (const p of [4e5, 5e5, 7e5, 10e5, 15e5, 20e5, 30e5, 40e5, 50e5]) {
    const y = Y(p); g.beginPath(); g.moveTo(pad.l, y); g.lineTo(w - pad.r, y); g.stroke();
    const shown = opts.gauge ? (p - opts.patm) / 1e5 : p / 1e5;
    g.textAlign = 'right'; g.fillText(shown.toFixed(shown < 10 ? 1 : 0), pad.l - 4, y + 3);
  }
  for (let hv = 200e3; hv <= 600e3; hv += 100e3) { const x = X(hv); g.beginPath(); g.moveTo(x, pad.t); g.lineTo(x, hh - pad.b); g.stroke(); g.textAlign = 'center'; g.fillText((hv / 1000).toFixed(0), x, hh - pad.b + 12); }
  g.textAlign = 'center'; g.fillText('specific enthalpy h [kJ/kg]  (CoolProp reference)', (pad.l + w - pad.r) / 2, hh - 4);
  g.save(); g.translate(12, hh / 2); g.rotate(-Math.PI / 2); g.fillText(`pressure [bar${opts.gauge ? '(g)' : '(a)'}], log scale`, 0, 0); g.restore();
  // dome
  g.strokeStyle = '#6d6a62'; g.lineWidth = 1.4; g.beginPath();
  D.P.forEach((p, i) => { const x = X(D.hl[i]), y = Y(p); if (i === 0) g.moveTo(x, y); else g.lineTo(x, y); });
  for (let i = D.P.length - 1; i >= 0; i--) g.lineTo(X(D.hv[i]), Y(D.P[i]));
  g.stroke();
  g.fillStyle = '#8a857a'; g.textAlign = 'left'; g.fillText('R32 saturation dome · ' + R32_META.backend, pad.l + 4, pad.t + 10);
  if (!o || !o.points || !o.running) { g.fillStyle = '#5b5850'; g.font = '12px system-ui'; g.textAlign = 'center'; g.fillText('Compressor stopped: no cycle to plot', w / 2, hh / 2); return; }
  const pts = o.points;
  const seq = [pts.p1, pts.p2, pts.p3, pts.p4, pts.p1e, pts.p1];
  g.strokeStyle = '#c4161c'; g.lineWidth = 2; g.beginPath();
  seq.forEach((p, i) => { const x = X(p.h), y = Y(p.P); if (i === 0) g.moveTo(x, y); else g.lineTo(x, y); });
  g.stroke();
  const lab: [typeof pts.p1, string][] = [[pts.p1, '1'], [pts.p2, '2'], [pts.p3, '3'], [pts.p4, '4']];
  g.font = 'bold 11px system-ui';
  for (const [p, l] of lab) {
    const x = X(p.h), y = Y(p.P);
    g.fillStyle = '#c4161c'; g.beginPath(); g.arc(x, y, 3.5, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#23221f'; g.textAlign = l === '3' || l === '4' ? 'right' : 'left';
    g.fillText(`${l}  ${p.T.toFixed(1)}°C`, x + (l === '3' || l === '4' ? -6 : 6), y + (l === '1' || l === '4' ? 14 : -6));
  }
  g.font = '10.5px system-ui'; g.fillStyle = '#5b5850'; g.textAlign = 'right';
  const role = opts.heat ? 'HEAT: indoor coil condenses, outdoor coil evaporates; the cycle itself is unchanged.' : 'COOL: indoor coil evaporates, outdoor coil condenses.';
  g.fillText(role, w - pad.r - 4, hh - pad.b - 22);
  g.fillText(`1 suction (${pts.p1.phase}) · 2 discharge · 3 condenser outlet (${pts.p3.phase}) · 4 after LEV (x=${pts.p4.x !== null ? pts.p4.x.toFixed(2) : '-'})`, w - pad.r - 4, hh - pad.b - 8);
}

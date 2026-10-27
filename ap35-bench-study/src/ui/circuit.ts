/** Refrigeration circuit schematic (S3 p.18 topology) with live states and flow direction per mode. */
import { tempCss } from '../scene/kit';
import type { Outputs } from '../model/types';

export function circuitSVG(o: Outputs | null, rv: number, opts: { gauge: boolean; patm: number }): string {
  const heat = rv > 0.5;
  const run = !!o && o.running;
  const T = (v: number) => (run ? tempCss(v, -5, 95) : '#b9b2a5');
  const bar = (p: number) => (opts.gauge ? (p - opts.patm) / 1e5 : p / 1e5).toFixed(2) + (opts.gauge ? ' bar(g)' : ' bar(a)');
  const Te = o?.Te ?? 20, Tc = o?.Tc ?? 20, T2 = o?.T2 ?? 20, SC = o?.SC ?? 0, SH = o?.SHevap ?? 0;
  // colours per segment as in the 3D pipes
  const c = heat
    ? { dis: T(T2), gasLine: T(T2 - 5), inCoil: T(Tc), liq: T(Tc - SC), levOut: T(Te), outCoil: T(Te), fwvOut: T(Te + SH), suct: T(Te + SH) }
    : { dis: T(T2), fwvOut: T(T2 - 3), outCoil: T(Tc), liq: T(Tc - SC), levOut: T(Te), inCoil: T(Te), gasLine: T(Te + SH), suct: T(Te + SH) };
  const arrow = (x: number, y: number, ang: number, col: string) => run ? `<path d="M${x},${y} l-7,-4 l0,8 z" fill="${col}" transform="rotate(${ang} ${x} ${y})"/>` : '';
  const s = (col: string, d: string, wdt = 4) => `<path d="${d}" stroke="${col}" stroke-width="${wdt}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
  const txt = (x: number, y: number, t: string, a = 'start', cls = '') => `<text x="${x}" y="${y}" text-anchor="${a}" class="${cls}">${t}</text>`;
  const liqLineLabel = heat ? 'liquid line 6.35: HIGH-pressure liquid' : 'liquid line 6.35: LOW-pressure two-phase';
  const gasLabel = heat ? 'gas line 9.52: hot discharge gas' : 'gas line 9.52: suction gas';
  return `<svg viewBox="0 0 760 210" width="100%" height="100%" font-family="system-ui" font-size="10.5">
  <style>.t{fill:#23221f}.m{fill:#5b5850}.h{font-weight:600}</style>
  <rect x="8" y="16" width="190" height="180" rx="10" fill="#fbfaf6" stroke="#d9d2c4"/>${txt(18, 32, 'INDOOR MSZ-AP35VGK', 'start', 'h')}
  <rect x="300" y="16" width="452" height="180" rx="10" fill="#fbfaf6" stroke="#d9d2c4"/>${txt(310, 32, 'OUTDOOR MUZ-AP35VG', 'start', 'h')}
  <line x1="248" y1="10" x2="248" y2="204" stroke="#bdb3a1" stroke-dasharray="4 3"/>${txt(248, 205, 'wall', 'middle', 'm')}
  <!-- indoor coil -->
  <rect x="40" y="70" width="100" height="70" rx="6" fill="none" stroke="${heat ? c.inCoil : c.inCoil}" stroke-width="3"/>
  ${txt(90, 100, 'indoor coil', 'middle', 't')}${txt(90, 114, heat ? 'CONDENSER' : 'EVAPORATOR', 'middle', 'h')}
  ${txt(90, 128, run ? (heat ? `Tc ${Tc.toFixed(1)}°C` : `Te ${Te.toFixed(1)}°C`) : 'no flow', 'middle', 'm')}
  <!-- interconnects -->
  ${s(heat ? c.gasLine : c.gasLine, 'M140,80 L470,80 L470,60', 6)}${txt(200, 74, gasLabel, 'start', 'm')}
  ${s(c.liq === undefined ? '#999' : heat ? c.liq : c.levOut, 'M140,130 L620,130', 3)}${txt(200, 146, liqLineLabel, 'start', 'm')}
  ${heat ? arrow(320, 80, 180, c.gasLine) : arrow(320, 80, 0, c.gasLine)}${heat ? arrow(330, 130, 0, c.liq) : arrow(330, 130, 180, c.levOut)}
  <!-- 4-way valve -->
  <rect x="455" y="40" width="40" height="22" rx="4" fill="#fff" stroke="#23221f"/>${txt(475, 55, '4WV', 'middle', 'h')}
  ${txt(500, 52, heat ? 'R.V. coil ON' : 'R.V. coil OFF', 'start', 'm')}
  <!-- compressor -->
  <circle cx="395" cy="95" r="22" fill="#2d2c2a"/><text x="395" y="99" text-anchor="middle" fill="#fff" font-weight="600">COMP</text>
  ${txt(395, 128, run ? `${(o!.fAct).toFixed(0)} Hz` : 'stopped', 'middle', 'm')}
  ${s(c.dis, 'M395,73 L395,50 L455,50', 4)}${arrow(440, 50, 0, c.dis)}
  ${s(c.suct, 'M455,58 L430,58 L430,95 L417,95', 4)}
  <rect x="352" y="62" width="14" height="40" rx="5" fill="#2d2c2a"/>${txt(348, 115, 'acc.', 'end', 'm')}
  <!-- outdoor coil -->
  <rect x="560" y="44" width="120" height="50" rx="6" fill="none" stroke="${c.outCoil}" stroke-width="3"/>
  ${txt(620, 64, 'outdoor coil', 'middle', 't')}${txt(620, 78, heat ? 'EVAPORATOR' : 'CONDENSER', 'middle', 'h')}
  ${txt(620, 90, run ? (heat ? `Te ${Te.toFixed(1)}°C` : `Tc ${Tc.toFixed(1)}°C`) : '', 'middle', 'm')}
  ${s(c.fwvOut, 'M495,50 L560,50', 4)}${heat ? arrow(520, 50, 180, c.fwvOut) : arrow(540, 50, 0, c.fwvOut)}
  ${s(c.liq, 'M680,80 L720,80 L720,130 L690,130', 3)}
  <!-- LEV + capillary -->
  <rect x="660" y="122" width="26" height="16" rx="3" fill="#fff" stroke="#23221f"/>${txt(673, 134, 'LEV', 'middle', 'h')}
  ${txt(640, 160, 'capillary 4.0x2.4x240 + strainer #100', 'middle', 'm')}
  ${s(heat ? c.liq : c.levOut, 'M660,130 L620,130', 3)}
  ${run ? txt(730, 110, heat ? 'expansion →' : '← expansion', 'end', 'm') : ''}
  <!-- pressures -->
  ${run ? txt(310, 185, `HP ${bar(o!.Pc)} · LP ${bar(o!.Pe)} · discharge ${o!.T2.toFixed(0)}°C · SH evap ${o!.SHevap.toFixed(1)} K · SC ${o!.SC.toFixed(1)} K (assumed) · m ${(o!.m * 1000).toFixed(1)} g/s`, 'start', 'm') : txt(310, 185, 'Compressor stopped: pressures equalising', 'start', 'm')}
  ${txt(18, 185, 'colours = computed local temperature (−5…95 °C)', 'start', 'm')}
</svg>`;
}

/**
 * Approximate room-air distribution: an entraining, buoyant supply jet traced
 * from the actual outlet geometry and vane angles, plus a coarse zonal grid of
 * velocity and temperature. NOT CFD. Temperature deviations are constrained so
 * the volume-weighted mean equals the room-balance temperature, so louver
 * direction redistributes air but cannot create cooling energy.
 *
 * Room frame: x across the wall (0..W), y up (0..H), z into the room from the
 * wall carrying the indoor unit (0..D). The outdoor unit is at z < 0.
 */
import type { ProfileValues } from '../config/registry';

export interface Obstacle { name: string; min: [number, number, number]; max: [number, number, number] }
export const DEFAULT_OBSTACLES: Obstacle[] = [
  { name: 'desk', min: [0.25, 0, 2.2], max: [1.45, 0.75, 2.9] },
  { name: 'bed', min: [2.3, 0, 1.5], max: [3.9, 0.5, 3.2] },
  { name: 'wardrobe', min: [3.35, 0, 3.35], max: [3.95, 2.0, 3.95] },
];

export interface JetPoint { p: [number, number, number]; d: [number, number, number]; u: number; dT: number; b: number; s: number }
export interface Jet { pts: JetPoint[]; throw: number | null; u0: number; dT0: number; a0: number; q: number; attached: string[] }

export interface FieldGrid {
  nx: number; ny: number; nz: number; dx: number; dy: number; dz: number;
  T: Float32Array; v: Float32Array; vx: Float32Array; vy: Float32Array; vz: Float32Array;
}

export interface FieldInputs {
  q_m3h: number; area: number; Tsup: number; Troom: number;
  vaneDeg: number; wideDeg: number; outletOpen: number;
}

export function outletPose(P: ProfileValues): { pos: [number, number, number]; ret: [number, number, number] } {
  const top = P.mountH, h = P.indoorH / 1000, d = P.indoorD / 1000;
  return { pos: [P.mountX, top - h + 0.04, d * 0.62], ret: [P.mountX, top + 0.02, d * 0.45] };
}

const G = 9.81;
/** Trace the supply jet centreline. */
export function traceJet(P: ProfileValues, fi: FieldInputs, obstacles: Obstacle[] = DEFAULT_OBSTACLES): Jet {
  const pts: JetPoint[] = [];
  const attached: string[] = [];
  const q = fi.q_m3h / 3600;
  const a0 = Math.max(1e-3, fi.area);
  if (q < 1e-4 || fi.outletOpen < 0.05) return { pts, throw: null, u0: 0, dT0: 0, a0, q, attached };
  const u0 = q / a0;
  const dT0 = fi.Tsup - fi.Troom;
  const W = P.roomW, H = P.roomH, D = P.roomD;
  const th = (fi.vaneDeg * Math.PI) / 180, ph = (fi.wideDeg * Math.PI) / 180;
  let d: [number, number, number] = [Math.cos(th) * Math.sin(ph), -Math.sin(th), Math.cos(th) * Math.cos(ph)];
  let p: [number, number, number] = [...outletPose(P).pos];
  const ds = 0.05;
  const s0 = P.jetK * Math.sqrt(a0); // potential-core length (u = u0 until s0)
  let s = 0, wallDecay = 1, throwS: number | null = null;
  const beta = 1 / (fi.Troom + 273.15);
  for (let k = 0; k < 400; k++) {
    const u = (s < s0 ? u0 : (u0 * s0) / Math.max(s, 1e-6)) * wallDecay;
    const dT = dT0 * Math.min(1, s < s0 ? 1 : (0.8 * s0) / s + 0.2 * Math.exp(-(s - s0) / 1.5));
    const b = 0.5 * Math.sqrt(a0) + P.jetSpread * s;
    pts.push({ p: [...p], d: [...d], u, dT, b, s });
    if (throwS === null && u < P.terminalV) throwS = s;
    if (u < 0.05 || s > 14) break;
    // buoyancy curvature in the vertical plane
    const kappa = (G * beta * dT) / Math.max(0.05, u * u) * 0.35;
    d = [d[0], d[1] + kappa * ds, d[2]];
    const n = Math.hypot(...d); d = [d[0] / n, d[1] / n, d[2] / n];
    let np: [number, number, number] = [p[0] + d[0] * ds, p[1] + d[1] * ds, p[2] + d[2] * ds];
    // room boundaries: wall-jet behaviour (project direction onto the surface)
    const hit = (cond: boolean, axis: 0 | 1 | 2, val: number, name: string) => {
      if (!cond) return;
      np[axis] = val; d[axis] = 0;
      const m = Math.hypot(...d) || 1; d = [d[0] / m, d[1] / m, d[2] / m];
      if (!attached.includes(name)) attached.push(name);
      wallDecay *= 0.985;
    };
    hit(np[1] > H - 0.02, 1, H - 0.02, 'ceiling'); hit(np[1] < 0.02, 1, 0.02, 'floor');
    hit(np[0] < 0.02, 0, 0.02, 'left wall'); hit(np[0] > W - 0.02, 0, W - 0.02, 'right wall');
    hit(np[2] > D - 0.02, 2, D - 0.02, 'far wall'); hit(np[2] < 0.02, 2, 0.02, 'unit wall');
    // obstacles: flow passes over the top surface with a wake loss (approximate)
    for (const o of obstacles) {
      if (np[0] > o.min[0] && np[0] < o.max[0] && np[1] > o.min[1] && np[1] < o.max[1] && np[2] > o.min[2] && np[2] < o.max[2]) {
        np = [np[0], o.max[1] + 0.02, np[2]]; d = [d[0], Math.max(0, d[1]), d[2]];
        const m = Math.hypot(...d) || 1; d = [d[0] / m, d[1] / m, d[2] / m];
        wallDecay *= 0.9;
        if (!attached.includes(o.name)) attached.push(o.name);
      }
    }
    p = np; s += ds;
  }
  return { pts, throw: throwS, u0, dT0, a0, q, attached };
}

export function makeGrid(P: ProfileValues, nx = 20, ny = 14, nz = 20): FieldGrid {
  const n = nx * ny * nz;
  return {
    nx, ny, nz, dx: P.roomW / nx, dy: P.roomH / ny, dz: P.roomD / nz,
    T: new Float32Array(n), v: new Float32Array(n), vx: new Float32Array(n), vy: new Float32Array(n), vz: new Float32Array(n),
  };
}

/**
 * Fill the zonal field from the jet. Background recirculation returns air to
 * the unit along the upper zone (cooling) and the room is stratified in
 * proportion to the supply temperature difference and inversely to how much
 * jet momentum reaches the occupied zone.
 */
export function computeField(P: ProfileValues, g: FieldGrid, jet: Jet, Troom: number, fi: FieldInputs) {
  const { nx, ny, nz, dx, dy, dz } = g;
  const qs = jet.q;
  const ub = Math.max(0.03, (0.6 * qs) / (P.roomW * P.roomH));
  const ret = outletPose(P).ret;
  // occupied-zone momentum reach
  let reach = 0, tot = 0;
  for (const j of jet.pts) { tot += j.u; if (j.p[1] < 1.8) reach += j.u; }
  const mix = tot > 0 ? reach / tot : 0;
  const dT0 = jet.dT0;
  const strat = P.strat * Math.abs(dT0) * (1 - 0.7 * mix) * (fi.q_m3h > 1 ? 1 : 0.3);
  const sign = dT0 < 0 ? 1 : -1; // cold supply: warmer at top (positive gradient)
  const n = nx * ny * nz;
  const vj = new Float32Array(n), tj = new Float32Array(n), vxj = new Float32Array(n), vyj = new Float32Array(n), vzj = new Float32Array(n);
  const stride = Math.max(1, Math.floor(jet.pts.length / 48));
  for (let m = 0; m < jet.pts.length; m += stride) {
    const jp = jet.pts[m];
    const b2 = jp.b * jp.b, rc = 2.2 * jp.b, rc2 = rc * rc;
    const i0 = Math.max(0, Math.floor((jp.p[0] - rc) / dx)), i1 = Math.min(nx - 1, Math.floor((jp.p[0] + rc) / dx));
    const j0 = Math.max(0, Math.floor((jp.p[1] - rc) / dy)), j1 = Math.min(ny - 1, Math.floor((jp.p[1] + rc) / dy));
    const k0 = Math.max(0, Math.floor((jp.p[2] - rc) / dz)), k1 = Math.min(nz - 1, Math.floor((jp.p[2] + rc) / dz));
    for (let k = k0; k <= k1; k++) for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const ddx = (i + 0.5) * dx - jp.p[0], ddy = (j + 0.5) * dy - jp.p[1], ddz = (k + 0.5) * dz - jp.p[2];
      const r2 = ddx * ddx + ddy * ddy + ddz * ddz;
      if (r2 > rc2) continue;
      const idx = i + nx * (j + ny * k);
      const uv = jp.u * Math.exp(-r2 / b2);
      if (uv > vj[idx]) { vj[idx] = uv; vxj[idx] = jp.d[0] * uv; vyj[idx] = jp.d[1] * uv; vzj[idx] = jp.d[2] * uv; }
      const tv = jp.dT * Math.exp(-r2 / (1.44 * b2));
      if (Math.abs(tv) > Math.abs(tj[idx])) tj[idx] = tv;
    }
  }
  let sumT = 0;
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const x = (i + 0.5) * dx, y = (j + 0.5) * dy, z = (k + 0.5) * dz;
    const idx = i + nx * (j + ny * k);
    // background loop toward the return grille (approximate recirculation)
    const rx = ret[0] - x, ry = ret[1] - y, rz = ret[2] - z;
    const rn = Math.hypot(rx, ry, rz) || 1;
    const capture = Math.min(1, 0.35 / rn);
    const f = ub * (0.5 + capture) / rn;
    g.vx[idx] = vxj[idx] + f * rx; g.vy[idx] = vyj[idx] + f * ry; g.vz[idx] = vzj[idx] + f * rz;
    g.v[idx] = Math.hypot(g.vx[idx], g.vy[idx], g.vz[idx]);
    const T = Troom + tj[idx] + sign * strat * (y - P.roomH / 2) * 0.6;
    g.T[idx] = T; sumT += T;
  }
  // constrain to the room-balance mean (energy-consistent display)
  const off = sumT / (nx * ny * nz) - Troom;
  for (let n = 0; n < g.T.length; n++) g.T[n] -= off;
}

export function sampleField(g: FieldGrid, P: ProfileValues, x: number, y: number, z: number): { T: number; v: number } | null {
  if (x < 0 || y < 0 || z < 0 || x > P.roomW || y > P.roomH || z > P.roomD) return null;
  const i = Math.min(g.nx - 1, Math.floor(x / g.dx)), j = Math.min(g.ny - 1, Math.floor(y / g.dy)), k = Math.min(g.nz - 1, Math.floor(z / g.dz));
  const idx = i + g.nx * (j + g.ny * k);
  return { T: g.T[idx], v: g.v[idx] };
}

export interface ZoneDef { name: string; min: [number, number, number]; max: [number, number, number]; draftV: number; band: number }
export const ZONE_PRESETS: Record<string, ZoneDef> = {
  desk: { name: 'Desk', min: [0.25, 0.6, 2.2], max: [1.45, 1.3, 3.3], draftV: 0.25, band: 1.0 },
  bed: { name: 'Bed', min: [2.3, 0.4, 1.5], max: [3.9, 0.9, 3.2], draftV: 0.2, band: 1.0 },
  even: { name: 'Even room coverage', min: [0.3, 0.1, 0.5], max: [3.7, 1.8, 3.7], draftV: 0.25, band: 1.5 },
};

export interface ZoneStats { mean: number; min: number; max: number; std: number; draftFrac: number; vMean: number; n: number }
export function zoneStats(g: FieldGrid, P: ProfileValues, z: ZoneDef): ZoneStats {
  let n = 0, s = 0, s2 = 0, mn = 1e9, mx = -1e9, dr = 0, vs = 0;
  for (let k = 0; k < g.nz; k++) for (let j = 0; j < g.ny; j++) for (let i = 0; i < g.nx; i++) {
    const x = (i + 0.5) * g.dx, y = (j + 0.5) * g.dy, zz = (k + 0.5) * g.dz;
    if (x < z.min[0] || x > z.max[0] || y < z.min[1] || y > z.max[1] || zz < z.min[2] || zz > z.max[2]) continue;
    const idx = i + g.nx * (j + g.ny * k);
    const T = g.T[idx];
    n++; s += T; s2 += T * T; mn = Math.min(mn, T); mx = Math.max(mx, T); vs += g.v[idx];
    if (g.v[idx] > z.draftV) dr++;
  }
  if (!n) return { mean: NaN, min: NaN, max: NaN, std: NaN, draftFrac: 0, vMean: 0, n: 0 };
  const mean = s / n;
  return { mean, min: mn, max: mx, std: Math.sqrt(Math.max(0, s2 / n - mean * mean)), draftFrac: dr / n, vMean: vs / n, n };
  void P;
}

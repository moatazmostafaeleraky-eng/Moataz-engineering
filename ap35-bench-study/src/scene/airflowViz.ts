/**
 * Air visualisation. Indoor particles live only in the room air domain (z >= 0)
 * and inside the indoor unit along its internal path; outdoor particles live
 * only outside the exterior wall. Particles animate the CURRENT computed field
 * in real time; they are markers, not a CFD solution.
 */
import * as THREE from 'three';
import { tempColor } from './kit';
import { DEFAULT_OBSTACLES } from '../model/airfield';

export interface FieldMsg { T: Float32Array; v: Float32Array; vx: Float32Array; vy: Float32Array; vz: Float32Array; nx: number; ny: number; nz: number; Tinst?: Float32Array }
export interface JetMsg { pts: { p: [number, number, number]; d: [number, number, number]; u: number; dT: number; b: number; s: number }[]; throw: number | null; u0: number; attached: string[] }

export interface RoomDims { W: number; H: number; D: number; wallT: number }

const tmpC = new THREE.Color();
let dotTex: THREE.Texture | null = null;
export function dotTexture(): THREE.Texture {
  if (dotTex) return dotTex;
  const c = document.createElement('canvas'); c.width = c.height = 32;
  const g = c.getContext('2d')!; const gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.55, 'rgba(255,255,255,0.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 32, 32);
  dotTex = new THREE.CanvasTexture(c); return dotTex;
}

export function sampleGrid(f: FieldMsg, dims: RoomDims, x: number, y: number, z: number) {
  const i = Math.min(f.nx - 1, Math.max(0, Math.floor((x / dims.W) * f.nx)));
  const j = Math.min(f.ny - 1, Math.max(0, Math.floor((y / dims.H) * f.ny)));
  const k = Math.min(f.nz - 1, Math.max(0, Math.floor((z / dims.D) * f.nz)));
  return i + f.nx * (j + f.ny * k);
}

/** Keep a point inside the room air domain and outside solid obstacles and the indoor unit body. */
export function clampIndoor(p: THREE.Vector3, dims: RoomDims, unitBox: THREE.Box3): boolean {
  let moved = false;
  if (p.x < 0.02) { p.x = 0.02; moved = true; } if (p.x > dims.W - 0.02) { p.x = dims.W - 0.02; moved = true; }
  if (p.y < 0.02) { p.y = 0.02; moved = true; } if (p.y > dims.H - 0.02) { p.y = dims.H - 0.02; moved = true; }
  if (p.z < 0.02) { p.z = 0.02; moved = true; } if (p.z > dims.D - 0.02) { p.z = dims.D - 0.02; moved = true; }
  for (const o of DEFAULT_OBSTACLES) {
    if (p.x > o.min[0] && p.x < o.max[0] && p.y > o.min[1] && p.y < o.max[1] && p.z > o.min[2] && p.z < o.max[2]) { p.y = o.max[1] + 0.01; moved = true; }
  }
  if (unitBox.containsPoint(p)) { p.z = unitBox.max.z + 0.01; moved = true; }
  return moved;
}

export class IndoorParticles {
  n: number;
  pos: Float32Array; col: Float32Array;
  phase: Uint8Array; s: Float32Array; off: Float32Array; age: Float32Array;
  points: THREE.Points;
  dims: RoomDims;
  unitBox: THREE.Box3;
  path: THREE.Vector3[] = [];
  returnPt = new THREE.Vector3();
  colorMode: 'temperature' | 'velocity' = 'temperature';
  tRange: [number, number] = [10, 34];
  private rnd = 1;

  constructor(n: number, dims: RoomDims) {
    this.n = n; this.dims = dims;
    this.pos = new Float32Array(n * 3); this.col = new Float32Array(n * 3);
    this.phase = new Uint8Array(n); this.s = new Float32Array(n); this.off = new Float32Array(n * 2); this.age = new Float32Array(n);
    this.unitBox = new THREE.Box3();
    for (let i = 0; i < n; i++) { this.respawnRoom(i); this.age[i] = this.r() * 20; }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    const m = new THREE.PointsMaterial({ size: 0.022, vertexColors: true, transparent: true, opacity: 0.85, depthWrite: false, sizeAttenuation: true, map: typeof document !== 'undefined' ? dotTexture() : null, alphaTest: 0.05 });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
  }
  private r() { this.rnd = (this.rnd * 1664525 + 1013904223) >>> 0; return this.rnd / 4294967296; }
  respawnRoom(i: number) {
    this.pos[i * 3] = 0.1 + this.r() * (this.dims.W - 0.2);
    this.pos[i * 3 + 1] = 0.1 + this.r() * (this.dims.H - 0.2);
    this.pos[i * 3 + 2] = 0.3 + this.r() * (this.dims.D - 0.4);
    this.phase[i] = 0; this.age[i] = 0;
    this.off[i * 2] = this.r() * 2 - 1; this.off[i * 2 + 1] = this.r() * 2 - 1;
  }
  setUnit(unitBox: THREE.Box3, worldPath: THREE.Vector3[], returnPt: THREE.Vector3) { this.unitBox.copy(unitBox); this.path = worldPath; this.returnPt.copy(returnPt); }

  update(dt: number, field: FieldMsg | null, jet: JetMsg | null, qIn: number, Troom: number, Tsup: number) {
    const p = new THREE.Vector3();
    const fanOn = qIn > 30;
    const jp = jet && jet.pts.length > 2 ? jet.pts : null;
    const pathSpeed = 0.6 + (qIn / 684) * 2.5;
    for (let i = 0; i < this.n; i++) {
      p.set(this.pos[i * 3], this.pos[i * 3 + 1], this.pos[i * 3 + 2]);
      this.age[i] += dt;
      let T = Troom, spd = 0;
      if (this.phase[i] === 0) {
        let vx = 0, vy = 0, vz = 0;
        if (field) { const k = sampleGrid(field, this.dims, p.x, p.y, p.z); vx = field.vx[k]; vy = field.vy[k]; vz = field.vz[k]; T = field.T[k]; spd = field.v[k]; }
        // return capture near the top grille
        const dr = p.distanceTo(this.returnPt);
        if (fanOn && dr < 0.9) { const f = (0.35 * (qIn / 684)) / Math.max(0.15, dr); vx += ((this.returnPt.x - p.x) / dr) * f; vy += ((this.returnPt.y - p.y) / dr) * f; vz += ((this.returnPt.z - p.z) / dr) * f; }
        const jitter = 0.03;
        p.x += (vx + (this.r() - 0.5) * jitter) * dt; p.y += (vy + (this.r() - 0.5) * jitter) * dt; p.z += (vz + (this.r() - 0.5) * jitter) * dt;
        clampIndoor(p, this.dims, this.unitBox);
        if (fanOn && p.distanceTo(this.returnPt) < 0.12 && this.path.length) { this.phase[i] = 1; this.s[i] = 0; }
        if (this.age[i] > 60 && this.r() < 0.002) this.respawnRoom(i);
      } else if (this.phase[i] === 1) {
        // inside the unit: return grille -> filter -> coil -> fan -> nozzle
        this.s[i] += dt * pathSpeed;
        const segN = this.path.length - 1;
        const u = this.s[i];
        if (u >= segN) { if (jp) { this.phase[i] = 2; this.s[i] = 0; } else { this.phase[i] = 0; } }
        else {
          const k = Math.floor(u), f = u - k;
          p.lerpVectors(this.path[k], this.path[k + 1], f);
          p.x += this.off[i * 2] * 0.28;
          T = k < 3 ? Troom : Tsup;
        }
      } else {
        // supply jet: follow the traced centreline with a spread offset
        if (!jp) { this.phase[i] = 0; continue; }
        const last = jp[jp.length - 1];
        let k = 0;
        while (k < jp.length - 1 && jp[k + 1].s < this.s[i]) k++;
        const a = jp[k];
        this.s[i] += Math.max(0.15, a.u) * dt;
        if (this.s[i] >= last.s || a.u < 0.12) { this.phase[i] = 0; this.age[i] = 0; }
        const d = new THREE.Vector3(...a.d);
        const side = new THREE.Vector3(0, 1, 0).cross(d).normalize();
        if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
        const up = d.clone().cross(side).normalize();
        p.set(...a.p).addScaledVector(side, this.off[i * 2] * a.b * 0.9).addScaledVector(up, this.off[i * 2 + 1] * a.b * 0.45);
        clampIndoor(p, this.dims, this.unitBox);
        T = Troom + a.dT; spd = a.u;
      }
      this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
      if (this.colorMode === 'temperature') tempColor(T, this.tRange[0], this.tRange[1], tmpC);
      else tmpC.setHSL(0.62 - Math.min(1, spd / 3) * 0.62, 0.8, 0.5);
      this.col[i * 3] = tmpC.r; this.col[i * 3 + 1] = tmpC.g; this.col[i * 3 + 2] = tmpC.b;
    }
    (this.points.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.points.geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;
  }

  /** For tests: every particle in the room phase must satisfy z >= 0 (indoor air domain). */
  allIndoor(): boolean { for (let i = 0; i < this.n; i++) if (this.pos[i * 3 + 2] < -1e-6) return false; return true; }
}

/** Outdoor air particles in the outdoor unit's local frame (rear/left intake -> coil -> fan -> forward discharge). */
export class OutdoorParticles {
  n: number; pos: Float32Array; col: Float32Array; ph: Float32Array; kind: Uint8Array; seed: Float32Array;
  points: THREE.Points;
  private rnd = 7;
  constructor(n: number) {
    this.n = n; this.pos = new Float32Array(n * 3); this.col = new Float32Array(n * 3); this.ph = new Float32Array(n); this.kind = new Uint8Array(n); this.seed = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { this.ph[i] = this.r(); this.kind[i] = this.r() < 0.65 ? 0 : 1; this.seed[i * 3] = this.r(); this.seed[i * 3 + 1] = this.r(); this.seed[i * 3 + 2] = this.r(); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.points = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.018, vertexColors: true, transparent: true, opacity: 0.8, depthWrite: false, map: typeof document !== 'undefined' ? dotTexture() : null, alphaTest: 0.05 }));
    this.points.frustumCulled = false;
  }
  private r() { this.rnd = (this.rnd * 1664525 + 1013904223) >>> 0; return this.rnd / 4294967296; }
  update(dt: number, qOut: number, Tin: number, Tleave: number, range: [number, number]) {
    const rate = (qOut / 2178) * 0.35;
    const fanX = 0.3025, fanY = 0.28;
    for (let i = 0; i < this.n; i++) {
      this.ph[i] += dt * rate * (0.8 + 0.4 * this.seed[i * 3]);
      if (this.ph[i] > 1) { this.ph[i] -= 1; this.kind[i] = this.r() < 0.65 ? 0 : 1; this.seed[i * 3] = this.r(); this.seed[i * 3 + 1] = this.r(); this.seed[i * 3 + 2] = this.r(); }
      const u = this.ph[i], a = this.seed[i * 3], b = this.seed[i * 3 + 1], c = this.seed[i * 3 + 2];
      let x: number, y: number, z: number, T: number;
      // entry point on the rear face (kind 0) or the left face (kind 1), outside the unit
      const ex = this.kind[i] === 0 ? 0.05 + a * 0.48 : -0.18 + 0.0 * a;
      const ez = this.kind[i] === 0 ? -0.1 : 0.05 + a * 0.21;
      const ey = 0.06 + b * 0.44;
      const cx = this.kind[i] === 0 ? ex : 0.03, cz = this.kind[i] === 0 ? 0.035 : ez;
      if (u < 0.35) { const f = u / 0.35; x = ex + (cx - ex) * f; y = ey; z = ez + (cz - ez) * f; T = Tin; }
      else if (u < 0.6) { const f = (u - 0.35) / 0.25; x = cx + (fanX - cx) * f; y = ey + (fanY - ey) * f * 0.8; z = cz + (0.2 - cz) * f; T = Tleave; }
      else { const f = (u - 0.6) / 0.4; const ang = c * Math.PI * 2, rr = 0.05 + 0.15 * b + f * 0.35; x = fanX + Math.cos(ang) * rr; y = fanY + Math.sin(ang) * rr * 0.9; z = 0.29 + f * 1.4; T = Tleave; }
      if (qOut < 30) { x = -10; y = -10; z = -10; }
      this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
      tempColor(T, range[0], range[1], tmpC);
      this.col[i * 3] = tmpC.r; this.col[i * 3 + 1] = tmpC.g; this.col[i * 3 + 2] = tmpC.b;
    }
    (this.points.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.points.geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;
  }
}

/** Plume envelope tube with radius following the jet half-width. */
export function plumeGeometry(jet: JetMsg, radial = 12): THREE.BufferGeometry | null {
  const pts = jet.pts;
  if (pts.length < 3) return null;
  const pos: number[] = [], idx: number[] = [], col: number[] = [];
  const up = new THREE.Vector3(0, 1, 0);
  for (let k = 0; k < pts.length; k++) {
    const d = new THREE.Vector3(...pts[k].d);
    let side = up.clone().cross(d); if (side.lengthSq() < 1e-6) side = new THREE.Vector3(1, 0, 0); side.normalize();
    const nrm = d.clone().cross(side).normalize();
    const b = pts[k].b * 0.8;
    for (let r = 0; r < radial; r++) {
      const a = (r / radial) * Math.PI * 2;
      const q = new THREE.Vector3(...pts[k].p).addScaledVector(side, Math.cos(a) * b).addScaledVector(nrm, Math.sin(a) * b * 0.55);
      pos.push(q.x, q.y, q.z);
      const v = Math.min(1, pts[k].u / 3);
      col.push(0.25 + 0.2 * (1 - v), 0.55 + 0.2 * v, 0.95);
    }
    if (k > 0) for (let r = 0; r < radial; r++) {
      const a0 = (k - 1) * radial + r, a1 = (k - 1) * radial + ((r + 1) % radial), b0 = k * radial + r, b1 = k * radial + ((r + 1) % radial);
      idx.push(a0, b0, a1, a1, b0, b1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

/** Streamlines through the averaged field from seed points. */
export function streamlines(field: FieldMsg, dims: RoomDims, seeds: THREE.Vector3[], unitBox: THREE.Box3, range: [number, number]): THREE.BufferGeometry {
  const pos: number[] = [], col: number[] = [];
  for (const s0 of seeds) {
    const p = s0.clone();
    let prev = p.clone();
    for (let i = 0; i < 70; i++) {
      const k = sampleGrid(field, dims, p.x, p.y, p.z);
      const v = new THREE.Vector3(field.vx[k], field.vy[k], field.vz[k]);
      const sp = v.length(); if (sp < 0.01) break;
      p.addScaledVector(v.normalize(), 0.06);
      clampIndoor(p, dims, unitBox);
      tempColor(field.T[k], range[0], range[1], tmpC);
      pos.push(prev.x, prev.y, prev.z, p.x, p.y, p.z); col.push(tmpC.r, tmpC.g, tmpC.b, tmpC.r, tmpC.g, tmpC.b);
      prev = p.clone();
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}

/** RGBA texture of a horizontal (y = h) or vertical (x = c) field slice. */
export function sliceTexture(field: FieldMsg, dims: RoomDims, kind: 'h' | 'v', at: number, mode: 'temperature' | 'velocity', range: [number, number], tex?: THREE.DataTexture): THREE.DataTexture {
  const w = kind === 'h' ? field.nx : field.nz, h = kind === 'h' ? field.nz : field.ny;
  const data = new Uint8Array(w * h * 4);
  for (let a = 0; a < w; a++) for (let b = 0; b < h; b++) {
    const x = kind === 'h' ? ((a + 0.5) / field.nx) * dims.W : at;
    const y = kind === 'h' ? at : ((b + 0.5) / field.ny) * dims.H;
    const z = kind === 'h' ? ((b + 0.5) / field.nz) * dims.D : ((a + 0.5) / field.nz) * dims.D;
    const k = sampleGrid(field, dims, x, y, z);
    if (mode === 'temperature') tempColor(field.T[k], range[0], range[1], tmpC); else tmpC.setHSL(0.62 - Math.min(1, field.v[k] / 1.5) * 0.62, 0.75, 0.5);
    const o = (b * w + a) * 4;
    data[o] = tmpC.r * 255; data[o + 1] = tmpC.g * 255; data[o + 2] = tmpC.b * 255; data[o + 3] = 170;
  }
  if (tex && tex.image.width === w && tex.image.height === h) { (tex.image.data as Uint8Array).set(data); tex.needsUpdate = true; return tex; }
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter; t.needsUpdate = true;
  return t;
}

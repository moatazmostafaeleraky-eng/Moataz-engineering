/** Shared materials, part registry and geometry helpers for the procedural assemblies. */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

export const MAT = {
  casing: new THREE.MeshPhysicalMaterial({ color: 0xf4f2ed, roughness: 0.32, metalness: 0, clearcoat: 0.5, clearcoatRoughness: 0.25 }),
  casingMatte: new THREE.MeshStandardMaterial({ color: 0xebe8e1, roughness: 0.6 }),
  cabinet: new THREE.MeshStandardMaterial({ color: 0xe9e6de, roughness: 0.45, metalness: 0.05 }),
  graphite: new THREE.MeshStandardMaterial({ color: 0x2d2c2a, roughness: 0.55 }),
  darkPlastic: new THREE.MeshStandardMaterial({ color: 0x3a3936, roughness: 0.7 }),
  grille: new THREE.MeshStandardMaterial({ color: 0x55534f, roughness: 0.5, metalness: 0.3 }),
  copper: new THREE.MeshStandardMaterial({ color: 0xb87333, roughness: 0.32, metalness: 0.9 }),
  aluminium: new THREE.MeshStandardMaterial({ color: 0xc8ccd2, roughness: 0.35, metalness: 0.75, side: THREE.DoubleSide }),
  steel: new THREE.MeshStandardMaterial({ color: 0x8b9096, roughness: 0.4, metalness: 0.85 }),
  compressor: new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 0.5, metalness: 0.4 }),
  rubber: new THREE.MeshStandardMaterial({ color: 0x1b1b1b, roughness: 0.9 }),
  insulation: new THREE.MeshStandardMaterial({ color: 0x2b2b2b, roughness: 0.95 }),
  insulationLight: new THREE.MeshStandardMaterial({ color: 0xdedbd2, roughness: 0.9 }),
  pcb: new THREE.MeshStandardMaterial({ color: 0x1f5e3a, roughness: 0.6 }),
  filter: new THREE.MeshStandardMaterial({ color: 0x9fb4c8, roughness: 0.8, transparent: true, opacity: 0.55, side: THREE.DoubleSide }),
  fanBlue: new THREE.MeshStandardMaterial({ color: 0xdfe3e6, roughness: 0.45, side: THREE.DoubleSide }),
  propeller: new THREE.MeshStandardMaterial({ color: 0x3d4045, roughness: 0.55, side: THREE.DoubleSide }),
  wall: new THREE.MeshStandardMaterial({ color: 0xe6e1d6, roughness: 0.95 }),
  wallCut: new THREE.MeshStandardMaterial({ color: 0xd9d1c2, roughness: 1, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide }),
  floor: new THREE.MeshStandardMaterial({ color: 0xd8cfbf, roughness: 0.9 }),
  furniture: new THREE.MeshStandardMaterial({ color: 0xc9bca6, roughness: 0.85 }),
  furniture2: new THREE.MeshStandardMaterial({ color: 0x9fa7ad, roughness: 0.8 }),
  lamp: new THREE.MeshStandardMaterial({ color: 0x5ab0ff, emissive: 0x2d7fd0, emissiveIntensity: 0.0 }),
  red: new THREE.MeshStandardMaterial({ color: 0xc4161c, roughness: 0.5 }),
  water: new THREE.MeshStandardMaterial({ color: 0x5aa8e6, roughness: 0.1, metalness: 0, transparent: true, opacity: 0.7 }),
  frost: new THREE.MeshStandardMaterial({ color: 0xf6fbff, roughness: 0.9, transparent: true, opacity: 0.0 }),
  ghost: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, transparent: true, opacity: 0.12, depthWrite: false }),
};

export interface PartInfo {
  id: string;
  name: string;
  nameAr?: string;
  unit: 'indoor' | 'outdoor' | 'room' | 'pipe';
  fidelity: 'sourced' | 'modelled' | 'conceptual';
  source: string;
  fn: string;
  links: string[];
  explode: THREE.Vector3;
  casing?: boolean;
}

export const PARTS = new Map<string, { info: PartInfo; obj: THREE.Object3D; home: THREE.Vector3 }>();

export function part(obj: THREE.Object3D, info: Omit<PartInfo, 'explode'> & { explode?: [number, number, number] }): THREE.Object3D {
  const full: PartInfo = { ...info, explode: new THREE.Vector3(...(info.explode ?? [0, 0, 0])) };
  obj.name = info.id;
  obj.userData.part = full;
  obj.traverse((o) => { o.userData.partId = info.id; if ((o as THREE.Mesh).isMesh) { (o as THREE.Mesh).castShadow = true; (o as THREE.Mesh).receiveShadow = true; } });
  PARTS.set(info.id, { info: full, obj, home: obj.position.clone() });
  return obj;
}

export function rbox(w: number, h: number, d: number, r: number, mat: THREE.Material, seg = 3): THREE.Mesh {
  return new THREE.Mesh(new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4)), mat);
}
export function box(w: number, h: number, d: number, mat: THREE.Material): THREE.Mesh {
  return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
}
export function cyl(r: number, h: number, mat: THREE.Material, seg = 24, rTop?: number): THREE.Mesh {
  return new THREE.Mesh(new THREE.CylinderGeometry(rTop ?? r, r, h, seg), mat);
}
export function at<T extends THREE.Object3D>(o: T, x: number, y: number, z: number): T { o.position.set(x, y, z); return o; }
export function rot<T extends THREE.Object3D>(o: T, x: number, y: number, z: number): T { o.rotation.set(x, y, z); return o; }

/** Tube along a polyline with rounded corners. */
export function tube(points: THREE.Vector3[], r: number, mat: THREE.Material, seg = 64): THREE.Mesh {
  const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal', 0.15);
  const m = new THREE.Mesh(new THREE.TubeGeometry(curve, seg, r, 10, false), mat);
  m.userData.curve = curve;
  return m;
}

/** Extrude a closed 2D profile (in the z-y plane) along x, centred on x. */
export function extrudeProfileX(pts: [number, number][], length: number, mat: THREE.Material, bevel = 0.004): THREE.Mesh {
  const shape = new THREE.Shape(pts.map(([z, y]) => new THREE.Vector2(z, y)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: length, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 3, curveSegments: 16 });
  g.translate(0, 0, -length / 2);
  g.rotateY(-Math.PI / 2); // shape x->world z, extrusion -> world x
  const m = new THREE.Mesh(g, mat);
  return m;
}

/** Instanced fin pack: thin plates along x between x0..x1 at a given pitch, each plate a w(z) x h(y) rectangle with a rotation about x. */
export function finPack(x0: number, x1: number, pitch: number, w: number, h: number, center: THREE.Vector3, rotX: number, mat: THREE.Material): THREE.InstancedMesh {
  const n = Math.max(1, Math.floor((x1 - x0) / pitch));
  const g = new THREE.BoxGeometry(0.0006, h, w);
  const im = new THREE.InstancedMesh(g, mat, n);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rotX, 0, 0)), s = new THREE.Vector3(1, 1, 1);
  for (let i = 0; i < n; i++) { m.compose(new THREE.Vector3(x0 + (i + 0.5) * pitch, center.y, center.z), q, s); im.setMatrixAt(i, m); }
  im.castShadow = true; im.receiveShadow = true;
  return im;
}

export function setOpacity(obj: THREE.Object3D, opacity: number) {
  obj.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.Material | undefined;
    if (!m || !(o as THREE.Mesh).isMesh) return;
    if (!o.userData.origMat) o.userData.origMat = m;
    if (opacity >= 0.999) { (o as THREE.Mesh).material = o.userData.origMat; return; }
    let gm = o.userData.ghostMat as THREE.Material | undefined;
    if (!gm) { gm = (o.userData.origMat as THREE.Material).clone(); gm.transparent = true; gm.depthWrite = false; o.userData.ghostMat = gm; }
    gm.opacity = opacity;
    (o as THREE.Mesh).material = gm;
  });
}

/** Canvas texture for labels and small prints (procedural, no image files). */
export function textTexture(text: string, opts: { size?: number; color?: string; bg?: string; font?: string; w?: number; h?: number } = {}): THREE.CanvasTexture {
  const w = opts.w ?? 256, h = opts.h ?? 64;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d')!;
  if (opts.bg) { g.fillStyle = opts.bg; g.fillRect(0, 0, w, h); }
  g.fillStyle = opts.color ?? '#333'; g.font = opts.font ?? `${opts.size ?? 28}px system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, w / 2, h / 2);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

/** Temperature to colour for refrigerant/air (cold blue - neutral - hot red). */
export function tempColor(T: number, lo = 0, hi = 90, out = new THREE.Color()): THREE.Color {
  const f = Math.max(0, Math.min(1, (T - lo) / (hi - lo)));
  const stops: [number, number, number, number][] = [
    [0, 0.17, 0.36, 0.78], [0.18, 0.25, 0.62, 0.92], [0.33, 0.62, 0.8, 0.88], [0.5, 0.9, 0.86, 0.72], [0.68, 0.96, 0.66, 0.3], [0.85, 0.89, 0.36, 0.16], [1, 0.72, 0.1, 0.1],
  ];
  for (let i = 0; i < stops.length - 1; i++) {
    const [a, r1, g1, b1] = stops[i], [b, r2, g2, b2] = stops[i + 1];
    if (f <= b) { const u = (f - a) / (b - a); return out.setRGB(r1 + u * (r2 - r1), g1 + u * (g2 - g1), b1 + u * (b2 - b1), THREE.SRGBColorSpace); }
  }
  return out.setRGB(0.72, 0.1, 0.1, THREE.SRGBColorSpace);
}
export function tempCss(T: number, lo = 0, hi = 90): string { return '#' + tempColor(T, lo, hi).getHexString(THREE.SRGBColorSpace); }

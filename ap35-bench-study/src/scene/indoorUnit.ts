/**
 * Procedural MSZ-AP35VGK indoor unit. Envelope 798 x 299 x 219 mm (S1, S2 p.6/p.11).
 * Part list follows S2 p.4 and S4 (front panel, air inlet, 2 air filters, heat
 * exchanger, line flow fan + motor, nozzle, horizontal vane upper/lower, vertical
 * vane, drain hose, electrical box, Wi-Fi interface). Internal dimensions,
 * fin/blade counts and the profile curvature are modelled.
 * Local frame: x across (centred), y up from the unit bottom, z out of the wall.
 */
import * as THREE from 'three';
import { MAT, part, box, cyl, at, rot, finPack, tube } from './kit';

export const IND = { W: 0.798, H: 0.299, D: 0.219, outletHalf: 0.305 };
const FAN = { z: 0.1, y: 0.14, r: 0.046, x0: -0.3, x1: 0.295 };

/** Thin band along a z-y polyline, extruded along x. */
function band(pts: [number, number][], t: number, length: number, mat: THREE.Material): THREE.Mesh {
  const shape = new THREE.Shape();
  const n = pts.length;
  const off: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    const dz = b[0] - a[0], dy = b[1] - a[1];
    const L = Math.hypot(dz, dy) || 1;
    off.push([pts[i][0] - (dy / L) * t, pts[i][1] + (dz / L) * t]);
  }
  shape.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < n; i++) shape.lineTo(pts[i][0], pts[i][1]);
  for (let i = n - 1; i >= 0; i--) shape.lineTo(off[i][0], off[i][1]);
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: length, bevelEnabled: false, curveSegments: 8 });
  g.translate(0, 0, -length / 2);
  g.rotateY(-Math.PI / 2);
  return new THREE.Mesh(g, mat);
}
function smooth(pts: [number, number][], n = 40): [number, number][] {
  const c = new THREE.SplineCurve(pts.map(([z, y]) => new THREE.Vector2(z, y)));
  return c.getPoints(n).map((p) => [p.x, p.y]);
}
const OUTLINE: [number, number][] = [[0, 0.03], [0, 0.299], [0.168, 0.299], [0.196, 0.288], [0.214, 0.258], [0.219, 0.2], [0.217, 0.12], [0.209, 0.08], [0.196, 0.058], [0.17, 0.045], [0.07, 0.016], [0.03, 0.007], [0.006, 0.014]];

export interface IndoorHandles {
  group: THREE.Group;
  fan: THREE.Group;
  vaneUpper: THREE.Group; vaneLower: THREE.Group;
  wideVanes: THREE.Object3D[];
  lamp: THREE.Mesh;
  trayWater: THREE.Mesh;
  coilFins: THREE.InstancedMesh[];
  casing: THREE.Object3D[];
  pipeOut: { gas: THREE.Vector3; liquid: THREE.Vector3; drain: THREE.Vector3 };
  airPath: THREE.Vector3[]; // local, return grille -> outlet mouth
  outletMouth: THREE.Vector3;
  returnTop: THREE.Vector3;
}

export function buildIndoor(): IndoorHandles {
  const g = new THREE.Group();
  g.name = 'indoorUnit';
  const casing: THREE.Object3D[] = [];
  const W = IND.W, half = W / 2;

  // ---------------- chassis / back plate
  const chassis = new THREE.Group();
  chassis.add(band([[0.002, 0.02], [0.002, 0.297]], 0.006, W - 0.01, MAT.casingMatte));
  chassis.add(band([[0.004, 0.02], [0.03, 0.007], [0.07, 0.022]], 0.004, W - 0.01, MAT.casingMatte));
  // scroll (rear wall of the fan housing) and stabiliser (front tongue): the nozzle
  chassis.add(band(smooth([[0.074, 0.026], [0.056, 0.08], [0.048, 0.13], [0.056, 0.172], [0.083, 0.194]], 24), 0.004, 2 * IND.outletHalf, MAT.casingMatte));
  part(chassis, { id: 'in.chassis', name: 'Chassis and nozzle (scroll + stabiliser)', unit: 'indoor', fidelity: 'modelled', source: 'S4 nozzle assembly; geometry modelled', fn: 'Holds the coil and fan; the scroll and stabiliser form the cross-flow fan casing and guide the jet to the outlet.', links: ['airflow', 'outlet area'], explode: [0, 0, -0.18] });
  g.add(chassis);
  const tongue = band(smooth([[0.197, 0.058], [0.186, 0.056], [0.16, 0.08], [0.148, 0.098]], 12), 0.004, 2 * IND.outletHalf, MAT.casingMatte);
  part(tongue, { id: 'in.stabiliser', name: 'Stabiliser (nozzle front wall)', unit: 'indoor', fidelity: 'modelled', source: 'modelled', fn: 'Front wall of the outlet nozzle; with the scroll it fixes the cross-flow vortex position.', links: ['airflow'], explode: [0, -0.05, 0.12] });
  g.add(tongue);

  // ---------------- side panels / corner boxes (solid ends)
  for (const sx of [-1, 1]) {
    const shape = new THREE.Shape(OUTLINE.map(([z, y]) => new THREE.Vector2(z, y)));
    const len = half - IND.outletHalf;
    const geo = new THREE.ExtrudeGeometry(shape, { depth: len, bevelEnabled: true, bevelSize: 0.003, bevelThickness: 0.003, bevelSegments: 2 });
    geo.rotateY(-Math.PI / 2);
    const m = new THREE.Mesh(geo, MAT.casing);
    m.position.x = sx > 0 ? half - 0.003 : -IND.outletHalf - 0.003;
    const id = sx > 0 ? 'in.cornerR' : 'in.cornerL';
    part(m, { id, name: sx > 0 ? 'Corner box (right): electrical box, fan motor' : 'Corner box (left)', unit: 'indoor', fidelity: 'modelled', source: 'S4 corner box (left/right)', fn: 'End housings closing the casing; the right one carries the fan motor, vane motors and electrical box.', links: [], explode: [sx * 0.22, 0, 0], casing: true });
    casing.push(m); g.add(m);
  }

  // ---------------- front panel (curved, glossy)
  const frontPts = smooth([[0.168, 0.299], [0.196, 0.288], [0.214, 0.258], [0.219, 0.2], [0.217, 0.12], [0.209, 0.08], [0.197, 0.059]], 48);
  const front = band(frontPts, -0.004, 2 * IND.outletHalf + 0.002, MAT.casing);
  part(front, { id: 'in.frontPanel', name: 'Front panel', unit: 'indoor', fidelity: 'sourced', source: 'S2 p.4 / S4 (front panel); curvature modelled', fn: 'Closed front; the AP draws room air through the top inlet only.', links: ['air inlet'], explode: [0, 0.02, 0.32], casing: true });
  casing.push(front); g.add(front);
  // operation indicator lamp (S2 p.22)
  const lamp = box(0.012, 0.004, 0.003, MAT.lamp);
  at(lamp, 0.27, 0.075, 0.207); rot(lamp, -0.5, 0, 0);
  part(lamp, { id: 'in.lamp', name: 'Operation indicator lamp', unit: 'indoor', fidelity: 'sourced', source: 'S2 p.4/p.22', fn: 'Lit when the room is about 2 degC or more from the set temperature; changes as it approaches.', links: ['controller'], explode: [0, 0, 0.34] });
  g.add(lamp);

  // ---------------- top air inlet grille
  const grille = new THREE.Group();
  const nb = 14;
  for (let i = 0; i < nb; i++) {
    const z = 0.012 + (i * (0.158 - 0.012)) / (nb - 1);
    grille.add(at(box(2 * IND.outletHalf + 0.01, 0.006, 0.004, MAT.casing), 0, 0.296, z));
  }
  grille.add(at(box(2 * IND.outletHalf + 0.01, 0.006, 0.006, MAT.casing), 0, 0.296, 0.165));
  part(grille, { id: 'in.inlet', name: 'Air inlet (top grille)', unit: 'indoor', fidelity: 'sourced', source: 'S2 p.4 "Air inlet"; slot count modelled', fn: 'Room air enters from the top, then passes the filters and the coil.', links: ['filter', 'airflow'], explode: [0, 0.2, 0], casing: true });
  casing.push(grille); g.add(grille);

  // ---------------- filters (2)
  for (const sx of [-1, 1]) {
    const fpts = smooth([[0.015, 0.288], [0.12, 0.29], [0.175, 0.282], [0.203, 0.255], [0.208, 0.2]], 20);
    const f = band(fpts, -0.002, 0.36, MAT.filter);
    f.position.x = sx * 0.188;
    const lines = new THREE.LineSegments(new THREE.EdgesGeometry(f.geometry, 30), new THREE.LineBasicMaterial({ color: 0x6d7f91 }));
    lines.position.copy(f.position);
    const fg = new THREE.Group(); fg.add(f, lines);
    part(fg, { id: sx < 0 ? 'in.filterL' : 'in.filterR', name: `Air filter (${sx < 0 ? 'left' : 'right'})`, unit: 'indoor', fidelity: 'sourced', source: 'S4: air filter x2', fn: 'Removes dust. A restricted filter raises indoor resistance and lowers airflow on the fan curve.', links: ['airflow', 'filter restriction'], explode: [sx * 0.08, 0.3, 0.16] });
    g.add(fg);
  }

  // ---------------- heat exchanger (3 segments)
  const coil = new THREE.Group();
  const segs: [[number, number], [number, number]][] = [[[0.034, 0.252], [0.104, 0.278]], [[0.104, 0.278], [0.186, 0.232]], [[0.186, 0.232], [0.193, 0.112]]];
  const coilFins: THREE.InstancedMesh[] = [];
  const finMat = MAT.aluminium.clone();
  for (const [p0, p1] of segs) {
    const dz = p1[0] - p0[0], dy = p1[1] - p0[1];
    const L = Math.hypot(dz, dy);
    const phi = -Math.atan2(dy, dz);
    const cz = (p0[0] + p1[0]) / 2, cy = (p0[1] + p1[1]) / 2;
    const nzN = -dy / L, nyN = dz / L; // normal into the unit (towards the fan)
    const fins = finPack(-IND.outletHalf + 0.005, IND.outletHalf - 0.005, 0.0045, L, 0.022, new THREE.Vector3(0, cy - nyN * 0.011, cz - nzN * 0.011), phi + Math.PI / 2, finMat);
    // finPack plates: h along y, w along z before rotation; rotate so the plate long side follows the segment
    fins.geometry = new THREE.BoxGeometry(0.0006, 0.022, L);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion().setFromEuler(new THREE.Euler(phi, 0, 0));
    for (let i = 0; i < fins.count; i++) { fins.getMatrixAt(i, m); const p = new THREE.Vector3().setFromMatrixPosition(m); m.compose(p, q, new THREE.Vector3(1, 1, 1)); fins.setMatrixAt(i, m); }
    coilFins.push(fins); coil.add(fins);
    const nT = Math.max(2, Math.round(L / 0.016));
    for (let r = 0; r < 2; r++) for (let k = 0; k < nT; k++) {
      const u = (k + 0.5) / nT;
      const tz = p0[0] + dz * u - nzN * (0.005 + r * 0.012), ty = p0[1] + dy * u - nyN * (0.005 + r * 0.012);
      const t = cyl(0.0035, 2 * IND.outletHalf + 0.03, MAT.copper, 8);
      t.rotation.z = Math.PI / 2; t.position.set(0, ty, tz); coil.add(t);
    }
  }
  // headers / return bends at the left end
  const hdr = cyl(0.006, 0.2, MAT.copper, 10); at(hdr, IND.outletHalf + 0.012, 0.2, 0.06); coil.add(hdr);
  part(coil, { id: 'in.coil', name: 'Indoor heat exchanger (fin-and-tube)', unit: 'indoor', fidelity: 'modelled', source: 'S2 p.4 heat exchanger; 3-bend shape, fin pitch (drawn 4.5 mm) and tube rows modelled', fn: 'Evaporator in COOL (absorbs room heat, condenses moisture), condenser in HEAT. Modelled with air-side UA (calibrated) and a refrigerant-side conductance.', links: ['coil', 'compressor', 'LEV', 'airflow'], explode: [0, 0.12, 0.08] });
  g.add(coil);
  // thermistors
  const th = (id: string, name: string, x: number, y: number, z: number, src: string, fn: string) => {
    const m = cyl(0.004, 0.018, MAT.graphite, 8); at(m, x, y, z); m.rotation.z = Math.PI / 2;
    part(m, { id, name, unit: 'indoor', fidelity: 'sourced', source: src, fn, links: ['controller'], explode: [0, 0.05, 0.1] }); g.add(m);
  };
  th('in.rt11', 'Room temperature thermistor RT11', 0.26, 0.275, 0.12, 'S2 p.18', 'Senses return air; the controller compares it with the set temperature.');
  th('in.rt12', 'Indoor coil thermistor RT12 (main)', 0.2, 0.258, 0.14, 'S2 p.18', 'Coil frost prevention in COOL; high pressure protection and cold-air prevention in HEAT. Modelled as the coil surface temperature.');
  th('in.rt13', 'Indoor coil thermistor RT13 (sub)', -0.2, 0.17, 0.18, 'S2 p.18', 'Secondary coil temperature.');

  // ---------------- line flow (cross-flow) fan
  const fan = new THREE.Group();
  fan.position.set(0, FAN.y, FAN.z);
  const nSec = 9, nBl = 35, secL = (FAN.x1 - FAN.x0) / nSec;
  const bladeGeo = new THREE.BoxGeometry(secL - 0.004, 0.0014, 0.012);
  const blades = new THREE.InstancedMesh(bladeGeo, MAT.fanBlue, nSec * nBl);
  const mm = new THREE.Matrix4();
  let bi = 0;
  for (let s = 0; s < nSec; s++) for (let b = 0; b < nBl; b++) {
    const a = (b / nBl) * Math.PI * 2;
    const r = FAN.r - 0.006;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(a + 0.45, 0, 0)); // forward-curved pitch
    mm.compose(new THREE.Vector3(FAN.x0 + (s + 0.5) * secL, Math.sin(a) * r, Math.cos(a) * r), q, new THREE.Vector3(1, 1, 1));
    blades.setMatrixAt(bi++, mm);
  }
  fan.add(blades);
  for (let s = 0; s <= nSec; s++) { const d = cyl(FAN.r, 0.002, MAT.fanBlue, 32); d.rotation.z = Math.PI / 2; d.position.x = FAN.x0 + s * secL; fan.add(d); }
  const shaft = cyl(0.004, FAN.x1 - FAN.x0 + 0.06, MAT.steel, 8); shaft.rotation.z = Math.PI / 2; fan.add(shaft);
  part(fan, { id: 'in.fan', name: 'Line flow (cross-flow) fan', unit: 'indoor', fidelity: 'modelled', source: 'S4 line flow fan; S2 p.6 rpm and airflow per step; blade count/diameter modelled', fn: 'Draws air through the coil and discharges it through the nozzle. Speed sets airflow on the published rpm-airflow curve, shifted by system resistance.', links: ['airflow', 'fan power', 'coil UA'], explode: [0, -0.02, 0.24] });
  g.add(fan);
  const motor = cyl(0.033, 0.055, MAT.darkPlastic, 20); motor.rotation.z = Math.PI / 2; at(motor, 0.335, FAN.y, FAN.z);
  part(motor, { id: 'in.fanMotor', name: 'Indoor fan motor (RC0J30-CV)', unit: 'indoor', fidelity: 'sourced', source: 'S2 p.6 model RC0J30-CV, 19 W cooling / 26 W heating at rated frequency; shape modelled', fn: 'DC fan motor; power follows the fan operating point (calibrated to the published 19/26 W).', links: ['fan power'], explode: [0.3, 0, 0.1] });
  g.add(motor);
  const bearing = cyl(0.012, 0.02, MAT.rubber, 12); bearing.rotation.z = Math.PI / 2; at(bearing, FAN.x0 - 0.02, FAN.y, FAN.z);
  part(bearing, { id: 'in.bearing', name: 'Bearing mount (sleeve bearing)', unit: 'indoor', fidelity: 'sourced', source: 'S4 bearing mount assembly', fn: 'Supports the fan shaft at the left end.', links: [], explode: [-0.3, 0, 0.1] });
  g.add(bearing);

  // ---------------- drain tray + water
  const tray = band([[0.158, 0.118], [0.162, 0.1], [0.205, 0.098], [0.212, 0.116]], 0.003, 2 * IND.outletHalf, MAT.casingMatte);
  const water = new THREE.Mesh(new THREE.BoxGeometry(2 * IND.outletHalf - 0.02, 0.006, 0.038), MAT.water);
  at(water, 0, 0.104, 0.184); water.scale.y = 0.01;
  const trayG = new THREE.Group(); trayG.add(tray, water);
  part(trayG, { id: 'in.drainTray', name: 'Condensate tray', unit: 'indoor', fidelity: 'modelled', source: 'modelled', fn: 'Collects water condensed on the coil in COOL/DRY; level shown from the modelled fin water film.', links: ['condensate'], explode: [0, -0.1, 0.18] });
  g.add(trayG);

  // ---------------- vanes
  const vaneGeo = (chord: number, camber: number) => {
    const pts: [number, number][] = [];
    for (let i = 0; i <= 12; i++) { const u = i / 12; pts.push([u * chord, -camber * Math.sin(Math.PI * u)]); }
    return band(pts, 0.0025, 2 * IND.outletHalf - 0.01, MAT.casing);
  };
  const vaneUpper = new THREE.Group(); vaneUpper.position.set(0, 0.052, 0.19);
  vaneUpper.add(vaneGeo(0.072, 0.006));
  part(vaneUpper, { id: 'in.vaneUpper', name: 'Horizontal vane (upper)', unit: 'indoor', fidelity: 'sourced', source: 'S4 horizontal vane (upper); S2 p.24 positions AUTO/1-5/SWING; angles modelled', fn: 'Sets the vertical discharge direction. In COOL/DRY/FAN swing only the upper vane swings (S2 9-6 (7)).', links: ['jet direction', 'outlet area'], explode: [0, -0.12, 0.2] });
  g.add(vaneUpper);
  const vaneLower = new THREE.Group(); vaneLower.position.set(0, 0.03, 0.104);
  vaneLower.add(vaneGeo(0.05, 0.004));
  part(vaneLower, { id: 'in.vaneLower', name: 'Horizontal vane (lower)', unit: 'indoor', fidelity: 'sourced', source: 'S4 horizontal vane (lower); motors MV1/MV2 (S2 p.6)', fn: 'Second flap; in HEAT swing both vanes swing.', links: ['jet direction'], explode: [0, -0.18, 0.1] });
  g.add(vaneLower);
  const wideVanes: THREE.Object3D[] = [];
  const wideG = new THREE.Group();
  const nV = 13;
  for (let i = 0; i < nV; i++) {
    const v = new THREE.Group();
    v.position.set(-IND.outletHalf + 0.03 + (i * (2 * IND.outletHalf - 0.06)) / (nV - 1), 0.07, 0.13);
    const plate = box(0.0016, 0.03, 0.04, MAT.casingMatte); plate.rotation.x = 0.5; v.add(plate);
    wideVanes.push(v); wideG.add(v);
  }
  const link = box(2 * IND.outletHalf - 0.05, 0.003, 0.003, MAT.graphite); at(link, 0, 0.088, 0.122); wideG.add(link);
  part(wideG, { id: 'in.vaneVertical', name: 'Vertical vanes (WIDE VANE)', unit: 'indoor', fidelity: 'sourced', source: 'S2 p.25 stepping motor, positions 1-5/SWING; S4 vertical vane; count (13) visual only', fn: 'Sets the horizontal (left-right) discharge direction.', links: ['jet direction'], explode: [0, -0.06, 0.06] });
  g.add(wideG);
  const motorsG = new THREE.Group();
  motorsG.add(at(box(0.022, 0.026, 0.02, MAT.darkPlastic), IND.outletHalf + 0.018, 0.06, 0.17));
  motorsG.add(at(box(0.022, 0.026, 0.02, MAT.darkPlastic), IND.outletHalf + 0.018, 0.045, 0.1));
  motorsG.add(at(box(0.02, 0.02, 0.02, MAT.darkPlastic), IND.outletHalf + 0.018, 0.085, 0.13));
  part(motorsG, { id: 'in.vaneMotors', name: 'Vane stepping motors MV1, MV2, MV3 (12 V DC)', unit: 'indoor', fidelity: 'sourced', source: 'S2 p.6 (MV1, MV2 horizontal; MV3 vertical)', fn: 'Drive the vanes by pulse signals; the vane first moves to its stopper to confirm the standard position.', links: ['vanes'], explode: [0.25, -0.05, 0.1] });
  g.add(motorsG);

  // ---------------- electrical box, Wi-Fi interface
  const eb = new THREE.Group();
  eb.add(at(box(0.05, 0.15, 0.13, MAT.darkPlastic), 0.365, 0.16, 0.1));
  eb.add(at(box(0.004, 0.12, 0.1, MAT.pcb), 0.338, 0.16, 0.1));
  part(eb, { id: 'in.electrical', name: 'Electrical box (indoor PCB)', unit: 'indoor', fidelity: 'modelled', source: 'S4 electrical box; S2 p.6 fuse T3.15AL250V', fn: 'Indoor microprocessor: receives the remote, runs thermostat and vane logic, talks to the outdoor unit over the serial signal.', links: ['controller', 'communication'], explode: [0.35, 0.05, 0.05] });
  g.add(eb);
  const wifi = at(box(0.05, 0.03, 0.012, MAT.casingMatte), 0.3, 0.262, 0.195);
  part(wifi, { id: 'in.wifi', name: 'Wi-Fi interface (VGK)', unit: 'indoor', fidelity: 'sourced', source: 'S2 p.4/p.20 (MSZ-AP-VGK)', fn: 'MELCloud interface on the VGK variant. Not simulated (no network control in this app).', links: [], explode: [0.25, 0.15, 0.25] });
  g.add(wifi);

  // ---------------- pipe stubs at rear-left
  const pipeG = new THREE.Group();
  pipeG.add(tube([new THREE.Vector3(IND.outletHalf + 0.012, 0.22, 0.06), new THREE.Vector3(0.36, 0.2, 0.03), new THREE.Vector3(0.36, 0.12, 0.02)], 0.0048, MAT.copper, 16));
  pipeG.add(tube([new THREE.Vector3(IND.outletHalf + 0.012, 0.15, 0.11), new THREE.Vector3(0.375, 0.12, 0.04), new THREE.Vector3(0.375, 0.09, 0.02)], 0.0032, MAT.copper, 16));
  part(pipeG, { id: 'in.pipes', name: 'Indoor coil connections (flared, rear-right piping)', unit: 'indoor', fidelity: 'sourced', source: 'S2 p.11/p.18 gas 9.52 mm, liquid 6.35 mm; piping side chosen for this installation', fn: 'Connect the indoor coil to the interconnecting pipes.', links: ['refrigerant'], explode: [0.2, 0, -0.05] });
  g.add(pipeG);

  const airPath = [
    new THREE.Vector3(0, 0.36, 0.09), new THREE.Vector3(0, 0.3, 0.09), new THREE.Vector3(0, 0.285, 0.1), new THREE.Vector3(0, 0.25, 0.11),
    new THREE.Vector3(0, 0.19, 0.105), new THREE.Vector3(0, 0.11, 0.122), new THREE.Vector3(0, 0.07, 0.132), new THREE.Vector3(0, 0.035, 0.14),
  ];
  return {
    group: g, fan, vaneUpper, vaneLower, wideVanes, lamp, trayWater: water, coilFins, casing,
    pipeOut: { gas: new THREE.Vector3(0.36, 0.12, 0.02), liquid: new THREE.Vector3(0.375, 0.09, 0.02), drain: new THREE.Vector3(0.33, 0.04, 0.03) },
    airPath, outletMouth: new THREE.Vector3(0, 0.035, 0.14), returnTop: new THREE.Vector3(0, 0.33, 0.09),
  };
}

/** Map a vane angle (deg below horizontal, -30 = closed) and opening to the plate rotation. */
export function vaneRotation(angleDeg: number, open: number): number {
  const closed = (172 * Math.PI) / 180;
  const a = (Math.max(-10, Math.min(90, angleDeg)) * Math.PI) / 180;
  return closed + (a - closed) * Math.max(0, Math.min(1, open));
}

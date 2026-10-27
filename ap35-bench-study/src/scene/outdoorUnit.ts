/**
 * Procedural MUZ-AP35VG outdoor unit. Envelope 800 x 550 x 285 mm, fan centre
 * 302.5 mm from the left and 280 mm above the base, feet bolt pitch 500 mm
 * (S3 p.11). Refrigerant topology per S3 p.18. Component shapes and internal
 * positions are modelled from the S3/S5 drawings, not CAD.
 * Local frame: x 0..0.8 left->right seen from the front, y up, z 0 at the rear
 * (wall side) to 0.285 at the front grille.
 */
import * as THREE from 'three';
import { MAT, part, box, cyl, at, tube, rbox } from './kit';

export const OUT = { W: 0.8, H: 0.55, D: 0.285, fanX: 0.3025, fanY: 0.28, fanR: 0.19, partitionX: 0.56 };

export interface OutdoorHandles {
  group: THREE.Group;
  fan: THREE.Group;
  compRotor: THREE.Group;
  rvSlider: THREE.Mesh;
  frost: THREE.Mesh[];
  casing: THREE.Object3D[];
  nodes: Record<string, THREE.Vector3>; // local refrigerant junctions
  airIn: { rear: THREE.Box3; left: THREE.Box3 };
  airOut: THREE.Vector3;
}

export function buildOutdoor(): OutdoorHandles {
  const g = new THREE.Group(); g.name = 'outdoorUnit';
  const casing: THREE.Object3D[] = [];
  const { W, H, D } = OUT;

  // ---------------- base, feet
  const base = new THREE.Group();
  base.add(at(box(W - 0.01, 0.012, D - 0.01, MAT.steel), W / 2, 0.025, D / 2));
  for (const x of [0.15, 0.65]) base.add(at(box(0.045, 0.02, 0.345, MAT.graphite), x, 0.01, D / 2 + 0.01));
  part(base, { id: 'out.base', name: 'Base pan and feet', unit: 'outdoor', fidelity: 'sourced', source: 'S3 p.11 bolt pitch 500 mm, depth bolt pitch 304-325 mm', fn: 'Structural base; drain hole beneath.', links: [], explode: [0, -0.18, 0] });
  g.add(base);

  // ---------------- cabinet: front panel with fan opening, right side, top
  const fp = new THREE.Shape();
  fp.moveTo(0, 0.03); fp.lineTo(W, 0.03); fp.lineTo(W, H); fp.lineTo(0, H); fp.closePath();
  const hole = new THREE.Path(); hole.absarc(OUT.fanX, OUT.fanY, OUT.fanR + 0.012, 0, Math.PI * 2, true); fp.holes.push(hole);
  const fpg = new THREE.ExtrudeGeometry(fp, { depth: 0.006, bevelEnabled: true, bevelSize: 0.003, bevelThickness: 0.003, bevelSegments: 2, curveSegments: 48 });
  const front = new THREE.Mesh(fpg, MAT.cabinet); front.position.z = D - 0.006;
  part(front, { id: 'out.cabinet', name: 'Cabinet (front panel)', unit: 'outdoor', fidelity: 'sourced', source: 'S3 p.11 outline; S5 cabinet', fn: 'Front panel with the fan outlet; heated air leaves forward.', links: ['outdoor airflow'], explode: [0, 0, 0.4], casing: true });
  casing.push(front); g.add(front);
  const grille = new THREE.Group();
  for (let i = -6; i <= 6; i++) { const r = OUT.fanR + 0.01; const y = (i / 6.5) * r; const half = Math.sqrt(Math.max(0, r * r - y * y)); grille.add(at(box(2 * half, 0.004, 0.004, MAT.grille), OUT.fanX, OUT.fanY + y, D + 0.003)); }
  for (let i = -6; i <= 6; i++) { const r = OUT.fanR + 0.01; const x = (i / 6.5) * r; const half = Math.sqrt(Math.max(0, r * r - x * x)); grille.add(at(box(0.004, 2 * half, 0.004, MAT.grille), OUT.fanX + x, OUT.fanY, D + 0.006)); }
  part(grille, { id: 'out.grille', name: 'Fan grille', unit: 'outdoor', fidelity: 'modelled', source: 'S3 p.11 (grille pattern modelled)', fn: 'Guard over the propeller fan outlet.', links: [], explode: [0, 0, 0.5], casing: true });
  casing.push(grille); g.add(grille);
  const top = rbox(W + 0.006, 0.012, D + 0.006, 0.004, MAT.cabinet); at(top, W / 2, H - 0.004, D / 2);
  part(top, { id: 'out.top', name: 'Top panel', unit: 'outdoor', fidelity: 'sourced', source: 'S5 top panel', fn: 'Weather cover.', links: [], explode: [0, 0.3, 0], casing: true });
  casing.push(top); g.add(top);
  const right = box(0.006, H - 0.04, D - 0.12, MAT.cabinet); at(right, W - 0.003, (H - 0.04) / 2 + 0.03 + 0.0, 0.06 + (D - 0.12) / 2 - 0.0);
  right.position.set(W - 0.003, 0.03 + (H - 0.04) / 2, (D - 0.12) / 2);
  part(right, { id: 'out.rightPanel', name: 'Right side panel and handle', unit: 'outdoor', fidelity: 'modelled', source: 'S3 p.11 (handle, service panel location)', fn: 'Closes the compressor compartment.', links: [], explode: [0.3, 0, -0.05], casing: true });
  casing.push(right); g.add(right);
  const handle = rbox(0.012, 0.03, 0.12, 0.004, MAT.darkPlastic); at(handle, W + 0.006, H - 0.08, 0.1); right.add(handle); handle.position.sub(right.position);
  const service = box(0.006, 0.3, 0.12, MAT.cabinet); at(service, W - 0.002, 0.18, D - 0.065);
  part(service, { id: 'out.servicePanel', name: 'Service panel', unit: 'outdoor', fidelity: 'sourced', source: 'S3 p.11 service panel, S5', fn: 'Covers the stop valves and the power/communication terminal block.', links: ['service valves'], explode: [0.35, 0, 0.1], casing: true });
  casing.push(service); g.add(service);

  // ---------------- L-shaped coil (rear + left) with rear guard
  const coil = new THREE.Group();
  const finMat = MAT.aluminium.clone();
  const finsRear = new THREE.InstancedMesh(new THREE.BoxGeometry(0.0007, H - 0.08, 0.034), finMat, 130);
  const mm = new THREE.Matrix4();
  for (let i = 0; i < 130; i++) { mm.makeTranslation(0.04 + (i * (OUT.partitionX - 0.05)) / 130, 0.03 + (H - 0.08) / 2 + 0.01, 0.028); finsRear.setMatrixAt(i, mm); }
  const finsLeft = new THREE.InstancedMesh(new THREE.BoxGeometry(0.034, H - 0.08, 0.0007), finMat, 60);
  for (let i = 0; i < 60; i++) { mm.makeTranslation(0.022, 0.03 + (H - 0.08) / 2 + 0.01, 0.05 + (i * (D - 0.09)) / 60); finsLeft.setMatrixAt(i, mm); }
  coil.add(finsRear, finsLeft);
  for (let r = 0; r < 2; r++) for (let k = 0; k < 18; k++) {
    const y = 0.06 + k * 0.025;
    const t1 = cyl(0.0042, OUT.partitionX - 0.04, MAT.copper, 8); t1.rotation.z = Math.PI / 2; at(t1, 0.04 + (OUT.partitionX - 0.04) / 2, y, 0.018 + r * 0.02); coil.add(t1);
    const t2 = cyl(0.0042, D - 0.08, MAT.copper, 8); t2.rotation.x = Math.PI / 2; at(t2, 0.012 + r * 0.02, y, 0.05 + (D - 0.08) / 2); coil.add(t2);
  }
  part(coil, { id: 'out.coil', name: 'Outdoor heat exchanger (L-shaped, rear + left)', unit: 'outdoor', fidelity: 'modelled', source: 'S3 p.11 air in at rear and left; S3 p.18; fin count/rows modelled', fn: 'Condenser in COOL (rejects heat to outdoor air); evaporator in HEAT, where frost can form below 0 degC.', links: ['condensing temperature', 'outdoor fan', 'defrost'], explode: [-0.12, 0, -0.32] });
  g.add(coil);
  const frostRear = box(OUT.partitionX - 0.04, H - 0.08, 0.036, MAT.frost); at(frostRear, 0.04 + (OUT.partitionX - 0.04) / 2, 0.03 + (H - 0.08) / 2 + 0.01, 0.028);
  const frostLeft = box(0.036, H - 0.08, D - 0.08, MAT.frost); at(frostLeft, 0.022, 0.03 + (H - 0.08) / 2 + 0.01, 0.05 + (D - 0.08) / 2);
  coil.add(frostRear, frostLeft);
  const guard = new THREE.Group();
  for (let i = 0; i < 9; i++) guard.add(at(box(OUT.partitionX - 0.02, 0.003, 0.003, MAT.grille), 0.02 + (OUT.partitionX - 0.02) / 2, 0.06 + i * 0.055, 0.003));
  for (let i = 0; i < 8; i++) guard.add(at(box(0.003, H - 0.08, 0.003, MAT.grille), 0.04 + i * 0.07, H / 2, 0.003));
  part(guard, { id: 'out.rearGuard', name: 'Rear coil guard', unit: 'outdoor', fidelity: 'modelled', source: 'S3 p.11 (back view grille)', fn: 'Protects the rear coil face where outdoor air enters.', links: [], explode: [0, 0, -0.45], casing: true });
  casing.push(guard); g.add(guard);
  const rt65 = cyl(0.004, 0.02, MAT.graphite, 8); at(rt65, 0.45, 0.35, -0.004); rt65.rotation.x = Math.PI / 2;
  part(rt65, { id: 'out.rt65', name: 'Ambient thermistor RT65', unit: 'outdoor', fidelity: 'sourced', source: 'S3 p.18', fn: 'Outdoor air temperature: low ambient operation in COOL.', links: ['controller'], explode: [0, 0.05, -0.5] });
  g.add(rt65);
  const rt68 = cyl(0.004, 0.02, MAT.graphite, 8); at(rt68, 0.3, 0.45, 0.05);
  part(rt68, { id: 'out.rt68', name: 'Outdoor heat exchanger thermistor RT68', unit: 'outdoor', fidelity: 'sourced', source: 'S3 p.18', fn: 'Coil temperature for high pressure protection (COOL) and outdoor fan control.', links: ['controller'], explode: [-0.1, 0.05, -0.35] });
  g.add(rt68);
  const rt61 = cyl(0.004, 0.02, MAT.graphite, 8); at(rt61, 0.1, 0.06, 0.05);
  part(rt61, { id: 'out.rt61', name: 'Defrost thermistor RT61', unit: 'outdoor', fidelity: 'sourced', source: 'S3 p.18, p.41', fn: 'Starts and ends defrost (finish 5 degC with JS soldered).', links: ['defrost'], explode: [-0.1, -0.05, -0.35] });
  g.add(rt61);

  // ---------------- propeller fan + motor support
  const fan = new THREE.Group(); fan.position.set(OUT.fanX, OUT.fanY, 0.215);
  const hub = cyl(0.04, 0.05, MAT.propeller, 24); hub.rotation.x = Math.PI / 2; fan.add(hub);
  for (let b = 0; b < 3; b++) {
    const sh = new THREE.Shape();
    sh.moveTo(0.035, -0.03); sh.quadraticCurveTo(0.12, -0.07, OUT.fanR - 0.005, -0.04); sh.quadraticCurveTo(OUT.fanR + 0.004, 0.02, OUT.fanR - 0.02, 0.07); sh.quadraticCurveTo(0.1, 0.06, 0.035, 0.03); sh.closePath();
    const bg = new THREE.ExtrudeGeometry(sh, { depth: 0.002, bevelEnabled: false, curveSegments: 12 });
    const blade = new THREE.Mesh(bg, MAT.propeller);
    const bw = new THREE.Group(); bw.rotation.z = (b * 2 * Math.PI) / 3; blade.rotation.x = 0.35; bw.add(blade); fan.add(bw);
  }
  part(fan, { id: 'out.fan', name: 'Propeller fan', unit: 'outdoor', fidelity: 'modelled', source: 'S3 p.6 rpm/airflow (940 rpm = 2178 m3/h cooling High); 3 blades and shape modelled', fn: 'Pulls outdoor air through the coil and discharges it forward. Higher speed lowers condensing temperature at the cost of fan power.', links: ['outdoor airflow', 'condensing temperature'], explode: [0, 0, 0.55] });
  g.add(fan);
  const fm = cyl(0.045, 0.05, MAT.darkPlastic, 20); fm.rotation.x = Math.PI / 2; at(fm, OUT.fanX, OUT.fanY, 0.165);
  const ms = new THREE.Group(); ms.add(fm); ms.add(at(box(0.03, H - 0.06, 0.012, MAT.steel), OUT.fanX, H / 2, 0.14));
  part(ms, { id: 'out.fanMotor', name: 'Outdoor fan motor + motor support (RC0J50-NC E1)', unit: 'outdoor', fidelity: 'sourced', source: 'S3 p.6 model, 0.22 A cooling; S5 motor support', fn: 'DC fan motor; ON 5 s before the compressor and OFF 15 s after (S3 10-1).', links: ['outdoor fan'], explode: [0, 0, 0.35] });
  g.add(ms);

  // ---------------- partition
  const partition = box(0.004, H - 0.05, D - 0.02, MAT.steel); at(partition, OUT.partitionX, (H - 0.05) / 2 + 0.03, D / 2);
  part(partition, { id: 'out.partition', name: 'Separator (fan / compressor compartments)', unit: 'outdoor', fidelity: 'modelled', source: 'modelled', fn: 'Keeps the airflow path separate from the compressor compartment.', links: [], explode: [0.08, 0, 0], casing: true });
  casing.push(partition); g.add(partition);

  // ---------------- compressor (shell) + accumulator + rubber mounts
  const comp = new THREE.Group();
  const cx = 0.69, cz = 0.15, cyb = 0.05;
  const shell = cyl(0.056, 0.2, MAT.compressor, 32); at(shell, 0, 0.1, 0); comp.add(shell);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.056, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2), MAT.compressor); dome.scale.y = 0.5; at(dome, 0, 0.2, 0); comp.add(dome);
  const bottom = dome.clone(); bottom.rotation.x = Math.PI; at(bottom, 0, 0.0, 0); comp.add(bottom);
  comp.add(at(cyl(0.022, 0.025, MAT.darkPlastic, 16), 0.0, 0.22, 0.035));
  const acc = cyl(0.03, 0.15, MAT.compressor, 24); at(acc, -0.075, 0.13, -0.02); comp.add(acc);
  comp.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.03, 20, 10), MAT.compressor), -0.075, 0.205, -0.02));
  comp.add(tube([new THREE.Vector3(-0.075, 0.055, -0.02), new THREE.Vector3(-0.075, 0.03, -0.02), new THREE.Vector3(-0.05, 0.03, -0.01), new THREE.Vector3(-0.045, 0.06, -0.008)], 0.006, MAT.copper, 16));
  for (let i = 0; i < 3; i++) { const a = (i * 2 * Math.PI) / 3 + 0.4; comp.add(at(cyl(0.012, 0.018, MAT.rubber, 12), Math.cos(a) * 0.065, -0.012, Math.sin(a) * 0.065)); }
  comp.position.set(cx, cyb + 0.018, cz);
  // rotor group (spins inside the shell; shown in X-ray / mechanism view)
  const compRotor = new THREE.Group();
  const rotorCore = cyl(0.03, 0.08, MAT.steel, 20); compRotor.add(at(rotorCore, 0, 0.13, 0));
  const ecc = cyl(0.022, 0.025, MAT.copper, 20); ecc.position.set(0.012, 0.045, 0); compRotor.add(ecc);
  compRotor.add(at(cyl(0.005, 0.18, MAT.steel, 8), 0, 0.1, 0));
  comp.add(compRotor);
  part(comp, { id: 'out.compressor', name: 'Compressor KVB073FYXMC with suction accumulator', unit: 'outdoor', fidelity: 'sourced', source: 'S3 p.6, S5 (model, 3 rubber mounts, FW68S oil 0.27 L); internals not published', fn: 'Inverter-driven compressor raising refrigerant pressure. Shell and side accumulator per S3 p.18; the internal mechanism view is a conceptual rolling-piston explainer, not a reconstruction.', links: ['frequency', 'mass flow', 'discharge temperature'], explode: [0.25, 0.1, 0.25] });
  g.add(comp);
  const rt62 = cyl(0.004, 0.02, MAT.graphite, 8); at(rt62, cx + 0.03, 0.33, cz - 0.02);
  part(rt62, { id: 'out.rt62', name: 'Discharge temperature thermistor RT62', unit: 'outdoor', fidelity: 'sourced', source: 'S3 p.18, p.40', fn: 'Discharge protection (111/116 degC) and LEV control input.', links: ['LEV', 'protection'], explode: [0.25, 0.25, 0.25] });
  g.add(rt62);

  // ---------------- 4-way valve, mufflers, LEV, strainer, capillary, stop valves
  const fwv = new THREE.Group();
  const body = cyl(0.014, 0.075, MAT.copper, 16); body.rotation.z = Math.PI / 2; fwv.add(body);
  const rvCoil = box(0.035, 0.03, 0.03, MAT.graphite); at(rvCoil, 0.0, 0.03, 0); fwv.add(rvCoil);
  const rvSlider = box(0.02, 0.008, 0.008, MAT.red); at(rvSlider, -0.015, 0, 0.016); fwv.add(rvSlider);
  fwv.position.set(0.66, 0.4, 0.14);
  part(fwv, { id: 'out.fourWay', name: '4-way valve + R.V. coil (21S4)', unit: 'outdoor', fidelity: 'sourced', source: 'S3 p.18, p.40 (R.V. coil ON in HEAT; reverses 5 s before start)', fn: 'Routes discharge gas to the outdoor coil (COOL/defrost) or to the indoor coil (HEAT). Red slider shows position.', links: ['mode', 'defrost'], explode: [0.15, 0.3, 0.2] });
  g.add(fwv);
  const muff1 = cyl(0.016, 0.06, MAT.copper, 14); at(muff1, 0.72, 0.31, 0.12);
  part(muff1, { id: 'out.mufflerD', name: 'Muffler (discharge)', unit: 'outdoor', fidelity: 'sourced', source: 'S3 p.18', fn: 'Damps discharge pulsation.', links: [], explode: [0.25, 0.2, 0.1] });
  g.add(muff1);
  const muff2 = cyl(0.016, 0.05, MAT.copper, 14); muff2.rotation.z = Math.PI / 2; at(muff2, 0.74, 0.25, 0.22);
  part(muff2, { id: 'out.mufflerS', name: 'Muffler (gas line)', unit: 'outdoor', fidelity: 'sourced', source: 'S3 p.18', fn: 'Muffler between the gas stop valve and the 4-way valve.', links: [], explode: [0.3, 0.15, 0.2] });
  g.add(muff2);
  const lev = new THREE.Group();
  lev.add(cyl(0.01, 0.04, MAT.copper, 14));
  lev.add(at(cyl(0.018, 0.028, MAT.darkPlastic, 18), 0, 0.03, 0));
  lev.position.set(0.66, 0.16, 0.07);
  part(lev, { id: 'out.lev', name: 'LEV (electronic expansion valve, 12 V DC coil)', unit: 'outdoor', fidelity: 'sourced', source: 'S3 p.8, p.18; S5 expansion valve assembly', fn: 'Meters refrigerant between condenser and evaporator; in this unit it sits outdoors, so the 6.35 mm interconnect carries low-pressure two-phase mixture in COOL.', links: ['superheat', 'discharge temperature'], explode: [0.1, -0.05, -0.2] });
  g.add(lev);
  const strainer = cyl(0.009, 0.04, MAT.copper, 12); at(strainer, 0.57, 0.1, 0.04);
  part(strainer, { id: 'out.strainer', name: 'Strainer #100', unit: 'outdoor', fidelity: 'sourced', source: 'S3 p.18', fn: 'Protects the LEV.', links: [], explode: [0.05, -0.1, -0.2] });
  g.add(strainer);
  const capPts: THREE.Vector3[] = [];
  for (let i = 0; i <= 60; i++) { const a = i * 0.45; capPts.push(new THREE.Vector3(0.7 + Math.cos(a) * 0.015, 0.1 + i * 0.0012, 0.07 + Math.sin(a) * 0.015)); }
  const cap = tube(capPts, 0.002, MAT.copper, 120);
  part(cap, { id: 'out.capillary', name: 'Capillary tube 4.0 x 2.4 x 240', unit: 'outdoor', fidelity: 'sourced', source: 'S3 p.18', fn: 'Fixed restriction in series with the LEV (folded into the LEV flow coefficient).', links: ['LEV'], explode: [0.15, -0.05, -0.2] });
  g.add(cap);
  const sv = new THREE.Group();
  sv.add(at(box(0.04, 0.028, 0.03, MAT.steel), 0.775, 0.165, 0.2));
  sv.add(at(box(0.045, 0.034, 0.034, MAT.steel), 0.775, 0.1, 0.2));
  part(sv, { id: 'out.stopValves', name: 'Stop valves: liquid 6.35 (upper), gas 9.52 with service port (lower)', unit: 'outdoor', fidelity: 'sourced', source: 'S3 p.11, p.18', fn: 'Field connections for the interconnecting pipes; service port on the gas valve.', links: ['interconnect'], explode: [0.35, -0.05, 0.15] });
  g.add(sv);

  // ---------------- inverter PCB + heat sink + reactor
  const inv = new THREE.Group();
  inv.add(at(box(0.22, 0.1, 0.2, MAT.darkPlastic), 0.68, 0.47, 0.15));
  inv.add(at(box(0.2, 0.004, 0.18, MAT.pcb), 0.68, 0.418, 0.15));
  for (let i = 0; i < 10; i++) inv.add(at(box(0.05, 0.08, 0.002, MAT.aluminium), OUT.partitionX - 0.03, 0.45, 0.08 + i * 0.014));
  part(inv, { id: 'out.inverter', name: 'Inverter P.C. board with heat sink (power module IC700)', unit: 'outdoor', fidelity: 'sourced', source: 'S3 p.8 (power module, smoothing capacitors, PAM), S3 p.47 fin thermistor', fn: 'Converts mains to variable-frequency drive for the compressor. Losses go to the heat sink cooled by outdoor air; fin over-temperature stops the compressor.', links: ['compressor', 'current', 'heat sink'], explode: [0.1, 0.3, 0.05] });
  g.add(inv);
  const reactor = box(0.07, 0.06, 0.06, MAT.graphite); at(reactor, 0.62, 0.065, 0.24);
  part(reactor, { id: 'out.reactor', name: 'Reactor L61 (18 mH)', unit: 'outdoor', fidelity: 'sourced', source: 'S3 p.8', fn: 'Power factor correction choke.', links: [], explode: [0.05, -0.12, 0.2] });
  g.add(reactor);

  const nodes: Record<string, THREE.Vector3> = {
    compDis: new THREE.Vector3(cx, cyb + 0.018 + 0.235, cz),
    mufD: new THREE.Vector3(0.72, 0.31, 0.12),
    fwvD: new THREE.Vector3(0.66, 0.4, 0.14), fwvC: new THREE.Vector3(0.62, 0.4, 0.14), fwvE: new THREE.Vector3(0.7, 0.4, 0.16), fwvS: new THREE.Vector3(0.66, 0.38, 0.12),
    coilTop: new THREE.Vector3(0.53, 0.5, 0.03), coilBot: new THREE.Vector3(0.53, 0.07, 0.03),
    strainer: new THREE.Vector3(0.57, 0.1, 0.04), lev: new THREE.Vector3(0.66, 0.16, 0.07), cap: new THREE.Vector3(0.7, 0.16, 0.07),
    svLiq: new THREE.Vector3(0.79, 0.165, 0.2), svGas: new THREE.Vector3(0.79, 0.1, 0.2), mufS: new THREE.Vector3(0.74, 0.25, 0.22),
    accIn: new THREE.Vector3(cx - 0.075, cyb + 0.018 + 0.235, cz - 0.02),
  };
  return {
    group: g, fan, compRotor, rvSlider, frost: [frostRear, frostLeft], casing, nodes,
    airIn: { rear: new THREE.Box3(new THREE.Vector3(0.03, 0.05, -0.25), new THREE.Vector3(0.54, 0.5, -0.01)), left: new THREE.Box3(new THREE.Vector3(-0.25, 0.05, 0.04), new THREE.Vector3(-0.01, 0.5, 0.27)) },
    airOut: new THREE.Vector3(OUT.fanX, OUT.fanY, D),
  };
}

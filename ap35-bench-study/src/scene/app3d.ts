/**
 * Three.js scene. Reads the authoritative simulation frame; never computes
 * capacity, temperatures or actuator speeds itself (only visual interpolation).
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { MAT, PARTS, part, box, at, tube, setOpacity, tempColor, cyl } from './kit';
import { buildIndoor, vaneRotation, IND, type IndoorHandles } from './indoorUnit';
import { buildOutdoor, OUT, type OutdoorHandles } from './outdoorUnit';
import { IndoorParticles, OutdoorParticles, plumeGeometry, streamlines, sliceTexture, type FieldMsg, type JetMsg, type RoomDims } from './airflowViz';
import { DEFAULT_OBSTACLES } from '../model/airfield';
import type { Outputs, SimView } from './viewTypes';

export type ViewMode = 'system' | 'indoor' | 'outdoor' | 'cutaway' | 'airflow' | 'cycle' | 'comfort' | 'exploded';
export const VIEW_MODES: { id: ViewMode; label: string; key: string }[] = [
  { id: 'system', label: 'System', key: '1' }, { id: 'indoor', label: 'Indoor', key: '2' }, { id: 'outdoor', label: 'Outdoor', key: '3' },
  { id: 'cutaway', label: 'Cutaway / X-ray', key: '4' }, { id: 'airflow', label: 'Airflow', key: '5' }, { id: 'cycle', label: 'Refrigeration cycle', key: '6' },
  { id: 'comfort', label: 'Room comfort', key: '7' }, { id: 'exploded', label: 'Exploded', key: '8' },
];

interface PipeSeg { id: string; mesh: THREE.Mesh; curve: THREE.Curve<THREE.Vector3>; mat: THREE.MeshStandardMaterial; label: string; role: string }

export class Scene3D {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  root = new THREE.Group();
  indoor!: IndoorHandles; outdoor!: OutdoorHandles;
  indoorWorld = new THREE.Group(); outdoorWorld = new THREE.Group();
  dims: RoomDims = { W: 4, H: 2.8, D: 4, wallT: 0.22 };
  mountX = 2; mountH = 2.55;
  pipes: PipeSeg[] = [];
  tracers: THREE.InstancedMesh;
  loopCurveCool: THREE.CurvePath<THREE.Vector3> = new THREE.CurvePath();
  inP: IndoorParticles; outP: OutdoorParticles;
  plume: THREE.Mesh; centre: THREE.Line; stream: THREE.LineSegments;
  sliceH: THREE.Mesh; sliceV: THREE.Mesh; arrows: THREE.InstancedMesh;
  probesG = new THREE.Group();
  wall!: THREE.Mesh;
  mode: ViewMode = 'system';
  show = { particles: true, outdoorParticles: true, plume: false, stream: false, sliceH: false, sliceV: false, arrows: false, tracers: false, labels: false, heatArrows: false };
  colorMode: 'temperature' | 'velocity' = 'temperature';
  sliceHeight = 1.1; sliceX = 2.0;
  slow = false; reducedMotion = false;
  selected: string | null = null;
  onSelect: (id: string | null) => void = () => {};
  onPickRoom: (p: THREE.Vector3) => void = () => {};
  probePlacing = false;
  view: SimView | null = null; field: FieldMsg | null = null; jet: JetMsg | null = null;
  private tween: { p0: THREE.Vector3; p1: THREE.Vector3; t0: THREE.Vector3; t1: THREE.Vector3; start: number; dur: number } | null = null;
  private explodeT = 0; private explodeTarget = 0;
  private fanAng = 0; private ofanAng = 0; private compAng = 0;
  private highlight: THREE.Object3D | null = null;
  private highlightMat = new THREE.MeshStandardMaterial({ color: 0xc4161c, emissive: 0xc4161c, emissiveIntensity: 0.35, transparent: true, opacity: 0.9 });
  private clip = new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0);
  private ghost = 1;
  private ghostTarget = 1;
  private lastT = performance.now();
  private raycaster = new THREE.Raycaster();
  private heatArrows = new THREE.Group();
  private ifanBlur: THREE.Mesh; private ofanBlur: THREE.Mesh;
  frameCount = 0; fps = 0; private fpsT = performance.now();
  private hidden = false;

  constructor(public canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.localClippingEnabled = true;
    this.scene.background = new THREE.Color(0xf1ede5);
    const pm = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.02, 60);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true; this.controls.dampingFactor = 0.08;
    this.controls.maxDistance = 14; this.controls.minDistance = 0.25;
    this.scene.add(this.root);
    this.lights();
    this.buildRoom();
    this.placeUnits();
    this.buildPipes();
    this.inP = new IndoorParticles(1600, this.dims);
    this.outP = new OutdoorParticles(700);
    this.root.add(this.inP.points);
    this.outdoorWorld.add(this.outP.points);
    this.plume = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false }));
    this.centre = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x2f7fc1, transparent: true, opacity: 0.55 }));
    this.stream = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85 }));
    this.root.add(this.plume, this.centre, this.stream);
    this.sliceH = new THREE.Mesh(new THREE.PlaneGeometry(this.dims.W, this.dims.D), new THREE.MeshBasicMaterial({ transparent: true, side: THREE.DoubleSide, depthWrite: false }));
    this.sliceH.rotation.x = -Math.PI / 2;
    this.sliceV = new THREE.Mesh(new THREE.PlaneGeometry(this.dims.D, this.dims.H), new THREE.MeshBasicMaterial({ transparent: true, side: THREE.DoubleSide, depthWrite: false }));
    this.sliceV.rotation.y = Math.PI / 2;
    this.root.add(this.sliceH, this.sliceV);
    this.arrows = new THREE.InstancedMesh(new THREE.ConeGeometry(0.018, 0.08, 6).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x2f7fc1 }), 400);
    this.arrows.count = 0; this.root.add(this.arrows);
    this.tracers = new THREE.InstancedMesh(new THREE.SphereGeometry(0.011, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }), 60);
    this.root.add(this.tracers);
    this.root.add(this.probesG, this.heatArrows);
    this.ifanBlur = new THREE.Mesh(new THREE.CylinderGeometry(0.047, 0.047, 0.59, 24, 1, true), new THREE.MeshBasicMaterial({ color: 0xdfe3e6, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
    this.ifanBlur.rotation.z = Math.PI / 2; this.indoor.fan.add(this.ifanBlur); this.ifanBlur.position.set(-0.002, 0, 0);
    this.ofanBlur = new THREE.Mesh(new THREE.CircleGeometry(OUT.fanR, 40), new THREE.MeshBasicMaterial({ color: 0x3d4045, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
    this.outdoor.fan.add(this.ofanBlur);
    this.setMode('system', true);
    canvas.addEventListener('pointerdown', (e) => this.pointerDown(e));
    canvas.addEventListener('pointerup', (e) => this.pointerUp(e));
    document.addEventListener('visibilitychange', () => { this.hidden = document.hidden; });
    this.resize();
  }

  lights() {
    this.scene.add(new THREE.HemisphereLight(0xfffaf0, 0xcfc6b5, 0.55));
    const sun = new THREE.DirectionalLight(0xfff4e0, 1.6);
    sun.position.set(-3, 6, 4); sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048); sun.shadow.camera.left = -5; sun.shadow.camera.right = 5; sun.shadow.camera.top = 5; sun.shadow.camera.bottom = -5; sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.02;
    sun.target.position.set(2, 1, 0); this.scene.add(sun, sun.target);
  }

  buildRoom() {
    const { W, H, D, wallT } = this.dims;
    const floor = box(W + 0.4, 0.06, D + 0.2, MAT.floor); at(floor, W / 2, -0.03, D / 2 + 0.1); floor.receiveShadow = true; this.root.add(floor);
    const grid = new THREE.GridHelper(Math.max(W, D) * 2.4, 48, 0xcfc7b8, 0xe0d9cc); grid.position.set(W / 2, -0.059, 0); this.root.add(grid);
    const outFloor = box(W + 0.4, 0.06, 1.7, new THREE.MeshStandardMaterial({ color: 0xcbc3b4, roughness: 0.95 })); at(outFloor, W / 2, -0.03, -wallT - 0.85); outFloor.receiveShadow = true; this.root.add(outFloor);
    // exterior wall drawn as a section that ends at a hatched cut edge; the outdoor unit sits beyond the cut
    this.buildWall();
    const right = box(0.12, H, D, MAT.wall); at(right, W + 0.06, H / 2, D / 2); right.receiveShadow = true; this.root.add(right);
    const back = box(W + 0.12, 0.12, 0.12, MAT.wall); at(back, W / 2, 0.06, D + 0.06); back.receiveShadow = true; this.root.add(back);
    const curb = box(0.12, 0.12, D, MAT.wall); at(curb, -0.06, 0.06, D / 2); this.root.add(curb);
    const ceilEdges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(W, H, D)), new THREE.LineBasicMaterial({ color: 0xbdb3a1, transparent: true, opacity: 0.6 }));
    ceilEdges.position.set(W / 2, H / 2, D / 2); this.root.add(ceilEdges);
    // furniture from the airflow obstacles
    for (const o of DEFAULT_OBSTACLES) {
      const g = new THREE.Group();
      const sx = o.max[0] - o.min[0], sy = o.max[1] - o.min[1], sz = o.max[2] - o.min[2];
      if (o.name === 'desk') {
        g.add(at(box(sx, 0.04, sz, MAT.furniture), 0, sy / 2 - 0.02, 0));
        for (const lx of [-1, 1]) for (const lz of [-1, 1]) g.add(at(box(0.04, sy - 0.04, 0.04, MAT.furniture2), lx * (sx / 2 - 0.04), -0.02, lz * (sz / 2 - 0.04)));
        g.add(at(box(0.4, 0.28, 0.03, MAT.graphite), 0, sy / 2 + 0.16, sz / 2 - 0.12));
      } else if (o.name === 'bed') {
        g.add(at(box(sx, sy * 0.55, sz, MAT.furniture2), 0, -sy * 0.22, 0));
        g.add(at(box(sx - 0.06, sy * 0.4, sz - 0.06, new THREE.MeshStandardMaterial({ color: 0xf2efe8, roughness: 0.9 })), 0, sy * 0.25, 0));
      } else g.add(box(sx, sy, sz, MAT.furniture));
      g.position.set((o.min[0] + o.max[0]) / 2, (o.min[1] + o.max[1]) / 2, (o.min[2] + o.max[2]) / 2);
      g.traverse((m) => { (m as THREE.Mesh).castShadow = true; (m as THREE.Mesh).receiveShadow = true; });
      this.root.add(g);
    }
    // occupant at the desk (simple figure)
    const person = new THREE.Group();
    const skin = new THREE.MeshStandardMaterial({ color: 0x8b8f96, roughness: 0.8 });
    person.add(at(new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.42, 6, 12), skin), 0, 0.72, 0));
    person.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.1, 16, 12), skin), 0, 1.15, 0));
    person.position.set(0.85, 0, 3.15); this.root.add(person);
  }

  wallGroup = new THREE.Group();
  buildWall() {
    const { H, wallT } = this.dims;
    this.root.remove(this.wallGroup); this.wallGroup = new THREE.Group();
    const x0 = -0.2, x1 = this.mountX + 0.72;
    this.wall = box(x1 - x0, H, wallT, MAT.wall); at(this.wall, (x0 + x1) / 2, H / 2, -wallT / 2);
    this.wall.receiveShadow = true; this.wall.castShadow = true;
    part(this.wall, { id: 'room.wall', name: 'Exterior wall (section)', unit: 'room', fidelity: 'modelled', source: 'demonstration room', fn: 'Separates the indoor and outdoor air circuits. A split AC recirculates room air; it does not supply outdoor air. The wall is drawn cut away beyond the pipe hole.', links: ['envelope'], explode: [0, 0, 0] });
    // hatched cut face
    const c = document.createElement('canvas'); c.width = 64; c.height = 64; const g = c.getContext('2d')!;
    g.fillStyle = '#d8cdb9'; g.fillRect(0, 0, 64, 64); g.strokeStyle = '#a3957c'; g.lineWidth = 3;
    for (let i = -64; i < 128; i += 14) { g.beginPath(); g.moveTo(i, 64); g.lineTo(i + 64, 0); g.stroke(); }
    const tex = new THREE.CanvasTexture(c); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(1, 12);
    const cut = new THREE.Mesh(new THREE.PlaneGeometry(wallT, H), new THREE.MeshStandardMaterial({ map: tex, roughness: 1 }));
    cut.rotation.y = Math.PI / 2; cut.position.set(x1 + 0.001, H / 2, -wallT / 2);
    const top = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, wallT), new THREE.MeshStandardMaterial({ map: tex, roughness: 1 }));
    top.rotation.x = -Math.PI / 2; top.position.set((x0 + x1) / 2, H + 0.001, -wallT / 2);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(this.wall.geometry), new THREE.LineBasicMaterial({ color: 0x8f846f }));
    edges.position.copy(this.wall.position);
    this.wallGroup.add(this.wall, cut, top, edges);
    this.root.add(this.wallGroup);
  }

  placeUnits() {
    this.indoor = buildIndoor();
    this.outdoor = buildOutdoor();
    this.indoorWorld.add(this.indoor.group);
    this.outdoorWorld.add(this.outdoor.group);
    this.root.add(this.indoorWorld, this.outdoorWorld);
    this.layoutUnits();
    // wall bracket for the outdoor unit
    const br = new THREE.Group();
    for (const lx of [0.15, 0.65]) {
      br.add(at(box(0.04, 0.04, 0.48, MAT.steel), lx, -0.02, 0.24 - 0.12));
      br.add(tube([new THREE.Vector3(lx, -0.04, -0.12), new THREE.Vector3(lx, -0.3, -0.12), new THREE.Vector3(lx, -0.04, 0.3)], 0.012, MAT.steel, 8));
    }
    this.outdoor.group.add(br);
  }

  layoutUnits() {
    this.indoorWorld.position.set(this.mountX, this.mountH - IND.H, 0);
    this.outdoorWorld.position.set(this.mountX + 1.75, 0.95, -this.dims.wallT - 0.12);
    this.outdoorWorld.rotation.y = Math.PI;
    this.indoorWorld.updateMatrixWorld(true); this.outdoorWorld.updateMatrixWorld(true);
    for (const v of PARTS.values()) v.home.copy(v.obj.position);
  }

  /** Apply supported geometry changes (mount position) from the profile. */
  setGeometry(mountX: number, mountH: number) {
    if (Math.abs(mountX - this.mountX) < 1e-6 && Math.abs(mountH - this.mountH) < 1e-6) return;
    this.mountX = mountX; this.mountH = mountH;
    this.layoutUnits();
    this.buildWall();
    for (const p of this.pipes) { this.root.remove(p.mesh); p.mesh.geometry.dispose(); }
    this.pipes = [];
    this.buildPipes();
  }

  private w(o: THREE.Object3D, v: THREE.Vector3) { return o.localToWorld(v.clone()); }

  buildPipes() {
    const n = this.outdoor.nodes, og = this.outdoor.group;
    const W = (v: THREE.Vector3) => this.w(og, v);
    const ig = this.indoor.group;
    const gasIn = this.w(ig, this.indoor.pipeOut.gas), liqIn = this.w(ig, this.indoor.pipeOut.liquid);
    const holeX = this.mountX + 0.36, holeY = this.mountH - IND.H + 0.05;
    const wt = this.dims.wallT;
    const svL = W(n.svLiq), svG = W(n.svGas);
    const cutX = this.mountX + 0.72;
    const outsideRun = (start: THREE.Vector3, end: THREE.Vector3, dx: number) => [
      start, new THREE.Vector3(holeX + dx, holeY, 0.01), new THREE.Vector3(holeX + dx, holeY, -wt - 0.04),
      new THREE.Vector3(cutX + 0.12 + dx, holeY + dx, -wt - 0.05 + dx), new THREE.Vector3(cutX + 0.14 + dx, end.y + 0.06, -wt - 0.08), new THREE.Vector3(end.x - 0.04, end.y, end.z), end,
    ];
    const seg = (id: string, label: string, role: string, pts: THREE.Vector3[], r: number, insulated = false) => {
      const mat = new THREE.MeshStandardMaterial({ color: 0xb87333, roughness: insulated ? 0.85 : 0.35, metalness: insulated ? 0 : 0.6 });
      const m = tube(pts, insulated ? r * 2.2 : r, mat, 80);
      part(m, { id: 'pipe.' + id, name: label, unit: 'pipe', fidelity: 'modelled', source: 'S3 p.18 topology; routing modelled', fn: role, links: ['refrigerant'], explode: [0, 0, 0] });
      this.root.add(m);
      this.pipes.push({ id, mesh: m, curve: m.userData.curve, mat, label, role });
    };
    seg('dis', 'Discharge line (compressor -> muffler -> 4-way valve)', 'Hot high-pressure gas', [W(n.compDis), W(n.compDis.clone().add(new THREE.Vector3(0, 0.03, -0.02))), W(n.mufD), W(n.fwvD)], 0.0048);
    seg('fwvOut', '4-way valve <-> outdoor coil', 'COOL: hot gas to condenser; HEAT: low-pressure gas from evaporator', [W(n.fwvC), W(n.fwvC.clone().add(new THREE.Vector3(-0.05, 0.08, -0.05))), W(n.coilTop)], 0.0048);
    seg('outCoil', 'Outdoor coil circuit', 'COOL: condensing; HEAT: evaporating', [W(n.coilTop), W(new THREE.Vector3(0.3, 0.48, 0.02)), W(new THREE.Vector3(0.05, 0.3, 0.02)), W(new THREE.Vector3(0.3, 0.12, 0.02)), W(n.coilBot)], 0.0042);
    seg('liqHP', 'Coil -> strainer -> LEV', 'COOL: subcooled high-pressure liquid; HEAT: two-phase after expansion', [W(n.coilBot), W(n.strainer), W(n.lev)], 0.0032);
    seg('levOut', 'LEV -> capillary -> liquid stop valve', 'COOL: low-pressure two-phase; HEAT: high-pressure liquid entering the restriction', [W(n.lev), W(n.cap), W(n.svLiq)], 0.0032);
    seg('liqLine', 'Interconnect "liquid" pipe 6.35 mm', 'COOL: LOW-pressure two-phase (LEV is outdoors); HEAT: subcooled high-pressure liquid', outsideRun(liqIn, svL, 0.02), 0.0032, true);
    seg('inCoil', 'Indoor coil circuit', 'COOL: evaporating; HEAT: condensing', [liqIn, this.w(ig, new THREE.Vector3(IND.outletHalf + 0.012, 0.15, 0.11)), this.w(ig, new THREE.Vector3(IND.outletHalf + 0.012, 0.22, 0.06)), gasIn], 0.0045);
    seg('gasLine', 'Interconnect gas pipe 9.52 mm', 'COOL: low-pressure superheated gas; HEAT: hot high-pressure gas', outsideRun(gasIn, svG, -0.03), 0.0048, true);
    seg('gasOut', 'Gas stop valve -> muffler -> 4-way valve', 'COOL: suction gas; HEAT: discharge gas', [W(n.svGas), W(n.mufS), W(n.fwvE)], 0.0048);
    seg('suct', '4-way valve -> accumulator -> compressor suction', 'Low-pressure suction gas', [W(n.fwvS), W(n.fwvS.clone().add(new THREE.Vector3(0, -0.05, 0))), W(n.accIn)], 0.0048);
    // cable + drain hose (not refrigerant)
    const cable = tube([this.w(ig, new THREE.Vector3(0.33, 0.1, 0.02)), new THREE.Vector3(holeX + 0.06, holeY - 0.02, 0), new THREE.Vector3(holeX + 0.06, holeY - 0.02, -wt - 0.05), new THREE.Vector3(cutX + 0.2, holeY - 0.05, -wt - 0.06), new THREE.Vector3(cutX + 0.22, svL.y + 0.25, -wt - 0.1), W(new THREE.Vector3(0.79, 0.3, 0.24))], 0.004, MAT.graphite, 60);
    part(cable, { id: 'pipe.cable', name: 'Power / communication cable (4 cores)', unit: 'pipe', fidelity: 'sourced', source: 'S1 interconnecting cable 4 cores', fn: 'Indoor unit is fed from the outdoor unit; serial signal carries commands.', links: ['communication'], explode: [0, 0, 0] });
    this.root.add(cable);
    const drain = tube([this.w(ig, this.indoor.pipeOut.drain), new THREE.Vector3(holeX + 0.1, holeY - 0.04, 0), new THREE.Vector3(holeX + 0.1, holeY - 0.06, -wt - 0.04), new THREE.Vector3(holeX + 0.14, 0.05, -wt - 0.05)], 0.008, MAT.insulationLight, 60);
    part(drain, { id: 'pipe.drain', name: 'Drain hose', unit: 'pipe', fidelity: 'sourced', source: 'S2 p.11, S4 drain hose', fn: 'Carries condensate outside.', links: ['condensate'], explode: [0, 0, 0] });
    this.root.add(drain);
  }

  // ------------------------------------------------------------ modes and camera
  presets(): Record<ViewMode, { pos: THREE.Vector3; target: THREE.Vector3 }> {
    const ix = this.mountX, iy = this.mountH - IND.H / 2;
    return {
      system: { pos: new THREE.Vector3(ix - 1.75, 2.95, 3.85), target: new THREE.Vector3(ix + 0.8, 1.45, -0.25) },
      indoor: { pos: new THREE.Vector3(ix - 0.75, iy - 0.25, 0.95), target: new THREE.Vector3(ix, iy, 0.1) },
      outdoor: { pos: new THREE.Vector3(ix + 0.55, 1.85, -2.0), target: new THREE.Vector3(ix + 1.35, 1.2, -0.5) },
      cutaway: { pos: new THREE.Vector3(ix - 1.6, 2.5, 2.2), target: new THREE.Vector3(ix + 0.6, 1.65, -0.3) },
      airflow: { pos: new THREE.Vector3(-2.2, 2.6, 5.6), target: new THREE.Vector3(ix + 0.1, 1.0, 1.6) },
      cycle: { pos: new THREE.Vector3(ix - 0.7, 2.7, 2.4), target: new THREE.Vector3(ix + 0.75, 1.55, -0.3) },
      comfort: { pos: new THREE.Vector3(-0.9, 5.6, 6.0), target: new THREE.Vector3(2.0, 0.4, 1.9) },
      exploded: { pos: new THREE.Vector3(ix - 0.4, 2.3, 2.3), target: new THREE.Vector3(ix + 0.75, 1.7, -0.3) },
    };
  }

  flyTo(pos: THREE.Vector3, target: THREE.Vector3, instant = false) {
    if (instant || this.reducedMotion) { this.camera.position.copy(pos); this.controls.target.copy(target); this.tween = null; return; }
    this.tween = { p0: this.camera.position.clone(), p1: pos.clone(), t0: this.controls.target.clone(), t1: target.clone(), start: performance.now(), dur: 1200 };
  }

  setMode(m: ViewMode, instant = false) {
    this.mode = m;
    const pr = this.presets()[m];
    this.flyTo(pr.pos, pr.target, instant);
    const s = this.show;
    s.plume = m === 'airflow' || m === 'comfort';
    s.stream = m === 'airflow';
    s.arrows = m === 'comfort';
    s.sliceH = m === 'comfort';
    s.sliceV = false;
    s.tracers = m === 'cycle';
    s.labels = m === 'exploded';
    s.heatArrows = m === 'cycle';
    s.particles = m !== 'cycle' && m !== 'exploded';
    s.outdoorParticles = s.particles;
    this.ghostTarget = m === 'cutaway' || m === 'cycle' || m === 'exploded' ? 0.14 : 1;
    this.explodeTarget = m === 'exploded' ? 1 : 0;
    const clipOn = m === 'cutaway';
    this.applyClip(clipOn);
  }

  private applyClip(on: boolean) {
    const planes = on ? [this.clip] : [];
    for (const v of PARTS.values()) if (v.info.casing) v.obj.traverse((o) => { const mm = (o as THREE.Mesh).material as THREE.Material | undefined; if (mm) { mm.clippingPlanes = planes; } });
  }

  // ------------------------------------------------------------ data in
  setFrame(view: SimView, field: FieldMsg | null, jet: JetMsg | null) {
    this.view = view;
    if (field) this.field = field;
    if (jet) this.jet = jet;
    const P = view.s.profile;
    this.setGeometry(P.mountX, P.mountH);
  }

  // ------------------------------------------------------------ picking
  private down = { x: 0, y: 0, t: 0 };
  private pointerDown(e: PointerEvent) { this.down = { x: e.clientX, y: e.clientY, t: performance.now() }; }
  private pointerUp(e: PointerEvent) {
    if (Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) > 5) return;
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    if (this.probePlacing) {
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -1.1);
      const hit = new THREE.Vector3();
      if (this.raycaster.ray.intersectPlane(plane, hit)) this.onPickRoom(hit);
      return;
    }
    const hits = this.raycaster.intersectObjects([this.indoorWorld, this.outdoorWorld, ...this.pipes.map((p) => p.mesh), this.wall], true);
    let id: string | null = null;
    for (const h of hits) {
      const pid = h.object.userData.partId as string | undefined;
      if (!pid) continue;
      const pinfo = PARTS.get(pid);
      if (pinfo && pinfo.info.casing && this.ghost < 0.5) continue; // see through ghosted casing
      if (pid === 'room.wall' && hits.length > 1) continue;
      id = pid; break;
    }
    this.select(id);
    this.onSelect(id);
  }

  select(id: string | null) {
    if (this.highlight) { this.highlight.traverse((o) => { if (o.userData.hlOrig) { (o as THREE.Mesh).material = o.userData.hlOrig; delete o.userData.hlOrig; } }); this.highlight = null; }
    this.selected = id;
    if (!id) return;
    const p = PARTS.get(id); if (!p) return;
    this.highlight = p.obj;
    p.obj.traverse((o) => { const mesh = o as THREE.Mesh; if (mesh.isMesh && !(mesh as unknown as THREE.InstancedMesh).isInstancedMesh) { o.userData.hlOrig = mesh.material; mesh.material = this.highlightMat; } });
  }

  focusPart(id: string) {
    const p = PARTS.get(id); if (!p) return;
    const b = new THREE.Box3().setFromObject(p.obj);
    const c = b.getCenter(new THREE.Vector3());
    const size = Math.max(0.25, b.getSize(new THREE.Vector3()).length());
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    this.flyTo(c.clone().addScaledVector(dir, size * 2.2), c);
  }

  // ------------------------------------------------------------ per-frame update
  render() {
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.lastT) / 1000);
    this.lastT = now;
    if (this.hidden) return;
    this.frameCount++;
    if (now - this.fpsT > 1000) { this.fps = (this.frameCount * 1000) / (now - this.fpsT); this.frameCount = 0; this.fpsT = now; }
    if (this.tween) {
      const u = Math.min(1, (now - this.tween.start) / this.tween.dur), e = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
      this.camera.position.lerpVectors(this.tween.p0, this.tween.p1, e);
      this.controls.target.lerpVectors(this.tween.t0, this.tween.t1, e);
      if (u >= 1) this.tween = null;
    }
    this.controls.update();
    // ghost / explode easing
    this.ghost += (this.ghostTarget - this.ghost) * Math.min(1, dt * 5);
    if (Math.abs(this.ghost - this.ghostTarget) < 0.01) this.ghost = this.ghostTarget;
    for (const v of PARTS.values()) if (v.info.casing) setOpacity(v.obj, this.ghost);
    this.explodeT += (this.explodeTarget - this.explodeT) * Math.min(1, dt * (this.reducedMotion ? 50 : 3));
    for (const v of PARTS.values()) { if (v.info.unit === 'pipe' || v.info.unit === 'room') continue; v.obj.position.copy(v.home).addScaledVector(v.info.explode, this.explodeT); }
    const pipesVisible = this.explodeT < 0.05;
    for (const p of this.pipes) p.mesh.visible = pipesVisible;
    this.clip.constant = this.mountX + 0.02;
    this.updateActuators(dt);
    this.updateAir(dt);
    this.updatePipes(dt);
    this.renderer.render(this.scene, this.camera);
  }

  private updateActuators(dt: number) {
    const o = this.view?.out;
    const slow = this.slow ? 0.04 : 1;
    // indoor cross-flow fan: visual speed capped to avoid stroboscopic aliasing (35 blades)
    const rpm = o ? o.ifanAct : 0;
    const realW = (rpm / 60) * 2 * Math.PI * slow;
    const capW = 2.2; // rad/s visual cap
    this.fanAng += Math.min(realW, capW) * dt; this.indoor.fan.rotation.x = -this.fanAng;
    (this.ifanBlur.material as THREE.MeshBasicMaterial).opacity = Math.min(0.55, (realW / 100) * 0.55);
    const orpm = o ? o.ofanAct : 0;
    const oW = (orpm / 60) * 2 * Math.PI * slow;
    this.ofanAng += Math.min(oW, 4.5) * dt; this.outdoor.fan.rotation.z = this.ofanAng;
    (this.ofanBlur.material as THREE.MeshBasicMaterial).opacity = Math.min(0.5, (oW / 100) * 0.6);
    const f = o ? o.fAct : 0;
    this.compAng += Math.min(f * 2 * Math.PI * slow, 6) * dt; this.outdoor.compRotor.rotation.y = this.compAng;
    if (o) {
      this.indoor.vaneUpper.rotation.x = vaneRotation(o.vaneUpper, o.vaneOpen);
      this.indoor.vaneLower.rotation.x = vaneRotation(o.vaneLower, o.vaneOpen);
      for (const v of this.indoor.wideVanes) v.rotation.y = (-o.wideAct * Math.PI) / 180;
      (this.indoor.lamp.material as THREE.MeshStandardMaterial).emissiveIntensity = this.view!.s.remote.power ? (this.view!.s.remote.nightMode ? 0.4 : 1.4) : 0;
      const film = o.film / Math.max(1e-6, this.view!.s.profile.filmMax);
      this.indoor.trayWater.scale.y = 0.05 + film;
      const frost = Math.min(1, o.frost / Math.max(0.05, this.view!.s.profile.frostRef));
      for (const fm of this.outdoor.frost) (fm.material as THREE.MeshStandardMaterial).opacity = frost * 0.85;
      this.outdoor.rvSlider.position.x = (this.view!.s.plant.rv - 0.5) * 0.03;
      // coil surface colouring (computed surface temperatures only)
      const tc = tempColor(o.coilInSurface, 0, 60);
      for (const fins of this.indoor.coilFins) (fins.material as THREE.MeshStandardMaterial).color.lerpColors(new THREE.Color(0xc8ccd2), tc, this.mode === 'cutaway' || this.mode === 'cycle' ? 0.75 : 0.2);
    }
  }

  private updateAir(dt: number) {
    const v = this.view;
    const o = v?.out;
    const Troom = v ? v.s.plant.Troom : 25;
    const range: [number, number] = [Math.min(10, Troom - 12), Math.max(34, Troom + 10)];
    this.inP.colorMode = this.colorMode; this.inP.tRange = range;
    const ig = this.indoor.group;
    const unitBox = new THREE.Box3().setFromCenterAndSize(this.w(ig, new THREE.Vector3(0, IND.H / 2, IND.D / 2)), new THREE.Vector3(IND.W, IND.H, IND.D));
    this.inP.setUnit(unitBox, this.indoor.airPath.map((p) => this.w(ig, p)), this.w(ig, this.indoor.returnTop));
    this.inP.points.visible = this.show.particles;
    const fanOn = !!o && o.qIn > 30 && o.vaneOpen > 0.05;
    const pm = this.inP.points.material as THREE.PointsMaterial;
    pm.opacity += ((fanOn ? 0.85 : 0.18) - pm.opacity) * Math.min(1, dt * 2);
    pm.size = fanOn ? 0.022 : 0.014;
    if (this.show.particles) this.inP.update(dt * (this.slow ? 0.1 : 1), this.field, this.jet, o ? o.qIn * (o.vaneOpen > 0.05 ? 1 : 0) : 0, Troom, o ? o.Tsup : Troom);
    this.outP.points.visible = this.show.outdoorParticles;
    if (this.show.outdoorParticles && v) this.outP.update(dt * (this.slow ? 0.1 : 1), o ? o.qOut : 0, v.s.env.outdoorT, o ? o.ToutLeave : v.s.env.outdoorT, [Math.min(0, v.s.env.outdoorT - 10), Math.max(50, v.s.env.outdoorT + 15)]);
    // plume + centreline
    this.plume.visible = this.show.plume && !!this.jet && this.jet.pts.length > 2;
    this.centre.visible = this.plume.visible || this.mode === 'system';
    if (this.jet && this.jet.pts.length > 2 && (this.plume.visible || this.centre.visible)) {
      if (this.plume.visible) { const g = plumeGeometry(this.jet); if (g) { this.plume.geometry.dispose(); this.plume.geometry = g; } }
      const cg = new THREE.BufferGeometry().setFromPoints(this.jet.pts.filter((p) => p.u >= 0.15).map((p) => new THREE.Vector3(...p.p)));
      this.centre.geometry.dispose(); this.centre.geometry = cg;
    } else this.centre.visible = false;
    this.stream.visible = this.show.stream && !!this.field;
    if (this.stream.visible && this.field && this.frameCount % 15 === 0) {
      const seeds: THREE.Vector3[] = [];
      for (let i = 0; i < 5; i++) for (let j = 0; j < 4; j++) seeds.push(new THREE.Vector3(0.4 + i * 0.8, 0.3 + j * 0.6, 3.2));
      const g = streamlines(this.field, this.dims, seeds, unitBox, range);
      this.stream.geometry.dispose(); this.stream.geometry = g;
    }
    // slices
    this.sliceH.visible = this.show.sliceH && !!this.field;
    this.sliceV.visible = this.show.sliceV && !!this.field;
    const sRange: [number, number] = [Troom - 4, Troom + 4];
    if (this.field && this.frameCount % 10 === 0) {
      if (this.sliceH.visible) {
        const m = this.sliceH.material as THREE.MeshBasicMaterial;
        m.map = sliceTexture(this.field, this.dims, 'h', this.sliceHeight, this.colorMode, sRange, m.map as THREE.DataTexture | undefined); m.needsUpdate = true;
        this.sliceH.position.set(this.dims.W / 2, this.sliceHeight, this.dims.D / 2);
      }
      if (this.sliceV.visible) {
        const m = this.sliceV.material as THREE.MeshBasicMaterial;
        m.map = sliceTexture(this.field, this.dims, 'v', this.sliceX, this.colorMode, sRange, m.map as THREE.DataTexture | undefined); m.needsUpdate = true;
        this.sliceV.position.set(this.sliceX, this.dims.H / 2, this.dims.D / 2);
      }
    }
    // vector arrows on the horizontal slice
    this.arrows.visible = this.show.arrows && !!this.field;
    if (this.arrows.visible && this.field && this.frameCount % 10 === 0) {
      const f = this.field; let n = 0; const m4 = new THREE.Matrix4(); const up = new THREE.Vector3(0, 0, 1);
      for (let i = 1; i < f.nx; i += 2) for (let k = 1; k < f.nz; k += 2) {
        const x = ((i + 0.5) / f.nx) * this.dims.W, z = ((k + 0.5) / f.nz) * this.dims.D, y = this.sliceHeight + 0.02;
        const j = Math.min(f.ny - 1, Math.floor((y / this.dims.H) * f.ny)); const idx = i + f.nx * (j + f.ny * k);
        const vv = new THREE.Vector3(f.vx[idx], f.vy[idx], f.vz[idx]); const sp = vv.length(); if (sp < 0.02) continue;
        const q = new THREE.Quaternion().setFromUnitVectors(up, vv.normalize());
        const s = 0.5 + Math.min(2, sp * 3);
        m4.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(s, s, s)); this.arrows.setMatrixAt(n++, m4);
        if (n >= 400) break;
      }
      this.arrows.count = n; this.arrows.instanceMatrix.needsUpdate = true;
    }
  }

  /** Pipe colour from the computed local state: temperature colour; phase reported on selection. */
  pipeStates(): Record<string, { T: number; phase: string; P: number; dir: string }> {
    const o = this.view?.out;
    const res: Record<string, { T: number; phase: string; P: number; dir: string }> = {};
    if (!o || !this.view) return res;
    const heat = this.view.s.plant.rv > 0.5;
    const run = o.running;
    const Te = o.Te, Tc = o.Tc, T2 = o.T2, SH = o.SHevap, SHs = o.SHsuct, SC = o.SC;
    const lp = o.Pe, hp = o.Pc;
    const S = (T: number, phase: string, P: number, dir: string) => ({ T, phase, P, dir });
    if (!run) {
      const Tin = this.view.s.plant.TinCoil, Tout = this.view.s.plant.ToutCoil;
      for (const id of ['dis', 'fwvOut', 'outCoil', 'liqHP', 'levOut', 'suct', 'gasOut']) res[id] = S(Tout, 'no flow (compressor stopped)', o.Pe, '-');
      for (const id of ['liqLine', 'inCoil', 'gasLine']) res[id] = S(Tin, 'no flow (compressor stopped)', o.Pe, '-');
      return res;
    }
    res.dis = S(T2, 'superheated vapour', hp, 'compressor -> 4-way valve');
    res.suct = S(Te + SHs, o.xSuct < 1 ? `two-phase carry-over x=${o.xSuct.toFixed(2)}` : 'superheated vapour', lp, '4-way valve -> accumulator -> compressor');
    if (!heat) {
      res.fwvOut = S(T2 - 3, 'superheated vapour', hp, '4-way valve -> outdoor coil');
      res.outCoil = S(Tc, 'condensing (two-phase)', hp, 'top -> bottom');
      res.liqHP = S(Tc - SC, SC > 0.05 ? 'subcooled liquid' : 'saturated liquid', hp, 'coil -> LEV');
      res.levOut = S(Te, 'two-phase (after expansion)', lp, 'LEV -> stop valve');
      res.liqLine = S(Te, 'LOW-pressure two-phase', lp, 'outdoor -> indoor');
      res.inCoil = S(Te + SH * 0.3, 'evaporating -> superheated at exit', lp, 'liquid side -> gas side');
      res.gasLine = S(Te + SH, 'superheated vapour (suction)', lp, 'indoor -> outdoor');
      res.gasOut = S(Te + SH + 0.5, 'superheated vapour', lp, 'stop valve -> 4-way valve');
    } else {
      res.gasOut = S(T2 - 2, 'superheated vapour (discharge)', hp, '4-way valve -> stop valve');
      res.gasLine = S(T2 - 5, 'superheated vapour (hot gas)', hp, 'outdoor -> indoor');
      res.inCoil = S(Tc, 'condensing (two-phase)', hp, 'gas side -> liquid side');
      res.liqLine = S(Tc - SC, 'subcooled high-pressure liquid', hp, 'indoor -> outdoor');
      res.levOut = S(Tc - SC, 'liquid entering capillary + LEV', hp, 'stop valve -> LEV');
      res.liqHP = S(Te, 'two-phase (after expansion)', lp, 'LEV -> outdoor coil');
      res.outCoil = S(Te, 'evaporating (two-phase)', lp, 'bottom -> top');
      res.fwvOut = S(Te + SH, 'superheated vapour', lp, 'outdoor coil -> 4-way valve');
    }
    return res;
  }

  private tracerS = new Float32Array(60);
  private updatePipes(dt: number) {
    const st = this.pipeStates();
    for (const p of this.pipes) {
      const s = st[p.id];
      if (!s) continue;
      const c = tempColor(s.T, -5, 95);
      p.mat.color.lerp(c, Math.min(1, dt * 4));
      p.mesh.userData.state = s;
    }
    // tracers: schematic markers moving in flow order (not molecular velocity)
    this.tracers.visible = this.show.tracers && !!this.view?.out?.running;
    if (!this.tracers.visible) return;
    const heat = (this.view?.s.plant.rv ?? 0) > 0.5;
    const order = heat ? ['dis', 'gasOut', 'gasLine', 'inCoil', 'liqLine', 'levOut', 'liqHP', 'outCoil', 'fwvOut', 'suct'] : ['dis', 'fwvOut', 'outCoil', 'liqHP', 'levOut', 'liqLine', 'inCoil', 'gasLine', 'gasOut', 'suct'];
    const reverse: Record<string, boolean> = heat ? { gasOut: true, gasLine: true, inCoil: true, liqLine: false, levOut: true, liqHP: true, outCoil: true, fwvOut: true } : { liqLine: true, gasLine: false, gasOut: false, inCoil: false };
    const segs = order.map((id) => this.pipes.find((p) => p.id === id)!).filter(Boolean);
    const lens = segs.map((s) => s.curve.getLength());
    const total = lens.reduce((a, b) => a + b, 0);
    const speed = 0.12 + ((this.view?.out?.m ?? 0) / 0.014) * 0.25;
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < 60; i++) {
      if (this.tracerS[i] === 0) this.tracerS[i] = (i + 0.5) / 60;
      this.tracerS[i] = (this.tracerS[i] + (speed * dt) / total) % 1;
      let d = this.tracerS[i] * total, k = 0;
      while (k < segs.length - 1 && d > lens[k]) { d -= lens[k]; k++; }
      let u = Math.min(1, d / lens[k]);
      if (reverse[segs[k].id]) u = 1 - u;
      const pt = segs[k].curve.getPointAt(u);
      m4.makeTranslation(pt.x, pt.y, pt.z); this.tracers.setMatrixAt(i, m4);
    }
    this.tracers.instanceMatrix.needsUpdate = true;
  }

  // ------------------------------------------------------------ probes
  setProbes(list: { id: string; pos?: [number, number, number]; kind: string }[]) {
    this.probesG.clear();
    for (const p of list) {
      if (!p.pos) continue;
      const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.04), new THREE.MeshStandardMaterial({ color: p.kind === 'airV' ? 0x2f7fc1 : 0xc4161c, emissive: 0x330000 }));
      m.position.set(...p.pos);
      const stem = cyl(0.004, p.pos[1], MAT.graphite, 6); stem.position.set(p.pos[0], p.pos[1] / 2, p.pos[2]);
      this.probesG.add(m, stem);
    }
  }

  /** Heat/work arrows for the cycle view (sizes from computed flows). */
  updateHeatArrows() {
    this.heatArrows.clear();
    this.heatArrows.visible = this.show.heatArrows;
    const o = this.view?.out; if (!o || !o.running || !this.show.heatArrows) return;
    const mk = (from: THREE.Vector3, dir: THREE.Vector3, W: number, color: number) => {
      const len = 0.12 + Math.min(0.6, W / 6000);
      this.heatArrows.add(new THREE.ArrowHelper(dir.clone().normalize(), from, len, color, 0.06, 0.04));
    };
    const ig = this.indoor.group, og = this.outdoor.group;
    const inC = this.w(ig, new THREE.Vector3(0, 0.36, 0.12)), outC = this.w(og, new THREE.Vector3(0.3, 0.3, -0.12)), comp = this.w(og, new THREE.Vector3(0.69, 0.45, 0.15));
    if (o.evapIsIndoor) { mk(inC, new THREE.Vector3(0, -1, 0), o.QevapRef, 0x2f7fc1); mk(outC, new THREE.Vector3(0, 0, 1), o.QcondRef, 0xe08a1e); }
    else { mk(inC.clone().add(new THREE.Vector3(0, -0.3, 0.1)), new THREE.Vector3(0, 0, 1), o.QcondRef, 0xe08a1e); mk(outC, new THREE.Vector3(0, 0, -1), o.QevapRef, 0x2f7fc1); }
    mk(comp, new THREE.Vector3(0, 1, 0), o.Wref, 0xc4161c);
  }

  // ------------------------------------------------------------ labels (projected)
  labelAnchors(): { id: string; name: string; x: number; y: number; visible: boolean; fidelity: string }[] {
    const out: { id: string; name: string; x: number; y: number; visible: boolean; fidelity: string }[] = [];
    const r = this.canvas.getBoundingClientRect();
    for (const [id, v] of PARTS) {
      if (v.info.unit === 'pipe' || v.info.unit === 'room') continue;
      if (id.includes('rt6') || id.includes('rt1')) continue;
      const b = new THREE.Box3().setFromObject(v.obj);
      if (b.isEmpty()) continue;
      const c = b.getCenter(new THREE.Vector3());
      const p = c.clone().project(this.camera);
      const vis = p.z < 1 && Math.abs(p.x) < 1.05 && Math.abs(p.y) < 1.05;
      out.push({ id, name: v.info.name, x: ((p.x + 1) / 2) * r.width, y: ((1 - p.y) / 2) * r.height, visible: vis, fidelity: v.info.fidelity });
    }
    return out;
  }

  resize() {
    const r = this.canvas.parentElement!.getBoundingClientRect();
    const w = Math.max(10, r.width), h = Math.max(10, r.height);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // Presets are framed for a landscape stage (aspect ~1.6). On narrow/portrait stages keep the
    // same horizontal field of view so the indoor unit, wall cut and outdoor unit stay in frame.
    const ref = 1.6, base = 38;
    this.camera.fov = this.camera.aspect >= ref ? base
      : Math.min(95, (2 * Math.atan(Math.tan((base * Math.PI) / 360) * ref / this.camera.aspect) * 180) / Math.PI);
    this.camera.updateProjectionMatrix();
  }

  screenshot(): string { this.renderer.render(this.scene, this.camera); return this.renderer.domElement.toDataURL('image/png'); }

  /** Orthographic drawing from the same geometry: front, side, plan, or section through the indoor blower. Only published envelope dimensions are dimensioned. */
  renderOrtho(view: 'front' | 'side' | 'plan' | 'section' | 'outdoorFront', w: number, h: number): string {
    const rt = new THREE.WebGLRenderTarget(w, h, { samples: 4 });
    const ix = this.mountX, iy0 = this.mountH - IND.H, iy = iy0 + IND.H / 2;
    const asp = w / h;
    const mk = (cx: number, cy: number, cz: number, half: number, dir: THREE.Vector3, up = new THREE.Vector3(0, 1, 0)) => {
      const c = new THREE.OrthographicCamera(-half * asp, half * asp, half, -half, 0.01, 30);
      c.position.set(cx, cy, cz).addScaledVector(dir, -8); c.up.copy(up); c.lookAt(cx, cy, cz); c.updateMatrixWorld(true); return c;
    };
    const og = this.outdoor.group;
    const oc = this.w(og, new THREE.Vector3(OUT.W / 2, OUT.H / 2, OUT.D / 2));
    let cam: THREE.OrthographicCamera;
    if (view === 'front') cam = mk(ix, iy, 0.1, 0.32, new THREE.Vector3(0, 0, -1));
    else if (view === 'side' || view === 'section') cam = mk(ix, iy - 0.03, 0.12, 0.22, new THREE.Vector3(-1, 0, 0));
    else if (view === 'plan') cam = mk(ix + 0.85, 3, -0.15, 0.95, new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, 0, -1));
    else cam = mk(oc.x, oc.y, oc.z, 0.4, new THREE.Vector3(0, 0, 1));
    // allowlist: only the assemblies (plus the wall section for side views, pipes for the plan, jet line for the section)
    const allow = new Set<THREE.Object3D>([this.indoorWorld, this.outdoorWorld]);
    if (view === 'side' || view === 'section') allow.add(this.wallGroup);
    if (view === 'section') allow.add(this.centre);
    if (view === 'plan') for (const p of this.pipes) allow.add(p.mesh);
    const hidden = [...this.root.children.filter((o) => !allow.has(o)), this.outP.points];
    const vis = hidden.map((o) => o.visible); hidden.forEach((o) => (o.visible = false));
    const planes = view === 'section' ? [new THREE.Plane(new THREE.Vector3(-1, 0, 0), ix)] : [];
    const touched: THREE.Material[] = [];
    if (view === 'section') this.indoor.group.traverse((o) => { const mm = (o as THREE.Mesh).material as THREE.Material | undefined; if (mm && (o as THREE.Mesh).isMesh) { mm.clippingPlanes = planes; touched.push(mm); } });
    const savedGhost = this.ghost;
    for (const v of PARTS.values()) if (v.info.casing) setOpacity(v.obj, view === 'section' ? 0.35 : 1);
    const prevBg = this.scene.background;
    this.scene.background = new THREE.Color(0xdcd8cf);
    this.renderer.setRenderTarget(rt); this.renderer.render(this.scene, cam); this.renderer.setRenderTarget(null);
    const buf = new Uint8Array(w * h * 4); this.renderer.readRenderTargetPixels(rt, 0, 0, w, h, buf);
    rt.dispose();
    const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d')!;
    const img = g.createImageData(w, h);
    for (let y = 0; y < h; y++) img.data.set(buf.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
    g.putImageData(img, 0, 0);
    // restore
    for (const m of touched) m.clippingPlanes = [];
    this.applyClip(this.mode === 'cutaway');
    hidden.forEach((o, i) => (o.visible = vis[i]));
    this.scene.background = prevBg;
    this.ghost = savedGhost; for (const v of PARTS.values()) if (v.info.casing) setOpacity(v.obj, this.ghost);
    // dimensions (published envelope only)
    const P = (x: number, y: number, z: number) => { const v = new THREE.Vector3(x, y, z).project(cam); return [((v.x + 1) / 2) * w, ((1 - v.y) / 2) * h] as [number, number]; };
    g.strokeStyle = '#c4161c'; g.fillStyle = '#c4161c'; g.lineWidth = 1; g.font = '11px system-ui';
    const dim = (a: [number, number], b: [number, number], off: [number, number], label: string) => {
      const a2: [number, number] = [a[0] + off[0], a[1] + off[1]], b2: [number, number] = [b[0] + off[0], b[1] + off[1]];
      g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(a2[0], a2[1]); g.moveTo(b[0], b[1]); g.lineTo(b2[0], b2[1]); g.moveTo(a2[0], a2[1]); g.lineTo(b2[0], b2[1]); g.stroke();
      for (const [p, q] of [[a2, b2], [b2, a2]] as [[number, number], [number, number]][]) { const ang = Math.atan2(q[1] - p[1], q[0] - p[0]); g.beginPath(); g.moveTo(p[0], p[1]); g.lineTo(p[0] + 7 * Math.cos(ang + 0.35), p[1] + 7 * Math.sin(ang + 0.35)); g.lineTo(p[0] + 7 * Math.cos(ang - 0.35), p[1] + 7 * Math.sin(ang - 0.35)); g.fill(); }
      g.save(); g.translate((a2[0] + b2[0]) / 2, (a2[1] + b2[1]) / 2); const ang = Math.atan2(b2[1] - a2[1], b2[0] - a2[0]); g.rotate(Math.abs(ang) > Math.PI / 2 ? ang + Math.PI : ang); g.textAlign = 'center'; g.fillStyle = '#fff'; const tw = g.measureText(label).width; g.fillRect(-tw / 2 - 3, -14, tw + 6, 13); g.fillStyle = '#c4161c'; g.fillText(label, 0, -4); g.restore();
    };
    const hw = IND.W / 2;
    if (view === 'front') { dim(P(ix - hw, iy0, 0.22), P(ix + hw, iy0, 0.22), [0, 26], '798 (S2 p.11)'); dim(P(ix + hw, iy0, 0.22), P(ix + hw, iy0 + IND.H, 0.22), [24, 0], '299 (S2 p.11)'); }
    if (view === 'side' || view === 'section') { dim(P(ix, iy0, 0), P(ix, iy0, IND.D), [0, 22], '219 (S2 p.11)'); dim(P(ix, iy0, IND.D), P(ix, iy0 + IND.H, IND.D), [24, 0], '299'); }
    if (view === 'outdoorFront') {
      const o0 = this.w(og, new THREE.Vector3(0, 0, OUT.D)), o1 = this.w(og, new THREE.Vector3(OUT.W, 0, OUT.D)), o2 = this.w(og, new THREE.Vector3(OUT.W, OUT.H, OUT.D));
      dim(P(o0.x, o0.y, o0.z), P(o1.x, o1.y, o1.z), [0, 22], '800 (S3 p.11)'); dim(P(o0.x, o0.y, o0.z), P(o0.x, o0.y + OUT.H, o0.z), [-24, 0], '550 (S3 p.11)');
      const fc = this.w(og, new THREE.Vector3(OUT.fanX, OUT.fanY, OUT.D)); const fp = P(fc.x, fc.y, fc.z);
      g.strokeStyle = '#2f7fc1'; g.setLineDash([6, 4]); g.beginPath(); g.moveTo(fp[0] - 30, fp[1]); g.lineTo(fp[0] + 30, fp[1]); g.moveTo(fp[0], fp[1] - 30); g.lineTo(fp[0], fp[1] + 30); g.stroke(); g.setLineDash([]);
      g.fillStyle = '#2f7fc1'; g.fillText('fan centre 302.5 / 280 (S3 p.11)', fp[0] + 8, fp[1] - 8);
      void o2;
    }
    g.fillStyle = '#23221f'; g.font = '11px system-ui'; g.textAlign = 'left';
    const title = { front: 'INDOOR · FRONT', side: 'INDOOR · SIDE (from right)', section: 'SECTION A-A · through blower and vanes (internals modelled)', plan: 'PLAN · units and piping (placement assumed)', outdoorFront: 'OUTDOOR · FRONT' }[view];
    g.fillText(title, 8, 14);
    if (view === 'section' && this.view?.out) { g.fillText(`vane ${this.view.out.vaneUpper.toFixed(0)}° below horizontal (assumed angle map) · jet line from the traced centreline`, 8, h - 8); }
    return c.toDataURL('image/png');
  }
}
export type { Outputs };

/** Shared simulation types. All state is plain JSON so it can be snapshotted, replayed and posted between workers. */
import type { CyclePoint } from './components';

export type Mode = 'cool' | 'heat' | 'dry' | 'fan' | 'auto';
export type FanSetting = 'auto' | 'Silent' | 'Low' | 'Med' | 'High' | 'SuperHigh';
export type VaneSetting = 'auto' | 1 | 2 | 3 | 4 | 5 | 'swing';
export type WideSetting = 1 | 2 | 3 | 4 | 5 | 'swing';
export type SupState =
  | 'OFF' | 'STANDBY' | 'START_DELAY' | 'STARTING' | 'COOLING' | 'HEATING' | 'DRY' | 'FAN_ONLY'
  | 'MODULATING' | 'STOPPING' | 'DEFROST' | 'PROTECTION' | 'FAULT';

export interface WeeklyEntry { day: number; time: number; on: boolean; temp: number }
export interface ISaveMemory { setpoint: number; fan: FanSetting; vane: VaneSetting }

/** Original product operation (S2 section 9). */
export interface RemoteSettings {
  power: boolean;
  mode: Mode;
  setpoint: number;
  fan: FanSetting;
  vane: VaneSetting;
  wide: WideSetting;
  econoCool: boolean;
  nightMode: boolean;
  isave: boolean;
  isaveMem: { cool: ISaveMemory | null; heat: ISaveMemory | null };
  onTimer: number | null;
  offTimer: number | null;
  weeklyOn: boolean;
  weekly: WeeklyEntry[];
  opLock: boolean;
}

/** Engineering experiment layer: not original remote functions. */
export interface Overrides {
  manual: boolean;
  compHz: number | null;
  ifanRpm: number | null;
  ofanRpm: number | null;
  eevPct: number | null;
  vaneAngle: number | null;
  wideAngle: number | null;
  swingLo: number | null;
  swingHi: number | null;
  ecoCapW: number | null;
  turbo: boolean;
  turboUntil: number | null;
  sleep: boolean;
  sleepRate: number; // K per hour
  sleepMax: number; // K
  sleepSince: number | null;
}

export interface Environment {
  outdoorT: number;
  outdoorRH: number;
  solar: number;
  internal: number;
  occupants: number;
  ach: number;
  doorOpen: boolean;
  patm: number;
  /** psychrometric-chamber test: indoor air held at a fixed state (room balance bypassed) */
  chamber: { T: number; RH: number } | null;
}

export interface Faults {
  filterRestriction: number; // 0 clean ... 4 = +400 % filter resistance
  coilFouling: number; // 0..1 indoor coil
  outdoorFouling: number; // 0..1 outdoor coil (dust / fibres)
  indoorFanFault: boolean;
  outdoorFanFault: boolean;
  roomSensorBias: number; // K
  coilSensorBias: number; // K
  sensorFail: 'none' | 'room' | 'indoorCoil' | 'discharge' | 'outdoorCoil' | 'ambient';
  commFault: boolean;
}

export interface PlantState {
  TinCoil: number; ToutCoil: number; SH: number; Tdis: number; Tfin: number;
  frost: number; film: number;
  fAct: number; compRunning: boolean;
  ifanAct: number; ofanAct: number; eevAct: number;
  vaneUpper: number; vaneLower: number; wideAct: number; vaneOpen: number;
  rv: number; // 0 cooling position, 1 heating position (R.V. coil energised)
  Troom: number; wroom: number; Tmass: number;
  // integrals
  E_total: number; E_comp: number; E_ifan: number; E_ofan: number; Q_net: number; Q_gross: number;
  condensateL: number; frostMeltedKg: number; defrostEnergy: number; runTime: number;
}

export interface LimitState { name: string; cap: number; active: boolean }

export interface CtrlState {
  sup: SupState; supSince: number;
  opMode: 'cool' | 'heat' | 'dry' | 'fan' | 'off';
  autoSide: 'cool' | 'heat' | null; autoSince: number;
  thermoOn: boolean; thermoSince: number;
  compOnSince: number; lastStop: number; startAt: number | null;
  fReq: number; fCmd: number; integ: number;
  limits: Record<string, LimitState>;
  limitReason: string;
  eevCmd: number; eevInteg: number; tdTarget: number;
  ifanCmd: number; ofanCmd: number; ofanOffAt: number | null;
  vaneUpperCmd: number; vaneLowerCmd: number; wideCmd: number; vaneOpenCmd: number; positioningUntil: number;
  rvCmd: number; rvPulseUntil: number;
  sens: { room: number; coilIn: number; coilOut: number; dis: number; amb: number; fin: number };
  prot: { tdStop: boolean; frostStop: boolean; hpStop: boolean; finStop: boolean; lowTdTimer: number; ifanTimer: number; ofanTimer: number; commTimer: number; envelope: string };
  fault: { code: string; msg: string; t: number } | null;
  faultClearArmed: boolean;
  defrost: { phase: 'none' | 'stop' | 'reverse' | 'recover'; since: number; heatRun: number; coldTimer: number; count: number };
  drySet: number | null;
  cumCompCool: number;
  econoPhase: number;
  narration: string;
  narrationKey: string;
  prevPower: boolean;
  lastWeeklyMinute: number;
}

export interface Outputs {
  Troom: number; RHroom: number; Tmass: number; Tsup: number; RHsup: number; Tret: number;
  ToutIn: number; ToutLeave: number;
  fReq: number; fCmd: number; fAct: number; fElec: number; rpmComp: number;
  ifanCmd: number; ifanAct: number; qIn: number; dpIn: number; resIn: { filter: number; coil: number; outlet: number; total: number };
  ofanCmd: number; ofanAct: number; qOut: number;
  eevCmd: number; eevAct: number;
  vaneUpperCmd: number; vaneUpper: number; vaneLowerCmd: number; vaneLower: number; wideCmd: number; wideAct: number; vaneOpen: number; outletArea: number;
  Qnet: number; Qgross: number; Qsens: number; Qlat: number; SHR: number | null;
  Pcomp: number; Pifan: number; Pofan: number; Pctrl: number; Ptotal: number; current: number;
  COP: number | null; EER_btu: number | null;
  condRate: number; // L/h
  Pe: number; Pc: number; Te: number; Tc: number; Tsuct: number; Tdis: number; T2: number; SHevap: number; SHsuct: number; SC: number; xSuct: number;
  m: number; mEev: number; QevapRef: number; QcondRef: number; Wref: number; Qshell: number; Qpickup: number;
  points: { p1e: CyclePoint; p1: CyclePoint; p2: CyclePoint; p3: CyclePoint; p4: CyclePoint } | null;
  evapIsIndoor: boolean; running: boolean;
  coilInSurface: number; coilOutSurface: number; frost: number; film: number;
  coreResidual: number | null; // instantaneous (storage included separately)
  storageIn: number; storageOut: number;
  flags: string[];
}

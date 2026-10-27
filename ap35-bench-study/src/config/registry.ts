/**
 * Central parameter registry. Each entry carries value, unit, status, origin,
 * valid range and explanation. The reference profile `mitsubishi_ap35_reference`
 * is built from these defaults (plus calibration.json) and frozen; experiments
 * are copies with an override map (see profiles.ts).
 *
 * Status meanings:
 *  supplied   - given in the build brief, cross-checked where possible
 *  sourced    - read from an official Mitsubishi Electric document (page cited)
 *  digitised  - read off a published graph; carries reading uncertainty
 *  assumed    - modelling assumption, not a Mitsubishi Electric value
 *  calibrated - fitted so the model reproduces published data (see calibration report)
 *  computed   - derived from other parameters
 */
import calib from './calibration.json';

export type Status = 'supplied' | 'sourced' | 'digitised' | 'assumed' | 'calibrated' | 'computed';
export type Group =
  | 'product' | 'compressor' | 'fans' | 'coils' | 'refrigerant' | 'control' | 'protection'
  | 'louvers' | 'room' | 'airflow' | 'sensors' | 'geometry';

export interface ParamDef {
  key: keyof ProfileValues;
  value: number;
  unit: string;
  status: Status;
  origin: string;
  range: [number, number];
  note: string;
  group: Group;
  /** whether editing it is a supported model change (otherwise visual/geometry only) */
  editable?: 'model' | 'geometry' | 'locked';
  label: string;
}

export interface ProfileValues {
  // product / rating
  capCoolNom: number; capCoolMin: number; capCoolMax: number;
  capHeatNom: number; capHeatMin: number; capHeatMax: number;
  pInCoolNom: number; pInHeatNom: number;
  shfNom: number; dehumNom: number;
  supplyV: number; pfCool: number; pfHeat: number; runCurrentMax: number;
  indoorW: number; indoorH: number; indoorD: number; outdoorW: number; outdoorH: number; outdoorD: number;
  chargeKg: number; pipeLen: number; pipeLenMax: number; heightDiffMax: number;
  // compressor
  pPolePairs: number; fMin: number; fMaxCool: number; fMaxHeat: number; fRatedCool: number; fRatedHeat: number;
  fStart: number; tStartHold: number; rampUp: number; rampDown: number;
  Vd: number; etaV0: number; etaVpr: number; etaVlow: number;
  etaIsPeak: number; prOpt: number; etaIsPr: number; fOpt: number; etaIsHi: number; etaIsLo: number;
  etaMotorInv: number; pInvFixed: number; fShell: number; restartDelay: number; tPickup: number;
  // fans
  ifanPhi: number; ifanDpRef: number; ifanEta: number; ifanPbase: number; ifanVeryLow: number; ifanRampRate: number;
  ofanPhi: number; ofanDpRef: number; ofanPref: number; ofanRpmRef: number; ofanRampRate: number;
  resFilterShare: number; resCoilShare: number; resOutletShare: number;
  pControls: number;
  // coils & refrigerant
  uaInAir: number; uaInRef: number; uaOutAir: number; uaOutRef: number; uaExp: number;
  cInCoil: number; cOutCoil: number; subcool: number; shTarget: number; shK: number; shFracMax: number;
  eevCv: number; eevRate: number; gEq: number; filmMax: number; reEvapK: number;
  frostRef: number; defrostFinishT: number; defrostMaxTime: number; defrostStartT: number; defrostMinRun: number;
  // control
  thermoOff: number; thermoOn: number; kp: number; ki: number; minOnTime: number;
  autoDwell: number; autoBand: number; econoOffset: number;
  nightFcap: number; nightOfanCap: number; coldAirFanOn: number; coldAirVeryLow: number;
  dryFmax: number; dryOffset: number; ofanOnLead: number; ofanOffLag: number; rvLead: number;
  eevKp: number; eevKi: number;
  // protection thresholds
  tdFreqDrop: number; tdStop: number; tdRestart: number; coilFrostDrop: number; coilFrostStop: number;
  hpHeatDrop: number; hpHeatStop: number; hpCoolStop: number; hpCoolDrop: number; currentDrop: number;
  commTimeout: number; lowTdLimit: number; lowTdTime: number; finStop: number; finRth: number;
  ifanFaultTime: number; ofanFaultTime: number; envelopeCoolMax: number; envelopeHeatMin: number;
  // louvers
  vaneRate: number; swingPeriod: number; wideRate: number; widePeriod: number;
  vaneAng1: number; vaneAng5: number; vaneAngAutoCool: number; wideMax: number; outletW: number; outletH: number;
  vaneCount: number; vaneSpacing: number;
  // room
  roomW: number; roomH: number; roomD: number; mountH: number; mountX: number;
  uaAirOut: number; uaMassOut: number; hAmass: number; cMass: number; ach: number;
  solar: number; solarToMass: number; internal: number; occupants: number; occSens: number; occLat: number;
  // airflow field
  jetK: number; jetSpread: number; terminalV: number; strat: number;
  // sensors
  sensorTau: number; sensorPeriod: number; sensorNoise: number;
}

type Def = Omit<ParamDef, 'key'>;
const C = calib as unknown as Record<string, number>;
const cal = (k: string, fallback: number) => (typeof C[k] === 'number' ? C[k] : fallback);

const D: Record<keyof ProfileValues, Def> = {
  // ---------- product (sourced) ----------
  capCoolNom: { label: 'Cooling capacity, nominal', value: 3.5, unit: 'kW', status: 'sourced', origin: 'S1; S3 p.6', range: [3.5, 3.5], note: '11,943 BTU/h. Rated at ISO 5151 conditions, airflow MAX.', group: 'product', editable: 'locked' },
  capCoolMin: { label: 'Cooling capacity, catalogue min', value: 1.1, unit: 'kW', status: 'sourced', origin: 'S1; S3 p.6', range: [1.1, 1.1], note: 'Conditional catalogue rating at rating conditions, not a universal limit.', group: 'product', editable: 'locked' },
  capCoolMax: { label: 'Cooling capacity, catalogue max', value: 3.8, unit: 'kW', status: 'sourced', origin: 'S1; S3 p.6', range: [3.8, 3.8], note: 'Conditional catalogue rating.', group: 'product', editable: 'locked' },
  capHeatNom: { label: 'Heating capacity, nominal', value: 4.0, unit: 'kW', status: 'sourced', origin: 'S1; S3 p.6', range: [4, 4], note: 'Indoor 20 DB, outdoor 7 DB / 6 WB.', group: 'product', editable: 'locked' },
  capHeatMin: { label: 'Heating capacity, catalogue min', value: 1.6, unit: 'kW', status: 'sourced', origin: 'S1 (S3 p.6 states 1.3, see D2)', range: [1.6, 1.6], note: 'Discrepancy D2.', group: 'product', editable: 'locked' },
  capHeatMax: { label: 'Heating capacity, catalogue max', value: 4.3, unit: 'kW', status: 'sourced', origin: 'S1 (S3 p.6 states 4.6, see D2)', range: [4.3, 4.3], note: 'Discrepancy D2.', group: 'product', editable: 'locked' },
  pInCoolNom: { label: 'System input, cooling nominal', value: 0.99, unit: 'kW', status: 'sourced', origin: 'S1; S3 p.6', range: [0.99, 0.99], note: 'Total appliance input incl. fans and controls.', group: 'product', editable: 'locked' },
  pInHeatNom: { label: 'System input, heating nominal', value: 1.03, unit: 'kW', status: 'sourced', origin: 'S1; S3 p.6', range: [1.03, 1.03], note: '', group: 'product', editable: 'locked' },
  shfNom: { label: 'Sensible heat factor, nominal', value: 0.88, unit: '-', status: 'sourced', origin: 'S1; S3 p.29', range: [0.88, 0.88], note: '', group: 'product', editable: 'locked' },
  dehumNom: { label: 'Dehumidification, cooling rated', value: 0.6, unit: 'L/h', status: 'sourced', origin: 'S3 p.6', range: [0.6, 0.6], note: '', group: 'product', editable: 'locked' },
  supplyV: { label: 'Supply voltage', value: 230, unit: 'V', status: 'sourced', origin: 'S1 220-240 V; S3 p.21 guaranteed 198-264 V', range: [198, 264], note: 'Single phase 50 Hz mains. Not the inverter output frequency.', group: 'product', editable: 'model' },
  pfCool: { label: 'Power factor, cooling rated', value: 0.95, unit: '-', status: 'sourced', origin: 'S3 p.6', range: [0.6, 1], note: 'Used to estimate current from power; not an inverter waveform model.', group: 'product', editable: 'model' },
  pfHeat: { label: 'Power factor, heating rated', value: 0.95, unit: '-', status: 'sourced', origin: 'S3 p.6', range: [0.6, 1], note: '', group: 'product', editable: 'model' },
  runCurrentMax: { label: 'System running current, max', value: 8.46, unit: 'A', status: 'sourced', origin: 'S1', range: [8.46, 8.46], note: '', group: 'product', editable: 'locked' },
  indoorW: { label: 'Indoor width', value: 798, unit: 'mm', status: 'sourced', origin: 'S1; S2 p.6/p.11', range: [798, 798], note: '', group: 'geometry', editable: 'locked' },
  indoorH: { label: 'Indoor height', value: 299, unit: 'mm', status: 'sourced', origin: 'S1; S2 p.6/p.11', range: [299, 299], note: '', group: 'geometry', editable: 'locked' },
  indoorD: { label: 'Indoor depth', value: 219, unit: 'mm', status: 'sourced', origin: 'S1; S2 p.6/p.11', range: [219, 219], note: '', group: 'geometry', editable: 'locked' },
  outdoorW: { label: 'Outdoor width', value: 800, unit: 'mm', status: 'sourced', origin: 'S1; S3 p.6/p.11', range: [800, 800], note: '', group: 'geometry', editable: 'locked' },
  outdoorH: { label: 'Outdoor height', value: 550, unit: 'mm', status: 'sourced', origin: 'S1; S3 p.6/p.11', range: [550, 550], note: '', group: 'geometry', editable: 'locked' },
  outdoorD: { label: 'Outdoor depth', value: 285, unit: 'mm', status: 'sourced', origin: 'S1; S3 p.6/p.11', range: [285, 285], note: '', group: 'geometry', editable: 'locked' },
  chargeKg: { label: 'Refrigerant charge R32 (7 m)', value: 0.55, unit: 'kg', status: 'sourced', origin: 'S1; S3 p.6', range: [0.55, 0.55], note: 'No refrigerant inventory model: charge faults are not simulated.', group: 'refrigerant', editable: 'locked' },
  pipeLen: { label: 'Interconnecting pipe length (one way)', value: 5, unit: 'm', status: 'sourced', origin: 'S3 p.6 (rating test length)', range: [3, 20], note: 'Geometry-only: no documented line-loss model is used, so it does not change performance.', group: 'geometry', editable: 'geometry' },
  pipeLenMax: { label: 'Max pipe length', value: 20, unit: 'm', status: 'sourced', origin: 'S1', range: [20, 20], note: '', group: 'geometry', editable: 'locked' },
  heightDiffMax: { label: 'Max height difference', value: 12, unit: 'm', status: 'sourced', origin: 'S1', range: [12, 12], note: '', group: 'geometry', editable: 'locked' },

  // ---------- compressor ----------
  pPolePairs: { label: 'Compressor motor pole pairs', value: 2, unit: '-', status: 'assumed', origin: 'assumption', range: [1, 4], note: 'Electrical Hz = pole pairs x mechanical rev/s. Only used to display electrical frequency.', group: 'compressor', editable: 'model' },
  fMin: { label: 'Min operational frequency', value: 13, unit: 'Hz', status: 'digitised', origin: 'S3 p.23 curve start', range: [8, 30], note: 'Published "operational frequency" is treated as mechanical rev/s (assumption A1).', group: 'compressor', editable: 'model' },
  fMaxCool: { label: 'Max operational frequency, cooling', value: 98, unit: 'Hz', status: 'digitised', origin: 'S3 p.23 curve end', range: [60, 120], note: 'End of published correction curve; beyond it the map is extrapolated.', group: 'compressor', editable: 'model' },
  fMaxHeat: { label: 'Max operational frequency, heating', value: 115, unit: 'Hz', status: 'digitised', origin: 'S3 p.23 curve end', range: [60, 130], note: '', group: 'compressor', editable: 'model' },
  fRatedCool: { label: 'Rated frequency, cooling', value: 84, unit: 'Hz', status: 'digitised', origin: 'S3 p.23 (factor 1.0)', range: [84, 84], note: 'D3: +/-2 Hz reading uncertainty.', group: 'compressor', editable: 'locked' },
  fRatedHeat: { label: 'Rated frequency, heating', value: 95, unit: 'Hz', status: 'digitised', origin: 'S3 p.23 (factor 1.0)', range: [95, 95], note: 'D3.', group: 'compressor', editable: 'locked' },
  fStart: { label: 'Start frequency hold', value: 30, unit: 'Hz', status: 'assumed', origin: 'assumption', range: [13, 60], note: 'Start-up hold before modulation.', group: 'control', editable: 'model' },
  tStartHold: { label: 'Start hold time', value: 45, unit: 's', status: 'assumed', origin: 'assumption', range: [0, 300], note: '', group: 'control', editable: 'model' },
  rampUp: { label: 'Frequency ramp-up limit', value: 1.0, unit: 'Hz/s', status: 'assumed', origin: 'assumption', range: [0.1, 5], note: '', group: 'control', editable: 'model' },
  rampDown: { label: 'Frequency ramp-down limit', value: 2.0, unit: 'Hz/s', status: 'assumed', origin: 'assumption', range: [0.1, 10], note: '', group: 'control', editable: 'model' },
  Vd: { label: 'Compressor displacement', value: cal('Vd', 7.0e-6), unit: 'm3/rev', status: 'calibrated', origin: 'calibration vs S3 p.29-30', range: [3e-6, 15e-6], note: 'Not published. Fitted; cross-checked against sibling KNB073 (X1, 7.3 cm3/rev) only for plausibility.', group: 'compressor', editable: 'model' },
  etaV0: { label: 'Volumetric efficiency intercept', value: cal('etaV0', 0.95), unit: '-', status: 'calibrated', origin: 'calibration', range: [0.7, 1], note: 'eta_v = eta_v0 - a(PR-1) - b(20/f).', group: 'compressor', editable: 'model' },
  etaVpr: { label: 'Volumetric efficiency PR slope', value: cal('etaVpr', 0.03), unit: '-', status: 'calibrated', origin: 'calibration vs S3 p.29-30', range: [0, 0.1], note: '', group: 'compressor', editable: 'model' },
  etaVlow: { label: 'Low-speed leakage term', value: cal('etaVlow', 0.05), unit: '-', status: 'calibrated', origin: 'calibration vs S3 p.23', range: [0, 0.3], note: '', group: 'compressor', editable: 'model' },
  etaIsPeak: { label: 'Isentropic efficiency peak', value: cal('etaIsPeak', 0.72), unit: '-', status: 'calibrated', origin: 'calibration', range: [0.4, 0.85], note: 'Map shape assumed; scale calibrated.', group: 'compressor', editable: 'model' },
  prOpt: { label: 'Pressure ratio at peak efficiency', value: cal('prOpt', 2.8), unit: '-', status: 'calibrated', origin: 'calibration', range: [1.5, 5], note: '', group: 'compressor', editable: 'model' },
  etaIsPr: { label: 'Efficiency PR curvature', value: cal('etaIsPr', 0.04), unit: '-', status: 'calibrated', origin: 'calibration', range: [0, 0.3], note: '', group: 'compressor', editable: 'model' },
  fOpt: { label: 'Peak-efficiency / field-weakening onset frequency', value: cal('fOpt', 60), unit: 'Hz', status: 'calibrated', origin: 'calibration vs S3 p.23', range: [20, 100], note: '', group: 'compressor', editable: 'model' },
  etaIsHi: { label: 'High-speed motor/inverter loss (field weakening)', value: cal('etaIsHi', 0.6), unit: '-', status: 'calibrated', origin: 'calibration vs S3 p.23', range: [0, 3], note: 'Applied to motor x inverter efficiency above fOpt; reproduces the steep input rise near max frequency in S3 p.23.', group: 'compressor', editable: 'model' },
  etaIsLo: { label: 'Low-speed efficiency loss', value: cal('etaIsLo', 0.2), unit: '-', status: 'calibrated', origin: 'calibration vs S3 p.23', range: [0, 2], note: '', group: 'compressor', editable: 'model' },
  etaMotorInv: { label: 'Motor x inverter efficiency', value: 0.88, unit: '-', status: 'assumed', origin: 'assumption', range: [0.7, 0.97], note: 'Losses rejected to the outdoor unit (heat sink).', group: 'compressor', editable: 'model' },
  pInvFixed: { label: 'Compressor-drive fixed loss while running', value: cal('pInvFixed', 12), unit: 'W', status: 'calibrated', origin: 'calibration vs S3 p.23', range: [0, 50], note: 'Rejected to the heat sink.', group: 'compressor', editable: 'model' },
  fShell: { label: 'Shell heat loss fraction', value: 0.06, unit: '-', status: 'assumed', origin: 'assumption', range: [0, 0.2], note: 'Fraction of shaft work lost from the shell to outdoor compartment air.', group: 'compressor', editable: 'model' },
  restartDelay: { label: 'Compressor restart delay', value: 180, unit: 's', status: 'sourced', origin: 'S2 p.28 (9-13)', range: [180, 180], note: '3-minute time delay.', group: 'protection', editable: 'locked' },
  tPickup: { label: 'Suction line heat pickup', value: 1.0, unit: 'K', status: 'assumed', origin: 'assumption', range: [0, 5], note: 'Compressor-inlet superheat = evaporator-outlet superheat + pickup.', group: 'refrigerant', editable: 'model' },

  // ---------- fans ----------
  ifanPhi: { label: 'Indoor fan operating fraction of free delivery', value: 0.6, unit: '-', status: 'assumed', origin: 'assumption', range: [0.3, 0.85], note: 'Sets fan-curve steepness about the published operating point.', group: 'fans', editable: 'model' },
  ifanDpRef: { label: 'Indoor reference total pressure at Super High', value: 40, unit: 'Pa', status: 'assumed', origin: 'assumption', range: [10, 120], note: 'Internal resistance of filter + coil + outlet at 684 m3/h.', group: 'fans', editable: 'model' },
  ifanEta: { label: 'Indoor fan+motor efficiency', value: cal('ifanEta', 0.49), unit: '-', status: 'calibrated', origin: 'S2 p.6 19 W / 26 W (see D4)', range: [0.2, 0.8], note: '', group: 'fans', editable: 'model' },
  ifanPbase: { label: 'Indoor fan motor base power', value: cal('ifanPbase', 3.45), unit: 'W', status: 'calibrated', origin: 'S2 p.6 (see D4)', range: [0, 10], note: '', group: 'fans', editable: 'model' },
  ifanVeryLow: { label: 'Indoor fan "very Low" speed', value: 400, unit: 'rpm', status: 'assumed', origin: 'S2 p.22 names the step; value assumed', range: [250, 500], note: 'Used at thermo-OFF in COOL/DRY and in cold-air prevention.', group: 'fans', editable: 'model' },
  ifanRampRate: { label: 'Indoor fan acceleration', value: 150, unit: 'rpm/s', status: 'assumed', origin: 'assumption', range: [20, 1000], note: '', group: 'fans', editable: 'model' },
  ofanPhi: { label: 'Outdoor fan operating fraction', value: 0.55, unit: '-', status: 'assumed', origin: 'assumption', range: [0.3, 0.85], note: '', group: 'fans', editable: 'model' },
  ofanDpRef: { label: 'Outdoor reference pressure at 940 rpm', value: 25, unit: 'Pa', status: 'assumed', origin: 'assumption', range: [5, 80], note: '', group: 'fans', editable: 'model' },
  ofanPref: { label: 'Outdoor fan input at 940 rpm', value: 30, unit: 'W', status: 'assumed', origin: 'assumption (motor current 0.22 A sourced S3 p.6)', range: [10, 80], note: '', group: 'fans', editable: 'model' },
  ofanRpmRef: { label: 'Outdoor fan reference speed', value: 940, unit: 'rpm', status: 'sourced', origin: 'S3 p.6', range: [940, 940], note: '', group: 'fans', editable: 'locked' },
  ofanRampRate: { label: 'Outdoor fan acceleration', value: 120, unit: 'rpm/s', status: 'assumed', origin: 'assumption', range: [20, 1000], note: '', group: 'fans', editable: 'model' },
  resFilterShare: { label: 'Filter share of indoor resistance', value: 0.25, unit: '-', status: 'assumed', origin: 'assumption', range: [0.05, 0.6], note: '', group: 'fans', editable: 'model' },
  resCoilShare: { label: 'Coil share of indoor resistance', value: 0.45, unit: '-', status: 'assumed', origin: 'assumption', range: [0.1, 0.8], note: '', group: 'fans', editable: 'model' },
  resOutletShare: { label: 'Outlet/vane share of indoor resistance', value: 0.30, unit: '-', status: 'assumed', origin: 'assumption', range: [0.05, 0.6], note: '', group: 'fans', editable: 'model' },
  pControls: { label: 'Controls / standby power', value: 6, unit: 'W', status: 'assumed', origin: 'assumption', range: [0, 20], note: '', group: 'product', editable: 'model' },

  // ---------- coils / refrigerant ----------
  uaInAir: { label: 'Indoor coil air-side UA at Super High', value: cal('uaInAir', 260), unit: 'W/K', status: 'calibrated', origin: 'calibration vs S3 p.29-30 (Q, SHC)', range: [50, 800], note: 'Scales with (airflow ratio)^uaExp.', group: 'coils', editable: 'model' },
  uaInRef: { label: 'Indoor coil refrigerant-side UA', value: cal('uaInRef', 900), unit: 'W/K', status: 'calibrated', origin: 'calibration', range: [100, 4000], note: '', group: 'coils', editable: 'model' },
  uaOutAir: { label: 'Outdoor coil air-side UA at 2178 m3/h', value: cal('uaOutAir', 450), unit: 'W/K', status: 'calibrated', origin: 'calibration vs S3 p.29-30 (input vs outdoor DB)', range: [100, 1500], note: '', group: 'coils', editable: 'model' },
  uaOutRef: { label: 'Outdoor coil refrigerant-side UA', value: cal('uaOutRef', 1500), unit: 'W/K', status: 'calibrated', origin: 'calibration', range: [200, 6000], note: '', group: 'coils', editable: 'model' },
  uaExp: { label: 'Air-side UA airflow exponent', value: 0.6, unit: '-', status: 'assumed', origin: 'assumption (typical finned-tube)', range: [0.4, 0.8], note: '', group: 'coils', editable: 'model' },
  cInCoil: { label: 'Indoor coil thermal capacitance', value: 3500, unit: 'J/K', status: 'assumed', origin: 'assumption (Al fins + Cu tube + refrigerant hold-up)', range: [500, 20000], note: 'Sets coil response time.', group: 'coils', editable: 'model' },
  cOutCoil: { label: 'Outdoor coil thermal capacitance', value: 7000, unit: 'J/K', status: 'assumed', origin: 'assumption', range: [1000, 40000], note: '', group: 'coils', editable: 'model' },
  subcool: { label: 'Condenser outlet subcooling', value: 4, unit: 'K', status: 'assumed', origin: 'assumption (no charge inventory model)', range: [0, 15], note: '', group: 'refrigerant', editable: 'model' },
  shTarget: { label: 'Target evaporator superheat', value: 5, unit: 'K', status: 'assumed', origin: 'assumption; S3 p.40: LEV is driven from discharge temperature', range: [1, 15], note: 'The surrogate converts this into a discharge-temperature target.', group: 'refrigerant', editable: 'model' },
  shK: { label: 'Superheat inventory gain', value: 1.5, unit: 'K/s per unit flow mismatch', status: 'assumed', origin: 'assumption', range: [0.2, 10], note: 'Reduced-order evaporator dry-out dynamics.', group: 'refrigerant', editable: 'model' },
  shFracMax: { label: 'Max superheated area fraction', value: 0.5, unit: '-', status: 'assumed', origin: 'assumption', range: [0.1, 0.8], note: 'f_sh = max * SH/(SH+15K).', group: 'refrigerant', editable: 'model' },
  eevCv: { label: 'LEV + capillary flow coefficient (100 %)', value: cal('eevCv', 1.4e-6), unit: 'm2', status: 'calibrated', origin: 'calibrated so rated opening is about 45 %', range: [1e-7, 1e-5], note: 'Capillary 4.0x2.4x240 mm (S3 p.18) folded into Cv.', group: 'refrigerant', editable: 'model' },
  eevRate: { label: 'LEV max rate', value: 3, unit: '%/s', status: 'assumed', origin: 'assumption', range: [0.2, 20], note: 'Percent only: the pulse count is not documented.', group: 'refrigerant', editable: 'model' },
  gEq: { label: 'Off-cycle pressure equalisation conductance', value: 25, unit: 'W/K', status: 'assumed', origin: 'assumption', range: [0, 200], note: '', group: 'refrigerant', editable: 'model' },
  filmMax: { label: 'Water retained on indoor fins', value: 0.12, unit: 'kg', status: 'assumed', origin: 'assumption', range: [0, 0.5], note: 'Re-evaporates after shutdown when fan runs.', group: 'coils', editable: 'model' },
  reEvapK: { label: 'Re-evaporation effectiveness', value: 0.35, unit: '-', status: 'assumed', origin: 'assumption', range: [0, 1], note: '', group: 'coils', editable: 'model' },
  frostRef: { label: 'Frost mass for 50 % air-side loss', value: 0.6, unit: 'kg', status: 'assumed', origin: 'assumption', range: [0.1, 3], note: 'Reduced-order frost demonstration.', group: 'coils', editable: 'model' },
  defrostFinishT: { label: 'Defrost finish temperature', value: 5, unit: 'degC', status: 'sourced', origin: 'S3 p.41 (JS soldered, initial)', range: [5, 10], note: '10 degC with JS cut.', group: 'control', editable: 'model' },
  defrostMaxTime: { label: 'Defrost max duration', value: 600, unit: 's', status: 'assumed', origin: 'S2 p.23 "fixed time" (value not given); assumed 10 min', range: [120, 900], note: '', group: 'control', editable: 'model' },
  defrostStartT: { label: 'Defrost start: outdoor coil below', value: -4, unit: 'degC', status: 'assumed', origin: 'S2 p.23 "too low" (value not given)', range: [-15, 0], note: '', group: 'control', editable: 'model' },
  defrostMinRun: { label: 'Defrost start: min heating time', value: 1800, unit: 's', status: 'assumed', origin: 'assumption', range: [300, 7200], note: '', group: 'control', editable: 'model' },

  // ---------- control ----------
  thermoOff: { label: 'Thermo-OFF offset', value: -1.0, unit: 'K', status: 'assumed', origin: 'assumption (S2 p.22 indicator bands 1-2 K)', range: [-3, 0], note: 'Cooling: OFF below set + offset (sign reversed in heating).', group: 'control', editable: 'model' },
  thermoOn: { label: 'Thermo-ON offset', value: 0.5, unit: 'K', status: 'assumed', origin: 'assumption', range: [0, 3], note: '', group: 'control', editable: 'model' },
  kp: { label: 'Frequency PI proportional gain', value: 12, unit: 'Hz/K', status: 'assumed', origin: 'surrogate controller', range: [1, 80], note: 'Not reverse-engineered firmware.', group: 'control', editable: 'model' },
  ki: { label: 'Frequency PI integral gain', value: 0.025, unit: 'Hz/(K s)', status: 'assumed', origin: 'surrogate controller', range: [0, 1], note: 'Anti-windup by conditional integration.', group: 'control', editable: 'model' },
  minOnTime: { label: 'Minimum compressor on time', value: 300, unit: 's', status: 'assumed', origin: 'assumption', range: [0, 900], note: '', group: 'control', editable: 'model' },
  autoDwell: { label: 'AUTO changeover dwell', value: 900, unit: 's', status: 'sourced', origin: 'S2 p.23 (about 15 minutes)', range: [900, 900], note: '', group: 'control', editable: 'locked' },
  autoBand: { label: 'AUTO changeover band', value: 1.0, unit: 'K', status: 'sourced', origin: 'S2 p.23 (1 degC)', range: [1, 1], note: '', group: 'control', editable: 'locked' },
  econoOffset: { label: 'ECONO COOL setpoint offset', value: 2.0, unit: 'K', status: 'sourced', origin: 'S2 p.24 (9-6 (9))', range: [2, 2], note: 'Vane swing cycle not documented numerically (assumed).', group: 'control', editable: 'locked' },
  nightFcap: { label: 'NIGHT MODE compressor cap', value: 60, unit: 'Hz', status: 'assumed', origin: 'S2 p.27 states outdoor noise is limited; value assumed', range: [20, 98], note: '', group: 'control', editable: 'model' },
  nightOfanCap: { label: 'NIGHT MODE outdoor fan cap', value: 700, unit: 'rpm', status: 'assumed', origin: 'assumption', range: [300, 940], note: '', group: 'control', editable: 'model' },
  coldAirFanOn: { label: 'Cold-air prevention: coil temp for set fan', value: 32, unit: 'degC', status: 'assumed', origin: 'S2 p.23 describes the function; value assumed', range: [20, 45], note: '', group: 'control', editable: 'model' },
  coldAirVeryLow: { label: 'Cold-air prevention: coil temp for very Low', value: 26, unit: 'degC', status: 'assumed', origin: 'assumption', range: [15, 40], note: '', group: 'control', editable: 'model' },
  dryFmax: { label: 'DRY compressor frequency cap', value: 40, unit: 'Hz', status: 'assumed', origin: 'assumption (DRY logic not published)', range: [13, 98], note: '', group: 'control', editable: 'model' },
  dryOffset: { label: 'DRY set temperature below initial room temp', value: 2.0, unit: 'K', status: 'assumed', origin: 'S2 p.22 "determined from initial room temperature" (rule assumed)', range: [0, 5], note: '', group: 'control', editable: 'model' },
  ofanOnLead: { label: 'Outdoor fan on before compressor', value: 5, unit: 's', status: 'sourced', origin: 'S3 p.40 (10-1)', range: [5, 5], note: '', group: 'control', editable: 'locked' },
  ofanOffLag: { label: 'Outdoor fan off after compressor', value: 15, unit: 's', status: 'sourced', origin: 'S3 p.40 (10-1)', range: [15, 15], note: '', group: 'control', editable: 'locked' },
  rvLead: { label: '4-way valve reversal before start', value: 5, unit: 's', status: 'sourced', origin: 'S3 p.40 (10-2)', range: [5, 5], note: '', group: 'control', editable: 'locked' },
  eevKp: { label: 'LEV PI gain', value: 0.4, unit: '%/K', status: 'assumed', origin: 'surrogate controller', range: [0, 10], note: '', group: 'control', editable: 'model' },
  eevKi: { label: 'LEV PI integral gain', value: 0.006, unit: '%/(K s)', status: 'assumed', origin: 'surrogate controller', range: [0, 1], note: '', group: 'control', editable: 'model' },

  // ---------- protection (S3 p.47-48 unless noted) ----------
  tdFreqDrop: { label: 'Discharge temp: frequency drop above', value: 111, unit: 'degC', status: 'sourced', origin: 'S3 p.47 (no.19)', range: [111, 111], note: '', group: 'protection', editable: 'locked' },
  tdStop: { label: 'Discharge temp: compressor stop above', value: 116, unit: 'degC', status: 'sourced', origin: 'S3 p.47 (no.10)', range: [116, 116], note: '', group: 'protection', editable: 'locked' },
  tdRestart: { label: 'Discharge temp: restart at or below', value: 100, unit: 'degC', status: 'sourced', origin: 'S3 p.47 (no.10, 3 min later)', range: [100, 100], note: '', group: 'protection', editable: 'locked' },
  coilFrostDrop: { label: 'COOL coil frost prevention: frequency drop at or below', value: 8, unit: 'degC', status: 'sourced', origin: 'S3 p.47 (no.18)', range: [8, 8], note: 'Indoor coil thermistor.', group: 'protection', editable: 'locked' },
  coilFrostStop: { label: 'COOL coil frost prevention: compressor stop below', value: 1, unit: 'degC', status: 'assumed', origin: 'S2 p.22 says compressor stops when coil is too low; value assumed', range: [-3, 5], note: '', group: 'protection', editable: 'model' },
  hpHeatDrop: { label: 'HEAT high pressure: frequency drop above', value: 55, unit: 'degC', status: 'sourced', origin: 'S3 p.47 (no.18)', range: [55, 55], note: 'Indoor coil thermistor.', group: 'protection', editable: 'locked' },
  hpHeatStop: { label: 'HEAT high pressure: stop above', value: 70, unit: 'degC', status: 'sourced', origin: 'S3 p.47 (no.12)', range: [70, 70], note: '', group: 'protection', editable: 'locked' },
  hpCoolStop: { label: 'COOL high pressure: stop above (defrost thermistor)', value: 70, unit: 'degC', status: 'sourced', origin: 'S3 p.47 (no.12)', range: [70, 70], note: '', group: 'protection', editable: 'locked' },
  hpCoolDrop: { label: 'COOL high pressure: frequency drop above', value: 62, unit: 'degC', status: 'assumed', origin: 'assumption (S3 p.40 lists the function)', range: [50, 70], note: '', group: 'protection', editable: 'model' },
  currentDrop: { label: 'Current protection: frequency drop above', value: 10, unit: 'A', status: 'sourced', origin: 'S3 p.47 (no.17, approximately 10 A)', range: [10, 10], note: 'Current estimated = P / (V x PF).', group: 'protection', editable: 'locked' },
  commTimeout: { label: 'Serial signal failure stop after', value: 180, unit: 's', status: 'sourced', origin: 'S3 p.47 (no.4)', range: [180, 180], note: '', group: 'protection', editable: 'locked' },
  lowTdLimit: { label: 'Low discharge temperature limit', value: 50, unit: 'degC', status: 'sourced', origin: 'S3 p.48 (no.21)', range: [50, 50], note: '', group: 'protection', editable: 'locked' },
  lowTdTime: { label: 'Low discharge temperature duration', value: 1200, unit: 's', status: 'sourced', origin: 'S3 p.48 (no.21, 20 min)', range: [1200, 1200], note: '', group: 'protection', editable: 'locked' },
  finStop: { label: 'Fin (heat sink) temperature stop', value: 80, unit: 'degC', status: 'sourced', origin: 'S3 p.47 (no.11: 75-86 degC)', range: [75, 86], note: 'Mid-band value; heat-sink thermal model is assumed.', group: 'protection', editable: 'model' },
  finRth: { label: 'Heat-sink thermal resistance', value: 0.35, unit: 'K/W', status: 'assumed', origin: 'assumption', range: [0.05, 1], note: '', group: 'protection', editable: 'model' },
  ifanFaultTime: { label: 'Indoor fan motor error detection', value: 12, unit: 's', status: 'assumed', origin: 'S2 p.36 names the error; timing assumed', range: [3, 60], note: '', group: 'protection', editable: 'model' },
  ofanFaultTime: { label: 'Outdoor fan stopped detection', value: 30, unit: 's', status: 'sourced', origin: 'S3 p.47 (no.14: stopped 3 times within 30 s)', range: [30, 30], note: '', group: 'protection', editable: 'locked' },
  envelopeCoolMax: { label: 'Cooling chart outdoor DB max', value: 46, unit: 'degC', status: 'sourced', origin: 'S3 p.21/p.30 (data to 46 degC)', range: [46, 46], note: 'Above it the map is extrapolated and flagged.', group: 'protection', editable: 'locked' },
  envelopeHeatMin: { label: 'Guaranteed heating lower limit', value: -15, unit: 'degC', status: 'sourced', origin: 'S3 p.22', range: [-15, -15], note: '', group: 'protection', editable: 'locked' },

  // ---------- louvers ----------
  vaneRate: { label: 'Horizontal vane slew rate', value: 20, unit: 'deg/s', status: 'assumed', origin: 'assumption (stepping motor, S2 p.24)', range: [2, 90], note: '', group: 'louvers', editable: 'model' },
  swingPeriod: { label: 'Vertical swing period', value: 14, unit: 's', status: 'assumed', origin: 'assumption', range: [4, 60], note: '', group: 'louvers', editable: 'model' },
  wideRate: { label: 'Vertical vane slew rate', value: 15, unit: 'deg/s', status: 'assumed', origin: 'assumption', range: [2, 90], note: '', group: 'louvers', editable: 'model' },
  widePeriod: { label: 'Horizontal swing period', value: 16, unit: 's', status: 'assumed', origin: 'assumption', range: [4, 60], note: '', group: 'louvers', editable: 'model' },
  vaneAng1: { label: 'Vane angle at position 1', value: 12, unit: 'deg below horizontal', status: 'assumed', origin: 'positions 1-5 sourced (S2 p.24), angles assumed', range: [0, 40], note: '', group: 'louvers', editable: 'model' },
  vaneAng5: { label: 'Vane angle at position 5', value: 68, unit: 'deg below horizontal', status: 'assumed', origin: 'assumption', range: [40, 85], note: '', group: 'louvers', editable: 'model' },
  vaneAngAutoCool: { label: 'Vane angle, AUTO cool "horizontal"', value: 6, unit: 'deg below horizontal', status: 'assumed', origin: 'S2 p.24 names "Horizontal position"; angle assumed', range: [0, 20], note: '', group: 'louvers', editable: 'model' },
  wideMax: { label: 'Vertical vane max deflection', value: 40, unit: 'deg', status: 'assumed', origin: 'positions 1-5 sourced (S2 p.25), angles assumed', range: [10, 60], note: '', group: 'louvers', editable: 'model' },
  outletW: { label: 'Outlet effective width', value: 0.60, unit: 'm', status: 'assumed', origin: 'estimated from S2 p.11 outline', range: [0.3, 0.75], note: 'Supported geometry: changes free area and resistance.', group: 'louvers', editable: 'model' },
  outletH: { label: 'Outlet effective opening height', value: 0.065, unit: 'm', status: 'assumed', origin: 'estimated', range: [0.03, 0.12], note: 'Supported geometry.', group: 'louvers', editable: 'model' },
  vaneCount: { label: 'Vertical vane count', value: 13, unit: '-', status: 'assumed', origin: 'not documented; visual only', range: [6, 24], note: 'Visual-only geometry.', group: 'louvers', editable: 'geometry' },
  vaneSpacing: { label: 'Vertical vane spacing', value: 0.045, unit: 'm', status: 'assumed', origin: 'visual only', range: [0.02, 0.08], note: 'Visual-only geometry: no supported performance model.', group: 'louvers', editable: 'geometry' },

  // ---------- room (demonstration assumptions) ----------
  roomW: { label: 'Room width', value: 4, unit: 'm', status: 'supplied', origin: 'build brief demonstration room', range: [2.5, 8], note: 'Not a room-sizing recommendation.', group: 'room', editable: 'model' },
  roomH: { label: 'Room height', value: 2.8, unit: 'm', status: 'supplied', origin: 'build brief', range: [2.4, 4], note: '', group: 'room', editable: 'model' },
  roomD: { label: 'Room depth', value: 4, unit: 'm', status: 'supplied', origin: 'build brief', range: [2.5, 8], note: '', group: 'room', editable: 'model' },
  mountH: { label: 'Indoor unit top height', value: 2.55, unit: 'm', status: 'assumed', origin: 'assumption (S2 p.11 min 39 mm to ceiling... typical)', range: [1.9, 2.75], note: 'Supported geometry.', group: 'room', editable: 'model' },
  mountX: { label: 'Indoor unit centre from left wall', value: 2.0, unit: 'm', status: 'assumed', origin: 'assumption', range: [0.5, 3.5], note: 'Supported geometry.', group: 'room', editable: 'model' },
  uaAirOut: { label: 'Envelope UA direct to room air (glazing)', value: 8, unit: 'W/K', status: 'assumed', origin: 'assumption', range: [0, 60], note: '', group: 'room', editable: 'model' },
  uaMassOut: { label: 'Envelope UA through walls/roof to mass node', value: 28, unit: 'W/K', status: 'assumed', origin: 'assumption', range: [0, 150], note: '', group: 'room', editable: 'model' },
  hAmass: { label: 'Air to thermal-mass conductance', value: 160, unit: 'W/K', status: 'assumed', origin: 'assumption (about 55 m2 x 3 W/m2K)', range: [20, 600], note: '', group: 'room', editable: 'model' },
  cMass: { label: 'Effective wall/furniture capacitance', value: 9.0e5, unit: 'J/K', status: 'assumed', origin: 'assumption', range: [1e5, 5e6], note: 'Room cooling is not modelled with air capacity alone.', group: 'room', editable: 'model' },
  ach: { label: 'Infiltration', value: 0.5, unit: '1/h', status: 'assumed', origin: 'assumption', range: [0, 10], note: 'Open-door scenario raises it.', group: 'room', editable: 'model' },
  solar: { label: 'Solar gain', value: 250, unit: 'W', status: 'assumed', origin: 'assumption', range: [0, 2000], note: '', group: 'room', editable: 'model' },
  solarToMass: { label: 'Solar fraction to mass', value: 0.6, unit: '-', status: 'assumed', origin: 'assumption', range: [0, 1], note: '', group: 'room', editable: 'model' },
  internal: { label: 'Internal sensible gain (equipment)', value: 150, unit: 'W', status: 'assumed', origin: 'assumption', range: [0, 3000], note: '', group: 'room', editable: 'model' },
  occupants: { label: 'Occupants', value: 1, unit: '-', status: 'assumed', origin: 'assumption', range: [0, 10], note: '', group: 'room', editable: 'model' },
  occSens: { label: 'Sensible gain per occupant', value: 75, unit: 'W', status: 'assumed', origin: 'assumption (seated, light work)', range: [50, 150], note: '', group: 'room', editable: 'model' },
  occLat: { label: 'Latent gain per occupant', value: 55, unit: 'W', status: 'assumed', origin: 'assumption', range: [20, 150], note: 'Converted to moisture with h_fg; not added to the sensible balance.', group: 'room', editable: 'model' },

  // ---------- airflow field ----------
  jetK: { label: 'Jet throw constant K', value: 5.0, unit: '-', status: 'assumed', origin: 'assumption (entraining free-jet literature)', range: [2, 8], note: 'u_c = K u0 sqrt(A0)/s.', group: 'airflow', editable: 'model' },
  jetSpread: { label: 'Jet half-width growth', value: 0.11, unit: 'm/m', status: 'assumed', origin: 'assumption', range: [0.05, 0.25], note: '', group: 'airflow', editable: 'model' },
  terminalV: { label: 'Throw terminal velocity', value: 0.25, unit: 'm/s', status: 'supplied', origin: 'build brief convention', range: [0.1, 1], note: 'Demonstration convention.', group: 'airflow', editable: 'model' },
  strat: { label: 'Stratification coefficient', value: 0.12, unit: 'K/m per K supply difference', status: 'assumed', origin: 'assumption', range: [0, 0.5], note: 'Zonal display only, constrained to the room mean.', group: 'airflow', editable: 'model' },

  // ---------- virtual sensors ----------
  sensorTau: { label: 'Virtual sensor lag', value: 20, unit: 's', status: 'assumed', origin: 'user assumption', range: [0, 300], note: 'Not linked to a real instrument spec.', group: 'sensors', editable: 'model' },
  sensorPeriod: { label: 'Virtual sensor sample period', value: 2, unit: 's', status: 'assumed', origin: 'user assumption', range: [0.1, 60], note: '', group: 'sensors', editable: 'model' },
  sensorNoise: { label: 'Virtual sensor noise (1 sigma)', value: 0.1, unit: 'K', status: 'assumed', origin: 'user assumption', range: [0, 2], note: 'Seeded, reproducible.', group: 'sensors', editable: 'model' },
};

export const PARAM_DEFS: ParamDef[] = (Object.keys(D) as (keyof ProfileValues)[]).map((k) => ({ key: k, ...D[k] }));
export const PARAM_BY_KEY: Record<keyof ProfileValues, ParamDef> = Object.fromEntries(PARAM_DEFS.map((p) => [p.key, p])) as Record<keyof ProfileValues, ParamDef>;

export function defaultValues(): ProfileValues {
  const v = {} as ProfileValues;
  for (const p of PARAM_DEFS) (v as unknown as Record<string, number>)[p.key] = p.value;
  return v;
}

export const CALIBRATION_META = calib as Record<string, unknown>;

/** Scenario presets. Each is an initial state plus a time schedule of validated actions. */
import type { InitSpec } from './engine';
import type { Action } from './schema';

export interface ScheduledAction { at: number; action: Action; note?: string }
export interface Scenario {
  id: string; title: string; titleAr: string; description: string;
  init: InitSpec; schedule: ScheduledAction[]; duration: number;
  variants?: { label: string; schedule: ScheduledAction[] }[];
  demo?: string;
}

const on = (patch: Record<string, unknown> = {}): Action => ({ type: 'remote', patch: { power: true, ...patch } } as Action);

export const SCENARIOS: Scenario[] = [
  {
    id: 'pulldown', title: 'Pull down a warm room to 24 degC', titleAr: 'تبريد أوضة حرّانة لحد 24 درجة',
    description: 'Room 30 degC / 55 % RH, outdoor 35 degC. COOL 24 degC, fan AUTO.',
    init: { room: { T: 30, RH: 55 }, env: { outdoorT: 35, outdoorRH: 40 } },
    schedule: [{ at: 0, action: on({ mode: 'cool', setpoint: 24, fan: 'auto', vane: 'auto' }) }], duration: 3600,
  },
  {
    id: 'lowload', title: 'Near-setpoint low-load modulation', titleAr: 'تشغيل بحمل قليل قريب من الدرجة المطلوبة',
    description: 'Room already at 24.6 degC, mild outdoor 29 degC, no sun: the load is near or below minimum capacity, so the compressor modulates and may cycle.',
    init: { room: { T: 24.6, RH: 50 }, env: { outdoorT: 29, outdoorRH: 50, solar: 0, internal: 80 } },
    schedule: [{ at: 0, action: on({ mode: 'cool', setpoint: 24 }) }], duration: 5400,
  },
  {
    id: 'hot', title: 'Hot outdoor condition (46 degC)', titleAr: 'جو خارجي حار جدًا 46 درجة',
    description: 'Outdoor 46 degC with strong sun. Shows condensing temperature, discharge and current limits. 46 degC is the edge of the published cooling data.',
    init: { room: { T: 33, RH: 40 }, env: { outdoorT: 46, outdoorRH: 25, solar: 700 } },
    schedule: [{ at: 0, action: on({ mode: 'cool', setpoint: 24, fan: 'auto' }) }], duration: 3600,
  },
  {
    id: 'fanAB', title: 'Same start: Low vs High indoor fan', titleAr: 'نفس البداية: مروحة واطية ضد عالية',
    description: 'Identical initial states; only the indoor fan step differs.',
    init: { room: { T: 30, RH: 55 }, env: { outdoorT: 35, outdoorRH: 40 } },
    schedule: [{ at: 0, action: on({ mode: 'cool', setpoint: 24 }) }], duration: 3600,
    variants: [
      { label: 'A: Low', schedule: [{ at: 0, action: { type: 'remote', patch: { fan: 'Low' } } }] },
      { label: 'B: High', schedule: [{ at: 0, action: { type: 'remote', patch: { fan: 'High' } } }] },
    ],
  },
  {
    id: 'louverAB', title: 'Same start: horizontal vs downward vs swing', titleAr: 'نفس البداية: ريشة أفقية ضد لتحت ضد swing',
    description: 'Identical initial states and fan; only the vane position differs. Direction redistributes air; it does not create capacity.',
    init: { room: { T: 30, RH: 55 }, env: { outdoorT: 35, outdoorRH: 40 } },
    schedule: [{ at: 0, action: on({ mode: 'cool', setpoint: 24, fan: 'Med' }) }], duration: 3600,
    variants: [
      { label: 'A: Vane 1 (near horizontal)', schedule: [{ at: 0, action: { type: 'remote', patch: { vane: 1 } } }] },
      { label: 'B: Vane 5 (downward)', schedule: [{ at: 0, action: { type: 'remote', patch: { vane: 5 } } }] },
      { label: 'C: Swing', schedule: [{ at: 0, action: { type: 'remote', patch: { vane: 'swing' } } }] },
    ],
  },
  {
    id: 'filter', title: 'Restricted filter at Low fan', titleAr: 'فلتر مسدود والمروحة على Low',
    description: 'At 5 min the filter resistance rises by 400 %. Airflow falls, the coil gets colder and coil frost prevention responds.',
    init: { room: { T: 29, RH: 55 }, env: { outdoorT: 35, outdoorRH: 40 } },
    schedule: [
      { at: 0, action: on({ mode: 'cool', setpoint: 20, fan: 'Low' }) },
      { at: 300, action: { type: 'faults', patch: { filterRestriction: 4 } }, note: 'filter restricted' },
    ], duration: 2700,
  },
  {
    id: 'loadstep', title: 'Sudden load: 1.2 kW appliances + open door', titleAr: 'حمل مفاجئ: أجهزة 1.2 كيلووات وباب مفتوح',
    description: 'Steady at 24 degC, then at 20 min internal gains rise by 1.2 kW and a door opens (extra infiltration).',
    init: { room: { T: 24.5, RH: 50 }, env: { outdoorT: 35, outdoorRH: 40 } },
    schedule: [
      { at: 0, action: on({ mode: 'cool', setpoint: 24 }) },
      { at: 1200, action: { type: 'env', patch: { internal: 1350, doorOpen: true } }, note: 'load step' },
    ], duration: 3600,
  },
  {
    id: 'dry', title: 'Humid room in DRY mode', titleAr: 'أوضة رطبة في وضع DRY',
    description: 'Room 27 degC / 80 % RH. DRY sets its target from the initial room temperature and runs at low capacity with low airflow.',
    init: { room: { T: 27, RH: 80 }, env: { outdoorT: 30, outdoorRH: 75, solar: 100 } },
    schedule: [{ at: 0, action: on({ mode: 'dry', fan: 'auto' }) }], duration: 3600,
  },
  {
    id: 'heatup', title: 'Heating warm-up', titleAr: 'تسخين أوضة باردة',
    description: 'Room 14 degC, outdoor 7 degC. Cold-air prevention holds the indoor fan until the coil is warm.',
    init: { room: { T: 14, RH: 55 }, env: { outdoorT: 7, outdoorRH: 87, solar: 0, internal: 100 } },
    schedule: [{ at: 0, action: on({ mode: 'heat', setpoint: 22, fan: 'auto' }) }], duration: 3600,
  },
  {
    id: 'defrost', title: 'Cold, humid weather with defrost', titleAr: 'جو بارد ورطب مع إذابة الثلج',
    description: 'Outdoor 0 degC / 92 % RH with a leaky room (2 air changes per hour). Frost builds on the outdoor coil until a reduced-order defrost cycle runs (reversed cycle, fans stopped).',
    init: { room: { T: 16, RH: 50 }, env: { outdoorT: 0, outdoorRH: 92, solar: 0, internal: 0, ach: 2 } },
    schedule: [{ at: 0, action: on({ mode: 'heat', setpoint: 24, fan: 'auto' }) }], duration: 6300,
  },
  {
    id: 'fanfault', title: 'Indoor fan fault, safe stop and recovery', titleAr: 'عطل في مروحة الداخلي، إيقاف آمن ورجوع',
    description: 'At 10 min the indoor fan seizes. The coil cools fast; the controller detects the fan error and stops. At 20 min the cause is removed and the unit is power-cycled.',
    init: { room: { T: 28, RH: 55 }, env: { outdoorT: 35, outdoorRH: 40 } },
    schedule: [
      { at: 0, action: on({ mode: 'cool', setpoint: 24 }) },
      { at: 600, action: { type: 'faults', patch: { indoorFanFault: true } }, note: 'fan seized' },
      { at: 1200, action: { type: 'faults', patch: { indoorFanFault: false } }, note: 'cause removed' },
      { at: 1210, action: { type: 'remote', patch: { power: false } }, note: 'power off' },
      { at: 1220, action: { type: 'remote', patch: { power: true } }, note: 'power on (reset)' },
    ], duration: 2400,
  },
  {
    id: 'sensorfault', title: 'Room sensor failure and recovery', titleAr: 'عطل في حساس حرارة الأوضة',
    description: 'At 8 min the room thermistor reads open circuit: unit stops with a simulator fault. At 15 min the sensor is restored and the unit power-cycled.',
    init: { room: { T: 28, RH: 55 }, env: { outdoorT: 35, outdoorRH: 40 } },
    schedule: [
      { at: 0, action: on({ mode: 'cool', setpoint: 24 }) },
      { at: 480, action: { type: 'faults', patch: { sensorFail: 'room' } } },
      { at: 900, action: { type: 'faults', patch: { sensorFail: 'none' } } },
      { at: 905, action: { type: 'remote', patch: { power: false } } },
      { at: 915, action: { type: 'remote', patch: { power: true } } },
    ], duration: 1800,
  },
];

export const SCENARIO_BY_ID = Object.fromEntries(SCENARIOS.map((s) => [s.id, s]));

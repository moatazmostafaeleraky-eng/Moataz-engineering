/**
 * Offline command assistant: a small, documented intent parser that turns a
 * typed request into structured actions. It is not a language model. Every
 * produced action goes through the same validation as the normal controls,
 * and all numbers come from solver runs.
 */
import type { Action } from './schema';
import type { FanSetting, VaneSetting } from '../model/types';

export type AssistantAction =
  | { kind: 'selectComponent'; id: string }
  | { kind: 'setScenarioParameter'; action: Action }
  | { kind: 'placeProbe'; preset: 'desk' | 'bed' | 'return' | 'occupied'; probe: 'airT' | 'airV' }
  | { kind: 'runComparison'; label: string; a: Action[]; b: Action[]; labels: [string, string] }
  | { kind: 'runSweep'; vars: string[]; zone: 'desk' | 'bed' | 'even' }
  | { kind: 'explainEvent'; quantity: 'fAct' | 'Qnet' | 'Troom' | 'airflow' | 'Te' | 'Tc' | 'Ptotal' }
  | { kind: 'showHeatFlows' }
  | { kind: 'exportExperiment'; format: 'json' | 'csv' | 'html' | 'png' }
  | { kind: 'loadScenario'; id: string };

export interface ParseResult { ok: boolean; actions: AssistantAction[]; message: string }

const FAN_WORDS: Record<string, FanSetting> = { silent: 'Silent', quiet: 'Silent', low: 'Low', med: 'Med', medium: 'Med', high: 'High', 'super high': 'SuperHigh', superhigh: 'SuperHigh', auto: 'auto' };
const VANE_WORDS: Record<string, VaneSetting> = { horizontal: 1, up: 1, downward: 5, down: 5, swing: 'swing', auto: 'auto' };
const COMPONENTS = ['compressor', 'outdoor fan', 'indoor fan', 'cross-flow fan', 'indoor coil', 'outdoor coil', 'lev', 'expansion valve', '4-way valve', 'reversing valve', 'inverter', 'filter', 'vane', 'louver', 'drain', 'accumulator', 'service valve'];

export const EXAMPLES = [
  'Compare Low and High indoor fan from the same starting state',
  'Compare horizontal and downward vane',
  'Why did compressor speed fall?',
  'Show where heat leaves the room',
  'Find the best tested louver/fan setting for the desk zone',
  'Set temperature to 25',
  'Set outdoor temperature to 40',
  'Place a probe at the desk',
  'Select compressor',
  'Export report',
];

export function parseCommand(text: string): ParseResult {
  const t = text.toLowerCase().trim().replace(/\s+/g, ' ');
  let m: RegExpMatchArray | null;
  if ((m = t.match(/compare (silent|quiet|low|medium|med|high|super ?high|auto)(?: fan)? (?:and|vs|versus|with) (silent|quiet|low|medium|med|high|super ?high|auto)/))) {
    const a = FAN_WORDS[m[1].replace(' ', ' ')] ?? FAN_WORDS[m[1]], b = FAN_WORDS[m[2]];
    return { ok: true, message: `Matched run: identical start, fan ${a} vs ${b}.`, actions: [{ kind: 'runComparison', label: 'fan', labels: [`fan ${a}`, `fan ${b}`], a: [{ type: 'remote', patch: { fan: a } }], b: [{ type: 'remote', patch: { fan: b } }] }] };
  }
  if ((m = t.match(/compare (horizontal|up|downward|down|swing)(?: vane| louver)? (?:and|vs|versus|with) (horizontal|up|downward|down|swing)/))) {
    const a = VANE_WORDS[m[1]], b = VANE_WORDS[m[2]];
    return { ok: true, message: `Matched run: identical start, vane ${a} vs ${b}.`, actions: [{ kind: 'runComparison', label: 'vane', labels: [`vane ${a}`, `vane ${b}`], a: [{ type: 'remote', patch: { vane: a } }], b: [{ type: 'remote', patch: { vane: b } }] }] };
  }
  if (/why .*(compressor|frequency|speed)/.test(t)) return { ok: true, message: 'Explaining compressor speed from recorded events.', actions: [{ kind: 'explainEvent', quantity: 'fAct' }] };
  if (/why .*(capacity|cooling|heating)/.test(t)) return { ok: true, message: 'Explaining useful capacity.', actions: [{ kind: 'explainEvent', quantity: 'Qnet' }] };
  if (/why .*(room|temperature)/.test(t)) return { ok: true, message: 'Explaining room temperature.', actions: [{ kind: 'explainEvent', quantity: 'Troom' }] };
  if (/why .*(airflow|air flow)/.test(t)) return { ok: true, message: 'Explaining airflow.', actions: [{ kind: 'explainEvent', quantity: 'airflow' }] };
  if (/why .*(power|input|current)/.test(t)) return { ok: true, message: 'Explaining electrical input.', actions: [{ kind: 'explainEvent', quantity: 'Ptotal' }] };
  if (/(where|how) .*heat .*(leave|leaves|go|goes)/.test(t) || /heat flow/.test(t)) return { ok: true, message: 'Showing the room and refrigerant heat path.', actions: [{ kind: 'showHeatFlows' }] };
  if ((m = t.match(/best .*(louver|vane|fan).* (desk|bed|even|room)/))) {
    const zone = m[2] === 'room' ? 'even' : (m[2] as 'desk' | 'bed' | 'even');
    return { ok: true, message: `Bounded sweep of vane angle and fan step for the ${zone} zone (results are the best among evaluated candidates under this model).`, actions: [{ kind: 'runSweep', vars: ['vane', 'ifan'], zone }] };
  }
  if ((m = t.match(/set (?:the )?(?:temperature|setpoint|set temp) (?:to )?(\d+(?:\.\d)?)/))) return { ok: true, message: `Set temperature ${m[1]} degC.`, actions: [{ kind: 'setScenarioParameter', action: { type: 'remote', patch: { setpoint: Number(m[1]) } } }] };
  if ((m = t.match(/set outdoor (?:temperature |temp )?(?:to )?(-?\d+(?:\.\d)?)/))) return { ok: true, message: `Outdoor ${m[1]} degC.`, actions: [{ kind: 'setScenarioParameter', action: { type: 'env', patch: { outdoorT: Number(m[1]) } } }] };
  if ((m = t.match(/(?:set )?fan (?:to )?(silent|quiet|low|medium|med|high|super ?high|auto)/))) return { ok: true, message: `Fan ${m[1]}.`, actions: [{ kind: 'setScenarioParameter', action: { type: 'remote', patch: { fan: FAN_WORDS[m[1]] } } }] };
  if (/^(start|turn on).*(cool)/.test(t)) return { ok: true, message: 'Start cooling.', actions: [{ kind: 'setScenarioParameter', action: { type: 'remote', patch: { power: true, mode: 'cool' } } }] };
  if (/^(start|turn on).*(heat)/.test(t)) return { ok: true, message: 'Start heating.', actions: [{ kind: 'setScenarioParameter', action: { type: 'remote', patch: { power: true, mode: 'heat' } } }] };
  if (/^(stop|turn off|switch off)/.test(t)) return { ok: true, message: 'Stop.', actions: [{ kind: 'setScenarioParameter', action: { type: 'remote', patch: { power: false } } }] };
  if ((m = t.match(/(?:place|add|put) (?:a |an )?(velocity|speed|temperature|temp)?\s*probe (?:at|on|near) (?:the )?(desk|bed|return|occupied)/))) {
    return { ok: true, message: `Probe placed at the ${m[2]}.`, actions: [{ kind: 'placeProbe', preset: m[2] as 'desk', probe: m[1] && /vel|speed/.test(m[1]) ? 'airV' : 'airT' }] };
  }
  if ((m = t.match(/(?:select|show|inspect) (?:the )?(.+)/))) {
    const c = COMPONENTS.find((x) => m![1].includes(x));
    if (c) return { ok: true, message: `Selected ${c}.`, actions: [{ kind: 'selectComponent', id: c }] };
  }
  if ((m = t.match(/export (?:the )?(experiment|report|story|json|csv|png|screenshot|settings)/))) {
    const f = m[1] === 'csv' ? 'csv' : m[1] === 'png' || m[1] === 'screenshot' ? 'png' : m[1] === 'json' || m[1] === 'settings' ? 'json' : 'html';
    return { ok: true, message: `Export ${f}.`, actions: [{ kind: 'exportExperiment', format: f }] };
  }
  if ((m = t.match(/(?:load|run) (?:the )?(?:scenario )?(pull ?down|defrost|dry|filter|hot|heat|fault|low ?load)/))) {
    const map: Record<string, string> = { pulldown: 'pulldown', 'pull down': 'pulldown', defrost: 'defrost', dry: 'dry', filter: 'filter', hot: 'hot', heat: 'heatup', fault: 'fanfault', lowload: 'lowload', 'low load': 'lowload' };
    return { ok: true, message: `Loading scenario ${m[1]}.`, actions: [{ kind: 'loadScenario', id: map[m[1]] }] };
  }
  return { ok: false, actions: [], message: 'Not understood. This assistant is a limited command parser (not a language model). Try one of the examples.' };
}

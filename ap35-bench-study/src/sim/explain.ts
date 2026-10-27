/**
 * "Why did this happen?" inspector. Explanations are generated from recorded
 * state, logged inputs and controller events over a configured dependency
 * graph. The graph supports explanation; it is not proof of a unique cause.
 */
import type { Simulation } from './engine';
import type { Action } from './schema';

export interface Explanation {
  quantity: string; title: string;
  equation: string;
  rule: string;
  causes: string[];
  recentInputs: { t: number; summary: string; action: Action }[];
  related: string[];
  separable: string;
}

const GRAPH: Record<string, { title: string; equation: string; parents: string[]; related: string[] }> = {
  fAct: { title: 'Compressor speed', equation: 'f_cmd = clamp(Kp e + I, f_min, min(f_max, protection caps)); ramp-limited; e = T_room,sensed - T_set (cooling)', parents: ['Troom', 'setpoint', 'limits', 'override'], related: ['compressor', 'inverter', 'room'] },
  Qnet: { title: 'Useful capacity', equation: 'Q_net = m_a (h_return - h_supply), supply includes fan heat; Q_evap,ref = m_ref (h1e - h4)', parents: ['fAct', 'airflow', 'Troom', 'outdoorT', 'filter'], related: ['indoor coil', 'compressor', 'indoor fan'] },
  Troom: { title: 'Room temperature', equation: 'C_air dT/dt = gains + envelope + infiltration + mass exchange - sensible cooling', parents: ['Qnet', 'load', 'outdoorT'], related: ['room', 'wall', 'indoor unit'] },
  airflow: { title: 'Indoor airflow', equation: 'Fan curve dp = P0(N)(1-(Q/Qf)^2) meets k r Q^2; r = filter + coil + outlet(vane area)', parents: ['fan', 'filter', 'vanes'], related: ['cross-flow fan', 'filter', 'vanes'] },
  Te: { title: 'Evaporating temperature', equation: 'C dTe/dt = Q_air(Te) - m_ref(Te,Tc,f) (h1e - h4)', parents: ['fAct', 'airflow', 'Troom', 'eev'], related: ['indoor coil', 'LEV'] },
  Tc: { title: 'Condensing temperature', equation: 'C dTc/dt = m_ref (h2 - h3) - Q_air(Tc)', parents: ['fAct', 'ofan', 'outdoorT'], related: ['outdoor coil', 'outdoor fan'] },
  Ptotal: { title: 'Total input', equation: 'P = P_comp + P_indoor fan + P_outdoor fan + P_controls; P_comp = W_shaft / eta_mi + P_fixed', parents: ['fAct', 'Tc', 'Te', 'fan'], related: ['compressor', 'inverter', 'fans'] },
};

function summarizeAction(a: Action): string {
  if (a.type === 'remote') return 'Remote ' + Object.entries(a.patch).map(([k, v]) => `${k}=${typeof v === 'object' ? '...' : v}`).join(', ');
  if (a.type === 'override') return 'Experiment ' + Object.entries(a.patch).map(([k, v]) => `${k}=${v}`).join(', ');
  if (a.type === 'env') return 'Conditions ' + Object.entries(a.patch).map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`).join(', ');
  if (a.type === 'faults') return 'Fault ' + Object.entries(a.patch).map(([k, v]) => `${k}=${v}`).join(', ');
  if (a.type === 'profile') return 'Design ' + Object.entries(a.patch).map(([k, v]) => `${k}=${v}`).join(', ');
  return a.type;
}

export function explain(sim: Simulation, quantity: keyof typeof GRAPH, windowS = 900): Explanation {
  const g = GRAPH[quantity] ?? GRAPH.fAct;
  const s = sim.s, o = sim.out, c = s.ctrl;
  const causes: string[] = [];
  const recent = sim.inputs.filter((r) => r.t >= s.t - windowS).slice(-8).map((r) => ({ t: r.t, summary: summarizeAction(r.action), action: r.action }));
  const evs = sim.events.filter((e) => e.t >= s.t - windowS && (e.kind === 'limit' || e.kind === 'protection' || e.kind === 'fault' || e.kind === 'state')).slice(-6);
  if (quantity === 'fAct' || quantity === 'Qnet' || quantity === 'Ptotal') {
    if (c.fault) causes.push(`Fault shutdown has priority: ${c.fault.code}.`);
    if (c.limitReason) causes.push(`Protection/derating active: ${c.limitReason} caps the frequency below the controller request (${c.fReq.toFixed(1)} Hz requested).`);
    if (s.overrides.manual && s.overrides.compHz !== null) causes.push(`Manual engineering request ${s.overrides.compHz} Hz (still passes envelope and protection limits).`);
    const err = (c.opMode === 'heat' ? sim.currentSetpoint() - c.sens.room : c.sens.room - sim.currentSetpoint());
    if (!c.limitReason && !c.fault) causes.push(`Controller demand: sensed room ${c.sens.room.toFixed(2)} degC vs target ${sim.currentSetpoint().toFixed(1)} degC (error ${err.toFixed(2)} K). Smaller error lowers the PI request.`);
    if (s.faults.filterRestriction > 0.5) causes.push(`Filter restriction (+${(s.faults.filterRestriction * 100).toFixed(0)} %) lowered airflow to ${o?.qIn.toFixed(0)} m3/h, cooling the coil.`);
    if (s.remote.nightMode) causes.push('NIGHT MODE caps compressor and outdoor fan (outdoor noise limit).');
  }
  if (quantity === 'airflow') {
    causes.push(`Fan ${o?.ifanAct.toFixed(0)} rpm; resistance ratio ${o?.resIn.total.toFixed(2)} (filter ${o?.resIn.filter.toFixed(2)}, coil ${o?.resIn.coil.toFixed(2)}, outlet ${o?.resIn.outlet.toFixed(2)}).`);
  }
  if (quantity === 'Troom') causes.push(`Net capacity ${(o?.Qnet ?? 0).toFixed(0)} W vs room gains; thermal mass at ${s.plant.Tmass.toFixed(1)} degC is still exchanging heat with the air.`);
  for (const e of evs) causes.push(`[${((e.t - sim.startTime) / 60).toFixed(1)} min] ${e.msg}`);
  const multi = recent.length > 1;
  return {
    quantity, title: g.title, equation: g.equation,
    rule: 'Priority: fault shutdown > protection/derating > mode sequence > user request > optimisation.',
    causes, recentInputs: recent, related: g.related,
    separable: multi ? 'Several inputs changed in this window. The model can separate them only by a matched counterfactual: use "Test this explanation" on one input at a time.' : 'At most one input changed in this window; the listed rule chain is the model\'s explanation.',
  };
}

/** Index of the snapshot just before time t (for counterfactual tests). */
export function snapshotBefore(sim: Simulation, t: number) {
  let best = sim.snapshots[0];
  for (const sn of sim.snapshots) if (sn.t <= t) best = sn;
  return best;
}

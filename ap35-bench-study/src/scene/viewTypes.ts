import type { SimState } from '../sim/engine';
import type { Outputs } from '../model/types';
export interface SimView { s: SimState; out: Outputs | null; setpoint: number; lockoutLeft: number }
export type { Outputs };

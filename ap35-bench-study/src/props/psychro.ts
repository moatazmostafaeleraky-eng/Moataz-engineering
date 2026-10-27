/**
 * Moist-air psychrometrics (ASHRAE Handbook Fundamentals, ch.1 formulation).
 * T in degC, w humidity ratio kg water / kg dry air, P total pressure Pa,
 * h specific enthalpy J/kg dry air (0 at 0 degC dry air and liquid water).
 */
export const P_ATM = 101325;
export const CP_DA = 1006; // J/(kg K) dry air
export const CP_V = 1860; // J/(kg K) water vapour
export const H_FG0 = 2.501e6; // J/kg at 0 degC
export const H_FUSION = 333.4e3; // J/kg
export const CP_W = 4186; // liquid water
export const CP_ICE = 2100;
export const R_DA = 287.042;

/** Saturation vapour pressure [Pa] over water (T>=0) or ice (T<0), Hyland-Wexler. */
export function pws(T: number): number {
  const Tk = T + 273.15;
  if (T >= 0) {
    const lnp = -5.8002206e3 / Tk + 1.3914993 - 4.8640239e-2 * Tk + 4.1764768e-5 * Tk * Tk - 1.4452093e-8 * Tk * Tk * Tk + 6.5459673 * Math.log(Tk);
    return Math.exp(lnp);
  }
  const lnp = -5.6745359e3 / Tk + 6.3925247 - 9.677843e-3 * Tk + 6.2215701e-7 * Tk * Tk + 2.0747825e-9 * Tk ** 3 - 9.484024e-13 * Tk ** 4 + 4.1635019 * Math.log(Tk);
  return Math.exp(lnp);
}

export function wFromPw(pw: number, P = P_ATM): number {
  return (0.621945 * pw) / Math.max(1, P - pw);
}
export function wsat(T: number, P = P_ATM): number {
  return wFromPw(pws(T), P);
}
export function pwFromW(w: number, P = P_ATM): number {
  return (P * w) / (0.621945 + w);
}
export function enthalpy(T: number, w: number): number {
  return CP_DA * T + w * (H_FG0 + CP_V * T);
}
export function tFromHW(h: number, w: number): number {
  return (h - w * H_FG0) / (CP_DA + w * CP_V);
}
export function rh(T: number, w: number, P = P_ATM): number {
  return Math.min(1.0, pwFromW(Math.max(0, w), P) / pws(T));
}
export function wFromRH(T: number, phi: number, P = P_ATM): number {
  return wFromPw(Math.max(0, Math.min(1, phi)) * pws(T), P);
}
/** Dew point [degC] from humidity ratio (bisection; frost point below 0). */
export function dewPoint(w: number, P = P_ATM): number {
  if (w <= 1e-7) return -60;
  const pw = pwFromW(w, P);
  let lo = -60, hi = 80;
  for (let i = 0; i < 50; i++) {
    const m = 0.5 * (lo + hi);
    if (pws(m) > pw) hi = m; else lo = m;
  }
  return 0.5 * (lo + hi);
}
/** Humidity ratio from dry bulb and thermodynamic wet bulb. */
export function wFromWB(T: number, Twb: number, P = P_ATM): number {
  const wsw = wsat(Twb, P);
  if (Twb >= 0) return ((2501 - 2.326 * Twb) * wsw - 1.006 * (T - Twb)) / (2501 + 1.86 * T - 4.186 * Twb);
  return ((2830 - 0.24 * Twb) * wsw - 1.006 * (T - Twb)) / (2830 + 1.86 * T - 2.1 * Twb);
}
/** Thermodynamic wet bulb [degC] from T and w. */
export function wetBulb(T: number, w: number, P = P_ATM): number {
  let lo = -40, hi = T;
  for (let i = 0; i < 50; i++) {
    const m = 0.5 * (lo + hi);
    if (wFromWB(T, m, P) > w) hi = m; else lo = m;
  }
  return 0.5 * (lo + hi);
}
/** Specific volume m3 per kg dry air. */
export function specVol(T: number, w: number, P = P_ATM): number {
  return (R_DA * (T + 273.15) * (1 + 1.607858 * w)) / P;
}
/** Saturated-air enthalpy at T (water surface or ice surface). */
export function hSat(T: number, P = P_ATM): number {
  return enthalpy(T, wsat(T, P));
}
/** Moist-air specific heat per kg dry air. */
export function cpMoist(w: number): number {
  return CP_DA + w * CP_V;
}
/** Enthalpy of condensate leaving at surface temperature Ts (liquid above 0, ice below). */
export function hCondensate(Ts: number): number {
  return Ts >= 0 ? CP_W * Ts : -H_FUSION + CP_ICE * Ts;
}

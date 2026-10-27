"""Generate offline R32 property tables for the AP35 bench study.

Backend: CoolProp (HEOS backend, pure R32). Run:
    python scripts/gen_r32_tables.py
Writes src/props/r32_tables.json. The table axes are aligned with the
saturation boundary (Tsat level x superheat / subcooling offset), so runtime
interpolation never crosses the two-phase dome.
Units in the JSON: T degC, P Pa (absolute), h J/kg, s J/(kg K), rho kg/m3.
"""
import json, os, datetime
import CoolProp
import CoolProp.CoolProp as CP

FLUID = "HEOS::R32"
T_SAT = [round(-50 + 0.5 * i, 2) for i in range(int((75 + 50) / 0.5) + 1)]   # -50..75 degC
T_LEVEL = [round(-50 + 2.5 * i, 2) for i in range(int((72.5 + 50) / 2.5) + 1)]  # pressure levels
DSH = [round(2.5 * i, 2) for i in range(0, 65)]   # superheat 0..160 K
DSC = [round(2.0 * i, 2) for i in range(0, 26)]   # subcooling 0..50 K
K = 273.15

def sat_row(T):
    Tk = T + K
    return dict(
        P=CP.PropsSI("P", "T", Tk, "Q", 0, FLUID),
        rl=CP.PropsSI("D", "T", Tk, "Q", 0, FLUID), rv=CP.PropsSI("D", "T", Tk, "Q", 1, FLUID),
        hl=CP.PropsSI("H", "T", Tk, "Q", 0, FLUID), hv=CP.PropsSI("H", "T", Tk, "Q", 1, FLUID),
        sl=CP.PropsSI("S", "T", Tk, "Q", 0, FLUID), sv=CP.PropsSI("S", "T", Tk, "Q", 1, FLUID),
    )

sat = {k: [] for k in ["P", "rl", "rv", "hl", "hv", "sl", "sv"]}
for T in T_SAT:
    r = sat_row(T)
    for k in sat: sat[k].append(r[k])

sup = {"h": [], "s": [], "rho": []}
sub = {"h": [], "rho": []}
for Tl in T_LEVEL:
    P = CP.PropsSI("P", "T", Tl + K, "Q", 1, FLUID)
    hrow, srow, rrow = [], [], []
    for d in DSH:
        if d == 0:
            hrow.append(CP.PropsSI("H", "P", P, "Q", 1, FLUID)); srow.append(CP.PropsSI("S", "P", P, "Q", 1, FLUID)); rrow.append(CP.PropsSI("D", "P", P, "Q", 1, FLUID))
        else:
            T = Tl + d + K
            hrow.append(CP.PropsSI("H", "P", P, "T", T, FLUID)); srow.append(CP.PropsSI("S", "P", P, "T", T, FLUID)); rrow.append(CP.PropsSI("D", "P", P, "T", T, FLUID))
    sup["h"].append(hrow); sup["s"].append(srow); sup["rho"].append(rrow)
    hl, rl = [], []
    for d in DSC:
        if d == 0:
            hl.append(CP.PropsSI("H", "P", P, "Q", 0, FLUID)); rl.append(CP.PropsSI("D", "P", P, "Q", 0, FLUID))
        else:
            T = Tl - d + K
            hl.append(CP.PropsSI("H", "P", P, "T", T, FLUID)); rl.append(CP.PropsSI("D", "P", P, "T", T, FLUID))
    sub["h"].append(hl); sub["rho"].append(rl)

crit = dict(T=CP.PropsSI("Tcrit", FLUID) - K, P=CP.PropsSI("pcrit", FLUID))
out = dict(
    meta=dict(fluid="R32", backend="CoolProp " + CoolProp.__version__ + " (HEOS)", generated=datetime.date.today().isoformat(),
              reference_state="CoolProp default (IIR: h=200 kJ/kg, s=1 kJ/kgK for saturated liquid at 0 degC)",
              units=dict(T="degC", P="Pa abs", h="J/kg", s="J/(kg K)", rho="kg/m3"),
              validity="Tsat -50..72.5 degC (P levels), superheat 0..160 K, subcooling 0..50 K; outside this domain lookups are flagged out-of-domain",
              critical=crit),
    T_sat=T_SAT, sat=sat, T_level=T_LEVEL, dSH=DSH, dSC=DSC, sup=sup, sub=sub,
    check_points=[dict(P=P, T=T, h=CP.PropsSI("H", "P", P, "T", T + K, FLUID), s=CP.PropsSI("S", "P", P, "T", T + K, FLUID))
                  for P, T in [(1.1e6, 20.0), (2.8e6, 80.0), (0.9e6, 5.0), (3.2e6, 95.3), (2.0e6, 40.0)]],
)
path = os.path.join(os.path.dirname(__file__), "..", "src", "props", "r32_tables.json")
with open(path, "w") as f:
    json.dump(out, f, separators=(",", ":"))
print("wrote", path, os.path.getsize(path), "bytes; critical", crit)

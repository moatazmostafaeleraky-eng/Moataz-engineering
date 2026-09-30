"""Hand calculations for the mould concept (ABS). Typical datasheet values; confirm with the chosen grade."""

from __future__ import annotations

import math

ABS = {
    "name": "ABS (general purpose, unfilled)",
    "density_g_cm3": 1.05,
    "E_MPa": 2300.0,
    "yield_MPa": 42.0,
    "T_melt_C": 240.0,  # 220-260
    "T_mold_C": 60.0,  # 50-70
    "T_eject_C": 85.0,
    "diffusivity_mm2_s": 0.10,
    "cp_J_kgK": 2100.0,
    "cte_1_K": 90e-6,
    "shrinkage_pct": (0.4, 0.7),
    "cavity_pressure_MPa": 40.0,  # 30-45 for 2 mm wall, L/t < 100
    "max_flow_ratio": 150.0,  # L/t, 2 mm wall
    "ejector_pin_min_mm": 2.0,
}
WATER = {"rho": 983.0, "cp": 4185.0, "nu_m2_s": 0.47e-6}  # 60 C
MACHINES_T = [25, 35, 50, 60, 80, 100, 120, 150, 180, 220, 280, 350, 450]


def cooling_time(s_mm, mat=ABS):
    """Mid-plane reaches ejection temperature (infinite plate, 1-D)."""
    a = mat["diffusivity_mm2_s"]
    ratio = (4 / math.pi) * (mat["T_melt_C"] - mat["T_mold_C"]) / (mat["T_eject_C"] - mat["T_mold_C"])
    return s_mm ** 2 / (math.pi ** 2 * a) * math.log(ratio)


def cycle_time(t_cool, fill=0.6, pack=2.5, open_eject_close=5.0):
    return {"fill_s": fill, "pack_s": pack, "cool_s": round(t_cool, 1), "mould_open_eject_close_s": open_eject_close,
            "total_s": round(fill + pack + t_cool + open_eject_close, 1)}


def tonnage_table(part_proj_cm2, part_mass_g, cavities=(1, 2, 4, 8), runner_cm2_per_cav=1.0,
                  runner_g_per_cav=0.8, safety=1.2, mat=ABS, cycle_s=17.0):
    rows = []
    p = mat["cavity_pressure_MPa"]
    for n in cavities:
        a_cm2 = n * (part_proj_cm2 + runner_cm2_per_cav)
        f_kN = a_cm2 * 1e-4 * p * 1e6 / 1e3
        f_t = f_kN / 9.81 * safety
        machine = next(m for m in MACHINES_T if m >= f_t)
        shot_g = n * (part_mass_g + runner_g_per_cav)
        rows.append({"cavities": n, "proj_area_cm2": round(a_cm2, 1), "clamp_calc_t": round(f_t, 1),
                     "machine_t": machine, "shot_g": round(shot_g, 1),
                     "parts_per_h": int(3600 / cycle_s * n)})
    return rows


def coolant(shot_g, cycle, dT_water=2.0, d_mm=6.0, circuits=2, mat=ABS):
    q_j = shot_g / 1000 * mat["cp_J_kgK"] * (mat["T_melt_C"] - mat["T_eject_C"])
    p_w = q_j / (cycle["cool_s"] + cycle["pack_s"])
    flow = p_w / (WATER["rho"] * WATER["cp"] * dT_water)  # m3/s total
    per = flow / circuits
    v = per / (math.pi * (d_mm / 1000) ** 2 / 4)
    re = v * d_mm / 1000 / WATER["nu_m2_s"]
    return {"heat_per_shot_J": round(q_j), "heat_rate_W": round(p_w), "flow_total_l_min": round(flow * 6e4, 2),
            "flow_per_circuit_l_min": round(per * 6e4, 2), "velocity_m_s": round(v, 2), "reynolds": int(re),
            "dT_water_K": dT_water, "channel_d_mm": d_mm}


def thermal_bow(dT, length_mm, t_mm, mat=ABS):
    """Bow of a plate with a through-thickness mould-temperature difference dT (A vs B)."""
    kappa = mat["cte_1_K"] * dT / t_mm
    return kappa * length_mm ** 2 / 8


def dT_for_bow(bow_mm, length_mm, t_mm, mat=ABS):
    return 8 * bow_mm * t_mm / (mat["cte_1_K"] * length_mm ** 2)


def beam_midspan(F_N, span_mm, I_mm4, c_mm, mat=ABS):
    d = F_N * span_mm ** 3 / (48 * mat["E_MPa"] * I_mm4)
    sigma = F_N * span_mm / 4 * c_mm / I_mm4
    return {"deflection_mm": round(d, 3), "stress_MPa": round(sigma, 1),
            "safety_vs_yield": round(mat["yield_MPa"] / sigma, 1)}


def lifter(depth_z_mm, clearance_mm=0.5, max_angle_deg=10.0):
    travel = depth_z_mm + clearance_mm
    stroke = travel / math.tan(math.radians(max_angle_deg))
    return {"lateral_travel_mm": round(travel, 2), "angle_deg": max_angle_deg, "ejector_stroke_mm": round(stroke, 1)}

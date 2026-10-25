"""Static actuator sizing, payload capacity and computed reach for a saved revision.

Everything here is a static (gravity-only) screening model built on the same
load model as the ``static_torque_J*`` checks. It sweeps the shoulder and elbow
through their limits to find the worst-case holding torque per axis, then
derives the largest TCP mass every axis can hold within its continuous rating.
Dynamic torque, acceleration, process forces and thermal limits are excluded,
so the real payload capacity is lower than the static bound reported here.
"""
from __future__ import annotations

import math

import numpy as np

from raedbots.catalog import loader
from raedbots.domain.models import ProjectRequirements, RobotConfiguration, Workcell
from raedbots.engineering.evaluate import model_gravity_torques, robot_mass, static_load_model
from raedbots.engineering.kinematics import fk_frames, NOMINAL_JOINTS

SWEEP_STEPS = 21
REACH_STEPS = 41
SCOPE = ("Static gravity screening over a J2/J3 sweep with J1, J4 and J6 at zero and J5 swept "
         "for the wrist. Continuous ratings only; dynamic torque, acceleration, process force "
         "and thermal limits are not included, so real payload capacity is lower.")


def _sweep_postures(rows) -> list[np.ndarray]:
    q2 = np.linspace(rows[1].q_min_rad, rows[1].q_max_rad, SWEEP_STEPS)
    q3 = np.linspace(rows[2].q_min_rad, rows[2].q_max_rad, SWEEP_STEPS)
    q5 = [max(min(v, rows[4].q_max_rad), rows[4].q_min_rad) for v in (-math.pi / 2, 0.0, math.pi / 2)]
    postures = []
    for a in q2:
        for b in q3:
            for c in q5:
                postures.append(np.array([0.0, a, b, 0.0, c, 0.0]))
    return postures


def computed_reach(rows) -> dict[str, float]:
    """Maximum horizontal distance from the J1 axis to the wrist centre and to the flange."""
    q2 = np.linspace(rows[1].q_min_rad, rows[1].q_max_rad, REACH_STEPS)
    q3 = np.linspace(rows[2].q_min_rad, rows[2].q_max_rad, REACH_STEPS)
    wrist = flange = 0.0
    for a in q2:
        for b in q3:
            frames = fk_frames(rows, np.array([0.0, a, b, 0.0, 0.0, 0.0]))
            wrist = max(wrist, float(np.hypot(*frames[4][:2, 3])))
            flange = max(flange, float(np.hypot(*frames[6][:2, 3])))
    return {"wrist_centre_m": wrist, "flange_m": flange}


def axis_sizing(cfg: RobotConfiguration, req: ProjectRequirements, workcell: Workcell) -> dict:
    fam = loader.families()[cfg.family_id]
    rows = cfg.dh_override or fam.dh
    motors = loader.motors()
    gearboxes = loader.gearboxes()
    tool = loader.tools()[cfg.tool_id]
    workpiece = req.workpiece_mass_kg.value

    postures = _sweep_postures(rows)
    # Torque is affine in the TCP mass: tau(q, m) = a(q) + m * b(q).
    model = static_load_model(cfg, req, workcell)
    base_t = np.array([model_gravity_torques(model, q, 0.0) for q in postures])
    unit_t = np.array([model_gravity_torques(model, q, 1.0) for q in postures]) - base_t
    load_t = base_t + workpiece * unit_t
    target_t = base_t + max(workpiece, req.payload_kg.value) * unit_t
    nominal = model_gravity_torques(model, NOMINAL_JOINTS, workpiece)

    axes = []
    capacity = math.inf
    limiting_axis = None
    for i, ax in enumerate(cfg.axes):
        gb = gearboxes[ax.gearbox_id]
        mot = motors[ax.motor_id]
        eff = max(float(gb.specs.get("efficiency", 0.75)), 0.2)
        gb_rated = float(gb.specs["rated_torque_nm"])
        gb_peak = float(gb.specs["peak_torque_nm"])
        motor_rated_out = float(mot.specs["rated_torque_nm"]) * ax.ratio * eff
        motor_peak_out = float(mot.specs.get("peak_torque_nm", mot.specs["rated_torque_nm"])) * ax.ratio * eff
        allowed = min(gb_rated, motor_rated_out)
        worst_idx = int(np.argmax(np.abs(load_t[:, i])))
        worst = float(abs(load_t[worst_idx, i]))
        # Largest TCP mass that keeps |a + m b| <= allowed for every sampled posture.
        axis_cap = math.inf
        for a, b in zip(base_t[:, i], unit_t[:, i]):
            if abs(a) > allowed:
                axis_cap = 0.0
                break
            if abs(b) > 1e-9:
                axis_cap = min(axis_cap, (allowed - a * math.copysign(1.0, b)) / abs(b))
        if axis_cap < capacity:
            capacity, limiting_axis = axis_cap, i + 1
        q = postures[worst_idx]
        required = float(np.max(np.abs(target_t[:, i])))
        motor_rated = float(mot.specs["rated_torque_nm"])
        axes.append({
            "axis": f"J{i+1}",
            "motor_id": ax.motor_id,
            "gearbox_id": ax.gearbox_id,
            "ratio": ax.ratio,
            "nominal_torque_nm": abs(nominal[i]),
            "worst_case_torque_nm": worst,
            "worst_case_posture_deg": [round(math.degrees(v), 1) for v in q],
            "gearbox_rated_nm": gb_rated,
            "gearbox_peak_nm": gb_peak,
            "motor_rated_at_output_nm": motor_rated_out,
            "motor_peak_at_output_nm": motor_peak_out,
            "allowed_continuous_nm": allowed,
            "limited_by": "gearbox" if gb_rated <= motor_rated_out else "motor",
            "utilization": worst / allowed if allowed else None,
            "static_tcp_capacity_kg": None if math.isinf(axis_cap) else max(axis_cap, 0.0),
            "required_static_nm_at_rated_payload": required,
            "min_ratio_for_selected_motor": required / (motor_rated * eff) if motor_rated else None,
        })

    mass, breakdown = robot_mass(cfg, tool, workpiece)
    reach = computed_reach(rows)
    cap = None if math.isinf(capacity) else max(capacity, 0.0)
    return {
        "revision_id": cfg.revision_id,
        "family_id": cfg.family_id,
        "tool_id": cfg.tool_id,
        "workpiece_kg": workpiece,
        "axes": axes,
        "static_payload_capacity_kg": cap,
        "limiting_axis": f"J{limiting_axis}" if limiting_axis else None,
        "payload_margin_kg": None if cap is None else cap - workpiece,
        "robot_mass_kg": mass,
        "mass_breakdown": {k: (sum(v) if isinstance(v, list) else v) for k, v in breakdown.items()},
        "reach": reach,
        "postures_sampled": len(postures),
        "scope": SCOPE,
    }

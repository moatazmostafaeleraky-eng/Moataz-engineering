"""Rigid-body dynamics of a saved revision along its task path.

The arm uses the same lumped masses as the static model (link + actuator mass
at mid-link, tool at its centre of mass, adapter at the flange, workpiece at the
TCP); each link also gets the inertia of a solid cylinder of its family's
section. Joint torques come from the Jacobian (Newton-Euler) form

    tau = sum_k  Jv_k^T m_k (a_k - g) + Jw_k^T (I_k alpha_k + w_k x I_k w_k)
          + rotor inertia reflected through the reducer,

with point accelerations a = Jv qdd + dJv/dt qd. The task poses are joined in
path order by minimum-jerk joint profiles, each segment timed by the requested
TCP speed (the same timing as the cycle-time check), with a dwell at every pose.
Peak torque is compared with repeated-peak ratings and RMS torque over the cycle
with continuous ratings (the usual servo sizing method).
"""
from __future__ import annotations

import math

import numpy as np

from raedbots.catalog import loader
from raedbots.domain.models import ProjectRequirements, RobotConfiguration, Workcell
from raedbots.engineering.evaluate import static_load_model
from raedbots.engineering.kinematics import default_seeds, fk_tcp, ik_dls
from raedbots.engineering.math3d import T_from_pose

GRAVITY = np.array([0.0, 0.0, -9.81])
SAMPLES_PER_SEGMENT = 60
DWELL_S = 0.4
MIN_SEGMENT_S = 0.2
SCOPE = ("Rigid-body dynamics on the task path: lumped link, actuator, tool and workpiece masses "
         "with cylinder link inertias and reflected rotor inertia; minimum-jerk joint motion timed "
         "by the TCP speed with a 0.4 s dwell per pose. Friction, process forces and cable loads "
         "are not modelled.")


def _model(cfg: RobotConfiguration, req: ProjectRequirements, workcell: Workcell) -> dict:
    model = static_load_model(cfg, req, workcell)
    fam = loader.families()[cfg.family_id]
    motors = loader.motors()
    tool = model["tool"]
    model["workpiece_kg"] = req.workpiece_mass_kg.value if tool.family == "gripper" else 0.0
    model["section_radius_m"] = max(fam.width_m, fam.height_m) / 2
    model["rotor_out"] = np.array([float(motors[ax.motor_id].specs.get("rotor_inertia_kgm2", 0.0)) * ax.ratio ** 2
                                   for ax in cfg.axes])
    return model


def _kinematics(model: dict, q: np.ndarray):
    """Bodies (mass, point, last moving joint, world inertia) plus joint origins and axes."""
    tool = model["tool"]
    tcp, frames = fk_tcp(model["rows"], q, tool, model["base"])
    origins = np.array([f[:3, 3] for f in frames])
    axes = np.array([f[:3, 2] for f in frames[:6]])
    r = model["section_radius_m"]
    bodies = []
    for i in range(6):
        m = float(model["link_masses"][i])
        seg = origins[i + 1] - origins[i]
        length = float(np.linalg.norm(seg))
        u = seg / length if length > 1e-9 else np.array([0.0, 0.0, 1.0])
        transverse = m * (length ** 2 / 12 + r ** 2 / 4)
        inertia = transverse * (np.eye(3) - np.outer(u, u)) + m * r ** 2 / 2 * np.outer(u, u)
        bodies.append((m, (origins[i] + origins[i + 1]) / 2, i, inertia))
    tool_com = (frames[-1] @ T_from_pose(tool.com))[:3, 3]
    zero = np.zeros((3, 3))
    for m, p in ((model["tool_kg"], tool_com), (tool.adapter_mass_kg, origins[6]), (model["workpiece_kg"], tcp[:3, 3])):
        if m > 0:
            bodies.append((float(m), p, 5, zero))
    return bodies, origins, axes


def _jacobians(bodies, origins, axes):
    out = []
    for _, p, last, _ in bodies:
        jv = np.zeros((3, 6))
        jw = np.zeros((3, 6))
        for j in range(last + 1):
            jv[:, j] = np.cross(axes[j], p - origins[j])
            jw[:, j] = axes[j]
        out.append((jv, jw))
    return out


def joint_torques(model: dict, q, qd, qdd, h: float = 1e-6) -> np.ndarray:
    """Output-side joint torques the actuators must supply at (q, qd, qdd)."""
    q, qd, qdd = (np.asarray(v, float) for v in (q, qd, qdd))
    bodies, origins, axes = _kinematics(model, q)
    jac = _jacobians(bodies, origins, axes)
    if np.any(qd):
        plus = _jacobians(*_kinematics(model, q + h * qd))
        minus = _jacobians(*_kinematics(model, q - h * qd))
        jdot = [((jvp - jvm) / (2 * h), (jwp - jwm) / (2 * h)) for (jvp, jwp), (jvm, jwm) in zip(plus, minus)]
    else:
        jdot = [(0.0, 0.0)] * len(jac)
    tau = model["rotor_out"] * qdd
    for (m, _, _, inertia), (jv, jw), (djv, djw) in zip(bodies, jac, jdot):
        a = jv @ qdd + (djv @ qd if np.any(qd) else 0.0)
        w = jw @ qd
        alpha = jw @ qdd + (djw @ qd if np.any(qd) else 0.0)
        tau = tau + jv.T @ (m * (a - GRAVITY)) + jw.T @ (inertia @ alpha + np.cross(w, inertia @ w))
    return tau


def _min_jerk(q0, q1, duration, n):
    """Positions, velocities and accelerations of a quintic rest-to-rest move."""
    s = np.linspace(0.0, 1.0, n)
    dq = q1 - q0
    pos = 10 * s ** 3 - 15 * s ** 4 + 6 * s ** 5
    vel = (30 * s ** 2 - 60 * s ** 3 + 30 * s ** 4) / duration
    acc = (60 * s - 180 * s ** 2 + 120 * s ** 3) / duration ** 2
    return (q0 + np.outer(pos, dq), np.outer(vel, dq), np.outer(acc, dq), s * duration)


def path_joint_targets(cfg: RobotConfiguration, workcell: Workcell) -> list[tuple[str, np.ndarray]]:
    """Reachable task poses in path order with their IK solutions."""
    fam = loader.families()[cfg.family_id]
    rows = cfg.dh_override or fam.dh
    tool = loader.tools()[cfg.tool_id]
    base = T_from_pose(workcell.base_pose)
    poses = ([next(p for p in workcell.task_poses if p.id == ident) for ident in workcell.path_ids]
             if workcell.path_ids else workcell.task_poses)
    # Same seeds as the task checks, so the dynamics follow the configurations those checks report.
    seeds = default_seeds(rows)
    targets = []
    for tp in poses:
        q, _ = ik_dls(rows, tool, tp.pose, seeds, base, require_ori=tp.require_orientation)
        if q is not None:
            targets.append((tp.id, np.asarray(q, float)))
    return targets


def trajectory_dynamics(cfg: RobotConfiguration, req: ProjectRequirements, workcell: Workcell,
                        targets: list[tuple[str, np.ndarray]] | None = None) -> dict:
    """Peak and RMS joint torques and speeds along the task path, against actuator ratings."""
    if targets is None:
        targets = path_joint_targets(cfg, workcell)
    if len(targets) < 2:
        return {"available": False, "reason": "needs at least two reachable task poses", "scope": SCOPE}
    model = _model(cfg, req, workcell)
    speed = req.tcp_speed_m_s.value if req.tcp_speed_m_s else 0.5
    tool = model["tool"]
    rows, base = model["rows"], model["base"]
    times, torques, velocities, segments = [], [], [], []
    t0 = 0.0
    hold = joint_torques(model, targets[0][1], np.zeros(6), np.zeros(6))
    times += [t0, t0 + DWELL_S]
    torques += [hold, hold]
    velocities += [np.zeros(6), np.zeros(6)]
    t0 += DWELL_S
    for (id0, q0), (id1, q1) in zip(targets, targets[1:]):
        p0 = fk_tcp(rows, q0, tool, base)[0][:3, 3]
        p1 = fk_tcp(rows, q1, tool, base)[0][:3, 3]
        duration = max(float(np.linalg.norm(p1 - p0)) / speed, MIN_SEGMENT_S)
        qs, qds, qdds, ts = _min_jerk(q0, q1, duration, SAMPLES_PER_SEGMENT)
        for q, qd, qdd, t in zip(qs, qds, qdds, ts):
            times.append(t0 + t)
            torques.append(joint_torques(model, q, qd, qdd))
            velocities.append(qd)
        t0 += duration
        hold = joint_torques(model, q1, np.zeros(6), np.zeros(6))
        times += [t0, t0 + DWELL_S]
        torques += [hold, hold]
        velocities += [np.zeros(6), np.zeros(6)]
        t0 += DWELL_S
        segments.append({"from": id0, "to": id1, "duration_s": duration})
    times = np.array(times)
    torques = np.array(torques)
    velocities = np.array(velocities)
    dt = np.diff(times)
    # Trapezoidal mean of tau^2 over the whole cycle.
    mean_sq = ((torques[1:] ** 2 + torques[:-1] ** 2) / 2 * dt[:, None]).sum(0) / times[-1]
    rms = np.sqrt(mean_sq)

    motors = loader.motors()
    gearboxes = loader.gearboxes()
    axes = []
    ok = True
    thermal_ok = True
    for i, ax in enumerate(cfg.axes):
        mot = motors[ax.motor_id]
        gb = gearboxes[ax.gearbox_id]
        eff = max(float(gb.specs.get("efficiency", 0.75)), 0.2)
        peak = float(np.max(np.abs(torques[:, i])))
        peak_speed = float(np.max(np.abs(velocities[:, i])))
        motor_rpm = peak_speed * ax.ratio * 60 / (2 * math.pi)
        max_rpm = min(float(mot.specs.get("max_speed_rpm", math.inf)), float(gb.specs.get("max_input_rpm", math.inf)))
        peak_allowed = min(float(gb.specs["peak_torque_nm"]),
                           float(mot.specs.get("peak_torque_nm", mot.specs["rated_torque_nm"])) * ax.ratio * eff)
        cont_allowed = min(float(gb.specs["rated_torque_nm"]), float(mot.specs["rated_torque_nm"]) * ax.ratio * eff)
        peak_ok = peak <= peak_allowed
        speed_ok = motor_rpm <= max_rpm
        rms_ok = float(rms[i]) <= cont_allowed
        ok = ok and peak_ok and speed_ok
        thermal_ok = thermal_ok and rms_ok
        axes.append({
            "axis": f"J{i+1}",
            "motor_id": ax.motor_id,
            "gearbox_id": ax.gearbox_id,
            "ratio": ax.ratio,
            "peak_torque_nm": peak,
            "peak_allowed_nm": peak_allowed,
            "peak_utilization": peak / peak_allowed if peak_allowed else None,
            "rms_torque_nm": float(rms[i]),
            "continuous_allowed_nm": cont_allowed,
            "rms_utilization": float(rms[i]) / cont_allowed if cont_allowed else None,
            "peak_joint_speed_deg_s": math.degrees(peak_speed),
            "peak_motor_speed_rpm": motor_rpm,
            "max_motor_speed_rpm": max_rpm,
            "min_ratio_for_peak": peak / (float(mot.specs.get("peak_torque_nm", mot.specs["rated_torque_nm"])) * eff),
            "min_ratio_for_rms": float(rms[i]) / (float(mot.specs["rated_torque_nm"]) * eff),
            "peak_ok": peak_ok,
            "speed_ok": speed_ok,
            "rms_ok": rms_ok,
        })
    step = max(1, len(times) // 240)
    return {
        "revision_id": cfg.revision_id,
        "available": True,
        "path": [ident for ident, _ in targets],
        "segments": segments,
        "cycle_s": float(times[-1]),
        "tcp_speed_m_s": speed,
        "axes": axes,
        "peak_ok": ok,
        "rms_ok": thermal_ok,
        "profile": {"t_s": [round(float(t), 4) for t in times[::step]],
                    "torque_nm": [[round(float(v), 3) for v in row] for row in torques[::step]]},
        "scope": SCOPE,
    }

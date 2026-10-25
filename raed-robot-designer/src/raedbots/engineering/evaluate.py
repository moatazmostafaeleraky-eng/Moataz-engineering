from __future__ import annotations

import hashlib
import math
from typing import Any

import numpy as np

from raedbots import ENGINE_VERSION
from raedbots.catalog import loader
from raedbots.domain.models import (
    CheckResult,
    CheckStatus,
    EndEffector,
    ProjectRequirements,
    RobotConfiguration,
    SolverResult,
    Workcell,
)
from raedbots.engineering.kinematics import (
    default_seeds,
    fk_tcp,
    ik_dls,
    in_limits,
    jacobian_numeric,
    min_svd,
    NOMINAL_JOINTS,
)
from raedbots.engineering.math3d import T_from_pose, pose_from_T


def _aabb_overlap(a_min, a_max, b_min, b_max) -> bool:
    return all(a_min[i] <= b_max[i] and a_max[i] >= b_min[i] for i in range(3))


def _link_aabb(T: np.ndarray, size: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    corners = []
    for sx in (-0.5, 0.5):
        for sy in (-0.5, 0.5):
            for sz in (0.0, 1.0):
                p = T @ np.array([sx * size[0], sy * size[1], sz * size[2], 1.0])
                corners.append(p[:3])
    c = np.stack(corners)
    return c.min(0), c.max(0)


def _box_volume(family, scale, wall_scale) -> float:
    w = family.width_m * scale
    h = family.height_m * scale
    t = family.wall_m * wall_scale
    if family.section == "tube":
        return math.pi * ((w / 2) ** 2 - max(w / 2 - t, 0) ** 2)
    inner = max(w - 2 * t, 0) * max(h - 2 * t, 0)
    return w * h - inner


def robot_mass(cfg: RobotConfiguration, tool: EndEffector, workpiece_kg: float) -> tuple[float, dict]:
    fam = loader.families()[cfg.family_id]
    mat = loader.materials()[cfg.material_id]
    mot = loader.motors()
    gb = loader.gearboxes()
    dh = cfg.dh_override or fam.dh
    lengths = [max(abs(r.a_m), abs(r.d_m), 0.08) for r in dh]
    area = _box_volume(fam, cfg.scale_links, cfg.wall_scale)
    link_masses = [area * L * mat.density_kg_m3 for L in lengths]
    bought = 0.0
    for ax in cfg.axes:
        bought += mot[ax.motor_id].mass_kg + gb[ax.gearbox_id].mass_kg + 0.4
    screws = 24 * 0.008
    base = fam.base_size_m**2 * 0.02 * mat.density_kg_m3
    tool_mass = tool.mass_kg + tool.adapter_mass_kg
    total = sum(link_masses) + bought + screws + base + tool_mass
    return total, {
        "links": link_masses,
        "actuators": bought,
        "base": base,
        "tool": tool_mass,
        "workpiece_not_in_robot": workpiece_kg,
    }


def gravity_torques(dh_rows, q, masses, com_frac=0.5, base=None, attached_loads=()) -> list[float]:
    g = np.array([0, 0, -9.81])
    frames = []
    T = np.eye(4) if base is None else base.copy()
    frames.append(T.copy())
    from raedbots.engineering.math3d import dh as dhT

    for row, qi in zip(dh_rows, q):
        T = T @ dhT(row.a_m, row.alpha_rad, row.d_m, qi + row.theta_offset_rad)
        frames.append(T.copy())
    origins = np.array([f[:3, 3] for f in frames])
    coms = origins[:-1] * (1 - com_frac) + origins[1:] * com_frac
    # Link masses beyond joint i plus every attached load act on joint i.
    points = np.vstack([coms] + [np.asarray(p, float).reshape(1, 3) for _, p in attached_loads])
    weights = np.concatenate([np.asarray(masses[:6], float), [m for m, _ in attached_loads]])
    link_index = np.concatenate([np.arange(6), np.full(len(attached_loads), 6)])
    tau = np.zeros(6)
    for i in range(6):
        sel = link_index >= i
        moments = np.cross(points[sel] - origins[i], np.outer(weights[sel], g))
        tau[i] = float(moments.sum(axis=0) @ frames[i][:3, 2])
    return [float(x) for x in tau]


def static_gravity_torques(cfg: RobotConfiguration, req: ProjectRequirements, workcell: Workcell,
                           q, workpiece_kg: float | None = None) -> list[float]:
    """Joint-output gravity torques with lumped link+actuator masses, tool and workpiece.

    ``workpiece_kg`` overrides the requirement value (used by payload-capacity sizing);
    by default the workpiece only loads the arm when the tool is a gripper.
    """
    model = static_load_model(cfg, req, workcell)
    if workpiece_kg is None:
        workpiece_kg = req.workpiece_mass_kg.value if model["tool"].family == "gripper" else 0.0
    return model_gravity_torques(model, q, workpiece_kg)


def static_load_model(cfg: RobotConfiguration, req: ProjectRequirements, workcell: Workcell) -> dict:
    """Posture-independent inputs of the static load model, computed once per revision."""
    fam = loader.families()[cfg.family_id]
    tool = loader.tools()[cfg.tool_id]
    _, breakdown = robot_mass(cfg, tool, req.workpiece_mass_kg.value)
    link_masses = breakdown["links"][:]
    mot = loader.motors()
    gb = loader.gearboxes()
    for i, ax in enumerate(cfg.axes):
        link_masses[i] += mot[ax.motor_id].mass_kg + gb[ax.gearbox_id].mass_kg
    return {
        "rows": cfg.dh_override or fam.dh,
        "base": T_from_pose(workcell.base_pose),
        "tool": tool,
        "link_masses": link_masses,
        "tool_kg": req.tool_mass_override_kg.value if req.tool_mass_override_kg else tool.mass_kg,
    }


def model_gravity_torques(model: dict, q, workpiece_kg: float) -> list[float]:
    tool = model["tool"]
    q = np.asarray(q, float)
    tcp, frames = fk_tcp(model["rows"], q, tool, model["base"])
    tool_com = (frames[-1] @ T_from_pose(tool.com))[:3, 3]
    return gravity_torques(model["rows"], q, model["link_masses"], base=model["base"], attached_loads=[
        (model["tool_kg"], tool_com), (tool.adapter_mass_kg, frames[-1][:3, 3]), (workpiece_kg, tcp[:3, 3])])


def collision_report(frames, fam, workcell: Workcell, tool: EndEffector) -> CheckResult:
    sizes = []
    for row in fam.dh:
        L = max(abs(row.a_m), abs(row.d_m), 0.08)
        sizes.append(np.array([fam.width_m, fam.height_m, L]))
    # Segment envelopes follow the actual DH endpoints, including links along X.
    radius = max(fam.width_m, fam.height_m) / 2
    aabbs = [(np.minimum(frames[i][:3, 3], frames[i+1][:3, 3]) - radius,
              np.maximum(frames[i][:3, 3], frames[i+1][:3, 3]) + radius) for i in range(6)]
    reasons = []
    for i in range(6):
        for j in range(i + 3, 6):
            if _aabb_overlap(*aabbs[i], *aabbs[j]):
                reasons.append(f"self_collision_L{i+1}_L{j+1}")
    for obs in workcell.obstacles:
        transform = T_from_pose(obs.pose)
        half = np.abs(transform[:3, :3]) @ (np.array(obs.size_m) / 2)
        bmin, bmax = transform[:3, 3] - half, transform[:3, 3] + half
        for i, aabb in enumerate(aabbs):
            if _aabb_overlap(*aabb, bmin, bmax):
                reasons.append(f"obstacle_{obs.id}_L{i+1}")
        tool_box = _link_aabb(frames[-1], np.array(tool.collision_box_m))
        if _aabb_overlap(*tool_box, bmin, bmax):
            reasons.append(f"obstacle_{obs.id}_tool")
    # AABB overlap is only a broad-phase candidate, not proof of collision.
    # Adjacent and next-neighbor bodies share joint volumes and are excluded.
    # sampled, not continuous
    status = CheckStatus.UNKNOWN if reasons else CheckStatus.PASS
    return CheckResult(
        name="collision_sampled_aabb",
        status=status,
        method="axis-aligned boxes at one or more sampled postures; not a continuous guarantee",
        assumptions="conservative segment boxes; overlap needs narrow-phase review; adjacent/next-neighbor and tool self-collision, cables ignored",
        evidence="sampled AABB overlap",
        reasons=reasons,
        value={"hits": reasons, "sample": "discrete"},
    )


def attached_mass(req: ProjectRequirements, tool: EndEffector) -> float:
    wp = req.workpiece_mass_kg.value if tool.family == "gripper" else 0.0
    extra = req.tool_mass_override_kg.value if req.tool_mass_override_kg else tool.mass_kg
    return extra + tool.adapter_mass_kg + wp


def dynamic_checks(cfg: RobotConfiguration, req: ProjectRequirements, workcell: Workcell,
                   task_reach: list[dict]) -> tuple[CheckResult, CheckResult]:
    """Peak-torque/speed and RMS-torque checks from the task-path dynamics."""
    from raedbots.engineering.dynamics import SCOPE, trajectory_dynamics

    solved = {entry["id"]: np.asarray(entry["q"]) for entry in task_reach if "q" in entry}
    order = workcell.path_ids or [tp.id for tp in workcell.task_poses]
    targets = [(ident, solved[ident]) for ident in order if ident in solved]
    if len(targets) < 2:
        reason = "needs at least two reachable task poses"
        return (CheckResult(name="dynamic_torque", status=CheckStatus.UNKNOWN, method="rigid-body dynamics on the task path",
                            assumptions=SCOPE, evidence="insufficient path", reasons=[reason]),
                CheckResult(name="thermal", status=CheckStatus.UNKNOWN, method="RMS torque over the task cycle",
                            assumptions=SCOPE, evidence="insufficient path", reasons=[reason]))
    dyn = trajectory_dynamics(cfg, req, workcell, targets)
    summary = {a["axis"]: {k: a[k] for k in ("peak_torque_nm", "peak_allowed_nm", "peak_motor_speed_rpm",
                                             "max_motor_speed_rpm", "rms_torque_nm", "continuous_allowed_nm")}
               for a in dyn["axes"]}
    peak_reasons = [f"peak_torque_exceeds_rating {a['axis']}" for a in dyn["axes"] if not a["peak_ok"]]
    peak_reasons += [f"motor_speed_exceeds_max {a['axis']}" for a in dyn["axes"] if not a["speed_ok"]]
    rms_reasons = [f"rms_torque_exceeds_continuous {a['axis']}" for a in dyn["axes"] if not a["rms_ok"]]
    return (
        CheckResult(name="dynamic_torque", status=CheckStatus.FAIL if peak_reasons else CheckStatus.PASS,
                    value={"cycle_s": dyn["cycle_s"], "path": dyn["path"], "axes": summary},
                    method="Newton-Euler (Jacobian form) rigid-body dynamics along the task path; peak output torque "
                           "vs repeated-peak rating of reducer and motor, peak motor speed vs motor and reducer limits",
                    assumptions=SCOPE, evidence=ENGINE_VERSION, reasons=peak_reasons),
        CheckResult(name="thermal", status=CheckStatus.FAIL if rms_reasons else CheckStatus.PASS,
                    value={"cycle_s": dyn["cycle_s"], "rms_torque_nm": {a["axis"]: a["rms_torque_nm"] for a in dyn["axes"]}},
                    method="RMS output torque over the task cycle vs continuous rating of reducer and motor "
                           "(servo RMS sizing method; no thermal network model)",
                    assumptions=SCOPE, evidence=ENGINE_VERSION, reasons=rms_reasons),
    )


def evaluate(cfg: RobotConfiguration, req: ProjectRequirements, workcell: Workcell) -> SolverResult:
    fam = loader.families()[cfg.family_id]
    mot = loader.motors()
    gb = loader.gearboxes()
    tool = loader.tools()[cfg.tool_id]
    dh_rows = cfg.dh_override or fam.dh
    base = T_from_pose(workcell.base_pose)
    q_nom = NOMINAL_JOINTS.copy()
    for i, row in enumerate(dh_rows):
        q_nom[i] = min(max(q_nom[i], row.q_min_rad), row.q_max_rad)
    tcp, frames = fk_tcp(dh_rows, q_nom, tool, base)
    mass, _ = robot_mass(cfg, tool, req.workpiece_mass_kg.value)
    tool_kg = req.tool_mass_override_kg.value if req.tool_mass_override_kg else tool.mass_kg
    tau_g = static_gravity_torques(cfg, req, workcell, q_nom)
    mass += tool_kg - tool.mass_kg

    checks: list[CheckResult] = []
    rejected: list[str] = []

    def add(c: CheckResult):
        checks.append(c)
        if c.status == CheckStatus.FAIL:
            rejected.append(c.name + ": " + ";".join(c.reasons) if c.reasons else c.name)

    # motor/gearbox gravity vs rated (static only)
    for i, ax in enumerate(cfg.axes):
        gbox = gb[ax.gearbox_id]
        motor = mot[ax.motor_id]
        eff = float(gbox.specs.get("efficiency", 0.75))
        ratio = ax.ratio
        t_out = abs(tau_g[i])
        t_mot = t_out / (ratio * max(eff, 0.2))
        rated_out = float(gbox.specs["rated_torque_nm"])
        peak_out = float(gbox.specs["peak_torque_nm"])
        rated_m = float(motor.specs["rated_torque_nm"])
        ok = t_out <= rated_out and t_mot <= rated_m
        add(
            CheckResult(
                name=f"static_torque_J{i+1}",
                status=CheckStatus.PASS if ok else CheckStatus.FAIL,
                value={
                    "output_gravity_nm": t_out,
                    "motor_side_nm": t_mot,
                    "gearbox_rated_nm": rated_out,
                    "gearbox_peak_nm": peak_out,
                    "motor_rated_nm": rated_m,
                    "side": "both_reported_separately",
                },
                method="recursive gravity with lumped link+actuator masses at one posture",
                assumptions="no dynamics, no process force, efficiency constant",
                evidence=ENGINE_VERSION,
                reasons=[] if ok else [f"torque_exceeds_continuous_rating J{i+1}"],
            )
        )

    # Dynamic and RMS (thermal) checks need the task-path IK; filled in after the task loop.
    dynamic_index = len(checks)
    add(
        CheckResult(
            name="dynamic_torque",
            status=CheckStatus.UNKNOWN,
            method="rigid-body dynamics on the task path",
            assumptions="",
            evidence="pending",
        )
    )
    add(
        CheckResult(
            name="deflection",
            status=CheckStatus.UNKNOWN,
            method="structural model not in this release",
            assumptions="",
            evidence="no FEA",
        )
    )
    add(
        CheckResult(
            name="thermal",
            status=CheckStatus.UNKNOWN,
            method="RMS thermal model not in this release",
            assumptions="",
            evidence="no thermal solver",
        )
    )

    coll = collision_report(frames, fam, workcell, tool)
    add(coll)

    seeds = default_seeds(dh_rows)
    task_reach = []
    all_ok = True
    for tp in workcell.task_poses:
        p = tp.pose
        if not (-workcell.size_m[0]/2 <= p.x_m <= workcell.size_m[0]/2 and
                -workcell.size_m[1]/2 <= p.y_m <= workcell.size_m[1]/2 and 0 <= p.z_m <= workcell.size_m[2]):
            all_ok = False
            entry = {"id":tp.id,"reason":"outside_workcell"}
            task_reach.append(entry)
            add(CheckResult(name=f"task_{tp.id}",status=CheckStatus.FAIL,method="world-aligned workcell boundary",
                assumptions="cell centered on world XY; floor Z=0",evidence="task pose coordinates",reasons=["outside_workcell"],value=entry))
            continue
        q, reason = ik_dls(dh_rows, tool, tp.pose, seeds, base, require_ori=tp.require_orientation)
        entry: dict[str, Any] = {"id": tp.id, "reason": reason, "require_ori": tp.require_orientation}
        if q is None:
            all_ok = False
            # try position only to distinguish ori failure
            qpos, r2 = ik_dls(dh_rows, tool, tp.pose, seeds, base, require_ori=False)
            if qpos is not None and tp.require_orientation:
                entry["reason"] = "orientation_unreachable"
                entry["position_ok"] = True
            else:
                entry["reason"] = "position_unreachable" if qpos is None else reason
                entry["position_ok"] = qpos is not None
            add(
                CheckResult(
                    name=f"task_{tp.id}",
                    status=CheckStatus.FAIL,
                    method="DLS IK with multiple seeds + FK check",
                    assumptions="discrete seeds, local minima possible",
                    evidence=entry["reason"],
                    reasons=[entry["reason"]],
                    value=entry,
                )
            )
        else:
            tcp2, frames2 = fk_tcp(dh_rows, q, tool, base)
            J = jacobian_numeric(dh_rows, q, tool, base)
            svd = min_svd(J)
            coll2 = collision_report(frames2, fam, workcell, tool)
            if coll2.status != CheckStatus.PASS:
                all_ok = False
                entry["reason"] = "possible_collision_on_pose"
                entry["collision"] = coll2.reasons
                add(
                    CheckResult(
                        name=f"task_{tp.id}",
                        status=CheckStatus.FAIL,
                        method="IK then conservative AABB overlap; requires narrow-phase review",
                        assumptions="sampled geometry",
                        evidence="collision",
                        reasons=coll2.reasons,
                        value=entry,
                    )
                )
            elif svd < 0.02:
                entry["reason"] = "near_singularity"
                entry["min_svd"] = svd
                add(
                    CheckResult(
                        name=f"task_{tp.id}",
                        status=CheckStatus.FAIL,
                        method="min SVD of weighted Jacobian (m and rad mixed; ang weight 0.2)",
                        assumptions="threshold 0.02 is a design margin not a proof",
                        evidence=f"min_svd={svd:.4f}",
                        reasons=["near_singularity"],
                        value=entry,
                    )
                )
                all_ok = False
            else:
                entry["reason"] = "reachable_collision_free_sampled"
                entry["q"] = [float(x) for x in q]
                entry["min_svd"] = svd
                add(
                    CheckResult(
                        name=f"task_{tp.id}",
                        status=CheckStatus.PASS,
                        method="DLS IK + FK residual + AABB",
                        assumptions="sampled, not continuous path",
                        evidence="ok",
                        value=entry,
                    )
                )
        task_reach.append(entry)

    if not workcell.task_poses:
        add(
            CheckResult(
                name="task_poses",
                status=CheckStatus.UNKNOWN,
                method="no task poses supplied",
                assumptions="",
                evidence="user input missing",
            )
        )
        all_ok = False

    add(CheckResult(name="payload_definition", status=CheckStatus.UNKNOWN if req.payload_includes_tool is None else CheckStatus.PASS,
        method="explicit payload definition", assumptions="", evidence="user requirements",
        reasons=["specify whether payload includes tool"] if req.payload_includes_tool is None else []))
    if req.payload_includes_tool is not None:
        requested_load = attached_mass(req, tool) if req.payload_includes_tool else (req.workpiece_mass_kg.value if tool.family == "gripper" else 0)
        add(CheckResult(name="payload_requirement", status=CheckStatus.PASS if requested_load <= req.payload_kg.value else CheckStatus.FAIL,
            value=requested_load, required=req.payload_kg.value, unit="kg", method="requested load vs specified payload", assumptions="does not certify robot capacity", evidence="requirements",
            reasons=[] if requested_load <= req.payload_kg.value else ["specified_payload_exceeded"]))
    for name, value in [("manufacturing_budget", req.manufacturing_budget), ("max_output_torque_nm", req.max_output_torque_nm), ("second_tool", req.second_tool_id)]:
        if value is not None:
            add(CheckResult(name=name, status=CheckStatus.UNKNOWN, method="not verified in this solver", assumptions="", evidence="constraint retained"))

    # reach vs family
    reach_ok = fam.reach_m + 1e-6 >= req.reach_m.value
    add(
        CheckResult(
            name="family_reach",
            status=CheckStatus.PASS if reach_ok else CheckStatus.FAIL,
            value={"family_reach_m": fam.reach_m, "required_m": req.reach_m.value},
            unit="m",
            method="template nominal reach vs required distance",
            assumptions="nominal kinematic reach, not collision-free workspace",
            evidence="DH template",
            reasons=[] if reach_ok else ["reach_short"],
        )
    )

    # payload: static gravity at stretched pose only — not a certified payload
    payload_att = attached_mass(req, tool)
    wrist = gb[cfg.axes[-1].gearbox_id]
    lever = abs(tool.tcp.z_m) + 0.05
    wrist_need = payload_att * 9.81 * lever
    pay_ok = wrist_need <= float(wrist.specs["rated_torque_nm"]) * 0.5
    add(
        CheckResult(
            name="payload_static_wrist",
            status=CheckStatus.PASS if pay_ok else CheckStatus.FAIL,
            value={"attached_kg": payload_att, "wrist_need_nm": wrist_need},
            method="mg * TCP lever vs 50% gearbox rated torque at wrist",
            assumptions="not a manufacturer payload rating; dynamics unknown",
            evidence="static estimate",
            reasons=[] if pay_ok else ["payload_static_exceeds_wrist"],
        )
    )

    if req.max_robot_mass_kg and mass > req.max_robot_mass_kg.value:
        add(
            CheckResult(
                name="robot_mass_limit",
                status=CheckStatus.FAIL,
                value=mass,
                unit="kg",
                required=req.max_robot_mass_kg.value,
                method="CAD-density + catalog masses",
                assumptions="hollow box sections",
                evidence="mass model",
                reasons=["too_heavy"],
            )
        )

    # inventory
    if req.inventory_only:
        add(
            CheckResult(
                name="inventory_constraint",
                status=CheckStatus.UNKNOWN,
                method="evaluated in configuration engine when inventory file present",
                assumptions="",
                evidence="see inventory checks",
            )
        )

    # accuracy / repeatability cannot be proven
    add(
        CheckResult(
            name="position_accuracy",
            status=CheckStatus.UNKNOWN,
            required=req.position_accuracy_mm.value,
            unit="mm",
            method="needs encoder, compliance, calibration; IK residual is not accuracy",
            assumptions="",
            evidence="not claimed",
        )
    )
    add(
        CheckResult(
            name="repeatability",
            status=CheckStatus.UNKNOWN,
            required=req.repeatability_mm.value,
            unit="mm",
            method="requires physical test",
            assumptions="",
            evidence="not claimed",
        )
    )

    # crude cycle time: path length / speed with joint limits, not trapezoid full
    speed = req.tcp_speed_m_s.value if req.tcp_speed_m_s else 0.5
    ordered = ([next(p for p in workcell.task_poses if p.id == ident) for ident in workcell.path_ids]
               if workcell.path_ids else workcell.task_poses)
    if len(ordered) >= 2 and speed > 0:
        pts = [np.array([p.pose.x_m, p.pose.y_m, p.pose.z_m]) for p in ordered]
        dist = 0.0
        for a, b in zip(pts, pts[1:]):
            dist += float(np.linalg.norm(b - a))
        if len(pts) == 1:
            dist = 0.4
        cycle = dist / speed + 0.4 * len(pts)  # grasp/wait allowance
        cyc_ok = cycle <= req.cycle_time_s.value * 1.05
        add(
            CheckResult(
                name="cycle_time_path_length",
                status=CheckStatus.PASS if cyc_ok else CheckStatus.FAIL,
                value=cycle,
                unit="s",
                required=req.cycle_time_s.value,
                method="polyline length / TCP speed + 0.4s process per pose; not motor torque/speed curve",
                assumptions="constant TCP speed, ignores accel and joint saturation",
                evidence="geometric",
                reasons=[] if cyc_ok else ["cycle_too_slow"],
            )
        )
        cycle_time = cycle
    else:
        cycle_time = None
        add(
            CheckResult(
                name="cycle_time_path_length",
                status=CheckStatus.UNKNOWN,
                method="need path and speed",
                assumptions="",
                evidence="insufficient input",
            )
        )

    checks[dynamic_index], checks[dynamic_index + 2] = dynamic_checks(cfg, req, workcell, task_reach)

    J = jacobian_numeric(dh_rows, q_nom, tool, base)
    svd0 = min_svd(J)

    # Unknown analyses never become a feasible or approved design.
    feasible = all_ok and all(c.status in {CheckStatus.PASS, CheckStatus.NOT_APPLICABLE} for c in checks)
    rejected = [f"{c.name}: {c.status.value}" for c in checks if c.status in {CheckStatus.FAIL, CheckStatus.UNKNOWN}]

    return SolverResult(
        revision_id=cfg.revision_id,
        engine_version=ENGINE_VERSION,
        fk_tcp=pose_from_T(tcp),
        joint_torques_gravity_nm=tau_g,
        robot_mass_kg=mass,
        payload_capacity_kg=None,
        cycle_time_s=cycle_time,
        singularity_min_svd=svd0,
        cost_incomplete=True,
        checks=checks,
        feasible=feasible,
        rejected_reasons=rejected if not feasible else [],
        link_poses=[[row.tolist() for row in T] for T in frames],
        task_reach=task_reach,
    )


def content_hash(obj: str) -> str:
    return hashlib.sha256(obj.encode("utf-8")).hexdigest()

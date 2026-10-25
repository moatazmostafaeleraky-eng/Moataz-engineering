from __future__ import annotations

from dataclasses import dataclass
from typing import Any
import math
import uuid

import numpy as np
from pydantic import BaseModel, Field, ConfigDict

from raedbots.catalog import loader
from raedbots.domain.models import Pose
from raedbots.engineering.kinematics import fk_tcp, ik_dls, default_seeds, in_limits
from raedbots.domain.models import DhRow
from raedbots.robot_geometry.categories import validate_category


class GeometryDesign(BaseModel):
    model_config = ConfigDict(extra="forbid")

    family_id: str = "medium"
    upper_arm_m: float = Field(default=0.52, gt=0.12, lt=1.2)
    forearm_m: float = Field(default=0.48, gt=0.12, lt=1.4)
    wrist_offset_m: float = Field(default=0.10, gt=0.03, lt=0.35)
    link_width_m: float = Field(default=0.11, gt=0.03, lt=0.5)
    link_height_m: float = Field(default=0.11, gt=0.03, lt=0.5)
    wall_m: float = Field(default=0.01, gt=0.001, lt=0.08)
    base_size_m: float = Field(default=0.34, gt=0.1, lt=1.5)
    shoulder_radius_m: float = Field(default=0.12, gt=0.04, lt=0.5)
    elbow_radius_m: float = Field(default=0.10, gt=0.03, lt=0.4)

    def validate_geometry(self) -> list[str]:
        errors: list[str] = []
        if self.wall_m * 2 >= min(self.link_width_m, self.link_height_m):
            errors.append("wall_m_must_be_less_than_half_link_section")
        if self.forearm_m <= self.wrist_offset_m:
            errors.append("forearm_must_exceed_wrist_offset")
        return errors


class GeometryOptimizationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    category_id: str = "articulated_6r_industrial"
    family_id: str = "medium"
    tool_id: str = "rg2"
    target: Pose
    workpiece_mass_kg: float = Field(default=0.0, ge=0.0)
    payload_kg: float = Field(default=0.0, ge=0.0)
    require_orientation: bool = True
    max_candidates: int = Field(default=24, ge=1, le=200)
    objective: str = "balanced"
    min_reach_margin_m: float = Field(default=0.03, ge=0.0, lt=1.0)
    seed_design: GeometryDesign | None = None


class GeometryCandidate(BaseModel):
    revision_id: str
    design: GeometryDesign
    feasible: bool
    score: float
    target_error_m: float
    joint_solution_rad: list[float] = Field(default_factory=list)
    tcp: Pose | None = None
    rejected: list[str] = Field(default_factory=list)
    metrics: dict[str, float] = Field(default_factory=dict)


def design_from_family(family_id: str) -> GeometryDesign:
    family = loader.families()[family_id]
    return GeometryDesign(
        family_id=family_id,
        upper_arm_m=family.dh[1].a_m,
        forearm_m=max(abs(family.dh[3].d_m), 0.15),
        wrist_offset_m=max(family.dh[5].d_m, 0.04),
        link_width_m=family.width_m,
        link_height_m=family.height_m,
        wall_m=family.wall_m,
        base_size_m=family.base_size_m,
    )


def dh_for_design(design: GeometryDesign) -> list[DhRow]:
    family = loader.families()[design.family_id]
    rows = [r.model_copy(deep=True) for r in family.dh]
    rows[1].a_m = design.upper_arm_m
    rows[3].d_m = design.forearm_m
    rows[5].d_m = design.wrist_offset_m
    for row in rows:
        row.q_min_rad = float(row.q_min_rad)
        row.q_max_rad = float(row.q_max_rad)
    return rows


def _target_distance(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.linalg.norm(a - b))


def _candidate_designs(request: GeometryOptimizationRequest) -> list[GeometryDesign]:
    seed = request.seed_design or design_from_family(request.family_id)
    # Deterministic bounded search around the seed. This is intentionally
    # explainable before adding a stochastic/global optimizer.
    upper = [0.82, 0.92, 1.02, 1.12]
    fore = [0.78, 0.90, 1.02, 1.14]
    wrist = [0.85, 1.0, 1.15]
    out: list[GeometryDesign] = [seed]
    for su in upper:
        for sf in fore:
            for sw in wrist:
                try:
                    design = seed.model_copy(update={
                        "upper_arm_m": seed.upper_arm_m * su,
                        "forearm_m": seed.forearm_m * sf,
                        "wrist_offset_m": seed.wrist_offset_m * sw,
                    })
                    if not design.validate_geometry():
                        out.append(design)
                except Exception:
                    continue
                if len(out) >= request.max_candidates:
                    return out
    return out


def evaluate_geometry_candidate(request: GeometryOptimizationRequest, design: GeometryDesign) -> GeometryCandidate:
    rejected = design.validate_geometry()
    if design.family_id not in loader.families():
        rejected.append("unknown_robot_family")
    if request.tool_id not in loader.tools():
        rejected.append("unknown_end_effector")
    if rejected:
        return GeometryCandidate(
            revision_id="geo-" + uuid.uuid4().hex[:10], design=design, feasible=False,
            score=1.0e12, target_error_m=1.0e6, rejected=rejected,
        )

    rows = dh_for_design(design)
    tool = loader.tools()[request.tool_id]
    seeds = default_seeds(rows)
    best_q, ik_reason = ik_dls(
        rows,
        tool,
        request.target,
        seeds,
        pos_tol=0.004,
        ori_tol=0.08,
        iters=180,
        require_ori=request.require_orientation,
    )
    if best_q is None:
        return GeometryCandidate(
            revision_id="geo-" + uuid.uuid4().hex[:10], design=design, feasible=False,
            score=1.0e12, target_error_m=1.0e6,
            rejected=[f"target_not_reachable_within_joint_limits:{ik_reason}"],
        )

    tcp, _ = fk_tcp(rows, best_q, tool)
    target_xyz = np.array([request.target.x_m, request.target.y_m, request.target.z_m])
    error = _target_distance(tcp[:3, 3], target_xyz)
    # This is a conservative reporting proxy only. Reachability is decided by
    # the actual IK result above, not by this scalar because the DH offsets are
    # not collinear in 3D.
    reach = design.upper_arm_m + design.forearm_m + design.wrist_offset_m
    margin = reach - float(np.linalg.norm(target_xyz))
    mass_proxy = (
        design.base_size_m * design.base_size_m * 0.02 * 2700.0
        + 2.0 * design.upper_arm_m * design.link_width_m * design.link_height_m * 2700.0
        + 2.0 * design.forearm_m * design.link_width_m * design.link_height_m * 2700.0
        + tool.mass_kg + request.workpiece_mass_kg
    )
    if error > 0.008:
        rejected.append("target_position_error_above_8mm")
    feasible = not rejected
    objective = request.objective
    if objective == "reach":
        score = error * 1000.0 - margin
    elif objective == "mass":
        score = mass_proxy + error * 10000.0
    else:
        score = error * 10000.0 + max(0.0, request.min_reach_margin_m - margin) * 1000.0 + mass_proxy * 0.01
    return GeometryCandidate(
        revision_id="geo-" + uuid.uuid4().hex[:10],
        design=design,
        feasible=feasible,
        score=float(score),
        target_error_m=error,
        joint_solution_rad=[float(x) for x in best_q],
        tcp=Pose.model_validate({"x_m": float(tcp[0,3]), "y_m": float(tcp[1,3]), "z_m": float(tcp[2,3]), "qw": 1, "qx": 0, "qy": 0, "qz": 0, "frame": "world"}),
        rejected=rejected,
        metrics={"reach_m": reach, "reach_margin_m": margin, "mass_proxy_kg": mass_proxy},
    )


def optimize_geometry(request: GeometryOptimizationRequest) -> dict[str, Any]:
    validate_category(request.category_id, request.family_id)
    rows = [evaluate_geometry_candidate(request, d) for d in _candidate_designs(request)]
    rows.sort(key=lambda row: (not row.feasible, row.score))
    return {
        "candidates": [row.model_dump(mode="json") for row in rows],
        "best": next((row.model_dump(mode="json") for row in rows if row.feasible), None),
        "scope": "Deterministic bounded link-dimension search with IK reachability; not a global optimum and not manufacturing approval.",
        "variables": ["upper_arm_m", "forearm_m", "wrist_offset_m"],
    }

from __future__ import annotations

from raedbots.catalog import loader
from raedbots.configuration.engine import assign_axes, pick_tool
from raedbots.domain.models import ProjectRequirements, RobotConfiguration, Workcell
from raedbots.engineering.evaluate import evaluate
from raedbots import ENGINE_VERSION
import uuid


def _clone(req: ProjectRequirements, family: str, material: str, motors_pattern: str) -> RobotConfiguration:
    axes = assign_axes(family)
    if motors_pattern == "small":
        m = ["sgm7a-01a"] * 6
        g = ["csg-17-100"] * 6
        axes = assign_axes(family)
        for i, ax in enumerate(axes):
            ax.motor_id = m[i]
            ax.gearbox_id = g[i]
            ax.ratio = float(loader.gearboxes()[g[i]].specs["ratio"])
    elif motors_pattern == "large":
        axes = assign_axes("long")
        for ax, src in zip(axes, assign_axes("long")):
            ax.motor_id = src.motor_id
            ax.gearbox_id = src.gearbox_id
            ax.ratio = src.ratio
    if req.locked_motor_ids:
        for i, mid in enumerate(req.locked_motor_ids[:6]):
            axes[i].motor_id = mid
    return RobotConfiguration(
        revision_id="rev-" + uuid.uuid4().hex[:10],
        family_id=family,
        material_id=material,
        process=next(p for p in req.processes_allowed if p in loader.materials()[material].process),
        tool_id=pick_tool(req),
        axes=axes,
        engine_version=ENGINE_VERSION,
        notes=f"pattern={motors_pattern}",
    )


def generate_candidates(req: ProjectRequirements, limit: int = 12) -> list[RobotConfiguration]:
    fams = [f.id for f in loader.families().values()]
    if req.reach_m.required:
        fams = [f for f in fams if loader.families()[f].reach_m >= req.reach_m.value] or fams[-1:]
    mats = [m for m in req.materials_allowed if m in loader.materials()]
    if req.locked_material_id:
        mats = [req.locked_material_id]
    patterns = ["default", "small", "large"]
    out = []
    for fam in fams:
        for mat in mats:
            if not any(p in loader.materials()[mat].process for p in req.processes_allowed):
                continue
            for pat in patterns:
                out.append(_clone(req, fam, mat, pat))
                if len(out) >= limit:
                    return out
    return out


def dominates(a: dict, b: dict, keys: list[str]) -> bool:
    better = False
    for k in keys:
        if a[k] is None or b[k] is None:
            return False
        if a[k] > b[k] + 1e-9:
            return False
        if a[k] < b[k] - 1e-9:
            better = True
    return better


def pareto(rows: list[dict], keys=("mass_kg", "cycle_s")) -> list[str]:
    ids = []
    for a in rows:
        if not a.get("feasible"):
            continue
        if any(k not in a or a[k] is None for k in keys):
            continue
        dominated = False
        for b in rows:
            if a is b or not b.get("feasible"):
                continue
            if dominates(b, a, list(keys)):
                dominated = True
                break
        if not dominated:
            ids.append(a["revision_id"])
    return ids


def run(req: ProjectRequirements, workcell: Workcell, limit: int = 12) -> dict:
    cands = generate_candidates(req, limit=limit)
    results = []
    for cfg in cands:
        sol = evaluate(cfg, req, workcell)
        row = {
            "revision_id": cfg.revision_id,
            "family_id": cfg.family_id,
            "material_id": cfg.material_id,
            "tool_id": cfg.tool_id,
            "notes": cfg.notes,
            "feasible": sol.feasible,
            "mass_kg": sol.robot_mass_kg,
            "cycle_s": sol.cycle_time_s,
            "rejected": sol.rejected_reasons,
            "configuration": cfg.model_dump(),
            "solver": sol.model_dump(),
        }
        results.append(row)
    front = pareto(results)
    for r in results:
        r["on_pareto"] = r["revision_id"] in front
    return {
        "candidates": results,
        "pareto_ids": front,
        "objectives": ["mass_kg", "cycle_s"],
        "scope": "evaluated candidates only; not a global optimum",
        "stop": {"max_candidates": limit, "reason": "bounded catalog search"},
    }

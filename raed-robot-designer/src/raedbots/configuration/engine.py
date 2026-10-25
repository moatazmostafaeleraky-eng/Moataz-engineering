from __future__ import annotations

import uuid

from raedbots import ENGINE_VERSION
from raedbots.catalog import loader
from raedbots.domain.models import (
    AxisAssignment,
    Binding,
    InventoryRow,
    ProjectRequirements,
    Quantity,
    RobotConfiguration,
)


def q(value: float, unit: str, **kw) -> Quantity:
    return Quantity(value=value, unit=unit, **kw)


def default_requirements() -> ProjectRequirements:
    return ProjectRequirements(
        application="pick_and_place",
        workpiece_mass_kg=q(6, "kg"),
        payload_kg=q(10, "kg", notes="clarify whether tool is included"),
        payload_includes_tool=None,
        reach_m=q(1.2, "m"),
        cycle_time_s=q(12, "s"),
        position_accuracy_mm=q(0.5, "mm", required=False, binding=Binding.AUTO),
        repeatability_mm=q(0.1, "mm", required=False),
        tcp_speed_m_s=q(0.4, "m/s", required=False),
    )


def pick_family(reach_m: float) -> str:
    fams = sorted(loader.families().values(), key=lambda f: f.reach_m)
    for f in fams:
        if f.reach_m >= reach_m:
            return f.id
    return fams[-1].id


def pick_tool(req: ProjectRequirements) -> str:
    if req.locked_tool_id:
        return req.locked_tool_id
    if req.tool_choice in loader.tools():
        return req.tool_choice
    if req.application in {"welding", "weld"}:
        return "mb-evo-24"
    return "rg2"


def assign_axes(family_id: str, locked_motors: list[str] | None = None) -> list[AxisAssignment]:
    motors = ["sgm7a-08a", "sgm7a-08a", "sgm7a-04a", "sgm7a-04a", "sgm7a-01a", "sgm7a-01a"]
    gbox = ["csg-32-50", "csg-32-50", "csg-25-80", "csg-25-80", "csg-17-100", "csg-17-100"]
    if family_id == "compact":
        motors = ["sgm7a-04a", "sgm7a-04a", "sgm7a-04a", "sgm7a-01a", "sgm7a-01a", "sgm7a-01a"]
        gbox = ["csg-25-80", "csg-25-80", "csg-17-100", "csg-17-100", "csg-17-100", "csg-17-100"]
    if family_id == "long":
        motors = ["sgm7a-08a", "sgm7a-08a", "sgm7a-08a", "sgm7a-04a", "sgm7a-04a", "sgm7a-01a"]
    if locked_motors:
        motors = [(locked_motors[i] if i < len(locked_motors) else motors[i]) for i in range(6)]
    ratios = {gid: float(loader.gearboxes()[gid].specs["ratio"]) for gid in set(gbox)}
    bearing = next(iter(loader.bearings()))
    return [
        AxisAssignment(joint=i + 1, motor_id=motors[i], gearbox_id=gbox[i], bearing_id=bearing, ratio=ratios[gbox[i]])
        for i in range(6)
    ]


def propose(req: ProjectRequirements, material_id: str | None = None) -> RobotConfiguration:
    if req.locked_material_id:
        mid = req.locked_material_id
    else:
        mid = material_id or (req.materials_allowed[0] if req.materials_allowed else "al6061")
    if mid not in req.materials_allowed and req.materials_allowed:
        raise ValueError("material not in allowed list")
    if mid not in loader.materials():
        raise ValueError("Unknown material")
    processes = [p for p in req.processes_allowed if p in loader.materials()[mid].process]
    if not processes:
        raise ValueError("Material is incompatible with the selected manufacturing process")
    fam = pick_family(req.reach_m.value)
    locked = req.locked_motor_ids or None
    return RobotConfiguration(
        revision_id="rev-" + uuid.uuid4().hex[:10],
        family_id=fam,
        material_id=mid,
        process=processes[0],
        tool_id=pick_tool(req),
        axes=assign_axes(fam, locked),
        engine_version=ENGINE_VERSION,
    )


def inventory_ok(cfg: RobotConfiguration, rows: list[InventoryRow]) -> tuple[bool, list[str]]:
    if not rows:
        return False, ["inventory_source_missing"]
    by_model = {r.model: r for r in rows}
    by_sku = {r.sku: r for r in rows}
    need: dict[str, int] = {}
    reasons = []
    for ax in cfg.axes:
        mot = loader.motors()[ax.motor_id]
        need[mot.model] = need.get(mot.model, 0) + 1
    for model, n in need.items():
        rec = by_model.get(model) or by_sku.get(model)
        if rec is None:
            reasons.append(f"motor_not_in_inventory:{model}")
            continue
        if not rec.approved:
            reasons.append(f"motor_not_approved:{model}")
        if rec.qty_available < n:
            reasons.append(f"insufficient_qty:{model}:need_{n}:have_{rec.qty_available}")
    return not reasons, reasons

from raedbots.catalog import loader
from raedbots.domain.models import ProjectRequirements, Workcell

def validate(req: ProjectRequirements, cell: Workcell):
    units = dict(workpiece_mass_kg="kg", tool_mass_override_kg="kg", payload_kg="kg", reach_m="m",
                 cycle_time_s="s", position_accuracy_mm="mm", repeatability_mm="mm", max_robot_mass_kg="kg", tcp_speed_m_s="m/s")
    for name, unit in units.items():
        q = getattr(req, name)
        if q is None:
            continue
        if abs(q.value)>1e6:
            raise ValueError(f"{name}: outside supported numeric range")
        if q.unit != unit:
            raise ValueError(f"{name}: expected {unit}; convert units before calculating")
        allow_zero = name in {"workpiece_mass_kg", "tool_mass_override_kg"}
        if q.value < 0 or (q.value == 0 and not allow_zero):
            raise ValueError(f"{name}: value must be {'nonnegative' if allow_zero else 'positive'}")
    if req.manufacturing_budget and (req.manufacturing_budget.value <= 0 or req.manufacturing_budget.unit != req.budget_currency):
        raise ValueError("Budget must be positive and use the selected currency")
    if not req.materials_allowed or any(m not in loader.materials() for m in req.materials_allowed):
        raise ValueError("Choose at least one material from the catalog")
    if req.locked_material_id and req.locked_material_id not in req.materials_allowed:
        raise ValueError("Locked material is outside allowed materials")
    if not req.processes_allowed or any(p not in {"cnc", "sheet"} for p in req.processes_allowed):
        raise ValueError("Unsupported manufacturing process")
    if len(req.locked_motor_ids) > 6 or any(m not in loader.motors() for m in req.locked_motor_ids):
        raise ValueError("Locked motor must be in the catalog (at most six axes)")
    for t in [req.locked_tool_id, req.second_tool_id, req.tool_choice if req.tool_choice != "auto" else None]:
        if t and t not in loader.tools():
            raise ValueError("Unknown end effector")
    if any(x <= 0 for x in cell.size_m):
        raise ValueError("Workcell dimensions must be positive")
    for group in [cell.task_poses, cell.obstacles]:
        ids = [x.id for x in group]
        if len(ids) != len(set(ids)) or any(not x for x in ids):
            raise ValueError("Task and obstacle IDs must be nonempty and unique")
    if any(p not in {t.id for t in cell.task_poses} for p in cell.path_ids):
        raise ValueError("Path refers to an unknown task pose")
    if cell.base_pose.frame != "world" or any(t.pose.frame != "world" for t in cell.task_poses) or any(o.pose.frame != "world" for o in cell.obstacles):
        raise ValueError("Workcell poses must use the world frame")

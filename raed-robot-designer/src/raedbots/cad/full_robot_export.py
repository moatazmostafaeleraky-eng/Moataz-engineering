from __future__ import annotations

from pathlib import Path
import math
import numpy as np

from raedbots.cad import occt_backend as oc
from raedbots.engineering.kinematics import fk_frames
from raedbots.engineering.math3d import T_from_pose
from raedbots.robot_geometry.full_design import GeometryDesign, dh_for_design
from raedbots.catalog import loader


def _frame_for_link(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    delta = b - a
    length = float(np.linalg.norm(delta))
    z = delta / length if length > 1e-10 else np.array([0.0, 0.0, 1.0])
    x = np.cross([0.0, 1.0, 0.0], z)
    if np.linalg.norm(x) < 1e-8:
        x = np.cross([1.0, 0.0, 0.0], z)
    x = x / np.linalg.norm(x)
    tr = np.eye(4)
    tr[:3, :3] = np.column_stack([x, np.cross(z, x), z])
    tr[:3, 3] = a
    return tr


def _hollow_box(width_mm: float, height_mm: float, length_mm: float, wall_mm: float):
    if wall_mm * 2 >= min(width_mm, height_mm):
        raise ValueError("wall thickness is too large for the link section")
    outer = oc.box(width_mm, height_mm, length_mm)
    inner = oc.box(width_mm - 2 * wall_mm, height_mm - 2 * wall_mm, max(length_mm - 2 * wall_mm, 0.1))
    inner_tr = np.eye(4)
    inner_tr[2, 3] = wall_mm
    return oc.cut(outer, oc.move(inner, inner_tr))


def build_full_robot_parts(design: GeometryDesign, tool_id: str, base_pose=None):
    if design.family_id not in loader.families():
        raise ValueError("Unknown robot family")
    if tool_id not in loader.tools():
        raise ValueError("Unknown end effector")
    rows = dh_for_design(design)
    base = T_from_pose(base_pose) if base_pose else np.eye(4)
    q = np.zeros(6)
    frames = fk_frames(rows, q, base)
    w = design.link_width_m * 1000.0
    h = design.link_height_m * 1000.0
    wall = design.wall_m * 1000.0
    parts = []

    base_shape = oc.box(design.base_size_m * 1000.0, design.base_size_m * 1000.0, 20.0)
    parts.append(("RB-BASE-001", base_shape, base))

    for i in range(6):
        a = frames[i][:3, 3]
        b = frames[i + 1][:3, 3]
        length_mm = max(float(np.linalg.norm(b - a)) * 1000.0, 35.0)
        link = _hollow_box(w, h, length_mm, wall)
        parts.append((f"RB-LINK-{i + 1:02d}-001", link, _frame_for_link(a, b)))
        radius = (design.shoulder_radius_m if i == 0 else design.elbow_radius_m) * 1000.0
        housing = oc.cylinder(radius, 70.0)
        housing_tr = frames[i + 1].copy()
        housing_tr[:3, 3] = frames[i + 1][:3, 3] - frames[i + 1][:3, 2] * 35.0
        parts.append((f"RB-J{i + 1}-HOUSING-001", housing, housing_tr))

    flange = oc.cylinder(40.0, 16.0)
    parts.append(("RB-TOOL-FLANGE-001", flange, frames[-1]))
    return parts


def export_full_robot(design: GeometryDesign, tool_id: str, out_dir: Path, base_pose=None) -> dict:
    out_dir = Path(out_dir)
    manufactured = out_dir / "Manufactured_Parts"
    assembly_dir = out_dir / "Assembly"
    manufactured.mkdir(parents=True, exist_ok=True)
    assembly_dir.mkdir(parents=True, exist_ok=True)

    parts = build_full_robot_parts(design, tool_id, base_pose)
    placed = []
    files = []
    for part_number, shape, transform in parts:
        placed_shape = oc.move(shape, np.block([[transform[:3, :3], (transform[:3, 3] * 1000.0).reshape(3, 1)], [np.zeros((1, 3)), np.ones((1, 1))]]))
        step = manufactured / f"{part_number}_A.step"
        stl = manufactured / f"{part_number}_A.stl"
        oc.export(placed_shape, step)
        oc.export(placed_shape, stl)
        files.extend([str(step.relative_to(out_dir)), str(stl.relative_to(out_dir))])
        placed.append(placed_shape)

    assembly_step = assembly_dir / "RAED-FULL-ROBOT-ASSY-001_A.step"
    assembly_stl = assembly_dir / "RAED-FULL-ROBOT-ASSY-001_A.stl"
    oc.export(oc.compound(placed), assembly_step)
    oc.export(oc.compound(placed), assembly_stl)
    files.extend([str(assembly_step.relative_to(out_dir)), str(assembly_stl.relative_to(out_dir))])
    (out_dir / "README.txt").write_text(
        "FULL ROBOT GEOMETRY PREVIEW. Units: millimetres.\n"
        "Parametric link and housing geometry generated from the selected design.\n"
        "Verify purchased interfaces, fits, tolerances, fasteners, FEA, dynamics and safety before manufacturing.\n",
        encoding="utf-8",
    )
    return {
        "files": files,
        "kind": "full_robot_parametric_preview",
        "backend": "OpenCascade compatibility adapter",
        "units": "mm",
        "part_count": len(parts),
        "assembly": str(assembly_step.relative_to(out_dir)),
        "manufacturing_approval": False,
    }

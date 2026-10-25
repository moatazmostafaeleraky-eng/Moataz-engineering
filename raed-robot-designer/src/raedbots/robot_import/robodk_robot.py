from __future__ import annotations

import hashlib
import json
import math
import struct
import tempfile
import zlib
import zipfile

import numpy as np

from raedbots.branding import DESIGNER, COPYRIGHT_NOTICE, COPYRIGHT_TEXT
import csv
from pathlib import Path
from typing import Any


def _read(fmt: str, data: bytes, cursor: list[int]):
    size = struct.calcsize(fmt)
    result = struct.unpack_from(fmt, data, cursor[0])
    cursor[0] += size
    return result


def _mesh_metrics(surfaces: list[dict[str, Any]]) -> dict[str, Any]:
    points: list[tuple[float, float, float]] = []
    area_m2 = 0.0
    triangle_count = 0
    colors: list[list[float]] = []
    for surface in surfaces:
        positions = surface["positions"]
        triangle_count += len(positions) // 9
        colors.append([round(float(x), 4) for x in surface["color"]])
        for i in range(0, len(positions), 9):
            a = tuple(float(x) for x in positions[i:i + 3])
            b = tuple(float(x) for x in positions[i + 3:i + 6])
            c = tuple(float(x) for x in positions[i + 6:i + 9])
            points.extend((a, b, c))
            ab = (b[0] - a[0], b[1] - a[1], b[2] - a[2])
            ac = (c[0] - a[0], c[1] - a[1], c[2] - a[2])
            cross = (
                ab[1] * ac[2] - ab[2] * ac[1],
                ab[2] * ac[0] - ab[0] * ac[2],
                ab[0] * ac[1] - ab[1] * ac[0],
            )
            area_m2 += 0.5 * (cross[0] ** 2 + cross[1] ** 2 + cross[2] ** 2) ** 0.5
    if not points:
        return {"surface_count": len(surfaces), "triangle_count": 0, "vertex_count": 0, "bbox_m": None, "envelope_dimensions_m": None, "surface_area_m2": 0.0, "colors": colors}
    mins = [min(p[i] for p in points) for i in range(3)]
    maxs = [max(p[i] for p in points) for i in range(3)]
    return {
        "surface_count": len(surfaces),
        "triangle_count": triangle_count,
        "vertex_count": len(points),
        "bbox_m": {"min": [round(x, 7) for x in mins], "max": [round(x, 7) for x in maxs]},
        "envelope_dimensions_m": [round(maxs[i] - mins[i], 7) for i in range(3)],
        "surface_area_m2": round(area_m2, 8),
        "colors": colors,
    }


def _positive_metadata(value: float) -> float | None:
    return float(value) if math.isfinite(value) and value > 0 else None


def build_actuator_market_screen(manifest: dict[str, Any]) -> dict[str, Any]:
    """Create an explicit evidence/screening report without guessing ABB parts."""
    from raedbots.catalog import loader

    catalog = loader.raw()
    motors = catalog.get("motors", [])
    gearboxes = catalog.get("gearboxes", [])
    axes = []
    for axis in range(1, 7):
        link = manifest["links"][min(axis, len(manifest["links"]) - 1)]
        axes.append({
            "axis": axis,
            "observed_motor_part": None,
            "observed_motor_status": "not_separable_or_named_in_robot_mesh",
            "observed_envelope_reference_m": link["metrics"]["envelope_dimensions_m"],
            "observed_evidence": "visual link mesh only; adjacent link envelope is not a motor envelope",
        })
    combinations = []
    for motor in motors:
        ms = motor.get("specs", {})
        for gearbox in gearboxes:
            gs = gearbox.get("specs", {})
            ratio = float(gs.get("ratio", 0) or 0)
            efficiency = float(gs.get("efficiency", 1.0) or 1.0)
            rated = ms.get("rated_torque_nm")
            peak = ms.get("peak_torque_nm")
            if not ratio or rated is None or peak is None:
                continue
            combinations.append({
                "motor_id": motor.get("id"), "motor": f"{motor.get('manufacturer')} {motor.get('model')}",
                "gearbox_id": gearbox.get("id"), "gearbox": f"{gearbox.get('manufacturer')} {gearbox.get('model')}",
                "ratio": ratio, "efficiency": efficiency,
                "estimated_output_rated_torque_nm": round(float(rated) * ratio * efficiency, 3),
                "estimated_output_peak_torque_nm": round(float(peak) * ratio * efficiency, 3),
                "motor_mass_kg": motor.get("mass_kg"), "gearbox_mass_kg": gearbox.get("mass_kg"),
                "status": "market_screening_candidate_not_identified_ABB_part",
            })
    return {
        "mode": "benchmark_market_screening",
        "abb_motor_identified": False,
        "abb_motor_reason": "The RoboDK .robot mesh has no separately named motor or gearbox records.",
        "axes": axes,
        "candidate_combinations": combinations,
        "catalog_version": catalog.get("version"),
    }


def parse_legacy_qcompress_robot(source: Path) -> dict[str, Any]:
    raw = source.read_bytes()
    if len(raw) < 8:
        raise ValueError("The .robot file is too small to be a recognized RoboDK asset")
    expected = struct.unpack_from(">I", raw, 0)[0]
    try:
        data = zlib.decompress(raw[4:])
    except zlib.error as exc:
        raise ValueError("Unsupported .robot container: expected RoboDK legacy qCompress/zlib data") from exc
    if expected != len(data):
        raise ValueError("RoboDK container length check failed")
    header = struct.unpack_from("<4000d", data)
    if header[:4] != (1, 4000, 20, 200):
        raise ValueError("Unsupported RoboDK .robot header; no safe parser is registered for this variant")
    name_chars = []
    for value in header[1800:1900]:
        if int(value) == 0:
            break
        if 0 <= int(value) < 128:
            name_chars.append(chr(int(value)))
    name = "".join(name_chars).strip() or source.stem
    cursor = [32000]
    link_count = _read("<Q", data, cursor)[0]
    if not 1 <= link_count <= 32:
        raise ValueError("Unsafe or unsupported link count in RoboDK .robot asset")
    links: list[dict[str, Any]] = []
    for link_index in range(link_count):
        surfaces: list[dict[str, Any]] = []
        surface_count = _read("<Q", data, cursor)[0]
        if surface_count > 10000:
            raise ValueError("Unsafe surface count in RoboDK .robot asset")
        for _ in range(surface_count):
            triangle_count = _read("<Q", data, cursor)[0]
            if triangle_count > 2_000_000:
                raise ValueError("Unsafe triangle count in RoboDK .robot asset")
            rgba = _read("<4f", data, cursor)
            positions: list[float] = []
            for _ in range(triangle_count * 3):
                xyz = _read("<3f", data, cursor)
                if not all(math.isfinite(x) and abs(x) < 10000 for x in xyz):
                    raise ValueError("Non-finite or out-of-range mesh coordinate")
                positions.extend(round(x / 1000.0, 7) for x in xyz)
                _read("<2B", data, cursor)
            surfaces.append({"color": list(rgba), "positions": positions})
        curves, clouds = _read("<2Q", data, cursor)
        if curves or clouds:
            raise ValueError("This safe converter only supports triangle surfaces")
        links.append({"name": f"Link {link_index + 1}", "surfaces": surfaces, "metrics": _mesh_metrics(surfaces)})
    if cursor[0] != len(data):
        raise ValueError("Unsupported trailing data in RoboDK .robot asset")

    mdh = [
        {"alpha": header[i], "a": header[i + 1] / 1000.0, "theta": header[i + 2], "d": header[i + 3] / 1000.0}
        for i in range(200, 320, 20)
    ]
    all_points = [point for link in links for surface in link["surfaces"] for point in zip(*[iter(surface["positions"])] * 3)]
    if all_points:
        robot_min = [min(float(point[i]) for point in all_points) for i in range(3)]
        robot_max = [max(float(point[i]) for point in all_points) for i in range(3)]
        robot_envelope = {
            "bbox_m": {"min": robot_min, "max": robot_max},
            "dimensions_m": [robot_max[i] - robot_min[i] for i in range(3)],
        }
    else:
        robot_envelope = {"bbox_m": None, "dimensions_m": None}
    payload_kg = _positive_metadata(header[100])
    reach_m = _positive_metadata(header[101] / 1000.0)
    mass_kg = _positive_metadata(header[103])
    metadata_warnings = []
    if payload_kg is None:
        metadata_warnings.append("payload_not_present_or_not_verified_in_robot_header")
    if reach_m is None:
        metadata_warnings.append("reach_not_present_or_not_verified_in_robot_header")
    if mass_kg is None:
        metadata_warnings.append("mass_not_present_or_not_verified_in_robot_header")
    return {
        "name": name,
        "source_filename": source.name,
        "source_sha256": hashlib.sha256(raw).hexdigest(),
        "units": "metres",
        "payload_kg": payload_kg,
        "reach_m": reach_m,
        "mass_kg": mass_kg,
        "metadata_warnings": metadata_warnings,
        "home": [0, 0, 0, 0, 0, 0],
        "mdh": mdh,
        "limits": [[math.radians(header[600 + i]), math.radians(header[620 + i])] for i in range(6)],
        "links": links,
        "robot_envelope": robot_envelope,
        "benchmark_mode": "detailed_reference_design",
        "cad_status": "reference_mesh_only",
        "cad_kind": "faceted_surface_not_solid",
        "manufacturing_cad_present": False,
        "scope": "Authorized RoboDK reference import. Kinematics and available visual meshes only; no hidden internal CAD inferred.",
    }


def home_pose_frames(mdh: list[dict[str, float]]) -> list[np.ndarray]:
    """Modified-DH link frames at home (all joints zero), base frame first; metres."""
    def rot_x(a):
        c, s_ = math.cos(a), math.sin(a)
        return np.array([[1, 0, 0, 0], [0, c, -s_, 0], [0, s_, c, 0], [0, 0, 0, 1.0]])

    def rot_z(a):
        c, s_ = math.cos(a), math.sin(a)
        return np.array([[c, -s_, 0, 0], [s_, c, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1.0]])

    def move(x, z):
        t = np.eye(4)
        t[0, 3], t[2, 3] = x, z
        return t

    frames = [np.eye(4)]
    for row in mdh:
        frames.append(frames[-1] @ rot_x(row["alpha"]) @ move(row["a"], 0) @ rot_z(row["theta"]) @ move(0, row["d"]))
    return frames


def export_reference_robot(source: Path, output_dir: Path, smooth: bool = False, smooth_tol_mm: float = 0.25) -> dict[str, Any]:
    from raedbots.cad import occt_backend as oc
    from raedbots.cad.mesh_solid import mesh_to_solid

    output_dir.mkdir(parents=True, exist_ok=True)
    manifest = parse_legacy_qcompress_robot(source)
    frames = home_pose_frames(manifest["mdh"])
    actuator_screen = build_actuator_market_screen(manifest)
    parts_dir = output_dir / "Reference_Parts"
    parts_dir.mkdir(parents=True, exist_ok=True)
    placed = []
    files: list[str] = []
    solid_reports = []
    skipped_links = []
    for index, link in enumerate(manifest["links"], start=1):
        part_number = f"ROBDK-LINK-{index:02d}"
        local = np.asarray([
            point
            for surface in link["surfaces"]
            for point in surface["positions"]
        ], dtype=np.float64).reshape(-1, 3)
        # RoboDK stores each body in its own joint frame; place it in the home pose
        # so the parts assemble into the robot (and can feed the STEP -> RoboDK builder).
        frame = frames[index - 1] if index - 1 < len(frames) else np.eye(4)
        positions = (local @ frame[:3, :3].T + frame[:3, 3]).reshape(-1).tolist()
        try:
            shape, report = mesh_to_solid(positions, part_name=part_number, smooth=smooth, smooth_tol_mm=smooth_tol_mm)
        except ValueError as exc:
            # One unrecoverable visual mesh must not discard the other validated links.
            solid_reports.append({"part": part_number, "status": "reconstruction_failed", "solid_count": 0, "error": str(exc)})
            skipped_links.append({"part": part_number, "reason": str(exc)})
            continue
        solid_reports.append({"part": part_number, **report})
        if not report["solid_count"]:
            skipped_links.append({"part": part_number, "reason": report["status"]})
            continue
        step = parts_dir / f"{part_number}.step"
        oc.export(shape, step)
        placed.append(shape)
        files.append(str(step.relative_to(output_dir)))
    assembly = output_dir / "ROBDK-REFERENCE-ASSEMBLY.step"
    if not placed:
        raise ValueError("No RoboDK link could be converted to a validated solid: "
                         + "; ".join(item["reason"] for item in skipped_links))
    oc.export(oc.compound(placed), assembly)
    files.append(str(assembly.relative_to(output_dir)))
    manifest["files"] = files
    manifest["part_count"] = len(placed)
    manifest["solid_reports"] = solid_reports
    manifest["skipped_links"] = skipped_links
    manifest["cad_status"] = "reconstructed_validated_solids"
    smooth_parts = [r["part"] for r in solid_reports if r.get("surface") == "smooth"]
    manifest["smooth_surface_parts"] = smooth_parts
    manifest["cad_kind"] = ("reverse_engineered_smooth_brep" if smooth and len(smooth_parts) == len(placed)
                            else "occt_brep_solids_from_closed_triangle_mesh")
    manifest["placement"] = "home_pose_world_frame_from_modified_dh"
    manifest["smooth_tolerance_mm"] = smooth_tol_mm if smooth else None
    manifest["stl_exported"] = False
    manifest["designed_by"] = DESIGNER
    manifest["copyright_notice"] = COPYRIGHT_NOTICE
    # Raw triangle coordinates are already in the STEP files; keep the report readable.
    manifest["links"] = [{"name": link["name"], "metrics": link["metrics"]} for link in manifest["links"]]
    (output_dir / "robot-import-report.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    (output_dir / "actuator-market-screen.json").write_text(json.dumps(actuator_screen, ensure_ascii=False, indent=2), encoding="utf-8")
    with (output_dir / "actuator-market-screen.csv").open("w", newline="", encoding="utf-8-sig") as handle:
        rows = actuator_screen["candidate_combinations"]
        if rows:
            writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
            writer.writeheader()
            writer.writerows(rows)
    (output_dir / "README.txt").write_text(
        "AUTHORIZED ROBODK REFERENCE IMPORT\n"
        "The STEP files are validated BREP solids reconstructed from available closed RoboDK triangle meshes.\n"
        "Open or non-manifold links may use VTK implicit-surface reconstruction; see solid_reports in robot-import-report.json.\n"
        "All parts are placed in the robot's home pose (world frame, mm) from the file's modified DH chain, so they assemble in place.\n"
        "With smooth surfaces enabled, each link is reverse-engineered into planes, cylinders, cones, spheres and NURBS plates\n"
        "within 0.1 mm of the mesh; a link whose smooth result does not validate keeps its faceted solid (see 'surface' per part).\n"
        "They are mesh-derived solids, not the manufacturer's native CAD or design-intent feature trees.\n"
        "Surface reconstruction may smooth or close gaps in the visual mesh and is not manufacturing-accurate CAD.\n"
        "actuator-market-screen.* contains market-screening combinations from the local catalog; these are not identified ABB components.\n"
        "They do not expose hidden motor, reducer, bearing, tolerance or material details.\n"
        "STL files are intentionally not included in this solid-only export.\n"
        "Use only files you are authorized to inspect and redistribute. Verify licensing and supplier/manufacturer permissions.\n"
        f"{COPYRIGHT_NOTICE}. All rights reserved.\n",
        encoding="utf-8",
    )
    (output_dir / "COPYRIGHT.txt").write_text(COPYRIGHT_TEXT, encoding="utf-8")
    return manifest


def make_import_zip(source: Path, output_zip: Path, smooth: bool = False, smooth_tol_mm: float = 0.25) -> dict[str, Any]:
    with tempfile.TemporaryDirectory(prefix="raed-robodk-import-") as tmp:
        root = Path(tmp) / "ROBDK-REFERENCE-IMPORT"
        manifest = export_reference_robot(source, root, smooth=smooth, smooth_tol_mm=smooth_tol_mm)
        with zipfile.ZipFile(output_zip, "w", zipfile.ZIP_DEFLATED) as archive:
            for path in root.rglob("*"):
                if path.is_file():
                    archive.write(path, path.relative_to(root))
    return manifest

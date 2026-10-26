"""Convert an STL part into a validated STEP solid: faceted, smooth or feature CAD."""
from __future__ import annotations

import json
import tempfile
import zipfile
from pathlib import Path
from typing import Any

import numpy as np

MODES = ("faceted", "smooth", "feature")


def load_stl(path: Path, units_mm: float = 1.0) -> tuple[np.ndarray, np.ndarray]:
    """Vertices (mm) and faces of an ASCII or binary STL; ``units_mm`` is the size of one file unit."""
    import trimesh

    mesh = trimesh.load(str(path), file_type="stl", force="mesh", process=True)
    if not len(mesh.faces):
        raise ValueError("The STL file contains no triangles")
    return np.asarray(mesh.vertices, float) * units_mm, np.asarray(mesh.faces, int)


def convert_stl(source: Path, output_zip: Path, *, mode: str = "feature", units_mm: float = 1.0,
                smooth_tol_mm: float = 0.25) -> dict[str, Any]:
    from raedbots.cad import occt_backend as oc
    from raedbots.cad.mesh_solid import mesh_to_solid

    if mode not in MODES:
        raise ValueError(f"mode must be one of {', '.join(MODES)}")
    vertices, faces = load_stl(source, units_mm)
    name = Path(source).stem
    positions = (vertices[faces] / 1000.0).reshape(-1).tolist()      # mesh_to_solid takes metres
    shape, report = mesh_to_solid(positions, part_name=name, smooth=mode == "smooth", smooth_tol_mm=smooth_tol_mm,
                                  feature=mode == "feature")
    report = {"source": Path(source).name, "requested_mode": mode, "units_mm_per_file_unit": units_mm,
              "triangles_in": len(faces), **report}
    with tempfile.TemporaryDirectory(prefix="raed-stl-") as tmp:
        root = Path(tmp)
        oc.export(shape, root / f"{name}.step")
        (root / "conversion-report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2, default=float),
                                                     encoding="utf-8")
        (root / "README.txt").write_text(
            "STL -> STEP conversion\n"
            f"Requested surface mode: {mode}; delivered: {report.get('surface')}.\n"
            "faceted - one planar face per triangle (exact copy of the mesh).\n"
            "smooth  - planes, cylinders, cones, spheres and NURBS fitted to the mesh; triangles kept where it is too coarse.\n"
            "feature - rebuilt from ordinary CAD features (extruded outlines, revolves, bores): every face is a plane,\n"
            "          cylinder, cone, sphere or torus, no triangles. Deviation from the mesh is in conversion-report.json.\n"
            "The mesh carries the external form only; wall thickness, internal features and tolerances are not inferred.\n",
            encoding="utf-8")
        with zipfile.ZipFile(output_zip, "w", zipfile.ZIP_DEFLATED) as archive:
            for path in root.iterdir():
                archive.write(path, path.name)
    return report

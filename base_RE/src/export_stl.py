"""Write a watertight STL from the generated STEP model (OCC tessellation).

Run from base_RE/ after building the STEP model:  python src/export_stl.py
"""

from pathlib import Path

import build123d as bd
import trimesh

ROOT = Path(__file__).resolve().parent.parent

shape = bd.import_step(ROOT / "STEP" / "base.step")
out = ROOT / "STL" / "base.stl"
bd.export_stl(shape, str(out), tolerance=0.005, angular_tolerance=0.1)
mesh = trimesh.load(out)
mesh.merge_vertices(digits_vertex=4)
mesh.update_faces(mesh.nondegenerate_faces())
mesh.remove_unreferenced_vertices()
if not mesh.is_watertight:  # OCC can leave a pinhole where a revolve meets its axis; the B-rep is valid
    trimesh.repair.fill_holes(mesh)
assert mesh.is_watertight, f"{out} is not watertight"
mesh.export(out)
print(f"wrote {out.relative_to(ROOT)}: {len(mesh.faces)} faces, watertight, volume {mesh.volume:.2f} mm3")

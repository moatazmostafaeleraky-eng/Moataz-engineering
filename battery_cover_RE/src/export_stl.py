"""Write watertight STL files from the generated STEP models (OCC tessellation).

Run from battery_cover_RE/ after building the STEP models:  python src/export_stl.py
cadgen's @stl mesher left open edges on this part, so STLs are written here with
an absolute 0.005 mm chord tolerance and verified watertight.
"""

from pathlib import Path

import build123d as bd
import trimesh

ROOT = Path(__file__).resolve().parent.parent

for name in ("battery_cover", "battery_cover_as_measured"):
    shape = bd.import_step(ROOT / "STEP" / f"{name}.step")
    out = ROOT / "STL" / f"{name}.stl"
    bd.export_stl(shape, str(out), tolerance=0.005, angular_tolerance=0.1)
    mesh = trimesh.load(out)
    mesh.merge_vertices(digits_vertex=5)
    assert mesh.is_watertight, f"{out} is not watertight"
    print(f"wrote {out.relative_to(ROOT)}: {len(mesh.faces)} faces, watertight, volume {mesh.volume:.2f} mm3")

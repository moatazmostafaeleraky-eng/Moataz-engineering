"""Compare the rebuilt rear case against the source mesh.

Run from base_RE/:  python checks/deviation.py
Reports B-rep validity, volume/area, topology and two-way surface deviation, plus where the
largest deviations are (so the exceptions can be listed honestly in REPORT.md).
"""

import json
import sys

import numpy as np
import trimesh
from cadgen import read_step

SRC = "source/base.STL"
STEP = "STEP/base.step"
STL = "STL/base.stl"
N = 120000


def one_way(a: trimesh.Trimesh, b: trimesh.Trimesh):
    pts, fi = trimesh.sample.sample_surface_even(a, N, seed=0)
    _, d, _ = trimesh.proximity.closest_point(b, pts)
    return pts, d


def stats(d):
    return {
        "mean": float(d.mean()),
        "p95": float(np.percentile(d, 95)),
        "p99": float(np.percentile(d, 99)),
        "max": float(d.max()),
        "within_0.02mm_%": float((d <= 0.02).mean() * 100),
        "within_0.05mm_%": float((d <= 0.05).mean() * 100),
        "within_0.10mm_%": float((d <= 0.10).mean() * 100),
    }


def clusters(pts, d, thr=0.1, cell=3.0):
    """Group samples deviating more than `thr` into 3 mm cells; largest groups first."""
    bad = d > thr
    if not bad.any():
        return []
    keys = np.floor(pts[bad] / cell).astype(int)
    uniq, inv, cnt = np.unique(keys, axis=0, return_inverse=True, return_counts=True)
    out = []
    for k in np.argsort(-cnt)[:12]:
        sel = inv.ravel() == k
        p = pts[bad][sel]
        out.append({"samples": int(cnt[k]), "centre": np.round(p.mean(0), 1).tolist(),
                    "max_mm": round(float(d[bad][sel].max()), 3)})
    return out


src = trimesh.load(SRC)
report = {"source": {"volume_mm3": float(src.volume), "area_mm2": float(src.area), "extents": src.extents.tolist(),
                     "watertight": bool(src.is_watertight), "euler": int(src.euler_number)}}

shape = read_step(STEP)
bb = shape.bounding_box()
brep = {"solids": len(shape.solids()), "valid": bool(shape.is_valid), "volume_mm3": float(shape.volume),
        "area_mm2": float(shape.area), "faces": len(shape.faces()),
        "bbox": [[round(bb.min.X, 3), round(bb.min.Y, 3), round(bb.min.Z, 3)],
                 [round(bb.max.X, 3), round(bb.max.Y, 3), round(bb.max.Z, 3)]]}
mesh = trimesh.load(STL)
mesh.merge_vertices(digits_vertex=4)
brep["mesh_watertight"] = bool(mesh.is_watertight)
brep["volume_delta_%"] = 100 * (brep["volume_mm3"] - src.volume) / src.volume
p1, d1 = one_way(src, mesh)  # source -> model (missing material / features)
p2, d2 = one_way(mesh, src)  # model -> source (extra material)
brep["dev_source_to_model"] = stats(d1)
brep["dev_model_to_source"] = stats(d2)
brep["hausdorff_mm"] = float(max(d1.max(), d2.max()))
brep["worst_regions_source_to_model"] = clusters(p1, d1)
brep["worst_regions_model_to_source"] = clusters(p2, d2)
np.save("checks/_dev_src.npy", np.c_[p1, d1])
np.save("checks/_dev_model.npy", np.c_[p2, d2])
report["model"] = brep

json.dump(report, open("checks/deviation_report.json", "w"), indent=2)
print(json.dumps(report, indent=2))
sys.exit(0 if brep["valid"] and brep["solids"] == 1 else 1)

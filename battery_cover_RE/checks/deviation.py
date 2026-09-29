"""Compare the rebuilt models against the source mesh.

Run from battery_cover_RE/:  python checks/deviation.py
Reports B-rep validity, volume/area, topology and two-way surface deviation.
"""

import json
import sys

import numpy as np
import trimesh
from cadgen import read_step

SRC = "source/battery_cover_original.stl"
MODELS = {
    "design_intent": ("STEP/battery_cover.step", "STL/battery_cover.stl"),
    "as_measured": ("STEP/battery_cover_as_measured.step", "STL/battery_cover_as_measured.stl"),
}
N = 60000
rng = np.random.default_rng(0)


def contains(m: trimesh.Trimesh, pts, batch=4000):
    return np.concatenate([m.contains(pts[i:i + batch]) for i in range(0, len(pts), batch)])


def one_way(a: trimesh.Trimesh, b: trimesh.Trimesh, drop_internal=False):
    pts, fi = trimesh.sample.sample_surface_even(a, N, seed=0)
    _, d, _ = trimesh.proximity.closest_point(b, pts)
    if drop_internal:  # samples with material on both sides lie on unfused internal faces
        cand = np.flatnonzero(d > 0.05)
        n = a.face_normals[fi[cand]]
        internal = contains(a, pts[cand] + 0.02 * n) & contains(a, pts[cand] - 0.02 * n)
        keep = np.ones(len(pts), bool)
        keep[cand[internal]] = False
        return pts[keep], d[keep], pts[cand[internal]]
    return pts, d, None


def stats(d):
    return {
        "mean": float(d.mean()),
        "p95": float(np.percentile(d, 95)),
        "p99": float(np.percentile(d, 99)),
        "max": float(d.max()),
        "within_0.05mm_%": float((d <= 0.05).mean() * 100),
        "within_0.10mm_%": float((d <= 0.10).mean() * 100),
    }


src = trimesh.load(SRC)
src_raw, src_volume = src, src.volume
report = {"source": {"volume_mm3": src_volume, "area_mm2": src_raw.area, "extents": src.extents.tolist(),
                     "watertight": bool(src_raw.is_watertight), "euler": int(src_raw.euler_number)}}
for name, (step_path, stl_path) in MODELS.items():
    shape = read_step(step_path)
    solids = shape.solids()
    brep = {"solids": len(solids), "valid": bool(shape.is_valid), "volume_mm3": float(shape.volume),
            "area_mm2": float(shape.area), "faces": len(shape.faces())}
    bb = shape.bounding_box()
    brep["bbox"] = [[round(bb.min.X, 3), round(bb.min.Y, 3), round(bb.min.Z, 3)],
                    [round(bb.max.X, 3), round(bb.max.Y, 3), round(bb.max.Z, 3)]]
    mesh = trimesh.load(stl_path)
    mesh.merge_vertices(digits_vertex=5)
    brep["mesh_watertight"] = bool(mesh.is_watertight)
    brep["mesh_euler"] = int(mesh.euler_number)  # source = 0 -> one through-opening (genus 1)
    brep["volume_delta_%"] = 100 * (brep["volume_mm3"] - src_volume) / src_volume
    p1, d1, internal = one_way(src, mesh, drop_internal=True)   # source -> model
    p2, d2, _ = one_way(mesh, src)   # model -> source
    brep["source_internal_samples_excluded"] = {
        "note": "coincident faces where the right hook leg touches the plate without being fused",
        "count": int(len(internal)),
        "bbox": np.round([internal.min(0), internal.max(0)], 2).tolist() if len(internal) else None,
    }
    brep["dev_source_to_model"] = stats(d1)
    brep["dev_model_to_source"] = stats(d2)
    brep["hausdorff_mm"] = float(max(d1.max(), d2.max()))
    # where are the worst points?
    worst = p1[np.argsort(d1)[-5:]]
    brep["worst_src_points"] = np.round(worst, 2).tolist()
    np.save(f"checks/_dev_{name}.npy", np.c_[p1, d1])
    report[name] = brep

json.dump(report, open("checks/deviation_report.json", "w"), indent=2)
print(json.dumps(report, indent=2))
ok = all(report[n]["valid"] and report[n]["solids"] == 1 for n in MODELS)
sys.exit(0 if ok else 1)

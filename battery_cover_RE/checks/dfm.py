"""Injection-moulding DFM checks on the design-intent model.

Run from battery_cover_RE/:  python checks/dfm.py
Pull direction is +/-Y (plate normal). Reports draft, undercuts, wall thickness
and part mass for candidate resins.
"""

import json

import numpy as np
import trimesh

m = trimesh.load("STL/battery_cover.stl")
m.merge_vertices(digits_vertex=5)
ray = trimesh.ray.ray_triangle.RayMeshIntersector(m)
n, c, A = m.face_normals, m.triangles_center, m.area_faces
PULL = np.array([0.0, 1.0, 0.0])
EPS = 1e-3


def escapes(origins, direction):
    d = np.tile(direction, (len(origins), 1))
    hit = np.zeros(len(origins), bool)
    for i in range(0, len(origins), 3000):
        hit[i:i + 3000] = ray.intersects_any(origins[i:i + 3000], d[i:i + 3000])
    return ~hit


def region(pt):
    x, y, z = pt
    if z < 11.5 or (12.5 <= x <= 18.5 and z < 20 and y < 18.2):
        return "snap latch"
    if 68 <= z <= 76 and y > 19.9:
        return "outer bumps"
    if 68 <= z <= 75.6 and 12 <= x <= 19 and y < 18.2:
        return "retention hook"
    if (5 <= x <= 8 or 23 <= x <= 27) and 69 <= z <= 75 and y < 21.1:
        return "bump coring"
    if z >= 75.4 and y < 18.2:
        return "top lip"
    if (x <= 1.01 or x >= 29.99) and y < 18.2:
        return "side rails"
    if (6.5 <= x <= 7.5 or 23.5 <= x <= 24.5) and 26 <= z <= 57 and y < 18.2:
        return "stiffening ribs"
    if np.hypot(x - 15.5, z - 11.5) <= 8.5:
        return "thumb recess"
    return "plate perimeter"


report = {}

# ---- draft: faces parallel to the pull (|n.Y| < sin 0.25 deg), excluding the part's outer perimeter walls
ny = n @ PULL
vertical = np.abs(ny) < np.sin(np.radians(0.25))
by_region = {}
for pt, a in zip(c[vertical], A[vertical]):
    k = region(pt)
    by_region[k] = by_region.get(k, 0.0) + a
report["zero_draft_area_mm2"] = {k: round(v, 1) for k, v in sorted(by_region.items(), key=lambda t: -t[1])}
report["zero_draft_total_mm2"] = round(float(A[vertical].sum()), 1)

# ---- undercuts: a face must see open space along its side of the pull
up = ny > 1e-3
down = ny < -1e-3
blocked = np.zeros(len(n), bool)
blocked[up] = ~escapes(c[up] + EPS * n[up], PULL)
blocked[down] = ~escapes(c[down] + EPS * n[down], -PULL)
vi = np.flatnonzero(vertical)
o = c[vi] + EPS * n[vi]
blocked[vi] = ~escapes(o, PULL) & ~escapes(o, -PULL)
uc = {}
for pt, a in zip(c[blocked], A[blocked]):
    k = region(pt)
    uc.setdefault(k, [0.0, [np.inf] * 3, [-np.inf] * 3])
    uc[k][0] += a
    uc[k][1] = np.minimum(uc[k][1], pt).tolist()
    uc[k][2] = np.maximum(uc[k][2], pt).tolist()
report["undercuts"] = {k: {"area_mm2": round(v[0], 2), "bbox_min": np.round(v[1], 2).tolist(),
                           "bbox_max": np.round(v[2], 2).tolist()} for k, v in uc.items()}

# ---- wall thickness: inward ray from surface samples
pts, fi = trimesh.sample.sample_surface_even(m, 6000, seed=1)
inward = -m.face_normals[fi]
loc, idx, _ = ray.intersects_location(pts + EPS * inward, inward, multiple_hits=False)
t = np.full(len(pts), np.nan)
t[idx] = np.linalg.norm(loc - pts[idx], axis=1)
by = {}
for p, v in zip(pts, t):
    if np.isfinite(v):
        by.setdefault(region(p), []).append(v)
report["wall_thickness_note"] = ("inward-normal ray cast; p10/median = section thickness, "
                                 "p90 includes rays running along rib/rail height (e.g. rib tip -> plate outer = 4.0)")
report["wall_thickness_mm"] = {k: {"p10": round(float(np.percentile(v, 10)), 2),
                                   "median": round(float(np.median(v)), 2),
                                   "p90": round(float(np.percentile(v, 90)), 2)} for k, v in by.items()}

# ---- mass
vol_cm3 = m.volume / 1000
report["volume_cm3"] = round(vol_cm3, 3)
report["mass_g"] = {r: round(vol_cm3 * rho, 2) for r, rho in
                    {"ABS (1.05)": 1.05, "PC/ABS (1.15)": 1.15, "PC (1.20)": 1.20, "PP (0.905)": 0.905}.items()}
report["projected_area_Y_cm2"] = round(float(A[ny > 0].dot(ny[ny > 0])) / 100, 2)

json.dump(report, open("checks/dfm_report.json", "w"), indent=2)
print(json.dumps(report, indent=2))

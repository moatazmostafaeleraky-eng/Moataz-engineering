"""DFM analysis of the rear case (ANRMTPT0002F): as-received model vs the DFM-corrected model.

Run from base_RE/ (after `python src/base_dfm.py` has written output/part_DFM.step):
    python dfm/run_dfm.py            # analysis + figures + output/dfm_summary.json + output/DFM.pptx

Reuses battery_cover_RE/dfm/meshkit.py, mold_calcs.py and battery_cover_RE/checks/dfm.py (undercut test).
All numbers are measured on the models or hand calculations with typical ABS datasheet values.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import trimesh  # noqa: E402

HERE = Path(__file__).resolve().parent
PROJ = HERE.parent
REPO = PROJ.parent
sys.path[:0] = [str(HERE), str(REPO / "battery_cover_RE" / "dfm"), str(REPO / "battery_cover_RE" / "checks"),
                str(PROJ / "src")]

import meshkit as mk  # noqa: E402
import mold_calcs as mc  # noqa: E402
import vtkview as vv  # noqa: E402
from dfm import undercut_mask  # noqa: E402  (battery_cover_RE/checks/dfm.py)
from export_stl import close_cracks, mesh_shape  # noqa: E402

IN_STEP = PROJ / "STEP" / "base.step"
OUT_STEP = PROJ / "output" / "part_DFM.step"
OUT = PROJ / "output"
FIG = OUT / "figures"
WALL = 2.0
Y_PL = 4.34
TEETH_Z = [(6.66, 10.66), (40.66, 44.66), (74.66, 78.66), (112.46, 116.46), (146.64, 150.64)]
TOOTH = {"protrusion": 1.0, "height": 1.5, "length": 4.0, "lead_in_deg": 45, "catch_face_Y": 5.84}
LIFTER_CLEAR = 0.5
LIFTER_ANGLE = 8.0
GATES = {
    "G1": ("Side gate at PL, top end", (26.12, Y_PL + 0.3, 153.9)),
    "G2": ("Side gate at PL, side wall mid-length", (0.62, Y_PL + 0.3, 92.0)),
    "G3": ("Sub gate on inner side wall, mid-length", (2.62, Y_PL + 1.2, 92.0)),
    "G4": ("Sub gate on inner side wall, bottom end", (2.62, Y_PL + 1.2, 28.0)),
}
GATE_PICK = "G3"
CAVITIES = 2


def load(path):
    import build123d as bd

    shape = bd.import_step(str(path))
    m, _ = mesh_shape(shape, tol=0.01, ang=0.2)
    close_cracks(m)
    return shape, m


def region(p):
    x, y, z = p
    if y < 6.0 and (x < 3.8 or x > 48.4) and any(a - 0.2 <= z <= b + 0.2 for a, b in TEETH_Z):
        return "PL catch teeth"
    if x < 0.8 or x > 51.45:
        return "outer side walls"
    if z > 151.3:
        return "top end (wall, rim, tongue)"
    if z < 5.0:
        return "bottom end"
    if 2.55 < x < 2.75 or 49.5 < x < 49.7:
        return "inner side walls"
    if 10.5 < x < 41.75 and 86 < z < 151.5:
        return "battery bay"
    return "ribs, plates, blocks"


def signed_draft(m):
    ny = m.face_normals[:, 1]
    return np.degrees(np.arcsin(np.clip(np.abs(ny), 0, 1))) * np.sign(ny)


def draft_rgb(m):
    """Reference legend: +0.5 deg and up magenta (cavity), 0 green, -0.5 and below blue (core)."""
    s = np.clip(signed_draft(m) / 0.5, -1, 1)
    mag, grn, blu = np.array([0.85, 0.1, 0.85]), np.array([0.24, 0.75, 0.24]), np.array([0.15, 0.3, 0.95])
    t = np.abs(s)[:, None]
    return np.where(s[:, None] >= 0, grn * (1 - t) + mag * t, grn * (1 - t) + blu * t)


def gaps(m, n=40000, seed=7):
    ray = trimesh.ray.ray_triangle.RayMeshIntersector(m)
    p, fi = trimesh.sample.sample_surface_even(m, n, seed=seed)
    nn = m.face_normals[fi]
    loc, idx, _ = ray.intersects_location(p + 1e-3 * nn, nn, multiple_hits=False)
    g = np.full(len(p), np.inf)
    g[idx] = np.linalg.norm(loc - p[idx], axis=1)
    return p, nn, g


def projected_area(m, step=0.25):
    ray = trimesh.ray.ray_triangle.RayMeshIntersector(m)
    lo, hi = m.bounds
    xs, zs = np.arange(lo[0], hi[0], step) + step / 2, np.arange(lo[2], hi[2], step) + step / 2
    X, Z = np.meshgrid(xs, zs)
    o = np.c_[X.ravel(), np.full(X.size, hi[1] + 5), Z.ravel()]
    hit = ray.intersects_any(o, np.tile([0, -1.0, 0], (len(o), 1)))
    return float(hit.sum() * step * step)


def cluster_boxes(pts, cell=4.0, min_n=3):
    k = np.floor(pts / cell).astype(int)
    u, inv, cnt = np.unique(k, axis=0, return_inverse=True, return_counts=True)
    out = []
    for i in np.flatnonzero(cnt >= min_n):
        s = pts[inv.ravel() == i]
        out.append((s.min(0), s.max(0), int(cnt[i])))
    return out


def weld_edges(m, dist, dihedral_max=25.0, opp_deg=130.0):
    """Mesh edges where the flow fronts meet: face gradients of the arrival time point towards each other."""
    tri = m.vertices[m.faces]
    dv = dist[m.faces]
    e1, e2 = tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0]
    nrm = np.cross(e1, e2)
    nn = (nrm ** 2).sum(1)
    d1, d2 = dv[:, 1] - dv[:, 0], dv[:, 2] - dv[:, 0]
    grad = (np.cross(nrm, e2) * d1[:, None] + np.cross(e1, nrm) * d2[:, None]) / (nn[:, None] + 1e-12)
    fa = m.face_adjacency
    ga, gb = grad[fa[:, 0]], grad[fa[:, 1]]
    cos = (ga * gb).sum(1) / (np.linalg.norm(ga, axis=1) * np.linalg.norm(gb, axis=1) + 1e-12)
    flat = np.degrees(m.face_adjacency_angles) < dihedral_max
    sel = flat & (cos < np.cos(np.radians(opp_deg)))
    return m.vertices[m.face_adjacency_edges[sel]]


def main():
    FIG.mkdir(parents=True, exist_ok=True)
    S = {"part": {"code": "ANRMTPT0002F", "name": "REAR CASE", "assembly": "ANRMTAS0001F Remote control assy",
                  "model": "TE-12XCME", "material": "ABS (assumed: not specified on the drawing)",
                  "shrinkage": 1.005, "pull": "Y", "parting_line_Y": Y_PL}}
    import pickle

    P = {}
    for key, path in (("input", IN_STEP), ("dfm", OUT_STEP)):
        shape, m = load(path)
        P[key] = {"shape": shape, "mesh": m}
        print(f"[{key}] mesh {len(m.faces)} faces, watertight {m.is_watertight}", flush=True)

    # ------------------------------------------------ geometry, draft, undercut, thickness (cached per STEP file)
    for key, D in P.items():
        path = IN_STEP if key == "input" else OUT_STEP
        cache = OUT / f"_cache_{key}.pkl"
        stamp = (path.stat().st_mtime, path.stat().st_size)
        if cache.exists():
            c = pickle.loads(cache.read_bytes())
            if c["stamp"] == stamp:
                for k in ("fine", "uc", "th_pts", "th", "gap"):
                    D[k] = c[k]
                S[key] = c["st"]
                print(f"[{key}] analysis from cache", flush=True)
                continue
        m = D["mesh"]
        st = mk.brep_stats(D["shape"])
        d = mk.draft_deg(m)
        A = m.area_faces
        bins = [(0, 0.25), (0.25, 1.0), (1.0, 3.0), (3.0, 80.0), (80.0, 90.01)]
        st["draft_area_mm2"] = {f"{a}-{b}": round(float(A[(d >= a) & (d < b)].sum()), 1) for a, b in bins}
        zero = d < 0.25
        by = {}
        for c, a in zip(m.triangles_center[zero], A[zero]):
            by[region(c)] = by.get(region(c), 0.0) + a
        st["zero_draft_by_region_mm2"] = {k: round(v, 1) for k, v in sorted(by.items(), key=lambda t: -t[1])}
        fine = trimesh.Trimesh(*trimesh.remesh.subdivide_to_size(m.vertices, m.faces, max_edge=1.2), process=True)
        uc = undercut_mask(fine)
        D["fine"], D["uc"] = fine, uc
        st["undercut_area_mm2"] = round(float(fine.area_faces[uc].sum()), 2)
        ucr = {}
        for c, a in zip(fine.triangles_center[uc], fine.area_faces[uc]):
            ucr[region(c)] = ucr.get(region(c), 0.0) + a
        st["undercut_by_region_mm2"] = {k: round(v, 2) for k, v in sorted(ucr.items(), key=lambda t: -t[1])}
        cc = fine.triangles_center[uc]
        zone = np.array([any(a - 1 <= z <= b + 1 for a, b in TEETH_Z) for z in cc[:, 2]]) & ((cc[:, 0] < 6) | (cc[:, 0] > 46))
        st["undercut_lifter_zones_mm2"] = round(float(fine.area_faces[uc][zone].sum()), 2)
        st["undercut_outside_lifter_zones_mm2"] = round(float(fine.area_faces[uc][~zone].sum()), 2)
        pts, th = mk.sample_thickness(m, n=30000)
        D["th_pts"], D["th"] = pts, th
        st["thickness_mm"] = {"min_0.5pct": round(float(np.percentile(th, 0.5)), 2),
                              "p5": round(float(np.percentile(th, 5)), 2), "median": round(float(np.median(th)), 2),
                              "p95": round(float(np.percentile(th, 95)), 2),
                              "max_99.5pct": round(float(np.percentile(th, 99.5)), 2)}
        edges = [0, 0.6, 0.9, 1.1, 1.4, 1.8, 2.2, 2.6, 3.0, 7.0]
        h, _ = np.histogram(th, bins=edges)
        st["thickness_hist"] = {"edges": edges, "pct": [round(100 * x / len(th), 1) for x in h]}
        thick = pts[th > 2.6]
        st["thick_spots"] = [{"min": np.round(a, 1).tolist(), "max": np.round(b, 1).tolist(), "n": n}
                             for a, b, n in cluster_boxes(thick, 6.0, 2)]
        gp, gn, gg = gaps(m)
        D["gap"] = (gp, gn, gg)
        weak = (gg < 0.8) & (gp[:, 1] > 5.0)
        st["steel_lt_0.8_samples"] = int(weak.sum())
        st["steel_samples_below"] = {str(t): int(((gg < t) & (gp[:, 1] > 5.0)).sum()) for t in (0.3, 0.5, 0.7, 0.8)}
        st["steel_lt_0.5_samples"] = st["steel_samples_below"]["0.5"]
        st["weak_steel_spots"] = [{"min": np.round(a, 1).tolist(), "max": np.round(b, 1).tolist(), "n": n}
                                  for a, b, n in cluster_boxes(gp[weak], 5.0, 4)]
        st["volume_cm3"] = round(D["shape"].volume / 1000, 3)
        st["mass_g"] = round(D["shape"].volume / 1000 * mc.ABS["density_g_cm3"], 2)
        S[key] = st
        cache.write_bytes(pickle.dumps({"stamp": stamp, "st": st, **{k: D[k] for k in ("fine", "uc", "th_pts", "th", "gap")}}))
        print(f"[{key}] zero-draft {st['draft_area_mm2']['0-0.25']} mm2, undercut {st['undercut_area_mm2']} mm2, "
              f"steel<0.8 {st['steel_lt_0.8_samples']}", flush=True)

    dm, fm = P["dfm"]["mesh"], P["dfm"]["fine"]
    dmain = max(dm.split(only_watertight=False), key=lambda c: len(c.faces))  # drop 0-volume slivers for flow
    S["dfm"]["projected_area_cm2"] = round(projected_area(dm) / 100, 2)

    # ------------------------------------------------ lifters: every undercut face free within the travel
    travel = TOOTH["protrusion"] + LIFTER_CLEAR
    lf = mc.lifter(TOOTH["protrusion"], LIFTER_CLEAR, LIFTER_ANGLE)
    uc = P["dfm"]["uc"]
    idx = np.flatnonzero(uc)
    c = fm.triangles_center[idx]
    dirx = np.where(c[:, 0] < 26.12, 1.0, -1.0)  # left-hand teeth release to +X, right-hand to -X
    o = c + 1e-3 * fm.face_normals[idx]
    ray = trimesh.ray.ray_triangle.RayMeshIntersector(fm)
    loc, ri, _ = ray.intersects_location(o, np.c_[dirx, np.zeros_like(dirx), np.zeros_like(dirx)], multiple_hits=True)
    first = np.full(len(o), np.inf)
    for pt, r in zip(loc, ri):
        first[r] = min(first[r], float(np.linalg.norm(pt - o[r])))
    free = first > travel
    in_zone = np.array([any(a - 1 <= z <= b + 1 for a, b in TEETH_Z) for z in c[:, 2]]) & ((c[:, 0] < 6) | (c[:, 0] > 46))
    a = fm.area_faces[idx]
    S["lifters"] = {"count_per_cavity": 2 * len(TEETH_Z), "tooth": TOOTH, "travel_mm": travel, "calc": lf,
                    "undercut_in_lifter_zones_mm2": round(float(a[in_zone].sum()), 2),
                    "released_within_travel_mm2": round(float(a[in_zone & free].sum()), 2),
                    "not_released_mm2": round(float(a[in_zone & ~free].sum()), 3),
                    "undercut_outside_lifter_zones_mm2": round(float(a[~in_zone].sum()), 2),
                    "outside_zone_boxes": [{"min": np.round(b0, 1).tolist(), "max": np.round(b1, 1).tolist(), "n": n}
                                           for b0, b1, n in cluster_boxes(c[~in_zone], 5.0, 3)],
                    "window_rejected": "a straight-pull window through the side wall would show on the cosmetic "
                                       "side walls of the remote and weaken the snap"}

    # ------------------------------------------------ gates: geodesic flow length
    gate_res = {}
    for k, (label, p) in GATES.items():
        dist, _ = mk.geodesic_from(dmain, p)
        gate_res[k] = {"label": label, "point": p, "max_flow_mm": round(float(dist.max()), 1),
                       "L_over_t": round(float(dist.max()) / WALL, 1),
                       "last_fill": np.round(dmain.vertices[int(np.argmax(dist))], 1).tolist()}
        if k == GATE_PICK:
            fill = dist
    S["gates"], S["gate_pick"] = gate_res, GATE_PICK
    S["gate_size"] = {"type": "SUB GATE (tunnel) from the PL runner onto the inner side wall", "d_mm": 1.2,
                      "rule": "d = 0.6 x wall for ABS (1.2 mm on a 2.0 wall)", "runner_d_mm": 5.0}

    # ------------------------------------------------ ejection: planar core-side faces
    from shapely.geometry import Point, Polygon
    from shapely.ops import polylabel

    pins, blades = [], []
    for f in P["dfm"]["shape"].faces():
        if f.geom_type.name != "PLANE" or f.normal_at().Y > -0.999:
            continue
        v = np.array([tuple(p) for p in f.outer_wire().vertices()])
        if len(v) < 3:
            continue
        poly = Polygon(v[:, [0, 2]]).buffer(0)
        if poly.area < 1.5:
            continue
        y = float(v[:, 1].mean())
        core = poly.buffer(-0.95)  # where a >= 1.5 mm pin fits
        cands = []
        for piece in getattr(core, "geoms", [core]):
            if piece.is_empty:
                continue
            ring = piece.exterior
            cands += [ring.interpolate(t) for t in np.arange(0, ring.length, 3.0)]
            cands.append(piece.representative_point())
        for pt in cands:
            x, z = pt.x, pt.y
            if any(a_ - 3 <= z <= b_ + 3 for a_, b_ in TEETH_Z) and (x < 7 or x > 45):
                continue  # lifter zone
            r_ = poly.exterior.distance(Point(x, z))
            if r_ >= 0.94:
                pins.append({"x": round(x, 2), "z": round(z, 2), "y": round(y, 2),
                             "d": float(min(4.0, max(1.5, np.floor((2 * r_ - 0.3) * 2) / 2))), "r": r_})
        pl_ = polylabel(poly, 0.02)
        r_ = poly.exterior.distance(pl_)
        if 0.38 <= r_ < 0.95:
            mrr = poly.minimum_rotated_rectangle
            e = np.asarray(mrr.exterior.coords)
            L = max(np.linalg.norm(e[1] - e[0]), np.linalg.norm(e[2] - e[1]))
            if L >= 4 and not (any(a_ - 3 <= pl_.y <= b_ + 3 for a_, b_ in TEETH_Z) and (pl_.x < 7 or pl_.x > 45)):
                blades.append({"x": round(pl_.x, 2), "z": round(pl_.y, 2), "y": round(y, 2), "w": round(2 * r_, 2),
                               "l": round(min(L - 1.0, 8.0), 1), "face_area_mm2": round(poly.area, 1)})
    # spread: keep the largest faces, at least 8 mm apart
    def spread(items, key, gap=8.0, cap=24):
        out = []
        for it in sorted(items, key=lambda t: -t[key]):
            if all(np.hypot(it["x"] - o["x"], it["z"] - o["z"]) >= gap for o in out):
                out.append(it)
            if len(out) >= cap:
                break
        return out

    pins = spread(pins, "r", 12.0, 28)
    for b in blades:
        b["w"], b["l"] = round(b["w"], 1), round(b["l"])
    blades = spread(blades, "face_area_mm2", 12.0, 12)
    depth = float(P["dfm"]["mesh"].bounds[1][1] - Y_PL)
    S["ejection"] = {"pins": pins, "blades": blades, "core_depth_mm": round(depth, 1),
                     "stroke_mm": round(max(depth + 5, lf["ejector_stroke_mm"] + 3), 1),
                     "pin_sizes": sorted({p["d"] for p in pins})}

    # ------------------------------------------------ cooling, cycle, tonnage
    th_cool = S["dfm"]["thickness_mm"]["max_99.5pct"]
    t_c = mc.cooling_time(th_cool)
    mass = S["dfm"]["mass_g"]
    fill_s = round((CAVITIES * mass / mc.ABS["density_g_cm3"] + 6.0) / 40.0, 2)  # shot cm3 / 40 cm3/s
    cyc = {"fill_s": fill_s, "pack_s": 8.0, "cool_s": round(t_c, 1), "mold_open_s": 5.0}
    cyc["total_s"] = round(sum(cyc.values()), 2)
    S["cooling"] = {"governing_wall_mm": th_cool, "t_cool_s": round(t_c, 1),
                    "t_cool_nominal_2mm_s": round(mc.cooling_time(WALL), 1),
                    "t_cool_3mm_spots_s": round(mc.cooling_time(3.0), 1), "cycle": cyc}
    S["tonnage"] = mc.tonnage_table(S["dfm"]["projected_area_cm2"], mass, cavities=(1, 2, 4), runner_cm2_per_cav=3.0,
                                    runner_g_per_cav=3.0, cycle_s=cyc["total_s"])
    pick = next(r for r in S["tonnage"] if r["cavities"] == CAVITIES)
    S["cavity_pick"] = CAVITIES
    S["coolant"] = mc.coolant(pick["shot_g"], {"cool_s": cyc["cool_s"], "pack_s": cyc["pack_s"]})
    L, W = 153.0, 51.0
    ins_w, ins_l = round(CAVITIES * W + 30 + 2 * 30), round(L + 2 * 30)
    S["mold"] = {"layout": f"1 X {CAVITIES}", "insert_W_mm": ins_w, "insert_L_mm": ins_l,
                 "mold_W_mm": round(ins_w + 2 * 60, -1), "mold_L_mm": round(ins_l + 2 * 60, -1),
                 "machine_t_clamp": pick["machine_t"]}
    TIE = {80: 310, 100: 360, 120: 410, 150: 460, 180: 510, 220: 560}  # typical distance between tie bars (H = V)
    need = max(S["mold"]["mold_W_mm"], S["mold"]["mold_L_mm"])
    m_t = next(t for t, d in sorted(TIE.items()) if t >= pick["machine_t"] and d > need)
    S["mold"]["machine_t"] = m_t
    S["mold"]["tie_bar_mm"] = TIE[m_t]
    S["mold"]["tie_bar_clamp_machine_mm"] = TIE.get(pick["machine_t"])
    S["mold"]["tie_bar_note"] = ("typical tie-bar distances (H x V): 80 T 310 x 310, 100 T 360 x 360, 120 T 410 x 410 "
                                 "- confirm with the moulder's machine list")
    S["warpage"] = {"bow_per_K_mm": round(mc.thermal_bow(1.0, L, WALL), 3),
                    "bow_5K_mm": round(mc.thermal_bow(5.0, L, WALL), 2),
                    "shrink_mm": [round(p / 100 * L, 2) for p in mc.ABS["shrinkage_pct"]]}

    # ------------------------------------------------ fill proxy, air traps, weld lines
    frac = fill / fill.max()
    S["fill"] = {"gate": GATE_PICK, "max_flow_mm": round(float(fill.max()), 1), "fill_time_s_est": fill_s,
                 "last_fill_xyz": np.round(dmain.vertices[int(np.argmax(fill))], 1).tolist()}
    nb = dmain.vertex_neighbors
    peaks = [i for i in range(len(fill)) if fill[i] > 0.55 * fill.max() and all(fill[i] >= fill[j] for j in nb[i])]
    pk = dmain.vertices[peaks]
    traps = []
    for p in pk[np.argsort(-fill[peaks])]:
        if all(np.linalg.norm(p - q) > 8 for q in traps):
            traps.append(p)
    S["air_traps"] = [np.round(p, 1).tolist() for p in traps[:10]]
    welds = weld_edges(dmain, fill)
    keep = np.zeros(len(welds), bool)  # drop isolated edges: keep clusters of >= 6 edges (6 mm cells)
    kc = np.floor(welds.mean(1) / 6.0).astype(int)
    _, inv_, cnt_ = np.unique(kc, axis=0, return_inverse=True, return_counts=True)
    keep = cnt_[inv_.ravel()] >= 6
    welds = welds[keep]
    S["weld_lines"] = {"n_edges": int(len(welds)),
                       "boxes": [{"min": np.round(a, 1).tolist(), "max": np.round(b, 1).tolist(), "n": n}
                                 for a, b, n in cluster_boxes(welds.mean(1), 6.0, 4)]}

    # ------------------------------------------------ figures (VTK renders + matplotlib)
    figs, proj = {}, {}
    g = np.array(vv.GREEN) / 255

    def rnd(name, mesh, col, cam, **kw):
        path, pj = vv.render(mesh, col, FIG / name, camera=cam, **kw)
        figs[name[:-4]] = str(Path(path).relative_to(REPO))
        proj[name[:-4]] = pj
        return pj

    for key in ("input", "dfm"):
        m = P[key]["mesh"]
        rnd(f"{key}_core_iso.png", m, g, "core_iso")
        rnd(f"{key}_cav_iso.png", m, g, "cav_iso")
    pj_plan = rnd("dfm_core_plan.png", dm, g, "core_plan", size=(1800, 800))
    pj_side = rnd("dfm_side.png", dm, g, "side", size=(1800, 520))
    pj_end = rnd("dfm_end.png", dm, g, "end_top", size=(700, 520))
    lo, hi = dm.bounds
    S["size"] = {"L": round(hi[2] - lo[2], 2), "W": round(hi[0] - lo[0], 2), "H": round(hi[1] - lo[1], 2)}
    S["size_px"] = {"plan": pj_plan([[lo[0], hi[1], lo[2]], [lo[0], hi[1], hi[2]], [lo[0], hi[1], lo[2]],
                                     [hi[0], hi[1], lo[2]]]).tolist(),
                    "side": pj_side([[hi[0], lo[1], lo[2]], [hi[0], hi[1], lo[2]]]).tolist()}

    # parting line: A/B classes on the DFM part, lifter faces excluded
    cls = mk.side_classes(fm, P["dfm"]["uc"])
    pl = mk.parting_edges(fm, cls, min_len=0.0)
    S["parting"] = {"pl_edges": int(len(pl)), "main_PL_Y": Y_PL,
                    "note": "flat PL at Y 4.34; steps down around the tongue (top end, to Y 0.41) and runs up the "
                            "slanted bottom end face; the battery opening and slot are cavity/core shut-offs"}
    rnd("pl_side.png", fm, g, "side", size=(1800, 520), lines=pl, line_w=3.5, edges=False)
    rnd("pl_cav_iso.png", fm, g, "cav_iso", lines=pl, line_w=2.5)
    rnd("pl_core_iso.png", fm, g, "core_iso", lines=pl, line_w=2.5)
    rnd("pl_top_end.png", fm, g, "top_end_iso", lines=pl, line_w=3.0, focus=(26, 10, 148), parallel_scale=16)
    rnd("pl_bottom_end.png", fm, g, "bottom_end_iso", lines=pl, line_w=3.0, focus=(26, 12, 6), parallel_scale=18)
    rnd("pl_opening.png", fm, g, "cav_iso", lines=pl, line_w=3.0, focus=(26, 20, 92), parallel_scale=16)
    proj_pts = {
        "teeth": [[3.1, 5.2, (a + b) / 2] for a, b in TEETH_Z] + [[49.1, 5.2, (a + b) / 2] for a, b in TEETH_Z],
        "tongue": [[26.12, 2.5, 152.4]], "bottom": [[26.12, 12, 2.5]], "opening": [[26.12, 22.5, 92.0]],
    }
    for k in ("pl_side", "pl_cav_iso", "pl_core_iso", "dfm_core_plan", "pl_top_end", "pl_bottom_end", "pl_opening"):
        S.setdefault("px", {})[k] = {n: proj[k](v).tolist() for n, v in proj_pts.items()}

    # lifters: faces formed by the lifter heads in purple on the core plan
    col = np.tile(g, (len(fm.faces), 1))
    col[P["dfm"]["uc"]] = [0.72, 0.35, 0.85]
    heads = []
    for a_, b_ in TEETH_Z:
        heads.append(vv.box_actor((2.62, 5.84, a_ - 0.5), (2.62 + 2.6, 13.0, b_ + 0.5)))
        heads.append(vv.box_actor((49.62 - 2.6, 5.84, a_ - 0.5), (49.62, 13.0, b_ + 0.5)))
    rnd("lifter_plan.png", fm, col, "core_plan", size=(1800, 800), extra=heads)
    rnd("lifter_iso.png", fm, col, "core_iso", extra=heads)
    rnd("lifter_zoom.png", fm, col, ((1.0, -0.55, -0.35), (0, 1, 0)), focus=(3.1, 8.5, 114.5), parallel_scale=6.5,
        extra=[vv.box_actor((2.62, 5.84, 112.0), (5.22, 13.0, 116.9), opacity=0.45)])
    S["px"]["lifter_plan"] = {"teeth": proj["lifter_plan"](proj_pts["teeth"]).tolist()}
    S["px"]["lifter_zoom"] = {"tooth": proj["lifter_zoom"]([[3.1, 5.2, 114.46]]).tolist()}

    # undercut before (red)
    fi = P["input"]["fine"]
    col = np.tile(g, (len(fi.faces), 1))
    col[P["input"]["uc"]] = [1, 0, 0]
    rnd("undercut_core_iso.png", fi, col, "core_iso")

    # draft maps
    for key in ("input", "dfm"):
        m = P[key]["mesh"]
        rnd(f"draft_{key}_cav.png", m, draft_rgb(m), "cav_iso", edges=False)
        rnd(f"draft_{key}_core.png", m, draft_rgb(m), "core_iso", edges=False)

    # thickness map (DFM part)
    tf = mk.to_faces(dm, P["dfm"]["th_pts"], P["dfm"]["th"])
    cmap = plt.get_cmap("jet")
    norm = matplotlib.colors.Normalize(0, 3.5)
    rnd("thick_core.png", dm, cmap(norm(tf))[:, :3], "core_iso", edges=False)
    rnd("thick_cav.png", dm, cmap(norm(tf))[:, :3], "cav_iso", edges=False)
    thick_pts = P["dfm"]["th_pts"][P["dfm"]["th"] > 2.6]
    S["px"]["thick_core"] = {"thick": proj["thick_core"](thick_pts.mean(0) if len(thick_pts) else [[26, 15, 144]]).tolist()}

    # ejectors on the core plan
    ex = [vv.sphere_actor((p["x"], p["y"] - 0.2, p["z"]), p["d"] / 2, (0.85, 0.1, 0.1)) for p in pins]
    ex += [vv.sphere_actor((b["x"], b["y"] - 0.2, b["z"]), b["w"] / 2, (0.1, 0.25, 0.9)) for b in blades]
    rnd("eject_plan.png", dm, g, "core_plan", size=(1800, 800), extra=ex)
    S["px"]["eject_plan"] = {"pins": proj["eject_plan"]([[p["x"], p["y"], p["z"]] for p in pins]).tolist(),
                             "blades": proj["eject_plan"]([[b["x"], b["y"], b["z"]] for b in blades]).tolist()}

    # fill / ejection-time / air traps / weld lines (proxies)
    fv = frac[dmain.faces].mean(1)
    rain = plt.get_cmap("jet")
    gp_ = np.array(GATES[GATE_PICK][1])
    gate_act = [vv.sphere_actor(gp_, 1.3, (1, 0, 0))]
    rnd("fill_core.png", dmain, rain(fv)[:, :3], "core_iso", edges=False, extra=gate_act)
    rnd("fill_cav.png", dmain, rain(fv)[:, :3], "cav_iso", edges=False)
    tcool = np.array([mc.cooling_time(max(t, 0.3)) for t in tf])
    S["ejection_time_s"] = {"p50": round(float(np.median(tcool)), 1), "p99": round(float(np.percentile(tcool, 99)), 1)}
    tnorm = matplotlib.colors.Normalize(0, 22)
    rnd("ejtime_core.png", dm, rain(tnorm(tcool))[:, :3], "core_iso", edges=False)
    trap_act = [vv.sphere_actor(p, 1.2, (1, 0, 0)) for p in traps[:10]]
    rnd("air_core.png", dm, np.tile([0.85, 0.87, 0.9], (len(dm.faces), 1)), "core_iso", extra=trap_act)
    rnd("air_cav.png", dm, np.tile([0.85, 0.87, 0.9], (len(dm.faces), 1)), "cav_iso", extra=trap_act)
    rnd("weld_cav.png", dm, np.tile([0.85, 0.87, 0.9], (len(dm.faces), 1)), "cav_iso", lines=welds, line_rgb=(1, 0, 0),
        line_w=4.0)
    rnd("weld_core.png", dm, np.tile([0.85, 0.87, 0.9], (len(dm.faces), 1)), "core_iso", lines=welds,
        line_rgb=(1, 0, 0), line_w=4.0)

    # sections for the Suggest slides (matplotlib)
    def sec(ax, mesh, z, xl, yl, col, title, lw=0.8):
        s = mesh.section(plane_origin=[0, 0, z], plane_normal=[0, 0, 1])
        for poly in s.discrete:
            ax.fill(poly[:, 0], poly[:, 1], color=col, alpha=0.9, lw=lw, ec="#1a5c1a")
        ax.set_xlim(*xl)
        ax.set_ylim(*yl)
        ax.set_aspect("equal")
        ax.set_title(title, fontsize=11)
        ax.tick_params(labelsize=8)
        ax.grid(alpha=0.25)

    def savefig(fig, name):
        fig.savefig(FIG / name, dpi=150, bbox_inches="tight", facecolor="white")
        plt.close(fig)
        figs[name[:-4]] = str((FIG / name).relative_to(REPO))

    gi = "#3DBE3D"
    # tooth section with lifter head
    fig, axs = plt.subplots(1, 2, figsize=(9, 4.2))
    sec(axs[0], P["input"]["mesh"], 114.46, (0, 9), (3.5, 12), gi, "A-A  Z 114.46: catch tooth (before)")
    sec(axs[1], dm, 114.46, (0, 9), (3.5, 12), gi, "A-A  with lifter head (purple)")
    from matplotlib.patches import FancyArrow, Polygon as MPoly

    axs[1].add_patch(MPoly([(2.62, 5.84), (3.62, 5.84), (3.62, 5.34), (3.62 + 2.5, 5.34), (3.62 + 2.5, 12),
                            (2.62, 12)], closed=True, fc="#B35AD8", alpha=0.55, ec="#6a1b9a"))
    axs[1].add_patch(FancyArrow(4.5, 9.5, travel, 0, width=0.12, head_width=0.45, head_length=0.4, color="red"))
    axs[1].text(4.4, 10.2, f"lifter travel {travel:.1f} mm", color="red", fontsize=9)
    for ax in axs:
        ax.axhline(Y_PL, color="red", lw=1.2, ls="--")
        ax.text(0.2, Y_PL - 0.45, "PL", color="red", fontsize=9)
    savefig(fig, "sec_tooth.png")

    # weak steel before/after
    zs = 105.7
    fig, axs = plt.subplots(1, 2, figsize=(9, 4.6))
    sec(axs[0], P["input"]["mesh"], zs, (43, 52), (4, 24), gi, f"B-B  Z {zs}: before")
    sec(axs[1], dm, zs, (43, 52), (4, 24), gi, f"B-B  Z {zs}: after (gap filled)")
    savefig(fig, "sec_steel.png")
    fig, axs = plt.subplots(1, 2, figsize=(9, 4.6))
    sec(axs[0], P["input"]["mesh"], 30.2, (41, 52), (4, 18), gi, "C-C  Z 30.2: before")
    sec(axs[1], dm, 30.2, (41, 52), (4, 18), gi, "C-C  Z 30.2: after")
    savefig(fig, "sec_steel2.png")
    wk = P["input"]["gap"]
    wpts = wk[0][(wk[2] < 0.8) & (wk[0][:, 1] > 5)]
    col = np.tile(g, (len(P["input"]["mesh"].faces), 1))
    rnd("steel_core.png", P["input"]["mesh"], col, "core_iso", extra=[vv.sphere_actor(p, 0.35) for p in wpts[::2]])
    # rib draft section
    fig, axs = plt.subplots(1, 2, figsize=(9, 4.6))
    sec(axs[0], P["input"]["mesh"], 36.0, (24.6, 27.6), (8.3, 16.0), gi, "D-D  Z 36: rib before (0 deg)")
    sec(axs[1], dm, 36.0, (24.6, 27.6), (8.3, 16.0), gi, "D-D  Z 36: rib after (0.5 deg/side)")
    savefig(fig, "sec_rib.png")
    # thick spot section
    fig, ax = plt.subplots(figsize=(6, 4.4))
    s = dm.section(plane_origin=[26.12, 0, 0], plane_normal=[1, 0, 0])
    for poly in s.discrete:
        ax.fill(poly[:, 2], poly[:, 1], color=gi, lw=0.8, ec="#1a5c1a")
    ax.set_xlim(136, 154)
    ax.set_ylim(4, 25)
    ax.set_aspect("equal")
    ax.grid(alpha=0.25)
    ax.set_title("E-E  X 26.12: contact walls Z 141-146", fontsize=11)
    savefig(fig, "sec_thick.png")

    # rib / rib-root numbers
    S["ribs"] = {"thickness_before_mm": 0.8, "ratio_to_wall": 0.4, "draft_after_deg": 0.5,
                 "tip_mm": 0.8, "root_mm_at_12mm_height": round(0.8 + 2 * 12 * np.tan(np.radians(0.5)), 2),
                 "wall_example": {"x": (25.72, 26.52), "z": 36.0, "tip_mm": 0.8, "height_mm": 6.5,
                                  "root_mm": round(0.8 + 2 * 6.5 * np.tan(np.radians(0.5)), 2)}}
    wed = json.loads((PROJ / "src" / "lib" / "dfm_features.json").read_text())
    S["wedges"] = {"count": len(wed["wedges"]), "gap_mm": wed["wedge_gap_mm"],
                   "added_volume_mm3_est": round(sum(w["area_mm2"] * (w["v1"] - w["v0"]) for w in wed["wedges"]), 1)}
    S["material"] = mc.ABS
    S["figures"] = figs
    (OUT / "dfm_summary.json").write_text(json.dumps(S, indent=2, default=float))
    print("summary ->", OUT / "dfm_summary.json", flush=True)

    import toolmaker_ppt

    toolmaker_ppt.build(S, REPO, OUT / "DFM.pptx")
    print("deck ->", OUT / "DFM.pptx")


if __name__ == "__main__":
    main()

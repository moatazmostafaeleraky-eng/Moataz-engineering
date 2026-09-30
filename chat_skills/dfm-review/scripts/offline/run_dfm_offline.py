"""Offline DFM analysis of a moulded part from an STL. Needs numpy + Pillow (scipy strongly recommended).
No trimesh / shapely / vtk / build123d / internet. Writes dfm_summary.json, figures/ and DFM_changes.md;
then deck_offline.py turns the summary into DFM.pptx.

    python run_dfm_offline.py part.stl --pull +y --out outputs/dfm --name "Front cover" --code ABC-01 \\
        --material ABS --cavities 2

Frame: the analysis runs in a working frame with the pull direction on +Y (+Y = cavity / A side). Every
location in the summary is given in the ORIGINAL STL frame (key "xyz") so it can be found in CAD.
Labels: every number is tagged measured / hand-calculated / assumed / proxy in S["basis"].
"""

from __future__ import annotations

import argparse
import json
import math
import sys
import time
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent))
import meshlite as ml  # noqa: E402

try:
    import mold_calcs as mc  # pure python
except ImportError:  # pragma: no cover
    mc = None

# typical datasheet values (unfilled grades); confirm with the chosen grade
MATERIALS = {
    "ABS": {"name": "ABS (general purpose)", "density_g_cm3": 1.05, "shrink_factor": 1.005, "T_melt_C": 240,
            "T_mold_C": 60, "T_eject_C": 85, "diffusivity_mm2_s": 0.10, "cavity_pressure_MPa": 40},
    "HIPS": {"name": "HIPS", "density_g_cm3": 1.04, "shrink_factor": 1.005, "T_melt_C": 220, "T_mold_C": 45,
             "T_eject_C": 80, "diffusivity_mm2_s": 0.09, "cavity_pressure_MPa": 35},
    "PP": {"name": "PP (homopolymer)", "density_g_cm3": 0.90, "shrink_factor": 1.015, "T_melt_C": 230,
           "T_mold_C": 40, "T_eject_C": 95, "diffusivity_mm2_s": 0.09, "cavity_pressure_MPa": 35},
    "PC": {"name": "PC", "density_g_cm3": 1.20, "shrink_factor": 1.006, "T_melt_C": 300, "T_mold_C": 90,
           "T_eject_C": 125, "diffusivity_mm2_s": 0.12, "cavity_pressure_MPa": 55},
    "PC/ABS": {"name": "PC/ABS", "density_g_cm3": 1.15, "shrink_factor": 1.005, "T_melt_C": 265, "T_mold_C": 70,
               "T_eject_C": 105, "diffusivity_mm2_s": 0.11, "cavity_pressure_MPa": 45},
}
MACHINES = [(50, 260), (80, 310), (100, 360), (120, 410), (150, 460), (180, 510), (220, 560), (280, 610),
            (350, 710), (450, 810)]  # (clamp t, typical distance between tie bars H = V, mm); confirm with moulder
AXES = {"x": 0, "y": 1, "z": 2}


# ---------------------------------------------------------------- frame
def pull_rotation(pull):
    """Proper rotation R (det +1) with R @ pull = +Y. pull like '+y', '-z', 'x'."""
    s = -1.0 if pull.strip().startswith("-") else 1.0
    a = AXES[pull.strip()[-1].lower()]
    if a == 1:
        return np.diag([1.0, s, s])  # -y: rotate 180 deg about X
    R = np.zeros((3, 3))
    if a == 0:  # x -> y
        R[1, 0], R[0, 1], R[2, 2] = s, -s, 1.0
    else:  # z -> y
        R[1, 2], R[2, 1], R[0, 0] = s, -s, 1.0
    return R


# ---------------------------------------------------------------- helpers
def hull_area(lines):
    """Area of the 2-D convex hull (XZ) of a section: the silhouette of the slice, also for open U-shapes."""
    if not lines:
        return 0.0
    P = np.unique(np.round(np.concatenate(lines)[:, [0, 2]], 4), axis=0)
    if len(P) < 3:
        return 0.0
    P = P[np.lexsort((P[:, 1], P[:, 0]))]

    def half(pts):
        h = []
        for p in pts:
            while len(h) >= 2 and ((h[-1][0] - h[-2][0]) * (p[1] - h[-2][1])
                                   - (h[-1][1] - h[-2][1]) * (p[0] - h[-2][0])) <= 0:
                h.pop()
            h.append(p)
        return h

    H = np.array(half(P)[:-1] + half(P[::-1])[:-1])
    x, z = H[:, 0], H[:, 1]
    return float(abs(0.5 * np.sum(x * np.roll(z, -1) - np.roll(x, -1) * z)))


def auto_pl(m, n=60):
    """PL height = lowest level where the slice silhouette (convex hull) reaches its maximum, refined by
    bisection and snapped to a nearby horizontal face level. A proposal: always confirm with the user."""
    lo, hi = m.V[:, 1].min(), m.V[:, 1].max()
    ys = np.linspace(lo + 0.01 * (hi - lo), hi - 0.01 * (hi - lo), n)
    area = lambda y: hull_area(ml.section(m, (0, y, 0), (0, 1, 0)))  # noqa: E731
    A = np.array([area(y) for y in ys])
    thr = 0.97 * A.max()  # walls may carry draft or a slight bow
    i = int(np.flatnonzero(A >= thr)[0])
    if i > 0:
        a_, b_ = ys[i - 1], ys[i]
        for _ in range(14):
            c_ = (a_ + b_) / 2
            a_, b_ = (a_, c_) if area(c_) >= thr else (c_, b_)
        y = b_
    else:
        y = ys[0]
    hz = np.abs(m.N[:, 1]) > 0.999
    if hz.any():
        yc = m.C[hz, 1]
        near = np.abs(yc - y) < 0.3
        if near.any():
            w = m.area[hz][near]
            levels = np.round(yc[near], 2)
            u, inv = np.unique(levels, return_inverse=True)
            y = float(u[np.argmax(np.bincount(inv, weights=w))])
    return float(y), ys.tolist(), A.tolist()


def classes(m, blocked, y_pl):
    """0 cavity, 1 core, 2 undercut (per face)."""
    ny = m.N[:, 1]
    cls = np.where(ny > 1e-3, 0, np.where(ny < -1e-3, 1, np.where(m.C[:, 1] >= y_pl, 0, 1)))
    cls[blocked] = 2
    return cls


def _face_of(m, P):
    """Face of m nearest to each point (by centroid; scipy if present)."""
    try:
        from scipy.spatial import cKDTree

        return cKDTree(m.C).query(P)[1]
    except ImportError:
        return np.array([int(np.argmin(np.linalg.norm(m.C - p, axis=1))) for p in P])


def release_classes(m, caster, y_pl):
    """0 = cavity (face released upwards: its +Y ray escapes), 1 = core (everything else). Vertical faces that
    escape both ways go by height against the PL. PL edges = boundaries between the two classes."""
    ny = m.N[:, 1]
    o = m.C + ml.EPS * m.N
    up_free = ~np.isfinite(caster.first_hit(o, +1))
    vert = np.abs(ny) <= 1e-3
    cav = (ny > 1e-3) & up_free
    cav |= vert & up_free & (m.C[:, 1] >= y_pl - 1e-3)
    return np.where(cav, 0, 1)


def box_of(pts, pad=0.0):
    return (np.round(pts.min(0) - pad, 2).tolist(), np.round(pts.max(0) + pad, 2).tolist())


def crop_faces(m, center, half):
    return np.flatnonzero(np.all(np.abs(m.C - center) <= half, axis=1))


def region_name(c, lo, hi):
    """Plain-language location in the working frame (for comments). X across, Z along, Y = pull."""
    f = (c - lo) / np.maximum(hi - lo, 1e-9)
    xs = "left" if f[0] < 0.33 else ("right" if f[0] > 0.67 else "middle")
    zs = "end A (Z-)" if f[2] < 0.25 else ("end B (Z+)" if f[2] > 0.75 else "mid-length")
    return f"{zs}, {xs}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("stl")
    ap.add_argument("--pull", default="+y", help="pull (ejection) direction of the core: +x -x +y -y +z -z")
    ap.add_argument("--out", default="dfm_out")
    ap.add_argument("--name", default="Part")
    ap.add_argument("--code", default="-")
    ap.add_argument("--model", default="-")
    ap.add_argument("--material", default="ABS", choices=sorted(MATERIALS))
    ap.add_argument("--material-given", action="store_true", help="material stated by the user (not assumed)")
    ap.add_argument("--cavities", type=int, default=2)
    ap.add_argument("--pl", type=float, default=None, help="PL height along the pull (STL frame); default auto")
    ap.add_argument("--subdiv", type=float, default=2.0, help="max edge for the undercut / draft mesh (mm)")
    ap.add_argument("--samples", type=int, default=30000)
    ap.add_argument("--quick", action="store_true", help="fewer samples (testing)")
    a = ap.parse_args()
    t0 = time.time()
    out = Path(a.out)
    FIG = out / "figures"
    FIG.mkdir(parents=True, exist_ok=True)
    env = ml.check_environment()
    has_scipy = env["scipy"]
    ns = 8000 if a.quick else a.samples
    mat = MATERIALS[a.material]

    def log(*x):
        print(f"[{time.time() - t0:6.1f}s]", *x, flush=True)

    # ------------------------------------------------ load + frame
    m0 = ml.Mesh.load(a.stl)
    R = pull_rotation(a.pull)
    m = ml.Mesh(m0.V @ R.T, m0.F)
    to_orig = lambda p: (np.asarray(p, float) @ R).round(2).tolist()  # noqa: E731
    st = m0.stats()
    comp = ml.components(m)
    main_faces = np.flatnonzero(comp == 0)
    mm = ml.submesh(m, main_faces) if comp.max() > 0 else m
    log("loaded", st["faces"], "faces, watertight", st["watertight"], "components", int(comp.max() + 1))
    lo, hi = m.V.min(0), m.V.max(0)
    S = {"input": {"file": Path(a.stl).name, "pull_stl_frame": a.pull, "working_frame": "pull = +Y (cavity side)",
                   "R_stl_to_work": R.tolist()},
         "environment": env, "mesh": st, "components": int(comp.max() + 1),
         "part": {"name": a.name, "code": a.code, "model": a.model, "material": mat["name"],
                  "material_assumed": not a.material_given, "shrinkage": mat["shrink_factor"]},
         "basis": {}}
    vol_cm3 = st["volume_mm3"] / 1000
    S["geometry"] = {"size_work_LWH": {"X": round(hi[0] - lo[0], 2), "Y_pull": round(hi[1] - lo[1], 2),
                                       "Z": round(hi[2] - lo[2], 2)},
                     "volume_cm3": round(vol_cm3, 3), "area_cm2": round(st["area_mm2"] / 100, 2),
                     "mass_g": round(vol_cm3 * mat["density_g_cm3"], 2)}
    S["basis"]["geometry"] = "measured on the mesh; mass = volume x typical density"
    if not st["watertight"]:
        S["warnings"] = ["mesh is not watertight: volume, mass and thickness are approximate; re-export a closed STL"]

    # ------------------------------------------------ PL
    if a.pl is None:
        y_pl, ys, areas = auto_pl(m)
        S["pl"] = {"y_work": round(y_pl, 3), "method": "auto: lowest level of the max silhouette - confirm",
                   "profile": {"y": np.round(ys, 2).tolist(), "area_mm2": np.round(areas, 1).tolist()}}
    else:
        p = np.zeros(3)
        p[AXES[a.pull.strip()[-1].lower()]] = a.pl
        y_pl = float((R @ p)[1])
        S["pl"] = {"y_work": round(y_pl, 3), "method": "given by user"}
    log("PL y =", round(y_pl, 3))

    # ------------------------------------------------ draft + undercut (subdivided mesh)
    ms = m.subdivide(a.subdiv)
    if len(ms.F) > 900_000:  # keep the check fast on very large meshes
        ms = m.subdivide(a.subdiv * 1.5)
    S["draft_mesh_faces"] = int(len(ms.F))
    cs = ml.AxisCaster(ms, 1)
    blocked = ml.undercut_mask(ms, 1, caster=cs)
    dd = ms.draft_deg((0, 1, 0))
    tot = ms.area.sum()
    bands = [(0, 0.25), (0.25, 1.0), (1.0, 3.0), (3.0, 80.0), (80.0, 90.01)]
    S["draft"] = {"bands_pct": {f"{a_}-{b_}": round(float(ms.area[(dd >= a_) & (dd < b_)].sum() / tot * 100), 2)
                                for a_, b_ in bands},
                  "zero_draft_area_mm2": round(float(ms.area[dd < 0.25].sum()), 1)}
    cls = classes(ms, blocked, y_pl)
    zero = dd < 0.25
    S["draft"]["zero_draft_cavity_mm2"] = round(float(ms.area[zero & (cls == 0)].sum()), 1)
    S["draft"]["zero_draft_core_mm2"] = round(float(ms.area[zero & (cls == 1)].sum()), 1)
    S["basis"]["draft"] = "measured per face: asin(|n . pull|)"
    adj_s = ml.face_adjacency(ms)
    uc = ml.face_clusters(ms, blocked, adj_s)
    uc = [g for g in uc if ms.area[g].sum() >= 0.2]
    log("undercut faces", int(blocked.sum()), "clusters", len(uc))

    # release check of each undercut cluster by a side action (X+/X-/Z+/Z-), travel = cluster size + 1 mm
    side_cs = {ax: ml.AxisCaster(ms, ax) for ax in (0, 2)}
    ucl = []
    cen_all = (lo + hi) / 2
    for g in uc[:12]:
        P = ms.C[g] + ml.EPS * ms.N[g]
        c = ms.C[g].mean(0)
        ext = ms.C[g].max(0) - ms.C[g].min(0)
        vert = float(np.average(dd[g], weights=ms.area[g]))
        best = None
        for ax in (0, 2):
            for sg in (+1, -1):
                travel = float(ext[ax] + 1.5)
                free = ~np.isfinite(side_cs[ax].first_hit(P, sg, max_dist=travel + 30))
                frac = float(ms.area[g][free].sum() / ms.area[g].sum())
                if best is None or frac > best[0]:
                    best = (frac, ax, sg)
        frac, ax, sg = best
        outward = (c[ax] - cen_all[ax]) * sg > 0
        kind = ("draft" if vert < 0.25 and frac < 0.5 else ("slider" if outward else "lifter")) if frac >= 0.5 \
            else ("draft" if vert < 0.25 else "modify")
        ucl.append({"faces": len(g), "area_mm2": round(float(ms.area[g].sum()), 2), "xyz": to_orig(c),
                    "c_work": np.round(c, 2).tolist(), "box_work": box_of(ms.C[g], 0.5),
                    "mean_draft_deg": round(vert, 2), "side_release": {"axis": "XYZ"[ax], "sign": sg,
                                                                     "free_pct": round(frac * 100, 1)},
                    "action": kind, "where": region_name(c, lo, hi)})
    S["undercuts"] = {"faces": int(blocked.sum()), "area_mm2": round(float(ms.area[blocked].sum()), 2),
                      "clusters": ucl}
    S["basis"]["undercuts"] = ("measured: straight-pull ray test per face; side release checked along +/-X, +/-Z "
                               "over the feature length only")

    # ------------------------------------------------ thickness
    if has_scipy:
        P, fi, th = ml.sphere_thickness(ms, ns, rmax=max(4.0, 0.25 * float(min(hi - lo))))
        th = ml.local_max(P, th, 0.7)
        S["basis"]["thickness"] = "measured: inscribed-sphere diameter (shrinking ball), 0.7 mm local max filter"
    else:
        P, fi, th = ml.thickness_axis(ms, ns)
        S["basis"]["thickness"] = "approximate: axis rays, cosine-corrected (scipy missing)"
    ok = np.isfinite(th)
    q = np.percentile(th[ok], [0.5, 5, 50, 95, 99.5])
    nominal = float(q[2])
    hist, edges_ = np.histogram(np.clip(th[ok], 0, 6), bins=24, range=(0, 6))
    thick_thr = max(nominal * 1.25, nominal + 0.5)
    thin_thr = min(0.8, 0.5 * nominal)
    spots = {}
    for key, sel in (("thick", ok & (th > thick_thr)), ("thin", ok & (th < thin_thr))):
        idx = np.flatnonzero(sel)
        cl = ml.point_clusters(P[idx], 3.0) if len(idx) else []
        spots[key] = [{"n": int(len(c)), "xyz": to_orig(P[idx[c]].mean(0)), "c_work": np.round(P[idx[c]].mean(0), 2).tolist(),
                       "t_max" if key == "thick" else "t_min":
                           round(float(th[idx[c]].max() if key == "thick" else th[idx[c]].min()), 2),
                       "t_median": round(float(np.median(th[idx[c]])), 2),
                       "where": region_name(P[idx[c]].mean(0), lo, hi)} for c in cl if len(c) >= 5][:8]
    S["thickness"] = {"min_0.5pct": round(float(q[0]), 2), "p5": round(float(q[1]), 2), "nominal_median": round(nominal, 2),
                      "p95": round(float(q[3]), 2), "max_99.5pct": round(float(q[4]), 2),
                      "hist": {"edges": edges_.round(2).tolist(), "count": hist.tolist()},
                      "thick_threshold": round(thick_thr, 2), "thin_threshold": round(thin_thr, 2),
                      "thick_spots": spots["thick"], "thin_spots": spots["thin"], "samples": int(ok.sum())}
    log("thickness median", round(nominal, 2))
    # thickness per face of the subdivided mesh (for the maps)
    tf = np.full(len(ms.F), np.nan)
    order = np.argsort(fi)
    u, st_ = np.unique(fi[order], return_index=True)
    tf[u] = np.maximum.reduceat(np.where(ok, th, 0)[order], st_)
    miss = np.isnan(tf)
    if miss.any():
        if has_scipy:
            from scipy.spatial import cKDTree

            j = cKDTree(P).query(ms.C[miss])[1]
            tf[miss] = th[j]
        else:
            tf[miss] = nominal

    # ------------------------------------------------ steel (air gap along the normal)
    Ps, fs = m.sample(ns, 7)
    gap = ml.ray_gap(m, Ps, m.N[fs])
    S["steel"] = {f"under_{t}mm": int((gap < t).sum()) for t in (0.3, 0.5, 0.8)}
    S["steel"]["samples"] = int(len(gap))
    ke = np.flatnonzero(gap < 0.75)
    kcl = ml.point_clusters(Ps[ke], 2.5) if len(ke) else []
    S["steel"]["knife_edges"] = [{"n": int(len(c)), "gap_min": round(float(gap[ke[c]].min()), 2),
                                  "xyz": to_orig(Ps[ke[c]].mean(0)), "c_work": np.round(Ps[ke[c]].mean(0), 2).tolist(),
                                  "where": region_name(Ps[ke[c]].mean(0), lo, hi)} for c in kcl if len(c) >= 4][:8]
    S["basis"]["steel"] = "measured: ray along the face normal (26-direction snap, cosine-corrected) to the next wall"
    log("steel <0.5:", S["steel"]["under_0.5mm"])

    # ------------------------------------------------ projected area, PL edges
    A_proj = ml.projected_area(m, 1, 0.25 if not a.quick else 0.5)
    S["geometry"]["projected_area_cm2"] = round(A_proj / 100, 2)
    csy = ml.AxisCaster(m, 1)
    cls0 = release_classes(m, csy, y_pl)
    pl_segs = ml.parting_edges(m, cls0)
    steps = []
    if len(pl_segs):
        off = np.abs(pl_segs.mean(1)[:, 1] - y_pl) > 0.3
        for c in ml.point_clusters(pl_segs.mean(1)[off], 4.0)[:4]:
            if len(c) >= 4:
                pts = pl_segs.mean(1)[off][c]
                steps.append({"c_work": np.round(pts.mean(0), 2).tolist(), "xyz": to_orig(pts.mean(0)),
                              "dy": round(float(pts[:, 1].mean() - y_pl), 2), "where": region_name(pts.mean(0), lo, hi)})
    S["pl"]["edges"] = int(len(pl_segs))
    S["pl"]["steps"] = steps
    S["basis"]["pl"] = "measured: edges between cavity-side and core-side faces"

    # ------------------------------------------------ gate candidates + flow proxy
    adj = ml.face_adjacency(mm)
    cands = {}
    if len(pl_segs):
        pv = pl_segs.reshape(-1, 3)
        c = (lo + hi) / 2
        for nm, tgt in (("side X-", (lo[0], c[2])), ("side X+", (hi[0], c[2])),
                        ("end Z-", (c[0], lo[2])), ("end Z+", (c[0], hi[2]))):
            # PL vertex nearest to the middle of that side, measured in plan (X, Z): the PL may rise and fall
            cands[nm] = pv[np.argmin(np.linalg.norm(pv[:, [0, 2]] - np.array(tgt), axis=1))]
    top = mm.V[mm.V[:, 1] > hi[1] - 0.5]
    if len(top):
        cands["top centre (pin point)"] = top[np.argmin(np.linalg.norm(top[:, [0, 2]] - ((lo + hi) / 2)[[0, 2]], axis=1))]
    gates = []
    fields = {}
    for nm, gp in cands.items():
        dist = ml.geodesic(mm, gp)
        mx = float(np.nanmax(dist[np.isfinite(dist)]))
        fields[nm] = dist
        gates.append({"name": nm, "xyz": to_orig(gp), "c_work": np.round(gp, 2).tolist(), "max_flow_mm": round(mx, 1),
                      "L_t": round(mx / nominal, 1)})
    side = [g for g in gates if "pin" not in g["name"]] or gates
    pick = min(side, key=lambda g: g["max_flow_mm"])
    fill = fields[pick["name"]]
    S["gate"] = {"candidates": gates, "pick": pick["name"],
                 "note": "shortest max flow among PL (side / sub) gates; confirm cosmetic side and weld lines"}
    S["basis"]["gate"] = "proxy: geodesic flow length over the mesh edges (overestimates ~5-10 %)"
    log("gate", pick)

    peaks = ml.flow_peaks(mm, fill)
    S["air_traps"] = [{"xyz": to_orig(mm.V[i]), "c_work": np.round(mm.V[i], 2).tolist(),
                       "where": region_name(mm.V[i], lo, hi)} for i in peaks[:8]]
    welds = ml.weld_edges(mm, fill, adj=adj)
    wcl = [c for c in ml.point_clusters(welds.mean(1), 4.0) if len(c) >= 5] if len(welds) else []
    keep = np.concatenate(wcl) if wcl else np.array([], int)
    welds = welds[keep] if len(keep) else np.zeros((0, 2, 3))
    S["weld_lines"] = []
    base = 0
    for c in wcl[:8]:
        pts = (welds.mean(1)[base:base + len(c)])
        base += len(c)
        S["weld_lines"].append({"n": int(len(c)), "xyz": to_orig(pts.mean(0)), "c_work": np.round(pts.mean(0), 2).tolist(),
                                "where": region_name(pts.mean(0), lo, hi)})
    S["basis"]["fill"] = "proxy: flow length from the gate; air traps = last-to-fill peaks; weld = opposing fronts"

    # ------------------------------------------------ ejection (round pins on flat core faces)
    y_from = lo[1] - 5
    step = 4.0 if not a.quick else 6.0
    gx, gz = np.meshgrid(np.arange(lo[0] + 1, hi[0] - 1, step), np.arange(lo[2] + 1, hi[2] - 1, step))
    G = np.c_[gx.ravel(), np.full(gx.size, y_from), gz.ravel()]
    d0 = csy.first_hit(G, +1)
    hit = np.isfinite(d0)
    uc_boxes = [np.array(u_["box_work"]) for u_ in ucl]
    pins = []
    for (x, _, z), d in zip(G[hit], d0[hit]):
        yr = y_from + d
        if any((b[0][0] - 3 <= x <= b[1][0] + 3) and (b[0][2] - 3 <= z <= b[1][2] + 3) for b in uc_boxes):
            continue  # keep clear of tool-action zones
        for dia in (6.0, 5.0, 4.0, 3.0, 2.0):
            if ml.flat_pad_ok(csy, x, z, dia / 2 + 0.3, yr, (0, 2), +1, y_from):
                pins.append({"x": round(float(x), 2), "z": round(float(z), 2), "y": round(float(yr), 2), "d": dia})
                break
    pins.sort(key=lambda p: (-p["d"], -abs(p["x"] - (lo[0] + hi[0]) / 2) - abs(p["z"] - (lo[2] + hi[2]) / 2)))
    chosen = []
    gap_min = max(10.0, 0.12 * float(max(hi[0] - lo[0], hi[2] - lo[2])))
    for p in pins:
        if all(math.hypot(p["x"] - o["x"], p["z"] - o["z"]) >= gap_min for o in chosen):
            chosen.append(p)
        if len(chosen) >= 24:
            break
    core_depth = float(m.C[cls0 == 1][:, 1].max() - y_pl) if (cls0 == 1).any() else 0.0
    for p in chosen:
        p["xyz"] = to_orig((p["x"], p["y"], p["z"]))
    sizes = {}
    for p in chosen:
        sizes[p["d"]] = sizes.get(p["d"], 0) + 1
    S["ejection"] = {"pins": chosen, "sizes": {f"{k:.1f}": v for k, v in sorted(sizes.items())},
                     "core_depth_mm": round(core_depth, 1), "stroke_mm": round(max(core_depth, 0) + 5, 1),
                     "spacing_mm": round(gap_min, 1)}
    S["basis"]["ejection"] = "proposal: pins on pads verified flat by 16 rays (+0.3 mm margin); stroke = core depth + 5"
    log("pins", len(chosen))

    # ------------------------------------------------ mould, tonnage, cooling, cycle (hand calcs)
    th_gov = float(q[4])
    ratio = (4 / math.pi) * (mat["T_melt_C"] - mat["T_mold_C"]) / (mat["T_eject_C"] - mat["T_mold_C"])
    tc = lambda s: s ** 2 / (math.pi ** 2 * mat["diffusivity_mm2_s"]) * math.log(ratio)  # noqa: E731
    n_cav = a.cavities
    mass = S["geometry"]["mass_g"]
    runner_cm2 = max(1.0, 0.08 * A_proj / 100)
    runner_g = max(0.8, 0.08 * mass)
    rows = []
    for n in (1, 2, 4, 8):
        a_cm2 = n * (A_proj / 100 + runner_cm2)
        f_t = a_cm2 * 1e-4 * mat["cavity_pressure_MPa"] * 1e6 / 1e3 / 9.81 * 1.2
        rows.append({"cavities": n, "proj_area_cm2": round(a_cm2, 1), "clamp_calc_t": round(f_t, 1),
                     "shot_g": round(n * (mass + runner_g), 1)})
    fill_s = round((n_cav * (mass + runner_g) / mat["density_g_cm3"]) / 40.0, 2)
    cyc = {"fill_s": max(fill_s, 0.3), "pack_s": 8.0, "cool_s": round(tc(th_gov), 1), "mold_open_s": 5.0}
    cyc["total_s"] = round(sum(cyc.values()), 2)
    for r in rows:
        r["parts_per_h"] = int(3600 / cyc["total_s"] * r["cavities"])
    L_, W_ = float(hi[2] - lo[2]), float(hi[0] - lo[0])
    ins_w = round(n_cav * W_ + 30 * (n_cav - 1) + 2 * 35)
    ins_l = round(L_ + 2 * 35)
    mold_w, mold_l = round(ins_w + 2 * 60, -1), round(ins_l + 2 * 60, -1)
    pick_row = next(r for r in rows if r["cavities"] == n_cav)
    clamp_m = next((t for t, _ in MACHINES if t >= pick_row["clamp_calc_t"]), MACHINES[-1][0])
    size_m = next((t for t, d in MACHINES if t >= clamp_m and d > min(mold_w, mold_l)), MACHINES[-1][0])
    S["mold"] = {"layout": f"1 X {n_cav}", "insert_W_mm": ins_w, "insert_L_mm": ins_l, "mold_W_mm": mold_w,
                 "mold_L_mm": mold_l, "machine_t_clamp": clamp_m, "machine_t": size_m,
                 "tie_bar_mm": dict(MACHINES)[size_m], "upsized": size_m != clamp_m,
                 "note": "mould size = estimate (35 mm insert wall, 60 mm plate margin); tie bars = typical values, "
                         "confirm with the moulder's machine list"}
    S["tonnage"] = rows
    S["cavity_pick"] = n_cav
    S["cooling"] = {"governing_wall_mm": round(th_gov, 2), "t_cool_s": cyc["cool_s"],
                    "t_cool_nominal_s": round(tc(nominal), 1), "cycle": cyc,
                    "material_data": {k: mat[k] for k in ("T_melt_C", "T_mold_C", "T_eject_C", "diffusivity_mm2_s")}}
    if mc is not None:
        S["coolant"] = mc.coolant(pick_row["shot_g"], {"cool_s": cyc["cool_s"], "pack_s": cyc["pack_s"]})
    S["basis"]["mould"] = ("hand-calculated: F = n(A_part + A_runner) p SF 1.2; 1-D plate cooling at the 99.5 % "
                           "wall; fill = shot / 40 cm3/s (assumed rate); pack 8 s, open 5 s = supplier defaults")
    ej_t = np.array([tc(max(t_, 0.3)) for t_ in tf])
    S["ejection_time_s"] = {"p50": round(float(np.median(ej_t)), 1), "p99": round(float(np.percentile(ej_t, 99)), 1)}

    # ------------------------------------------------ findings -> suggest slides + change list
    F_ = []
    for u_ in sorted(ucl, key=lambda u: -u["area_mm2"])[:6]:  # largest six on slides; all in the json
        sr = u_["side_release"]
        if u_["action"] == "draft":
            txt_ = "Have undercut (0 deg wall inside a pocket), suggest to add draft 0.5º at core side"
            change = "Add 0.5 deg draft to the walls in the box (core side), neutral plane at the PL."
        elif u_["action"] in ("slider", "lifter"):
            txt_ = (f"Have undercut, need {u_['action']} ({sr['sign']:+d}{sr['axis']} in the analysis frame, "
                    f"{sr['free_pct']:.0f}% of faces released)")
            change = (f"Keep the feature (function). Tool action: {u_['action']}. Alternative only if function allows: "
                      "open a window in the core for straight pull.")
        else:
            txt_ = "Have undercut, suggest to modify part or use lifter/slider"
            change = "Review the feature: straight pull not possible, side action not found automatically."
        F_.append({"type": "undercut", "text": txt_, "change": change, **{k: u_[k] for k in ("xyz", "c_work", "where")},
                   "value": f"{u_['area_mm2']} mm2"})
    for k_ in S["steel"]["knife_edges"][:4]:
        F_.append({"type": "sharp steel", "text": "Have sharp steel, suggest to modify part, cancel 'R'. Because of "
                   f"core main ins sharp steel, easy broken (gap {k_['gap_min']:.2f} mm)",
                   "change": "Fill the gap (flat-bottomed) or remove the fillet that forms the knife edge; keep the "
                             "mating faces unchanged.", **{k: k_[k] for k in ("xyz", "c_work", "where")},
                   "value": f"{k_['gap_min']} mm"})
    for k_ in S["thickness"]["thick_spots"][:3]:
        F_.append({"type": "thickness mark", "text": f"Have thickness mark (t = {k_['t_max']:.2f} mm vs nominal "
                   f"{nominal:.2f} mm), suggest to core out / reduce rib to {0.6 * nominal:.1f} mm",
                   "change": f"Core out the thick section or make ribs 0.5-0.65 x wall ({0.6 * nominal:.1f} mm).",
                   **{k: k_[k] for k in ("xyz", "c_work", "where")}, "value": f"{k_['t_max']} mm"})
    for k_ in S["thickness"]["thin_spots"][:2]:
        F_.append({"type": "thin plastic", "text": f"part have only {k_['t_median']:.2f}mm, its difficult to filling",
                   "change": "Increase to >= 0.8 mm if function allows.", **{k: k_[k] for k in ("xyz", "c_work", "where")},
                   "value": f"{k_['t_median']} mm (min {k_['t_min']})"})
    if S["draft"]["zero_draft_area_mm2"] > 1:
        F_.append({"type": "draft", "text": "All green surface are 0º, propose to add 1.0º for cavity side & "
                   "draft 0.5º for core side", "change": "Cavity side >= 1.0 deg, core side >= 0.5 deg, neutral "
                   "plane at the PL; keep functional faces (slots, rails, catches) at 0 deg.", "xyz": None,
                   "c_work": None, "where": "all 0 deg faces", "value": f"{S['draft']['zero_draft_area_mm2']} mm2"})
    S["findings"] = F_

    # ------------------------------------------------ figures
    figs = {}
    grey = np.array([214, 218, 224])

    def rnd(name, mesh, col, view, **kw):
        p, proj = ml.render(mesh, col, FIG / name, view=view, size=kw.pop("size", (1300, 1000)), **kw)
        figs[name[:-4]] = str(Path("figures") / name)
        return proj

    projs = {}
    for v in ("cav_iso", "core_iso", "cav_plan", "side"):
        projs[v] = rnd(f"part_{v}.png", m, ml.GREEN, v)
    for v in ("cav_iso", "core_iso", "side"):
        rnd(f"pl_{v}.png", m, ml.GREEN, v, lines=pl_segs, line_w=4)
    for v in ("cav_iso", "core_iso"):
        rnd(f"draft_{v}.png", ms, ml.draft_rgb(ms), v, edges=False)
        tn = np.clip(tf / max(3.5, float(q[4])), 0, 1)
        rnd(f"thick_{v}.png", ms, ml.rainbow(tn), v, edges=False)
        col = np.where(blocked[:, None], np.array([255, 0, 0]), np.tile(ml.GREEN, (len(ms.F), 1)))
        rnd(f"uc_{v}.png", ms, col, v, edges=False)
        rnd(f"fill_{v}.png", mm, ml.rainbow((fill[mm.F].mean(1)) / np.nanmax(fill)), v, edges=False,
            points=[(cands[pick["name"]], 2.5, (0, 0, 0))])
        rnd(f"ejt_{v}.png", ms, ml.rainbow(np.clip(ej_t / max(ej_t.max(), 1e-6), 0, 1)), v, edges=False)
        rnd(f"air_{v}.png", mm, grey, v, points=[(mm.V[i], 2.2, (255, 0, 0)) for i in peaks[:8]])
        rnd(f"weld_{v}.png", mm, grey, v, lines=welds, line_w=4)
    pts = [(np.array([p["x"], p["y"], p["z"]]), p["d"] / 2, (255, 0, 0) if p["d"] >= 4 else (255, 140, 0))
           for p in chosen]
    projs["ej_core_plan"] = rnd("ej_core_plan.png", m, ml.GREEN, "core_plan", points=pts)
    ml.legend_png(FIG / "legend_draft.png", ml.draft_ramp, -0.5, 0.5, [-0.5, -0.25, 0, 0.25, 0.5], "{:+.2f}", "deg")
    tmax = max(3.5, float(q[4]))
    ml.legend_png(FIG / "legend_thick.png", ml.rainbow, 0, tmax, list(np.round(np.linspace(0, tmax, 6), 1)), "{:.1f}", "mm")
    ml.legend_png(FIG / "legend_fill.png", ml.rainbow, 0, float(np.nanmax(fill)),
                  list(np.round(np.linspace(0, float(np.nanmax(fill)), 5))), "{:.0f}", "mm")
    ml.legend_png(FIG / "legend_ejt.png", ml.rainbow, 0, float(ej_t.max()),
                  list(np.round(np.linspace(0, float(ej_t.max()), 5), 1)), "{:.1f}", "s")
    # zooms of each finding (the flagged area red)
    for i, f in enumerate(F_):
        if f["c_work"] is None:
            continue
        c = np.array(f["c_work"])
        idx = crop_faces(ms, c, np.array([12.0, 12.0, 12.0]))
        if len(idx) < 20:
            continue
        sub = ml.submesh(ms, idx)
        col = np.tile(ml.GREEN, (len(idx), 1)).astype(float)
        if f["type"] == "undercut":
            col[blocked[idx]] = (255, 0, 0)
        near = np.linalg.norm(sub.C - c, axis=1) < 2.5
        if f["type"] != "undercut":
            col[near] = (255, 0, 0)
        best = None
        for view in ("core_iso", "cav_iso"):  # keep the view that shows most of the red finding
            rnd(f"find_{i}.png", sub, col, view, size=(900, 800))
            im = np.asarray(Image.open(FIG / f"find_{i}.png").convert("RGB")).astype(int)
            red = int(((im[..., 0] > 150) & (im[..., 1] < 90) & (im[..., 2] < 90)).sum())
            if best is None or red > best[0]:
                best = (red, view)
        view = best[1]
        if view != "cav_iso":
            rnd(f"find_{i}.png", sub, col, view, size=(900, 800))
        f["zoom"] = f"find_{i}"
        f["view"] = view
        f["px"] = projs[view](c)[0].round(1).tolist()
    for st_ in S["pl"]["steps"]:
        st_["px"] = projs["core_iso"](st_["c_work"])[0].round(1).tolist()
    S["figures"] = figs
    S["px"] = {k: {"size_ref": [1300, 1000]} for k in projs}
    S["px"]["ej_core_plan"]["pins"] = [projs["ej_core_plan"]((p["x"], p["y"], p["z"]))[0].round(1).tolist()
                                       for p in chosen]
    S["px"]["gate"] = {v: projs[v](cands[pick["name"]])[0].round(1).tolist() for v in ("cav_iso", "core_iso")}
    S["px"]["plan_bbox"] = projs["cav_plan"](np.array([[lo[0], hi[1], lo[2]], [hi[0], hi[1], hi[2]]])).round(1).tolist()
    S["px"]["side_bbox"] = projs["side"](np.array([[hi[0], lo[1], lo[2]], [hi[0], hi[1], hi[2]]])).round(1).tolist()
    S["runtime_s"] = round(time.time() - t0, 1)

    # ------------------------------------------------ outputs
    (out / "dfm_summary.json").write_text(json.dumps(S, indent=1, default=float))
    write_changes(S, out / "DFM_changes.md")
    log("done ->", out)


def write_changes(S, path):
    """The DFM change list: what the corrected CAD must contain. Used when part_DFM.step cannot be written here."""
    p = S["part"]
    L = [f"# DFM change list: {p['name']} ({p['code']})", "",
         f"Material: {p['material']}{' (assumed)' if p['material_assumed'] else ''}. Pull: {S['input']['pull_stl_frame']} "
         f"in the STL frame. PL: {S['pl']['method']}.",
         "Coordinates are in the original STL / CAD frame (mm).", "",
         "| # | Type | Where | Location (x, y, z) | Value | Change in CAD | Function check |",
         "|---|---|---|---|---|---|---|"]
    for i, f in enumerate(S["findings"], 1):
        loc = "-" if f["xyz"] is None else ", ".join(f"{v:.1f}" for v in f["xyz"])
        L.append(f"| {i} | {f['type']} | {f['where']} | {loc} | {f['value']} | {f['change']} | "
                 "confirm the mating / cosmetic function is unchanged |")
    L += ["", "Rules: draft side walls about a neutral plane at the PL (the PL outline stays); ribs 0.5-0.65 x wall; "
          "R >= 0.5 on internal corners; knife-edge fills flat-bottomed; functional faces (slots, rails, catches, "
          "sealing faces) keep their geometry. Verify the corrected part with the same checks before release."]
    Path(path).write_text("\n".join(L) + "\n")


if __name__ == "__main__":
    main()

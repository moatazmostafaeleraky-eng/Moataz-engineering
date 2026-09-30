"""Full DFM run: analyse input/part.step and output/part_DFM.step, make figures + summary, build the deck.

Run from the repo root:
    python battery_cover_RE/src/battery_cover_dfm.py      # (re)build output/part_DFM.step
    python battery_cover_RE/dfm/run_dfm.py                # analysis, figures, output/DFM.pptx
"""

from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import trimesh  # noqa: E402
from matplotlib.patches import Circle, FancyArrowPatch, Rectangle  # noqa: E402

HERE = Path(__file__).resolve().parent
PROJ = HERE.parent
REPO = PROJ.parent
sys.path[:0] = [str(HERE), str(PROJ / "checks"), str(PROJ / "src")]

import meshkit as mk  # noqa: E402
import mold_calcs as mc  # noqa: E402
from dfm import analyze, undercut_mask  # noqa: E402  (battery_cover_RE/checks/dfm.py)
from lib import geometry as g  # noqa: E402
from lib import geometry_dfm as gd  # noqa: E402

IN_STEP = REPO / "input" / "part.step"
OUT_STEP = REPO / "output" / "part_DFM.step"
OUT = REPO / "output"
FIG = OUT / "figures"

C_A, C_B, C_UC, C_PART = "#4C78A8", "#F28E2B", "#D62728", "#B8C2CC"
GATES = {
    "G1": ("Top end, centre - edge gate", (15.5, 19.0, 77.0)),
    "G2": ("Side wall, mid-length - tunnel gate", (0.0, 19.0, 44.0)),
    "G3": ("Bottom end, beside recess - tunnel gate", (3.0, 19.0, 11.5)),
    "G4": ("Inner face centre - pin-point (3-plate)", (15.5, 18.0, 44.0)),
}
GATE_PICK = "G3"


def rgb(hexc):
    return np.array(matplotlib.colors.to_rgb(hexc))


def fine(mesh, edge=1.4):
    v, f = trimesh.remesh.subdivide_to_size(mesh.vertices, mesh.faces, max_edge=edge)
    return trimesh.Trimesh(v, f, process=True)


def save(fig, name, trim=True):
    from PIL import Image, ImageChops

    FIG.mkdir(parents=True, exist_ok=True)
    fig.savefig(FIG / name, dpi=170, bbox_inches="tight", facecolor="white")
    plt.close(fig)
    if trim:  # 3-D axes reserve empty space; crop to content
        im = Image.open(FIG / name).convert("RGB")
        box = ImageChops.difference(im, Image.new("RGB", im.size, "white")).getbbox()
        if box:
            pad = 18
            im.crop((max(box[0] - pad, 0), max(box[1] - pad, 0), min(box[2] + pad, im.width),
                     min(box[3] + pad, im.height))).save(FIG / name)
    return str((FIG / name).relative_to(REPO))


def trim_to_content(path, pad=14, tol=14):
    """Crop a render to its content, using the corner pixel as the background colour."""
    from PIL import Image, ImageChops

    im = Image.open(path).convert("RGB")
    bg = Image.new("RGB", im.size, im.getpixel((2, 2)))
    diff = ImageChops.difference(im, bg).convert("L").point(lambda v: 255 if v > tol else 0)
    box = diff.getbbox()
    if box:
        im.crop((max(box[0] - pad, 0), max(box[1] - pad, 0), min(box[2] + pad, im.width),
                 min(box[3] + pad, im.height))).save(path)


def plan(ax, mesh, y_levels, colors, alpha=1.0):
    """XZ plan view: filled mesh sections at the given Y levels (drawn in order)."""
    from shapely.geometry import Polygon
    from shapely.ops import unary_union

    for y, c in zip(y_levels, colors):
        sec = mesh.section(plane_origin=[0, y, 0], plane_normal=[0, 1, 0])
        if sec is None:
            continue
        polys = sorted((Polygon(p[:, [2, 0]]) for p in sec.discrete), key=lambda q: -q.area)
        solid = None
        for q in polys:
            solid = q if solid is None else (solid.difference(q) if solid.contains(q) else unary_union([solid, q]))
        for gm in getattr(solid, "geoms", [solid]):
            xs, ys = gm.exterior.xy
            ax.fill(xs, ys, color=c, alpha=alpha, lw=0.6, ec="#1F2A36")
            for hole in gm.interiors:
                hx, hy = hole.xy
                ax.fill(hx, hy, color="white", lw=0.6, ec="#1F2A36")
    ax.set_aspect("equal")
    ax.set_xlabel("Z [mm]", fontsize=8)
    ax.set_ylabel("X [mm]", fontsize=8)
    ax.tick_params(labelsize=7)


def two_views(mesh, face_rgb, name, titles=("Inner face (B / core side)", "Outer face (A / cavity side)"), lines=None,
              points_in=None, points_out=None, size=(11, 4.2)):
    fig = plt.figure(figsize=size)
    for i, view in enumerate(("inner", "outer")):
        ax = fig.add_subplot(1, 2, i + 1, projection="3d")
        mk.render(ax, mesh, face_rgb, view=view, lines=lines,
                  points=points_in if view == "inner" else points_out, title=titles[i])
    fig.subplots_adjust(wspace=0.0, left=0, right=1, top=0.92, bottom=0)
    return save(fig, name)


# ============================================================ section classifier (A / B / undercut air)
def section_map(mesh, axis, pos, lim_u, lim_v, step=0.04, ps_level=None, lifter_mm=None):
    """Raster of a planar section: 0 air-A, 1 air-B, 2 part, 3 trapped (undercut) air,
    4 trapped air a lifter can pull out within `lifter_mm` along -u (x-section: -Z).

    axis='x': section plane X=pos, raster (u=Z, v=Y);  axis='z': plane Z=pos, raster (u=X, v=Y)."""
    from shapely import contains_xy
    from shapely.geometry import Polygon
    from shapely.ops import unary_union

    normal = [1, 0, 0] if axis == "x" else [0, 0, 1]
    origin = [pos, 0, 0] if axis == "x" else [0, 0, pos]
    sec = mesh.section(plane_origin=origin, plane_normal=normal)
    cols = (2, 1) if axis == "x" else (0, 1)
    polys = sorted((Polygon(p[:, cols]) for p in sec.discrete), key=lambda p: -p.area)
    solid = None
    for p in polys:
        solid = p if solid is None else (solid.difference(p) if solid.contains(p) else unary_union([solid, p]))
    us = np.arange(*lim_u, step)
    vs = np.arange(*lim_v, step)
    U, V = np.meshgrid(us, vs)
    part = contains_xy(solid, U, V)
    out = np.zeros(part.shape, int)
    for j in range(len(us)):
        col = part[:, j]
        idx = np.flatnonzero(col)
        if not len(idx):
            lvl = ps_level(us[j]) if ps_level else (lim_v[0] + lim_v[1]) / 2
            out[:, j] = np.where(vs >= lvl, 0, 1)
            continue
        lo, hi = idx.min(), idx.max()
        out[:, j] = 3
        out[hi + 1:, j] = 0
        out[:lo, j] = 1
        out[col, j] = 2
    if lifter_mm:
        n = int(round(lifter_mm / step))
        for i, j in zip(*np.nonzero(out == 3)):
            row = out[i, max(j - n, 0):j]
            if (row != 2).all() and (row == 1).any():  # clear path back to B-side air within the travel
                out[i, j] = 4
    return us, vs, out


def plot_section(ax, sm, title, xlabel):
    us, vs, img = sm
    cmap = matplotlib.colors.ListedColormap(["#D6E4F2", "#FBE3CC", "#5B6770", C_UC, "#9467BD"])
    ax.imshow(img, origin="lower", extent=[us[0], us[-1], vs[0], vs[-1]], cmap=cmap, vmin=-0.5, vmax=4.5,
              interpolation="nearest", aspect="equal")
    ax.set_title(title, fontsize=10)
    ax.set_xlabel(xlabel, fontsize=8)
    ax.set_ylabel("Y (pull) [mm]", fontsize=8)
    ax.tick_params(labelsize=7)


# ============================================================ main
def main():
    FIG.mkdir(parents=True, exist_ok=True)
    S = {"part": {"code": "ANRMTPT0003F", "name": "Battery cover", "assembly": "ANRMTAS0001F Remote control assy",
                  "model": "TE-12XCME", "material": mc.ABS["name"]}}

    parts = {}
    for key, path in (("input", IN_STEP), ("dfm", OUT_STEP)):
        shape, m = mk.load_step(path, tol=0.02, ang=0.3)
        f = fine(m)
        parts[key] = {"shape": shape, "mesh": m, "fine": f}
        print(f"[{key}] faces {len(m.faces)} fine {len(f.faces)}")

    # ---------------------------------------------------- 1. geometry + reused checks/dfm.analyze
    for key, P in parts.items():
        st = mk.brep_stats(P["shape"])
        rep = analyze(P["mesh"])
        m = P["mesh"]
        d = mk.draft_deg(m)
        A = m.area_faces
        bins = [(0, 0.25), (0.25, 1.0), (1.0, 3.0), (3.0, 80.0), (80.0, 90.01)]
        st["draft_area_mm2"] = {f"{a}-{b}": round(float(A[(d >= a) & (d < b)].sum()), 1) for a, b in bins}
        walls = (d < 80)
        st["min_wall_draft_deg"] = round(float(d[walls & (A > 0.05)].min()), 2)
        pts, th = mk.sample_thickness(P["mesh"])
        P["th_pts"], P["th"] = pts, th
        st["thickness_mm"] = {"min": round(float(np.percentile(th, 0.5)), 2), "p5": round(float(np.percentile(th, 5)), 2),
                              "median": round(float(np.median(th)), 2), "p95": round(float(np.percentile(th, 95)), 2),
                              "max": round(float(np.percentile(th, 99.5)), 2)}
        hist_edges = [0, 0.6, 0.9, 1.1, 1.4, 1.8, 2.2, 2.6, 3.0, 7.0]
        h, _ = np.histogram(th, bins=hist_edges)
        st["thickness_hist"] = {"edges": hist_edges, "pct": [round(100 * x / len(th), 1) for x in h]}
        st["reuse_checks_dfm"] = rep
        uc = undercut_mask(P["fine"])
        P["uc_fine"] = uc
        st["undercut_area_mm2"] = round(float(P["fine"].area_faces[uc].sum()), 2)
        S[key] = st
        print(f"[{key}] thickness {st['thickness_mm']}  undercut {st['undercut_area_mm2']}")

    dfm = parts["dfm"]
    fm = dfm["fine"]
    mass_g = S["dfm"]["volume_mm3"] / 1000 * mc.ABS["density_g_cm3"]
    proj_cm2 = S["dfm"]["reuse_checks_dfm"]["projected_area_Y_cm2"]
    S["dfm"]["mass_g"] = round(mass_g, 2)
    S["input"]["mass_g"] = round(S["input"]["volume_mm3"] / 1000 * mc.ABS["density_g_cm3"], 2)

    # ---------------------------------------------------- 2. parting line / surface
    for key in ("input", "dfm"):
        P = parts[key]
        cls = mk.side_classes(P["fine"], P["uc_fine"])
        P["cls"] = cls
        P["pl"] = mk.parting_edges(P["fine"], cls)
    col = np.array([rgb(C_A), rgb(C_B), rgb("#9467BD")])  # DFM undercut faces are lifter-formed
    figs = {}
    figs["parting"] = two_views(fm, col[dfm["cls"]], "f02_parting.png", lines=dfm["pl"])

    ps_level = lambda u: 13.0 if u < 11.5 else 20.0  # noqa: E731  stepped PS: latch end / main
    fig, axs = plt.subplots(1, 2, figsize=(11, 3.4), gridspec_kw={"width_ratios": [2.3, 1]})
    plot_section(axs[0], section_map(fm, "x", 15.5, (0, 80), (11, 24), ps_level=ps_level,
                                     lifter_mm=gd.lifter_travel()["travel_mm"]),
                 "Section X = 15.5 (centre): stepped parting surface", "Z [mm]")
    plot_section(axs[1], section_map(fm, "z", 40.0, (-3, 34), (14, 23), ps_level=lambda u: 20.0),
                 "Section Z = 40: PL at outer-face edge", "X [mm]")
    for ax, segs in ((axs[0], [[(0, 13), (g.LATCH_TIP_Z, 13)], [(g.Z_TOP, 20), (80, 20)]]),
                     (axs[1], [[(-3, 20), (0, 20)], [(g.WIDTH, 20), (34, 20)]])):
        for seg in segs:
            xs, ys = zip(*seg)
            ax.plot(xs, ys, "-", color=C_UC, lw=2.0)
    axs[0].text(2.7, 13.5, "PS", color=C_UC, fontsize=8, ha="center")
    axs[0].text(78.5, 20.5, "PS", color=C_UC, fontsize=8, ha="center")
    axs[0].text(40, 22.6, "A  (cavity, fixed half)", ha="center", fontsize=8)
    axs[0].text(40, 12.0, "B  (core, moving half)", ha="center", fontsize=8)
    fig.tight_layout()
    figs["ps_section"] = save(fig, "f02_ps_sections.png")
    S["parting"] = {"pl_edges": int(len(dfm["pl"])), "main_pl_Y": 20.0, "latch_step_Y": 13.0, "step_mm": 7.0}

    # ---------------------------------------------------- 3. draft maps (before / after)
    def draft_rgb(mesh):
        d = mk.draft_deg(mesh)
        c = np.tile(rgb("#C9D1D9"), (len(d), 1))
        c[d < 80] = rgb("#59A14F")
        c[(d < 2.9)] = rgb("#8CD17D")
        c[(d < 0.9)] = rgb("#F1CE63")
        c[d < 0.25] = rgb(C_UC)
        return c

    fig = plt.figure(figsize=(11, 7.2))
    for i, key in enumerate(("input", "dfm")):
        for j, view in enumerate(("inner", "outer")):
            ax = fig.add_subplot(2, 2, 2 * i + j + 1, projection="3d")
            mk.render(ax, parts[key]["fine"], draft_rgb(parts[key]["fine"]), view=view,
                      title=f"{'AS RECEIVED' if key == 'input' else 'DFM'} - {view} face")
    fig.subplots_adjust(wspace=0, hspace=0.08, left=0, right=1, top=0.95, bottom=0)
    figs["draft"] = save(fig, "f03_draft.png")

    # ---------------------------------------------------- 4. undercut
    inp = parts["input"]
    c_in = np.tile(rgb(C_PART), (len(inp["fine"].faces), 1))
    c_in[inp["uc_fine"]] = rgb(C_UC)
    figs["undercut_3d"] = two_views(inp["fine"], c_in, "f04_undercut_3d.png",
                                    titles=("AS RECEIVED - undercut faces (red)", "AS RECEIVED - outer face"))
    lift = gd.lifter_travel()
    fig, axs = plt.subplots(1, 2, figsize=(11, 3.6))
    for ax, key, t, lm in ((axs[0], "input", "BEFORE: hook gap is a straight-pull undercut (red)", None),
                           (axs[1], "dfm", f"DFM: gap moulded by the lifter head (purple), out {lift['travel_mm']} mm in -Z",
                            lift["travel_mm"])):
        plot_section(ax, section_map(parts[key]["fine"], "x", 15.5, (62, 79), (14.5, 23.5), ps_level=lambda u: 20.0,
                                     lifter_mm=lm), t, "Z [mm]")
    zl = g.HOOK_BLOCK_Z[0]
    axs[1].annotate("", (zl - lift["travel_mm"], 17.5), (zl + 1.5, 17.5),
                    arrowprops={"arrowstyle": "->", "color": "#6a3d9a", "lw": 1.5})
    fig.tight_layout()
    figs["undercut_sec"] = save(fig, "f04_undercut_sections.png")
    # DFM: every straight-pull undercut face must be free within the lifter travel along -Z
    dm = dfm["fine"]
    idx = np.flatnonzero(dfm["uc_fine"])
    o = dm.triangles_center[idx] + 1e-3 * dm.face_normals[idx]
    ray = trimesh.ray.ray_triangle.RayMeshIntersector(dm)
    loc, ri, _ = ray.intersects_location(o, np.tile([0.0, 0.0, -1.0], (len(o), 1)), multiple_hits=True)
    first = np.full(len(o), np.inf)
    for pt, r in zip(loc, ri):
        first[r] = min(first[r], float(np.linalg.norm(pt - o[r])))
    released = first > lift["travel_mm"]
    a = dm.area_faces[idx]
    S["undercut"] = {"before_mm2": S["input"]["undercut_area_mm2"], "dfm_straight_pull_mm2": S["dfm"]["undercut_area_mm2"],
                     "dfm_lifter_released_mm2": round(float(a[released].sum()), 2),
                     "dfm_unreleased_mm2": round(float(a[~released].sum()), 3), "lifter": lift,
                     "window_rejected": "a through-hole in a battery cover exposes the cells and lets in dust"}

    # ---------------------------------------------------- 5. thickness maps
    cmap = plt.get_cmap("turbo")
    norm = matplotlib.colors.Normalize(0.6, 3.0)
    tf = mk.to_faces(fm, dfm["th_pts"], dfm["th"])
    fig = plt.figure(figsize=(11, 4.4))
    for i, view in enumerate(("inner", "outer")):
        ax = fig.add_subplot(1, 2, i + 1, projection="3d")
        mk.render(ax, fm, cmap(norm(tf)), view=view, title=f"DFM wall thickness - {view} face")
    cax = fig.add_axes([0.3, 0.05, 0.4, 0.03])
    fig.colorbar(matplotlib.cm.ScalarMappable(norm=norm, cmap=cmap), cax=cax, orientation="horizontal",
                 label="inscribed-sphere thickness [mm]")
    fig.subplots_adjust(wspace=0, left=0, right=1, top=0.93, bottom=0.12)
    figs["thickness"] = save(fig, "f05_thickness.png")

    # ---------------------------------------------------- 6. gates (flow-length proxy)
    gate_res = {}
    for k, (label, p) in GATES.items():
        dist, src = mk.geodesic_from(fm, p)
        gate_res[k] = {"label": label, "point": p, "max_flow_mm": round(float(dist.max()), 1),
                       "L_over_t": round(float(dist.max()) / g.WALL, 1),
                       "last_fill": np.round(fm.vertices[int(np.argmax(dist))], 1).tolist()}
        if k == GATE_PICK:
            dfm["fill"] = dist
    S["gates"] = gate_res
    S["gate_pick"] = GATE_PICK
    fig, ax = plt.subplots(figsize=(10, 4.2))
    plan(ax, fm, [19.0, 14.0], ["#D6E4F2", "#9FB4C8"])
    for k, (label, p) in GATES.items():
        pick = k == GATE_PICK
        ax.scatter([p[2]], [p[0]], marker="v", s=160 if pick else 80, c=C_UC if pick else "#1F2A36", zorder=5)
        dx = {"G1": -2, "G2": 0, "G3": 0, "G4": 0}[k]
        ax.annotate(f"{k}: {gate_res[k]['max_flow_mm']:.0f} mm", (p[2], p[0]), (p[2] + 3 + dx, p[0] + 3.2),
                    fontsize=9, fontweight="bold" if pick else "normal", color=C_UC if pick else "#1F2A36")
    lf = gate_res[GATE_PICK]["last_fill"]
    ax.scatter([lf[2]], [lf[0]], marker="*", s=160, c="#F28E2B", zorder=5)
    ax.annotate("last to fill (G3)", (lf[2], lf[0]), (lf[2] - 22, lf[0] + 4), fontsize=8, color="#b35806",
                arrowprops={"arrowstyle": "->", "color": "#b35806"})
    ax.set_title("Gate candidates (plan view, outer face up): max flow length per gate", fontsize=10)
    ax.set_xlim(2, 84)
    ax.set_ylim(-6, 40)
    figs["gates"] = save(fig, "f06_gates.png")

    # ---------------------------------------------------- 7. ejection
    ray = trimesh.ray.ray_triangle.RayMeshIntersector(dfm["mesh"])
    pins = []
    for x in (3.6, g.WIDTH / 2, g.WIDTH - 3.6):
        for z in (22.0, 44.0, 64.0):
            in_lifter = g.HOOK_X[0] - 2 < x < g.HOOK_X[1] + 2 and z > g.HOOK_BLOCK_Z[0] - 10
            if not in_lifter and mk.flat_pad_ok(dfm["mesh"], x, z, 1.5 + 0.5, gd.Y_IN, ray=ray):
                pins.append({"x": x, "z": z, "y": gd.Y_IN, "d": 3.0, "on": "plate inner face"})
    extra = [((g.WIDTH / 2, 70.75), 1.0 + 0.3, g.HOOK_BLOCK_Y[0], 2.0, "hook block"),
             ((g.WIDTH / 2, 9.0), 1.0 + 0.3, g.LATCH_ARM_Y[0], 2.0, "latch arm (inner face)")]
    for (x, z), r, yf, dia, on in extra:
        ok = mk.flat_pad_ok(dfm["mesh"], x, z, r, yf, ray=ray, tol=0.08)
        pins.append({"x": x, "z": z, "y": yf, "d": dia, "on": on, "checked": bool(ok)})
    S["ejection"] = {"pins": pins, "n_pins": len(pins),
                     "stroke_mm": 15.0, "core_depth_mm": round(g.Y_OUTER - g.LATCH_ARM_Y[0], 1)}
    fig, ax = plt.subplots(figsize=(10, 4.2))
    plan(ax, fm, [19.0, 17.0, 13.5], ["#FBE3CC", "#E8A76B", "#C9762F"])
    for i, p in enumerate(pins, 1):
        ax.add_patch(Circle((p["z"], p["x"]), p["d"] / 2, fc="#1b9e77", ec="k", lw=0.8, zorder=5))
        ax.text(p["z"], p["x"] + p["d"] / 2 + 1.0, str(i), ha="center", fontsize=7, zorder=6)
    ax.set_title("Ejector pins on the B (core) side - true size: Ø3 on plate, Ø2 on hook block and latch arm",
                 fontsize=10)
    ax.set_xlim(2, 80)
    ax.set_ylim(-4, 35)
    figs["ejection"] = save(fig, "f07_ejection.png")

    # ---------------------------------------------------- 8. cavities / tonnage
    th_gov = g.WALL
    t_c = mc.cooling_time(th_gov)
    cyc = mc.cycle_time(t_c)
    S["cooling"] = {"governing_wall_mm": th_gov, "t_cool_s": round(t_c, 1),
                    "t_cool_thickest_s": round(mc.cooling_time(S["dfm"]["thickness_mm"]["max"]), 1), "cycle": cyc}
    S["tonnage"] = mc.tonnage_table(proj_cm2, mass_g, cycle_s=cyc["total_s"])
    S["cavity_pick"] = 4
    pick = next(r for r in S["tonnage"] if r["cavities"] == S["cavity_pick"])
    S["coolant"] = mc.coolant(pick["shot_g"], cyc)

    fig, ax = plt.subplots(figsize=(6.2, 4.6))
    L, W = g.Z_TOP - g.LATCH_TIP_Z, g.WIDTH
    centres = [(-22, 42), (22, 42), (-22, -42), (22, -42)]
    ax.plot([-22, 22], [0, 0], color="#8c564b", lw=5, solid_capstyle="round")
    for cx, cy in centres:
        ax.add_patch(Rectangle((cx - W / 2, cy - L / 2 if cy > 0 else cy - L / 2), W, L, fc="#D6E4F2", ec="#1F2A36"))
        ax.plot([cx, cx], [0, cy - np.sign(cy) * L / 2], color="#8c564b", lw=3.5)
        gy = cy - np.sign(cy) * L / 2
        ax.plot([cx, cx - W / 2 + 3], [gy, gy], color="#8c564b", lw=2)
        ax.scatter([cx - W / 2 + 3], [gy], marker="v", s=40, c=C_UC, zorder=5)
    ax.add_patch(Circle((0, 0), 3.5, fc="#8c564b"))
    ax.text(0, 5, "sprue", ha="center", fontsize=8)
    ax.set_title("4-cavity, H-balanced cold runner; latch ends face the runner (tunnel gate G3)", fontsize=9)
    ax.set_xlim(-50, 50)
    ax.set_ylim(-84, 84)
    ax.set_aspect("equal")
    ax.set_xlabel("mm")
    ax.tick_params(labelsize=7)
    figs["layout"] = save(fig, "f08_layout.png")

    # ---------------------------------------------------- 9. cooling schematic
    fig, axs = plt.subplots(1, 2, figsize=(11, 3.8), gridspec_kw={"width_ratios": [1, 1.5]})
    us, vs, img = section_map(fm, "z", 40.0, (-12, 43), (4, 34), step=0.08, ps_level=lambda u: 20.0)
    img2 = np.where(img == 2, 2, np.where(vs[:, None] >= 20, 0, 1))
    plot_section(axs[0], (us, vs, img2), "Section Z = 40 with Ø6 channels (depth 12 mm, pitch 18 mm)", "X [mm]")
    for cx in (g.WIDTH / 2 - 9, g.WIDTH / 2 + 9):
        axs[0].add_patch(Circle((cx, 20 + 12), 3, fc="#2c7fb8"))
        axs[0].add_patch(Circle((cx, 16 - 10), 3, fc="#2c7fb8"))
    axs[0].text(g.WIDTH / 2, 27.2, "A plate", ha="center", fontsize=8)
    axs[0].text(g.WIDTH / 2, 10.8, "B plate", ha="center", fontsize=8)
    ax = axs[1]
    for cx, cy in centres:
        ax.add_patch(Rectangle((cx - W / 2, cy - L / 2), W, L, fc="#EEF2F6", ec="#1F2A36"))
    for x in (-22 - 9, -22 + 9, 22 - 9, 22 + 9):
        ax.plot([x, x], [-84, 84], color="#2c7fb8", lw=2.2)
    ax.plot([-31, -13], [84, 84], color="#2c7fb8", lw=2.2)
    ax.plot([13, 31], [84, 84], color="#2c7fb8", lw=2.2)
    ax.plot([-13, 13], [-84, -84], color="#2c7fb8", lw=2.2)
    ax.annotate("IN 60 °C", (-31, -84), (-52, -97), fontsize=8, arrowprops={"arrowstyle": "->"})
    ax.annotate("OUT", (31, -84), (38, -97), fontsize=8, arrowprops={"arrowstyle": "->"})
    for cx, cy in centres:
        ax.add_patch(Circle((cx, cy - np.sign(cy) * 31), 2.2, fc="#d62728"))
    ax.set_title("Series circuit per half (A shown); red = Ø4 bubbler at latch core", fontsize=9)
    ax.set_xlim(-58, 58)
    ax.set_ylim(-102, 92)
    ax.set_aspect("equal")
    ax.tick_params(labelsize=7)
    fig.tight_layout()
    figs["cooling"] = save(fig, "f09_cooling.png")

    # ---------------------------------------------------- 10. fill sequence (geodesic proxy)
    dist = dfm["fill"]
    frac = dist / dist.max()
    fvals = frac[fm.faces].mean(axis=1)
    cm = plt.get_cmap("viridis")
    bands = (np.minimum(np.floor(fvals * 5), 4) + 0.5) / 5
    fig = plt.figure(figsize=(11, 4.6))
    gpt = [(np.array(GATES[GATE_PICK][1]), {"s": 110, "c": C_UC, "marker": "v", "depthshade": False, "zorder": 10})]
    for i, view in enumerate(("inner", "outer")):
        ax = fig.add_subplot(1, 2, i + 1, projection="3d")
        mk.render(ax, fm, cm(bands), view=view, points=gpt, title=f"Fill sequence from {GATE_PICK} - {view} face")
    cax = fig.add_axes([0.3, 0.05, 0.4, 0.03])
    fig.colorbar(matplotlib.cm.ScalarMappable(norm=matplotlib.colors.Normalize(0, 100), cmap=cm), cax=cax,
                 orientation="horizontal", label="% of flow length (20 % bands, gate = 0)")
    fig.subplots_adjust(wspace=0, left=0, right=1, top=0.93, bottom=0.12)
    figs["fill"] = save(fig, "f10_fill.png")
    last = fm.vertices[int(np.argmax(dist))]
    S["fill"] = {"gate": GATE_PICK, "max_flow_mm": round(float(dist.max()), 1), "last_fill_xyz": np.round(last, 1).tolist(),
                 "weld_line": "none on the cosmetic face (no openings in the plate); fronts meet only around the "
                              "hook block on the inner side",
                 "fill_time_s_est": 0.6}

    # ---------------------------------------------------- 11. warpage / deflection
    span = g.HOOK_BLOCK_Z[0] + (g.HOOK_BLOCK_Z[1] - g.HOOK_BLOCK_Z[0]) / 2 - g.Z_BOTTOM
    sp_in = mk.section_props(parts["input"]["mesh"], 40.0)
    sp_out = mk.section_props(fm, 40.0)
    measured_bow = 0.34
    S["warpage"] = {
        "span_mm": round(span, 2),
        "bow_per_K_mm": round(mc.thermal_bow(1.0, g.Z_TOP - g.Z_BOTTOM, g.WALL), 4),
        "bow_at_dT": {str(dT): round(mc.thermal_bow(dT, g.Z_TOP - g.Z_BOTTOM, g.WALL), 3) for dT in (2, 5, 10, 14, 20)},
        "measured_source_bow_mm": measured_bow,
        "dT_equivalent_K": round(mc.dT_for_bow(measured_bow, g.Z_TOP - g.Z_BOTTOM, g.WALL), 1),
        "section_before": {k: round(v, 3) for k, v in sp_in.items()},
        "section_after": {k: round(v, 3) for k, v in sp_out.items()},
        "thumb_10N_before": mc.beam_midspan(10, span, sp_in["I_mm4"], sp_in["c_mm"]),
        "thumb_10N_after": mc.beam_midspan(10, span, sp_out["I_mm4"], sp_out["c_mm"]),
        "shrink_mm": [round(p / 100 * (g.Z_TOP - g.LATCH_TIP_Z), 2) for p in mc.ABS["shrinkage_pct"]],
    }
    fig, ax = plt.subplots(figsize=(5.8, 3.0))
    sm = section_map(fm, "z", 40.0, (-1, 32), (15.3, 20.7), step=0.03, ps_level=lambda u: 20.0)
    img = np.where(sm[2] == 2, 2, 0)
    plot_section(ax, (sm[0], sm[1], img), "DFM section Z = 40 (plate + ribs + rails)", "X [mm]")
    ax.axhline(sp_out["yc"], color=C_UC, ls="--", lw=1)
    ax.text(31.5, sp_out["yc"] + 0.15, f"neutral axis Y={sp_out['yc']:.2f}", fontsize=7, ha="right", color=C_UC)
    fig.tight_layout()
    figs["section"] = save(fig, "f11_section.png")

    # ---------------------------------------------------- 1 / 12 renders + assembly crop
    snaps = {"input_inner": PROJ / "tmp" / "snap_a.png", "input_outer": PROJ / "tmp" / "snap_b.png",
             "dfm_inner": PROJ / "tmp" / "dfm_a.png", "dfm_outer": PROJ / "tmp" / "dfm_b.png"}
    for k, p in snaps.items():
        key, view = k.split("_")
        if p.exists():
            shutil.copy(p, FIG / f"r_{k}.png")
        else:  # no cadgen snapshot available: plain shaded render
            fig = plt.figure(figsize=(4, 6))
            ax = fig.add_subplot(1, 1, 1, projection="3d")
            mk.render(ax, parts[key]["fine"], np.tile(rgb(C_PART), (len(parts[key]["fine"].faces), 1)), view=view,
                      elev=25, azim=-30)
            fig.savefig(FIG / f"r_{k}.png", dpi=150, bbox_inches="tight", facecolor="white")
            plt.close(fig)
        trim_to_content(FIG / f"r_{k}.png")
        figs[f"r_{k}"] = str((FIG / f"r_{k}.png").relative_to(REPO))
    pdf = Path(sys.argv[1]) if len(sys.argv) > 1 else None
    if pdf and pdf.exists():
        import pymupdf as fitz

        page = fitz.open(pdf)[0]
        clip = fitz.Rect(330, 215, 1420, 455)  # exploded view: battery cover + callout (sheet 1)
        page.get_pixmap(dpi=200, clip=clip).save(FIG / "f01_assembly.png")
        figs["assembly"] = str((FIG / "f01_assembly.png").relative_to(REPO))

    S["figures"] = figs
    S["material"] = mc.ABS
    S["dfm_changes"] = {
        "draft_core_deg": gd.DRAFT_CORE, "draft_cavity_deg": gd.DRAFT_CAVITY, "draft_lifter_deg": gd.DRAFT_LIFTER,
        "r_min_mm": gd.R_MIN, "rib_w_before": g.RIB_W, "rib_w_after": gd.RIB_W, "wall_mm": g.WALL,
    }
    (OUT / "dfm_summary.json").write_text(json.dumps(S, indent=2, default=float))
    print("summary ->", OUT / "dfm_summary.json")

    import make_ppt

    make_ppt.build(S, REPO, OUT / "DFM.pptx")
    print("deck ->", OUT / "DFM.pptx")


if __name__ == "__main__":
    main()

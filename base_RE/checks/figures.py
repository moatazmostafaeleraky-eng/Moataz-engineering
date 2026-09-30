"""Report figures: rebuilt model views, deviation map, source-vs-model sections.

Run from base_RE/ after checks/deviation.py:  python checks/figures.py
"""

import matplotlib
import numpy as np
import trimesh

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
from matplotlib import cm, colors  # noqa: E402
from mpl_toolkits.mplot3d.art3d import Poly3DCollection  # noqa: E402

SRC = trimesh.load("source/base.STL")
MODEL = trimesh.load("STL/base.stl")
LIGHT = np.array([0.35, 0.55, 0.75]) / np.linalg.norm([0.35, 0.55, 0.75])


def shaded(mesh, rgb):
    s = 0.4 + 0.6 * np.clip(np.abs(mesh.face_normals @ LIGHT), 0, 1)
    return np.clip(np.asarray(rgb)[None, :] * s[:, None], 0, 1)


def draw(ax, mesh, face_rgb, elev, azim, title):
    ax.add_collection3d(Poly3DCollection(mesh.triangles, facecolors=face_rgb, edgecolor="none", linewidth=0))
    lo, hi = mesh.bounds
    ax.set_xlim(lo[0], hi[0]); ax.set_ylim(lo[1], hi[1]); ax.set_zlim(lo[2], hi[2])
    ax.set_box_aspect(hi - lo)
    ax.set_proj_type("ortho")
    ax.view_init(elev=elev, azim=azim, vertical_axis="y")
    ax.set_axis_off()
    ax.set_title(title, fontsize=12)


# 1. rebuilt model: cosmetic side and inside (ribs)
green = (0.35, 0.68, 0.40)
for name, elev, azim, title in (("rebuilt_outer_iso", 35, -125, "Rebuilt rear case: outer (cosmetic) side"),
                                ("rebuilt_inner_iso", -55, -125, "Rebuilt rear case: inside (ribs, battery bay)")):
    fig = plt.figure(figsize=(8, 11))
    draw(fig.add_subplot(projection="3d"), MODEL, shaded(MODEL, green), elev, azim, title)
    plt.tight_layout()
    plt.savefig(f"images/{name}.png", dpi=110)
    plt.close(fig)

# 2. deviation map: source surface coloured by distance to the model
pd = np.load("checks/_dev_src.npy")
_, d, _ = trimesh.proximity.closest_point(MODEL, SRC.triangles_center)
norm = colors.Normalize(0, 0.10)
rgb = cm.turbo(norm(np.clip(d, 0, 0.10)))[:, :3]
rgb = shaded(SRC, (1, 1, 1)) * rgb
fig = plt.figure(figsize=(15, 10))
for i, (elev, azim, t) in enumerate(((35, -125, "outer side"), (-55, -125, "inside"))):
    draw(fig.add_subplot(1, 2, i + 1, projection="3d"), SRC, rgb, elev, azim, t)
cax = fig.add_axes([0.93, 0.25, 0.015, 0.5])
fig.colorbar(cm.ScalarMappable(norm=norm, cmap="turbo"), cax=cax, label="source -> model distance [mm] (clipped at 0.10)")
fig.suptitle(f"Deviation map: mean {pd[:, 3].mean():.3f} mm, {100 * (pd[:, 3] <= 0.05).mean():.2f} % within 0.05 mm", fontsize=14)
plt.savefig("images/deviation_map.png", dpi=90)
plt.close(fig)


# 3. sections: source (blue fill) vs model (red outline)
def section(mesh, origin, normal, cols):
    s = mesh.section(plane_origin=origin, plane_normal=normal)
    return [] if s is None else [p[:, cols] for p in s.discrete]


jobs = [("XY section @ Z 40 (bottom-end ribs)", [0, 0, 40], [0, 0, 1], (0, 1), None),
        ("XY section @ Z 100 (battery bay)", [0, 0, 100], [0, 0, 1], (0, 1), None),
        ("XY section @ Z 143.9 (contact walls)", [0, 0, 143.9], [0, 0, 1], (0, 1), None),
        ("YZ section @ X 26.12 (centre line)", [26.12, 0, 0], [1, 0, 0], (2, 1), None),
        ("YZ section @ X 14.1 (rib with ramps)", [14.1, 0, 0], [1, 0, 0], (2, 1), None),
        ("YZ section @ X 47.5 (side ribs)", [47.5, 0, 0], [1, 0, 0], (2, 1), None)]
fig, axs = plt.subplots(6, 1, figsize=(16, 26), gridspec_kw={"height_ratios": [1, 1, 1, 1.1, 1.1, 1.1]})
for ax, (t, o, n, cols, _) in zip(axs, jobs):
    for p in section(SRC, o, n, cols):
        ax.fill(p[:, 0], p[:, 1], color="#4f8fd6", alpha=0.45, lw=0)
    for p in section(MODEL, o, n, cols):
        ax.plot(p[:, 0], p[:, 1], color="#d62728", lw=0.7)
    ax.set_aspect("equal"); ax.grid(alpha=0.3); ax.set_title(t + "   (blue = source mesh, red = rebuilt model)")
plt.tight_layout()
plt.savefig("images/source_vs_rebuilt_sections.png", dpi=70)
plt.close(fig)
print("figures written to images/")

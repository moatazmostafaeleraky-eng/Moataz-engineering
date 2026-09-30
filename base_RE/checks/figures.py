"""Report figures: deviation map and source-vs-model sections.

Run from base_RE/ after checks/deviation.py:  python checks/figures.py
"""

import matplotlib
import numpy as np
import trimesh

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
from matplotlib import cm, colors  # noqa: E402

SRC = trimesh.load("source/base.STL")
MODEL = trimesh.load("STL/base.stl")
# 1. rebuilt model views are rendered with cadgen (see REPORT.md, 'Reproduce')

# 2. deviation map: every source sample coloured by its distance to the model (worst drawn on top)
pd = np.load("checks/_dev_src.npy")
pd = pd[np.argsort(pd[:, 3])]
norm = colors.Normalize(0, 0.10)
fig, axs = plt.subplots(1, 2, figsize=(16, 12), gridspec_kw={"width_ratios": [1, 0.55]})
axs[0].scatter(pd[:, 2], pd[:, 0], c=pd[:, 3], cmap="turbo", norm=norm, s=1.2, lw=0)
axs[0].set_xlabel("Z [mm]"); axs[0].set_ylabel("X [mm]"); axs[0].set_title("plan view (all depths)")
axs[1].scatter(pd[:, 1], pd[:, 0], c=pd[:, 3], cmap="turbo", norm=norm, s=1.2, lw=0)
axs[1].set_xlabel("Y [mm]"); axs[1].set_title("end view (all lengths)")
for ax in axs:
    ax.set_aspect("equal"); ax.grid(alpha=0.3)
fig.colorbar(cm.ScalarMappable(norm=norm, cmap="turbo"), ax=axs, shrink=0.5,
             label="source -> model distance [mm] (clipped at 0.10)")
fig.suptitle(f"Deviation: mean {pd[:, 3].mean():.4f} mm, {100 * (pd[:, 3] <= 0.05).mean():.2f} % of "
             f"{len(pd)} samples within 0.05 mm, max {pd[:, 3].max():.2f} mm", fontsize=14)
plt.savefig("images/deviation_map.png", dpi=80, bbox_inches="tight")
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

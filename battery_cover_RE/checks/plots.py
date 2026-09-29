"""Deviation colour maps and feature views for the report. Run after checks/deviation.py."""

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

fig, axs = plt.subplots(1, 4, figsize=(16, 9), constrained_layout=True)
vmax = 0.35
for col, (name, title) in enumerate([("design_intent", "Design-intent (flat)"), ("as_measured", "As-measured (bowed)")]):
    P = np.load(f"checks/_dev_{name}.npy")
    for j, (sel, face) in enumerate([(P[:, 1] >= 19.0, "outer face (+Y)"), (P[:, 1] < 19.0, "inner face (-Y)")]):
        ax = axs[col * 2 + j]
        Q = P[sel]
        Q = Q[np.argsort(Q[:, 3])]
        sc = ax.scatter(Q[:, 0], Q[:, 2], c=Q[:, 3], s=1.2, cmap="turbo", vmin=0, vmax=vmax)
        ax.set_aspect("equal")
        ax.set_xlim(-1, 32)
        ax.set_ylim(4, 78)
        ax.set_title(f"{title}\n{face}\nmax {Q[:, 3].max():.3f} mm", fontsize=10)
        ax.set_xlabel("X [mm]")
        if col * 2 + j == 0:
            ax.set_ylabel("Z [mm]")
fig.colorbar(sc, ax=axs, shrink=0.6, label="deviation source -> model [mm]")
fig.suptitle("Battery cover - surface deviation of rebuilt CAD vs source mesh", fontsize=13)
plt.savefig("images/deviation_map.png", dpi=110)

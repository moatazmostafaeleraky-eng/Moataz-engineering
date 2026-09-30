"""Two-way surface deviation between a source mesh and a model mesh (offline: numpy + scipy).

    python deviation_offline.py source.stl model.stl [--n 60000] [--out deviation_report.json]

Samples both surfaces, measures exact point-to-triangle distance to the other one, and reports mean, p95,
p99, max, % within +/-0.05 / 0.10 mm, the Hausdorff distance and the worst regions (clustered by location).
Use it when the model was built outside this sandbox: ask the user to export the model as a fine STL
(chord 0.005-0.01 mm) and compare it with the source mesh here.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import meshlite as ml  # noqa: E402


def one_way(a, b, n, seed):
    P, _ = a.sample(n, seed)
    d = ml.point_mesh_distance(b, P)
    return P, d


def stats(d):
    return {"mean": round(float(d.mean()), 4), "p95": round(float(np.percentile(d, 95)), 4),
            "p99": round(float(np.percentile(d, 99)), 4), "max": round(float(d.max()), 4),
            "within_0.05mm_%": round(float((d <= 0.05).mean() * 100), 2),
            "within_0.10mm_%": round(float((d <= 0.10).mean() * 100), 2)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("source")
    ap.add_argument("model")
    ap.add_argument("--n", type=int, default=60000)
    ap.add_argument("--out", default="deviation_report.json")
    a = ap.parse_args()
    src, mod = ml.Mesh.load(a.source), ml.Mesh.load(a.model)
    Ps, ds = one_way(src, mod, a.n, 1)
    Pm, dm = one_way(mod, src, a.n, 2)
    worst = []
    bad = np.flatnonzero(ds > 0.05)
    for c in ml.point_clusters(Ps[bad], 3.0)[:10]:
        worst.append({"n": int(len(c)), "xyz": np.round(Ps[bad][c].mean(0), 2).tolist(),
                      "max_mm": round(float(ds[bad][c].max()), 3)})
    rep = {"source": src.stats(), "model": mod.stats(), "dev_source_to_model": stats(ds),
           "dev_model_to_source": stats(dm), "hausdorff_mm": round(float(max(ds.max(), dm.max())), 4),
           "volume_delta_%": round((mod.stats()["volume_mm3"] / src.stats()["volume_mm3"] - 1) * 100, 3),
           "worst_regions_source_to_model": worst, "samples_each_way": a.n,
           "basis": "measured: exact point-to-triangle distance at area-weighted random samples"}
    Path(a.out).write_text(json.dumps(rep, indent=1))
    print(json.dumps({k: rep[k] for k in ("dev_source_to_model", "dev_model_to_source", "hausdorff_mm",
                                          "volume_delta_%")}, indent=1))


if __name__ == "__main__":
    main()

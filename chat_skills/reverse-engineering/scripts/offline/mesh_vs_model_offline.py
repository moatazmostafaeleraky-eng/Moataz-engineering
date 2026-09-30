"""Side-by-side image: source mesh vs the reverse-engineered model (both as STL), offline (numpy + Pillow).

    python mesh_vs_model_offline.py source.stl model.stl [--report deviation_report.json] [--out mesh_vs_model.png]

The model STL is the fine export of the STEP (built here, or built by the user's CAD from the delivered script).
"""

from __future__ import annotations

import argparse
import json
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parent))
import meshlite as ml  # noqa: E402


def crop(path, pad=20):
    im = Image.open(path).convert("RGB")
    b = ImageChops.difference(im, Image.new("RGB", im.size, "white")).getbbox()
    return im.crop((max(b[0] - pad, 0), max(b[1] - pad, 0), min(b[2] + pad, im.width), min(b[3] + pad, im.height)))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("source")
    ap.add_argument("model")
    ap.add_argument("--report", default=None)
    ap.add_argument("--out", default="mesh_vs_model.png")
    ap.add_argument("--views", default="cav_iso,core_iso")
    a = ap.parse_args()
    src, mod = ml.Mesh.load(a.source), ml.Mesh.load(a.model)
    views = a.views.split(",")
    tiles = {}
    with tempfile.TemporaryDirectory() as d:
        for k, m, col in (("mesh", src, (200, 202, 208)), ("model", mod, ml.GREEN)):
            for v in views:
                p, _ = ml.render(m, col, Path(d) / f"{k}_{v}.png", view=v, size=(1100, 1000), edges=(k == "model"))
                im = crop(p)
                if k == "mesh":  # show the triangles: every edge, thin
                    e, _, _, _ = m.edges()
                    p2, _ = ml.render(m, col, Path(d) / f"{k}_{v}_w.png", view=v, size=(1100, 1000), edges=False,
                                      lines=m.V[e] if len(e) < 400000 else None, line_rgb=(90, 90, 100), line_w=1)
                    im = crop(p2)
                tiles[(k, v)] = im
    cw = max(im.width for im in tiles.values())
    ch = max(im.height for im in tiles.values())
    head, foot, gap = 130, 90, 30
    W = 2 * cw + 3 * gap
    H = head + len(views) * (ch + gap) + foot
    sheet = Image.new("RGB", (W, H), "white")
    dr = ImageDraw.Draw(sheet)
    cols = {"mesh": gap, "model": 2 * gap + cw}
    rep = json.loads(Path(a.report).read_text()) if a.report else None
    sub = {"mesh": f"{len(src.F):,} triangles, no features",
           "model": "reverse-engineered solid" + (f", {rep['model'].get('faces', '')} mesh faces" if rep else "")}
    for k, x in cols.items():
        dr.text((x, 25), "SOURCE MESH (STL)" if k == "mesh" else "REVERSE-ENGINEERED CAD", fill=(20, 20, 20),
                font=ml._font(38))
        dr.text((x, 75), sub[k], fill=(90, 90, 90), font=ml._font(24))
    for (k, v), im in tiles.items():
        r = views.index(v)
        sheet.paste(im, (cols[k] + (cw - im.width) // 2, head + r * (ch + gap) + (ch - im.height) // 2))
    if rep:
        s2m = rep["dev_source_to_model"]
        dr.text((gap, H - foot + 25), f"Deviation source -> model: mean {s2m['mean']:.4f} mm | {s2m['within_0.05mm_%']:.1f} % "
                f"within +/-0.05 mm | Hausdorff {rep['hausdorff_mm']:.2f} mm | volume {rep['volume_delta_%']:+.2f} %",
                fill=(20, 20, 20), font=ml._font(26))
    sheet.save(a.out)
    print("->", a.out, sheet.size)


if __name__ == "__main__":
    main()

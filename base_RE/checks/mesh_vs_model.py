"""Side-by-side image: source mesh (STL triangles) vs reverse-engineered B-rep (STEP faces).

Run from base_RE/:  python checks/mesh_vs_model.py   ->  images/mesh_vs_model.png
Needs VTK with off-screen rendering (libosmesa6). Numbers come from checks/deviation_report.json.
"""

import json
import sys
from pathlib import Path

import build123d as bd
import numpy as np
import trimesh
import vtk
from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "dfm"))
import vtkview as vv  # noqa: E402

OUT = Path("images")
TMP = Path("tmp")
TMP.mkdir(exist_ok=True)
SIZE = (1100, 1300)
VIEWS = {"outside": "cav_iso", "inside": "core_iso"}

src = trimesh.load("source/base.STL")
model = trimesh.load("STL/base.stl")
shape = bd.import_step("STEP/base.step")
rep = json.load(open("checks/deviation_report.json"))["model"]


def wire_actor(mesh, rgb=(0.25, 0.25, 0.28), width=0.6, opacity=0.9):
    """Every triangle edge of the mesh (shows it is a mesh)."""
    e = mesh.edges_unique
    return vv._lines_actor(mesh.vertices[e], rgb, width) if len(e) else None


def brep_edges(shape, tol=0.05):
    """B-rep face boundaries, discretised (shows it is a CAD solid made of faces)."""
    segs = []
    for ed in shape.edges():
        try:
            n = max(2, int(ed.length / 0.6) + 1)
            pts = [tuple(ed.position_at(t)) for t in np.linspace(0, 1, n)]
        except Exception:
            continue
        segs += list(zip(pts[:-1], pts[1:]))
    return np.array(segs)


tiles = {}
wires = wire_actor(src)
wires.GetProperty().SetOpacity(0.55)
for name, cam in VIEWS.items():
    p, _ = vv.render(src, (0.78, 0.79, 0.82), TMP / f"mvm_mesh_{name}.png", camera=cam, size=SIZE, edges=False,
                     extra=[wires])
    tiles[("mesh", name)] = p
segs = brep_edges(shape)
edge_act = vv._lines_actor(segs, (0.05, 0.25, 0.05), 1.2)
for name, cam in VIEWS.items():
    p, _ = vv.render(model, np.array(vv.GREEN) / 255, TMP / f"mvm_model_{name}.png", camera=cam, size=SIZE,
                     edges=False, extra=[edge_act])
    tiles[("model", name)] = p


def crop(path, pad=20):
    from PIL import ImageChops

    im = Image.open(path).convert("RGB")
    b = ImageChops.difference(im, Image.new("RGB", im.size, "white")).getbbox()
    return im.crop((max(b[0] - pad, 0), max(b[1] - pad, 0), min(b[2] + pad, im.width), min(b[3] + pad, im.height)))


cells = {k: crop(v).rotate(90, expand=True, fillcolor="white") for k, v in tiles.items()}  # part lies horizontal
cw = max(im.width for im in cells.values())
ch = max(im.height for im in cells.values())
head, foot, gap = 160, 130, 40
W = 2 * cw + 3 * gap
H = head + 2 * ch + gap + foot
sheet = Image.new("RGB", (W, H), "white")


def font(sz, bold=False):
    for f in ("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else
              "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",):
        try:
            return ImageFont.truetype(f, sz)
        except OSError:
            pass
    return ImageFont.load_default()


d = ImageDraw.Draw(sheet)
cols = {"mesh": gap, "model": 2 * gap + cw}
titles = {"mesh": ("SOURCE MESH (STL)", f"{len(src.faces):,} triangles, no features"),
          "model": ("REVERSE-ENGINEERED CAD (STEP)",
                    f"1 solid, {rep['faces']:,} B-rep faces, parametric envelope + feature sketches")}
for k, x in cols.items():
    d.text((x, 30), titles[k][0], fill=(20, 20, 20), font=font(44, True))
    d.text((x, 88), titles[k][1], fill=(90, 90, 90), font=font(28))
for (k, view), im in cells.items():
    x = cols[k] + (cw - im.width) // 2
    y = head + (0 if view == "outside" else ch + gap) + (ch - im.height) // 2
    sheet.paste(im, (x, y))
    d.text((cols[k] + 10, head + (0 if view == "outside" else ch + gap) + 10), view, fill=(120, 120, 120),
           font=font(28))
d.line((W // 2, head, W // 2, head + 2 * ch + gap), fill=(200, 200, 200), width=3)
s2m = rep["dev_source_to_model"]
stat = (f"Deviation source -> model: mean {s2m['mean']:.4f} mm  |  {s2m['within_0.05mm_%']:.1f} % of surface "
        f"within +/-0.05 mm  |  Hausdorff {rep['hausdorff_mm']:.2f} mm  |  volume {rep['volume_delta_%']:+.2f} %")
d.text((gap, H - foot + 25), stat, fill=(20, 20, 20), font=font(30))
d.text((gap, H - foot + 70), "Rear case ANRMTPT0002F (TE-12XCME)  -  reverse engineering: Moataz Mostafa",
       fill=(120, 120, 120), font=font(24))
out = OUT / "mesh_vs_model.png"
sheet.save(out)
print("->", out, sheet.size)

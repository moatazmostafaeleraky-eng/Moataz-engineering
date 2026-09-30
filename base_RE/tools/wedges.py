"""Find knife-edge steel (air gaps < WEDGE_GAP next to the side walls/fillets) and write fill prisms
to src/lib/dfm_features.json. Run from base_RE/ after STL/base.stl exists:  python tools/wedges.py"""
import json, sys
import numpy as np, trimesh
from shapely.geometry import Polygon, MultiPolygon
from shapely.ops import unary_union
sys.path.insert(0, "src")
GAP = 0.75
m = trimesh.load("STL/base.stl")
feat = json.load(open("src/lib/features.json"))
zsnap = np.array(sorted({round(z, 3) for t in feat["T"] for poly in t["rings"] for r in poly for _, z in r}))

def section(z):
    s = m.section(plane_origin=[0, 0, z], plane_normal=[0, 0, 1])
    polys = sorted((Polygon(p[:, :2]).buffer(0) for p in s.discrete if len(p) >= 3), key=lambda q: -q.area)
    solid = Polygon()
    for q in polys:
        solid = solid.difference(q) if solid.contains(q) else solid.union(q)
    return solid

def narrow(z):
    part = section(z)
    hull = part.convex_hull.intersection(Polygon([(-5, 4.4), (60, 4.4), (60, 40), (-5, 40)]))
    air = hull.difference(part)
    thin = air.difference(air.buffer(-GAP / 2).buffer(GAP / 2 + 0.01))
    out = []
    for q in getattr(thin, "geoms", [thin]):
        if q.geom_type != "Polygon" or q.area < 0.08:
            continue
        c = q.centroid
        if (c.x < 8 or c.x > 44.2) and c.y > 6:
            out.append(q.buffer(0.02, join_style=2))  # slight overlap into the walls
    return out

zs = np.arange(4.5, 151.4, 0.25)
groups = []  # open groups: dict(poly, z0, z1, last)
done = []
for z in zs:
    pieces = narrow(z)
    for q in pieces:
        hit = None
        for gr in groups:
            if gr["last"] >= z - 0.26 and gr["poly"].intersection(q).area > 0.3 * min(q.area, gr["poly"].area):
                hit = gr; break
        if hit:
            hit["poly"] = unary_union([hit["poly"], q]); hit["last"] = z; hit["z1"] = z
        else:
            groups.append({"poly": q, "z0": z, "z1": z, "last": z})
    for gr in [gr for gr in groups if gr["last"] < z - 0.26]:
        groups.remove(gr); done.append(gr)
done += groups

def snapz(v):
    i = np.argmin(np.abs(zsnap - v)); return float(zsnap[i]) if abs(zsnap[i] - v) <= 0.26 else round(v, 3)

wedges = []
for gr in done:
    z0, z1 = snapz(gr["z0"] - 0.125), snapz(gr["z1"] + 0.125)
    if z1 - z0 < 0.4:
        continue
    p = gr["poly"].simplify(0.01)
    for q in getattr(p, "geoms", [p]):
        if q.geom_type == "Polygon" and q.area > 0.08:
            ring = np.round(np.asarray(q.exterior.coords)[:-1], 3).tolist()
            wedges.append({"v0": z0, "v1": z1, "rings": [[ring]], "area_mm2": round(q.area, 3),
                           "bbox": np.round(q.bounds, 2).tolist()})
json.dump({"wedge_gap_mm": GAP, "wedges": wedges}, open("src/lib/dfm_features.json", "w"), indent=1)
print(len(wedges), "wedge fills")
for w in wedges:
    print(f"  z {w['v0']:7.2f}-{w['v1']:7.2f}  area {w['area_mm2']:5.2f}  bbox {w['bbox']}")

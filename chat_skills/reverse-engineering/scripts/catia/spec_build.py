"""Mirror build of a feature spec with build123d (full path only): the same features, in the same order, as the
CATIA macro. Compare the result with the reverse-engineered STEP to verify the spec before handing over the
macro (the macro itself can only run inside CATIA).

    python spec_build.py part_spec.json --step out/part_spec_mirror.step [--stl out/part_spec_mirror.stl]
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import feature_spec as fs  # noqa: E402

try:
    from cadgen import build123d as bd  # noqa: F401
except Exception:  # plain build123d
    import build123d as bd


def plane(normal, offset):
    hx, vx = fs.FRAME[normal]
    z = [0.0, 0.0, 0.0]
    z[fs.AX[normal]] = 1.0
    o = [0.0, 0.0, 0.0]
    o[fs.AX[normal]] = offset
    return bd.Plane(origin=tuple(o), x_dir=hx, z_dir=tuple(z))


def face_of(profile, normal, offset, P):
    pl = plane(normal, offset)
    faces = []
    for lp in fs.loops(profile):
        edges = []
        for s in fs.loop_segments(lp, P):
            if s[0] == "line":
                edges.append(bd.Line(pl.from_local_coords(s[1]), pl.from_local_coords(s[2])))
            elif s[0] == "arc":
                edges.append(bd.ThreePointArc(*[pl.from_local_coords(p) for p in s[1:]]))
            else:
                c = pl.from_local_coords(s[1])
                edges.append(bd.Edge.make_circle(s[2], bd.Plane(origin=c, x_dir=pl.x_dir, z_dir=pl.z_dir)))
        faces.append(bd.Face(bd.Wire(edges)))
    out = faces[0]
    for h in faces[1:]:
        out = out - h
    return out


def build(spec):
    P = fs.resolve_params(spec)
    body = None
    log = []
    for f in spec["features"]:
        t = f["type"]
        if t in ("pad", "pocket"):
            a, b = fs.ev(f["from"], P), fs.ev(f["to"], P)
            s0, s1 = min(a, b), max(a, b)
            face = face_of(f["profile"], f["normal"], s0, P)
            z = [0.0, 0.0, 0.0]
            z[fs.AX[f["normal"]]] = 1.0
            solid = bd.extrude(face, amount=s1 - s0, dir=tuple(z))
            body = solid if body is None else (body + solid if t == "pad" else body - solid)
        elif t in ("shaft", "groove"):
            off = fs.ev(f["offset"], P)
            face = face_of(f["profile"], f["normal"], off, P)
            (h0, v0), (h1, v1) = [(fs.ev(p[0], P), fs.ev(p[1], P)) for p in f["axis"]]
            p0 = fs.to_world(f["normal"], off, h0, v0)
            p1 = fs.to_world(f["normal"], off, h1, v1)
            d = tuple(q - p for p, q in zip(p0, p1))
            ax = bd.Axis(p0, d)
            first, second = (fs.ev(x, P) for x in f.get("angles", [360, 0]))
            if first + second >= 360 - 1e-9:
                solid = bd.revolve(face, ax, 360)
            else:
                face = face.rotate(ax, -second)
                solid = bd.revolve(face, ax, first + second)
            body = solid if body is None else (body + solid if t == "shaft" else body - solid)
        elif t == "mirror":
            off = fs.ev(f["offset"], P)
            n = [0.0, 0.0, 0.0]
            n[fs.AX[f["normal"]]] = 1.0
            o = [0.0, 0.0, 0.0]
            o[fs.AX[f["normal"]]] = off
            body = body + bd.mirror(body, bd.Plane(origin=tuple(o), z_dir=tuple(n)))
        elif t == "manual":
            log.append(f"manual (not built): {f['name']}: {f['note']}")
        else:
            raise ValueError(f"unknown feature type {t}")
    return body, log


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("spec")
    ap.add_argument("--step", required=True)
    ap.add_argument("--stl")
    a = ap.parse_args()
    body, log = build(fs.load(a.spec))
    Path(a.step).parent.mkdir(parents=True, exist_ok=True)
    bd.export_step(body, a.step)
    if a.stl:
        bd.export_stl(body, a.stl, tolerance=0.005, angular_tolerance=0.1)
    solids = body.solids()
    print(f"solids {len(solids)}, valid {body.is_valid}, volume {body.volume:.3f} mm3, faces {len(body.faces())}")
    for line in log:
        print(line)


if __name__ == "__main__":
    main()

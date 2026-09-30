"""Feature spec: one JSON file that describes a part as a CAD feature tree. It drives both the CATIA macro
(catia_macro.py) and the build123d mirror build (spec_build.py) used to verify the geometry here.

Spec format (all lengths mm, angles deg; any number may be an expression of the parameters, e.g. "Y_OUTER-WALL"):

{
  "part": "battery_cover",
  "params": {"WIDTH": 31.0, "WALL": 2.0, ...},
  "features": [
    {"type": "pad",    "name": "Plate", "normal": "X", "from": 0, "to": "WIDTH", "profile": P},
    {"type": "pocket", "name": "Core_L", "normal": "X", "from": 5.5, "to": 6.5, "profile": P},
    {"type": "shaft",  "name": "Recess_shell", "normal": "X", "offset": 15.5,
                       "axis": [[h0, v0], [h1, v1]], "angles": [90, 90], "profile": P},
    {"type": "groove", ... same as shaft ...},
    {"type": "mirror", "name": "Mirror_X", "normal": "X", "offset": "WIDTH/2"},
    {"type": "manual", "name": "Bump_edge_fillets", "note": "R0.25 on the proud side edges of both bumps"}
  ]
}

Sketch frames (right-handed, h x v = normal):
    normal X -> sketch (h, v) = (Y, Z);  normal Y -> (Z, X);  normal Z -> (X, Y)
Pads / pockets run along the normal from "from" to "to" (world coordinate on that axis). Shafts / grooves are
sketched on the plane normal = offset; the axis lies in that plane; "angles" = [first, second] sweep on
either side of the sketch plane (use [90, 90] or [180, 180] where possible: symmetric = orientation-proof).

Profile P: one loop or {"loops": [loop, ...]} (outer + holes). A loop is one of
    {"rect": [h0, v0, h1, v1]}
    {"circle": [hc, vc, r]}
    {"poly": [[h, v], ...]}                                    closed polygon
    {"path": {"start": [h, v], "segs": [{"line": [h, v]}, {"arc": {"mid": [h, v], "end": [h, v]}}, ...]}}
                                                               closed; arcs are three-point arcs
"""

from __future__ import annotations

import ast
import json
import math
import operator
from pathlib import Path

AX = {"X": 0, "Y": 1, "Z": 2}
FRAME = {"X": ((0, 1, 0), (0, 0, 1)), "Y": ((0, 0, 1), (1, 0, 0)), "Z": ((1, 0, 0), (0, 1, 0))}
_OPS = {ast.Add: operator.add, ast.Sub: operator.sub, ast.Mult: operator.mul, ast.Div: operator.truediv,
        ast.USub: operator.neg, ast.UAdd: operator.pos, ast.Pow: operator.pow}
_FUN = {"sqrt": math.sqrt, "sin": lambda d: math.sin(math.radians(d)), "cos": lambda d: math.cos(math.radians(d)),
        "tan": lambda d: math.tan(math.radians(d))}


def load(path):
    return json.loads(Path(path).read_text())


def ev(x, params):
    """Evaluate a number or a parameter expression."""
    if isinstance(x, (int, float)):
        return float(x)
    node = ast.parse(str(x), mode="eval").body

    def rec(n):
        if isinstance(n, ast.Constant):
            return float(n.value)
        if isinstance(n, ast.Name):
            return float(params[n.id])
        if isinstance(n, ast.BinOp):
            return _OPS[type(n.op)](rec(n.left), rec(n.right))
        if isinstance(n, ast.UnaryOp):
            return _OPS[type(n.op)](rec(n.operand))
        if isinstance(n, ast.Call) and n.func.id in _FUN:
            return _FUN[n.func.id](*[rec(a) for a in n.args])
        raise ValueError(f"unsupported expression: {x}")

    return rec(node)


def is_expr(x):
    return isinstance(x, str)


def resolve_params(spec):
    """Params may reference earlier params."""
    out = {}
    for k, v in spec["params"].items():
        out[k] = ev(v, out)
    return out


def loops(profile):
    return profile["loops"] if "loops" in profile else [profile]


def arc_from_3pts(a, m, b):
    """Centre, radius and ccw start/end angles (rad) of the arc a -> m -> b; flag if it runs clockwise."""
    (x1, y1), (x2, y2), (x3, y3) = a, m, b
    d = 2 * (x1 * (y2 - y3) + x2 * (y3 - y1) + x3 * (y1 - y2))
    if abs(d) < 1e-12:
        raise ValueError(f"collinear arc points {a} {m} {b}")
    ux = ((x1 ** 2 + y1 ** 2) * (y2 - y3) + (x2 ** 2 + y2 ** 2) * (y3 - y1) + (x3 ** 2 + y3 ** 2) * (y1 - y2)) / d
    uy = ((x1 ** 2 + y1 ** 2) * (x3 - x2) + (x2 ** 2 + y2 ** 2) * (x1 - x3) + (x3 ** 2 + y3 ** 2) * (x2 - x1)) / d
    r = math.hypot(x1 - ux, y1 - uy)
    ang = lambda p: math.atan2(p[1] - uy, p[0] - ux) % (2 * math.pi)  # noqa: E731
    t1, t2, t3 = ang(a), ang(m), ang(b)
    ccw = ((t2 - t1) % (2 * math.pi)) < ((t3 - t1) % (2 * math.pi))
    return (ux, uy), r, t1, t3, ccw


def loop_segments(loop, P):
    """Loop -> list of segments in sketch coordinates:
    ("line", (h0, v0), (h1, v1)) | ("arc", start, mid, end) | ("circle", (hc, vc), r)."""
    e = lambda p: (ev(p[0], P), ev(p[1], P))  # noqa: E731
    if "rect" in loop:
        h0, v0, h1, v1 = (ev(t, P) for t in loop["rect"])
        pts = [(h0, v0), (h1, v0), (h1, v1), (h0, v1)]
        return [("line", pts[i], pts[(i + 1) % 4]) for i in range(4)]
    if "circle" in loop:
        hc, vc, r = (ev(t, P) for t in loop["circle"])
        return [("circle", (hc, vc), r)]
    if "poly" in loop:
        pts = [e(p) for p in loop["poly"]]
        return [("line", pts[i], pts[(i + 1) % len(pts)]) for i in range(len(pts))]
    if "path" in loop:
        cur = e(loop["path"]["start"])
        start = cur
        segs = []
        for s in loop["path"]["segs"]:
            if "line" in s:
                nxt = e(s["line"])
                segs.append(("line", cur, nxt))
            else:
                nxt = e(s["arc"]["end"])
                segs.append(("arc", cur, e(s["arc"]["mid"]), nxt))
            cur = nxt
        if math.dist(cur, start) > 1e-9:
            segs.append(("line", cur, start))
        return segs
    raise ValueError(f"unknown loop {loop}")


def to_world(normal, offset, h, v):
    hx, vx = FRAME[normal]
    p = [0.0, 0.0, 0.0]
    p[AX[normal]] = offset
    return tuple(p[i] + h * hx[i] + v * vx[i] for i in range(3))

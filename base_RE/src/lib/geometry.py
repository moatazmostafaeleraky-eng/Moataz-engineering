"""Parametric geometry for the reverse-engineered rear case ("base", ANRMTPT0002F, TE-12XCME).

Frame is kept identical to the source mesh `source/base.STL` so deviation checks are 1:1:
    X  width      0.62 .. 51.62   (51.0 wide)
    Y  depth      parting line at Y 4.34, outer (cosmetic) skin up to Y ~24.3
    Z  length     bottom end (slanted) ~1 .. top end 153.94
Battery-cover frame = this frame shifted by (-10.62, -4.34, -76.94).

All dimensions in millimetres, measured from the source mesh (see ../../REPORT.md).
"""

from __future__ import annotations

import functools
import json
from pathlib import Path

import numpy as np
from cadgen import build123d as bd

HERE = Path(__file__).resolve().parent

# ---------------------------------------------------------------- shell
X0, X1 = 0.62, 51.62  # outer side faces
WALL = 2.0  # side and top wall
Y_PL = 4.34  # parting line (open face towards the front case)
Z_TOP = 153.94  # top end of the outer skin
Z_END_WALL = (151.44, 153.44)  # top end wall
CORNER_R = 10.0  # rolling-ball radius between the top skin and the sides
Z_RIM_FLOOR = 153.45  # end face of the top wall; a 2.0 rim stands 0.49 proud of it
RIM_FILLET = 0.45  # both top edges of the rim (measured ~0.5; the rim is only 0.49 tall)
SLOT_X = (10.62, 41.62)  # battery-cover slot through the top end wall ...
SLOT_Y0 = 20.34  # ... down to the cover-rail level
SLOT_Z0 = 151.45
OPENING_Z = (88.45, SLOT_Z0)  # battery opening through the top wall, same width as the slot
# bottom end: open, cut by a plane tilted ~14.8 deg about X (normal, offset)
BOTTOM_N = (0.0, -0.2543, -0.9671)
BOTTOM_D = -5.330


def _profile(kind: str) -> np.ndarray:
    """(z, y) control points of the top skin: 'outer' surface or 'inner' (normal offset WALL)."""
    return np.load(HERE / "profile_ctrl.npz")[kind]


def _yz_spline_face(ctrl: np.ndarray, x0: float, y_floor: float) -> bd.Face:
    """Face in the plane X = x0 bounded by the top spline and Y = y_floor (ends at the spline ends)."""
    pts = [bd.Vector(x0, y, z) for z, y in ctrl]
    top = bd.Spline(*pts)
    a, b = pts[0], pts[-1]
    edges = [
        top,
        bd.Line(b, bd.Vector(x0, y_floor, b.Z)),
        bd.Line(bd.Vector(x0, y_floor, b.Z), bd.Vector(x0, y_floor, a.Z)),
        bd.Line(bd.Vector(x0, y_floor, a.Z), a),
    ]
    return bd.Face(bd.Wire(edges))


def _block(ctrl, x0, x1, y_floor, radius) -> bd.Part:
    body = bd.extrude(_yz_spline_face(ctrl, x0, y_floor), amount=x1 - x0, dir=(1, 0, 0))
    ztop = [e for e in body.edges() if e.geom_type == bd.GeomType.BSPLINE]
    return bd.fillet(ztop, radius)


@functools.cache
def outer_block(y_floor: float = Y_PL) -> bd.Part:
    """Solid bounded by the outer cosmetic skin, the side faces and Y = y_floor."""
    return _block(_profile("outer"), X0, X1, y_floor, CORNER_R)


@functools.cache
def _inner_full() -> bd.Part:
    return _block(_profile("inner"), X0 + WALL, X1 - WALL, Y_PL - 10, CORNER_R - WALL)


def _zbox(z0: float, z1: float) -> bd.Part:
    return bd.Pos(26.12, 0, (z0 + z1) / 2) * bd.Box(200, 200, z1 - z0)


@functools.cache
def inner_block() -> bd.Part:
    """The cavity: solid bounded by the inner skin (offset WALL), open towards the parting line."""
    return _inner_full() & _zbox(-50, Z_END_WALL[0])


def _bottom_plane() -> bd.Plane:
    z_at_pl = (BOTTOM_D - BOTTOM_N[1] * Y_PL) / BOTTOM_N[2]  # where the cut plane meets the parting line
    return bd.Plane(origin=(26.12, Y_PL, z_at_pl), z_dir=BOTTOM_N)


def shell() -> bd.Part:
    body = outer_block() - inner_block()
    body = body & _zbox(0, Z_TOP)
    body = bd.split(body, bisect_by=_bottom_plane(), keep=bd.Keep.BOTTOM)
    # top end: rim around a shallow recess, cover slot through the end wall, rounded rim
    body = body - (_inner_full() & _zbox(Z_RIM_FLOOR, Z_TOP + 1))
    slot = bd.Pos((SLOT_X[0] + SLOT_X[1]) / 2, SLOT_Y0 + 10, (SLOT_Z0 + Z_TOP + 1) / 2) * bd.Box(
        SLOT_X[1] - SLOT_X[0], 20, Z_TOP + 1 - SLOT_Z0)
    body = body - slot
    rim = [e for e in body.edges() if abs(e.center().Z - Z_TOP) < 1e-3 and abs(e.start_point().Z - Z_TOP) < 1e-3
           and abs(e.end_point().Z - Z_TOP) < 1e-3]
    return bd.fillet(rim, RIM_FILLET)


# ---------------------------------------------------------------- finger recess (revolved) and bosses
FR_AXIS = (26.12, 88.45)  # (x, z) of the revolve axis (parallel to Y) = middle of the cover edge
FR_R_MAX = 8.6
# outer surface of the recess: (radius, y), measured from the source (floor flat at y 22.32 out to r 2.5)
FR_PROFILE = [(0.0, 22.32), (2.5, 22.33), (3.0, 22.354), (3.5, 22.405), (4.0, 22.478), (4.5, 22.593),
              (5.0, 22.753), (5.5, 22.952), (6.0, 23.205), (6.5, 23.504), (7.0, 23.863), (7.5, 24.217),
              (8.0, 24.571), (8.6, 24.996)]
BOSS_XZ = [(16.62, 81.44), (35.62, 81.44)]
BOSS_R, BOSS_TOP, BOSS_FILLET = 1.5, 26.28, 1.05
BOSS_HOLE_R, BOSS_HOLE_TOP = 0.5, 24.87  # blind hole from the cavity, ball end


def _fr_curve(offset: float = 0.0) -> list[tuple[float, float]]:
    """Recess profile in (r, y), optionally offset along its normal (towards -Y) by `offset`."""
    from scipy.interpolate import CubicSpline

    r, y = np.array(FR_PROFILE).T
    f = CubicSpline(r, y, bc_type=((1, 0.0), (2, 0.0)))
    rr = np.linspace(0, FR_R_MAX, 44)
    yy, dy = f(rr), f(rr, 1)
    n = np.c_[dy, -np.ones_like(dy)] / np.sqrt(1 + dy ** 2)[:, None]  # downward normal
    pts = np.c_[rr, yy] + offset * n
    pts[0, 0] = 0.0
    return [tuple(p) for p in pts if p[0] >= 0]


def _revolve(pts_ry) -> bd.Part:
    ax, az = FR_AXIS
    face = bd.Face(bd.Wire.make_polygon([bd.Vector(ax + r, y, az) for r, y in pts_ry], close=True))
    return bd.revolve(face, bd.Axis((ax, 0, az), (0, 1, 0)), 360)


def finger_recess_cut() -> bd.Part:
    top = _fr_curve()
    return _revolve(top + [(top[-1][0], 30.0), (0.0, 30.0)])


def finger_recess_wall() -> bd.Part:
    """The recessed wall (uniform WALL, bulging into the cavity), up to the cover edge."""
    top, bot = _fr_curve(), _fr_curve(WALL)
    bot = [p for p in bot if p[0] <= top[-1][0]]
    wall = _revolve(top + [(bot[-1][0], bot[-1][1])] + bot[::-1])
    return wall & (bd.Pos(0, -0.3, 0) * outer_block(Y_PL - 10)) & _zbox(0, FR_AXIS[1])


def bosses() -> bd.Part:
    parts = []
    for x, z in BOSS_XZ:
        cyl = bd.Pos(x, 23.0, z) * bd.Cylinder(BOSS_R, BOSS_TOP - 23.0, rotation=(-90, 0, 0), align=None)
        cyl = bd.fillet([e for e in cyl.edges() if abs(e.center().Y - BOSS_TOP) < 1e-3], BOSS_FILLET)
        parts.append(cyl)
    return _fuse(parts)


def boss_holes() -> bd.Part:
    parts = []
    for x, z in BOSS_XZ:
        parts.append(bd.Pos(x, 21.5, z) * bd.Cylinder(BOSS_HOLE_R, BOSS_HOLE_TOP - 21.5, rotation=(-90, 0, 0), align=None))
        parts.append(bd.Pos(x, BOSS_HOLE_TOP, z) * bd.Sphere(BOSS_HOLE_R))
    return _fuse(parts)


# ---------------------------------------------------------------- internal features and cuts
# Each feature is a sketch (polygon with holes, measured from a section of the source mesh) extruded
# along X, Y or Z over its measured range; see ../../REPORT.md, "Method".
AXES = {0: (1, 0, 0), 1: (0, 1, 0), 2: (0, 0, 1)}


def _to3d(axis: int, v: float, a: float, b: float) -> bd.Vector:
    return bd.Vector(*{0: (v, a, b), 1: (a, v, b), 2: (a, b, v)}[axis])


def _sketch(polys, axis: int, v: float) -> list[bd.Face]:
    faces = []
    for rings in polys:
        wires = [bd.Wire.make_polygon([_to3d(axis, v, a, b) for a, b in r], close=True) for r in rings]
        faces.append(bd.Face(wires[0], wires[1:]))
    return faces


def _prism(polys, axis: int, v0: float, v1: float) -> list[bd.Part]:
    return [bd.extrude(f, amount=v1 - v0, dir=AXES[axis]) for f in _sketch(polys, axis, v0)]


SKIN_OVERLAP = 0.6  # features that run up to the skin end this far inside the wall (clean volumetric fuse)


@functools.cache
def _skin_clip() -> bd.Part:
    return bd.Pos(0, SKIN_OVERLAP, 0) * inner_block()


def _up_to_skin(polys, y0: float) -> list[bd.Part]:
    """Sketch on the plane Y = y0, extruded +Y 'up to the skin' (the design intent of the ribs)."""
    return [p & _skin_clip() for p in _prism(polys, 1, y0, 30.0)]


def _follow_skin(ext: bd.Part, side: str, delta: float, cut: bool) -> bd.Part:
    """Trim a Y-swept copy of a Z-feature so it only fills the gap left by the skin drifting inside its range."""
    if not cut:  # added material under the inner skin: keep what lies above (inner skin - delta)
        return ext - bd.Pos(0, -delta, 0) * inner_block()
    if side == "out":  # cut through the outer skin: keep what lies above (outer skin - delta)
        return ext - bd.Pos(0, -delta, 0) * outer_block(Y_PL - 10)
    return ext & (bd.Pos(0, delta, 0) * inner_block())  # cut from the cavity side


def _feature_solids(entries, cut: bool = False) -> list[bd.Part]:
    solids = []
    for e in entries:
        solids += _prism(e["rings"], e["axis"], e["v0"], e["v1"])
        for ext in e.get("skin", []):
            solids += [_follow_skin(p, ext["side"], ext["delta"], cut) for p in _prism(ext["rings"], 2, e["v0"], e["v1"])]
    return [s for s in solids if s.volume > 1e-6]


@functools.cache
def _features() -> dict:
    return json.loads((HERE / "features.json").read_text())


def _fuse(parts: list[bd.Part]) -> bd.Part:
    return parts[0].fuse(*parts[1:]).clean() if len(parts) > 1 else parts[0]


def _fuse_seq(parts: list[bd.Part]) -> bd.Part:
    """One-by-one fuse: slower than a single multi-argument boolean but robust with many touching prisms."""
    acc = parts[0]
    for p in parts[1:]:
        acc = acc.fuse(p)
    return acc


def ribs() -> list[bd.Part]:
    parts = []
    for e in _features()["T"]:
        parts += _up_to_skin(e["rings"], e["y0"])
    return [p for p in parts if p.volume > 1e-6]


def envelope() -> bd.Part:
    """Shell with the modelled design features (recess, bosses) but without the section-driven detail."""
    body = shell() - finger_recess_cut()
    return body.fuse(finger_recess_wall(), bosses())


def battery_opening() -> bd.Part:
    """Cut through the top wall down to the inner skin (removes any rib overlap left in the wall)."""
    z0, z1 = OPENING_Z
    box = bd.Pos((SLOT_X[0] + SLOT_X[1]) / 2, 20, (z0 + z1) / 2) * bd.Box(SLOT_X[1] - SLOT_X[0], 20, z1 - z0)
    return box - _inner_full()


def base() -> bd.Part:
    """Rear case = shell + design features + ribs (up to skin) + section-driven detail - cuts."""
    data = _features()
    body = envelope().fuse(_fuse(ribs()))
    detail = [p for p in _feature_solids(data["F"]) if p.volume > 1e-4]
    body = body.fuse(_fuse_seq(detail))
    body = body - battery_opening()
    for cut in _feature_solids(data["G"], cut=True):
        body = body - cut
    body = body - boss_holes()
    return bd.split(body, bisect_by=_bottom_plane(), keep=bd.Keep.BOTTOM).clean()

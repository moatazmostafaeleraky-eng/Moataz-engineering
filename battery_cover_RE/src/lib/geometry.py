"""Parametric geometry for the reverse-engineered battery cover.

Frame (kept identical to the source mesh so deviation checks are 1:1):
    X  width      0 .. 31
    Y  thickness  +Y = cosmetic/exterior face (plate outer face at Y = 20)
    Z  length     plate from Z = 11.5 (latch end) to Z = 77 (hinge/tab end)

All dimensions in millimetres. Values come from section and surface-fit
measurements of `source/battery_cover_original.stl` (see ../../REPORT.md).
"""

from __future__ import annotations

import math

from cadgen import build123d as bd

# ---------------------------------------------------------------- plate
WIDTH = 31.0
Z_BOTTOM = 11.5
Z_TOP = 77.0
Y_OUTER = 20.0
WALL = 2.0  # nominal wall everywhere on the plate and the thumb recess
TOP_EDGE_R = 0.5

# Measured plate bow (outer-face Y at each Z break point). The inner face is
# the same polyline offset by WALL. Flat design intent = all values Y_OUTER.
BOW_Z = (11.5, 19.3, 29.836, 42.696, 67.247, 76.5)
BOW_Y_AS_MEASURED = (19.968, 19.782, 19.661, 19.704, 19.966, 20.0)
BOW_Y_FLAT = (Y_OUTER,) * len(BOW_Z)

# ---------------------------------------------------------------- inner (-Y) features
Y_RIB_TIP = 16.0  # free edge of rails, ribs, lip and hook
RAIL_W = 1.0
RAIL_Z = (26.5, 75.5)
RIB_W = 0.8  # 40 % of wall: sink-mark safe
RIB_X = (7.0, 24.0)  # rib centre lines
RIB_Z = (26.5, 56.5)
LIP_Z = (75.5, 76.5)

HOOK_X = (12.5, 18.5)
HOOK_BLOCK_Y = (16.0, 17.0)  # 1.0 mm gap to plate inner face
HOOK_BLOCK_Z = (68.5, 73.0)
HOOK_LEG_W = 1.0

# ---------------------------------------------------------------- outer (+Y) bumps
BUMP_X = (6.0, 25.0)  # centre lines
BUMP_W = 3.0
BUMP_Z = (68.5, 75.5)
BUMP_H = 2.0  # proud of outer face
BUMP_END_R = 2.0
BUMP_EDGE_R = 0.25
CORE_W = 1.0  # coring pocket from the inner side -> 1.0 mm bump walls
CORE_Z = (69.5, 74.5)
CORE_TOP_Y = 21.0
CORE_R = 0.5

# ---------------------------------------------------------------- thumb recess (revolved)
RECESS_AXIS_X = 15.5
RECESS_AXIS_Z = 11.5
RECESS_FLAT_R = 2.55  # flat floor radius
RECESS_ARC_R = 7.1  # concave outer arc, centre (FLAT_R, Y_FLOOR + ARC_R)
RECESS_RIM_R = 1.25  # convex blend into the outer face
RECESS_FLOOR_Y = 18.0  # recess depth = WALL (floor sits on the nominal inner plane)

# ---------------------------------------------------------------- snap latch
LATCH_X = (12.5, 18.5)
LATCH_ARM_Y = (13.0, 14.3)
LATCH_TIP_Z = 5.5
LATCH_TIP_W = 1.0
LATCH_TOOTH_Y = 15.0  # catch face protrudes 0.7 mm
LATCH_CATCH_Z = 9.5
LATCH_CATCH_FLAT = 0.5  # vertical land below the catch face
LATCH_FLOOR_Z = 12.5  # 1.0 mm floor under the coring slots
LATCH_RAMP_Z0 = 13.1  # ramp starts at (Y=13.0, Z=13.1)
LATCH_RAMP_DZ_DY = 1.2  # ramp slope (39.8 deg to the plate plane)
LATCH_SLOTS_X = ((13.5, 15.0), (16.0, 17.5))  # coring slots -> three 1.0 mm ribs


# ======================================================================== helpers
def _yz_face(pts_yz, x0: float) -> bd.Face:
    """Planar polygon in the YZ plane at X = x0 (points given as (y, z))."""
    return bd.Face(bd.Wire.make_polygon([bd.Vector(x0, y, z) for y, z in pts_yz], close=True))


def _extrude_x(face: bd.Face, width: float) -> bd.Part:
    return bd.extrude(face, amount=width, dir=(1, 0, 0))


def _box(x0, x1, y0, y1, z0, z1) -> bd.Part:
    return bd.Pos((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2) * bd.Box(x1 - x0, y1 - y0, z1 - z0)


def _arc_pt(c, r, ang):
    return (c[0] + r * math.cos(ang), c[1] + r * math.sin(ang))


def _arc_mid(c, r, a0, a1):
    return _arc_pt(c, r, (a0 + a1) / 2)


# ======================================================================== plate
def _plate(bow_y) -> bd.Part:
    # Profile in YZ; the top end is rounded in the sketch (the bow leaves exactly
    # TOP_EDGE_R of straight face under the top, too little for a 3D fillet).
    V = lambda y, z: bd.Vector(0, y, z)  # noqa: E731
    r, s45 = TOP_EDGE_R, math.sqrt(0.5)
    zt = Z_TOP - r
    y_o, y_i = Y_OUTER, Y_OUTER - WALL
    outer = [V(y, z) for y, z in zip(bow_y, BOW_Z)]
    inner = [V(y - WALL, z) for y, z in zip(reversed(bow_y), reversed(BOW_Z))]
    edges = [bd.Line(p, q) for p, q in zip(outer, outer[1:])]
    edges.append(bd.Line(outer[-1], V(y_o, zt)) if outer[-1].Z < zt - 1e-9 else None)
    edges += [
        bd.ThreePointArc(V(y_o, zt), V(y_o - r + r * s45, zt + r * s45), V(y_o - r, Z_TOP)),
        bd.Line(V(y_o - r, Z_TOP), V(y_i + r, Z_TOP)),
        bd.ThreePointArc(V(y_i + r, Z_TOP), V(y_i + r - r * s45, zt + r * s45), V(y_i, zt)),
    ]
    edges.append(bd.Line(V(y_i, zt), inner[0]) if inner[0].Z < zt - 1e-9 else None)
    edges += [bd.Line(p, q) for p, q in zip(inner, inner[1:])]
    edges.append(bd.Line(inner[-1], outer[0]))
    face = bd.Face(bd.Wire([e for e in edges if e is not None]))
    return _extrude_x(face, WIDTH)


# ======================================================================== thumb recess profiles (r, y)
def _recess_curves():
    a = RECESS_FLAT_R
    c1 = (a, RECESS_FLOOR_Y + RECESS_ARC_R)
    r_o, r_i, rf = RECESS_ARC_R, RECESS_ARC_R + WALL, RECESS_RIM_R
    # rim blend centre: tangent to Y = Y_OUTER and externally tangent to outer arc
    dy = c1[1] - (Y_OUTER - rf)
    c2 = (a + math.sqrt((r_o + rf) ** 2 - dy**2), Y_OUTER - rf)
    k = r_o / (r_o + rf)
    tan_pt = (c1[0] + (c2[0] - c1[0]) * k, c1[1] + (c2[1] - c1[1]) * k)
    # inner arc meets the nominal inner plane
    r_in_end = a + math.sqrt(r_i**2 - (c1[1] - (Y_OUTER - WALL)) ** 2)
    return a, c1, c2, tan_pt, r_i, r_in_end


def _revolve_profile(edges_rz) -> bd.Part:
    """Revolve a closed (r, y) profile 360 deg about the recess axis (parallel to Y)."""
    face = bd.Face(bd.Wire(edges_rz))
    axis = bd.Axis((RECESS_AXIS_X, 0, RECESS_AXIS_Z), (0, 1, 0))
    return bd.revolve(face, axis, 360)


def _p(r, y):
    return bd.Vector(RECESS_AXIS_X + r, y, RECESS_AXIS_Z)


def _outer_curve_edges(a, c1, c2, t, reverse=False):
    """Floor -> concave arc -> convex rim blend (in +r direction)."""
    a1s, a1e = -math.pi / 2, math.atan2(t[1] - c1[1], t[0] - c1[0])
    a2s, a2e = math.atan2(t[1] - c2[1], t[0] - c2[0]), math.pi / 2
    e = [
        bd.ThreePointArc(_p(a, RECESS_FLOOR_Y), _p(*_arc_mid(c1, RECESS_ARC_R, a1s, a1e)), _p(*t)),
        bd.ThreePointArc(_p(*t), _p(*_arc_mid(c2, RECESS_RIM_R, a2s, a2e)), _p(c2[0], Y_OUTER)),
    ]
    if reverse:
        e = [bd.ThreePointArc(x @ 1, x @ 0.5, x @ 0) for x in reversed(e)]
    return e


def _recess_air(r_max=12.0, y_top=24.0) -> bd.Part:
    a, c1, c2, t, _, _ = _recess_curves()
    e = [bd.Line(_p(0, RECESS_FLOOR_Y), _p(a, RECESS_FLOOR_Y))]
    e += _outer_curve_edges(a, c1, c2, t)
    e += [
        bd.Line(_p(c2[0], Y_OUTER), _p(r_max, Y_OUTER)),
        bd.Line(_p(r_max, Y_OUTER), _p(r_max, y_top)),
        bd.Line(_p(r_max, y_top), _p(0, y_top)),
        bd.Line(_p(0, y_top), _p(0, RECESS_FLOOR_Y)),
    ]
    return _revolve_profile(e)


def _inner_arc_edge(a, c1, r_i, r_end):
    a_s = -math.pi / 2
    a_e = math.atan2((Y_OUTER - WALL) - c1[1], r_end - c1[0])
    return bd.ThreePointArc(
        _p(a, RECESS_FLOOR_Y - WALL), _p(*_arc_mid(c1, r_i, a_s, a_e)), _p(r_end, Y_OUTER - WALL)
    )


def _recess_shell() -> bd.Part:
    a, c1, c2, t, r_i, r_end = _recess_curves()
    y_in = RECESS_FLOOR_Y - WALL
    e = [bd.Line(_p(0, y_in), _p(a, y_in)), _inner_arc_edge(a, c1, r_i, r_end)]
    e += [
        bd.Line(_p(r_end, Y_OUTER - WALL), _p(r_end, Y_OUTER)),
        bd.Line(_p(r_end, Y_OUTER), _p(c2[0], Y_OUTER)),
    ]
    e += _outer_curve_edges(a, c1, c2, t, reverse=True)
    e += [bd.Line(_p(a, RECESS_FLOOR_Y), _p(0, RECESS_FLOOR_Y)), bd.Line(_p(0, RECESS_FLOOR_Y), _p(0, y_in))]
    return _revolve_profile(e)


def _above_inner(r_max=12.0, y_top=24.0) -> bd.Part:
    a, c1, _, _, r_i, r_end = _recess_curves()
    y_in = RECESS_FLOOR_Y - WALL
    e = [bd.Line(_p(0, y_in), _p(a, y_in)), _inner_arc_edge(a, c1, r_i, r_end)]
    e += [
        bd.Line(_p(r_end, Y_OUTER - WALL), _p(r_max, Y_OUTER - WALL)),
        bd.Line(_p(r_max, Y_OUTER - WALL), _p(r_max, y_top)),
        bd.Line(_p(r_max, y_top), _p(0, y_top)),
        bd.Line(_p(0, y_top), _p(0, y_in)),
    ]
    return _revolve_profile(e)


# ======================================================================== latch
def _latch_block() -> bd.Part:
    y0, y1 = LATCH_ARM_Y
    y_top = 19.0
    pts = [
        (y0, LATCH_TIP_Z),
        (y0 + LATCH_TIP_W, LATCH_TIP_Z),
        (LATCH_TOOTH_Y, LATCH_CATCH_Z - LATCH_CATCH_FLAT),
        (LATCH_TOOTH_Y, LATCH_CATCH_Z),
        (y1, LATCH_CATCH_Z),
        (y1, Z_BOTTOM),
        (y_top, Z_BOTTOM),
        (y_top, LATCH_RAMP_Z0 + (y_top - y0) * LATCH_RAMP_DZ_DY),
        (y0, LATCH_RAMP_Z0),
    ]
    return _extrude_x(_yz_face(pts, LATCH_X[0]), LATCH_X[1] - LATCH_X[0])


# ======================================================================== top features
def _bump(xc: float) -> bd.Part:
    y0, y1 = Y_OUTER - 0.5, Y_OUTER + BUMP_H
    z0, z1 = BUMP_Z
    r = BUMP_END_R
    x0 = xc - BUMP_W / 2
    P = lambda y, z: bd.Vector(x0, y, z)  # noqa: E731
    s45 = math.sqrt(0.5)
    edges = [
        bd.Line(P(y0, z0), P(Y_OUTER, z0)),
        bd.ThreePointArc(P(Y_OUTER, z0), P(Y_OUTER + r * s45, z0 + r - r * s45), P(y1, z0 + r)),
        bd.Line(P(y1, z0 + r), P(y1, z1 - r)),
        bd.ThreePointArc(P(y1, z1 - r), P(Y_OUTER + r * s45, z1 - r + r * s45), P(Y_OUTER, z1)),
        bd.Line(P(Y_OUTER, z1), P(y0, z1)),
        bd.Line(P(y0, z1), P(y0, z0)),
    ]
    solid = _extrude_x(bd.Face(bd.Wire(edges)), BUMP_W)
    proud = [
        e
        for e in solid.edges()
        if e.bounding_box().min.Y > Y_OUTER - 1e-3
        and (abs(e.center().X - x0) < 1e-3 or abs(e.center().X - (x0 + BUMP_W)) < 1e-3)
    ]
    return bd.fillet(proud, BUMP_EDGE_R)


def _bump_core(xc: float) -> bd.Part:
    x0 = xc - CORE_W / 2
    z0, z1 = CORE_Z
    r = CORE_R
    yb = Y_OUTER - WALL - 0.5
    P = lambda y, z: bd.Vector(x0, y, z)  # noqa: E731
    s45 = math.sqrt(0.5)
    edges = [
        bd.Line(P(yb, z0), P(CORE_TOP_Y - r, z0)),
        bd.ThreePointArc(P(CORE_TOP_Y - r, z0), P(CORE_TOP_Y - r + r * s45, z0 + r - r * s45), P(CORE_TOP_Y, z0 + r)),
        bd.Line(P(CORE_TOP_Y, z0 + r), P(CORE_TOP_Y, z1 - r)),
        bd.ThreePointArc(P(CORE_TOP_Y, z1 - r), P(CORE_TOP_Y - r + r * s45, z1 - r + r * s45), P(CORE_TOP_Y - r, z1)),
        bd.Line(P(CORE_TOP_Y - r, z1), P(yb, z1)),
        bd.Line(P(yb, z1), P(yb, z0)),
    ]
    return _extrude_x(bd.Face(bd.Wire(edges)), CORE_W)


def _inner_features() -> bd.Part:
    y_in = Y_OUTER - WALL + 0.5  # overlap into the plate so bowed variants still fuse
    feats = [
        _box(0, RAIL_W, Y_RIB_TIP, y_in, *RAIL_Z),
        _box(WIDTH - RAIL_W, WIDTH, Y_RIB_TIP, y_in, *RAIL_Z),
        _box(0, WIDTH, Y_RIB_TIP, y_in, *LIP_Z),
        _box(HOOK_X[0], HOOK_X[1], *HOOK_BLOCK_Y, *HOOK_BLOCK_Z),
        _box(HOOK_X[0], HOOK_X[0] + HOOK_LEG_W, Y_RIB_TIP, y_in, HOOK_BLOCK_Z[1], LIP_Z[0]),
        _box(HOOK_X[1] - HOOK_LEG_W, HOOK_X[1], Y_RIB_TIP, y_in, HOOK_BLOCK_Z[1], LIP_Z[0]),
    ]
    feats += [_box(xc - RIB_W / 2, xc + RIB_W / 2, Y_RIB_TIP, y_in, *RIB_Z) for xc in RIB_X]
    out = feats[0]
    for f in feats[1:]:
        out = out + f
    return out


# ======================================================================== assembly of features
def battery_cover_solid(bow_y=BOW_Y_FLAT) -> bd.Part:
    body = _plate(bow_y) + _inner_features()
    for xc in BUMP_X:
        body = body + _bump(xc)
    for xc in BUMP_X:
        body = body - _bump_core(xc)

    # Thumb recess and latch follow the plate tilt in the first bow segment.
    slope = (bow_y[1] - bow_y[0]) / (BOW_Z[1] - BOW_Z[0])
    shift = bow_y[0] - Y_OUTER
    # rotation about X through (Y_OUTER, RECESS_AXIS_Z): y' = y + slope * (z - z0)
    tilt = (
        bd.Pos(0, shift + Y_OUTER, RECESS_AXIS_Z)
        * bd.Rot(math.degrees(math.atan(-slope)), 0, 0)
        * bd.Pos(0, -Y_OUTER, -RECESS_AXIS_Z)
    )
    air = tilt * _recess_air()
    keep_z = _box(-1, WIDTH + 1, 10, 26, Z_BOTTOM, Z_BOTTOM + 15)
    shell = (tilt * _recess_shell()) & keep_z

    body = body - air
    body = body + shell
    body = body + (_latch_block() - air)
    above_inner = tilt * _above_inner()
    for x0, x1 in LATCH_SLOTS_X:
        slot = _box(x0, x1, LATCH_ARM_Y[0] - 1, Y_OUTER - WALL + 0.5, LATCH_FLOOR_Z, Z_BOTTOM + 10)
        body = body - (slot - above_inner)
    return body

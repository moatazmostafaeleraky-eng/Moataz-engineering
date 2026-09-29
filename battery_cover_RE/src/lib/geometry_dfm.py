"""DFM-corrected battery cover for injection moulding in ABS.

Builds on lib.geometry (same frame, same nominal dimensions, same recess and latch
profiles). Changes versus the design-intent model:

  * draft on every wall parallel to the pull (+/-Y):
      DRAFT_CORE   on B-side (core) walls: perimeter, rails, lip, ribs, hook, latch, core pins
      DRAFT_CAVITY on A-side (cavity) walls: outer bumps
      DRAFT_SHUTOFF on the hook shut-off window
  * R >= R_MIN on internal corners (rib / rail / lip / hook-leg roots, recess-to-plate,
    latch root, bump roots) and on exposed bump edges; PL and shut-off edges stay sharp
  * minimum section 0.8 -> 1.0 mm (ribs), nominal wall unchanged at 2.0 mm
  * straight-pull tooling: the hook-block undercut is released by a pass-through
    (shut-off) window in the plate, so no lifter/slide is needed
"""

from __future__ import annotations

import math

from cadgen import build123d as bd

from lib import geometry as g

DRAFT_CORE = 1.0  # deg, B side
DRAFT_CAVITY = 3.0  # deg, A side (cosmetic, texture-ready)
DRAFT_SHUTOFF = 3.0  # deg, pass-through shut-off
R_MIN = 0.5  # min internal / edge radius
R_LEG = 0.3  # hook-leg roots: limited by the adjoining shut-off window rim
RIB_W = 1.0  # rib root width (0.5 t), was 0.8
Y_IN = g.Y_OUTER - g.WALL  # plate inner face (18)
TAN_C = math.tan(math.radians(DRAFT_CORE))

# pass-through window under the hook block (A-side steel forms the 1.0 mm hook gap)
WINDOW_X = g.HOOK_X
WINDOW_Z = g.HOOK_BLOCK_Z


# ======================================================================== helpers
def _xz_face(pts_xz, y0: float) -> bd.Face:
    return bd.Face(bd.Wire.make_polygon([bd.Vector(x, y0, z) for x, z in pts_xz], close=True))


def _xz_rect(x0, x1, z0, z1, y0) -> bd.Face:
    return _xz_face([(x0, z0), (x1, z0), (x1, z1), (x0, z1)], y0)


def _xz_rounded(x0, x1, z0, z1, r, y0) -> bd.Face:
    plane = bd.Plane(origin=((x0 + x1) / 2, y0, (z0 + z1) / 2), x_dir=(1, 0, 0), z_dir=(0, 1, 0))
    return (plane * bd.RectangleRounded(x1 - x0, z1 - z0, r)).faces()[0]


def _prism(face, y_from, y_to, taper) -> bd.Part:
    """Extrude an XZ face from y_from to y_to; positive taper shrinks along the travel."""
    d = y_to - y_from
    return bd.extrude(face, amount=abs(d), dir=(0, math.copysign(1, d), 0), taper=taper)


def _tilt_halfspace(z0, y0, deg, keep_above=True, size=200.0) -> bd.Part:
    """Half-space bounded by a plane through (y0, z0), tilted `deg` about X (z rises with y)."""
    box = bd.Pos(0, 0, size / 2 if keep_above else -size / 2) * bd.Box(size, size, size)
    return bd.Pos(0, y0, z0) * bd.Rot(deg, 0, 0) * box


def _safe_fillet(part, edges, r, log, label):
    edges = list(edges)
    if not edges:
        return part
    try:
        out = bd.fillet(edges, r)
        log.append((label, len(edges), "ok"))
        return out
    except Exception:  # fall back edge by edge so one bad edge does not drop the whole set
        ok = 0
        for e in edges:
            try:
                match = [x for x in part.edges() if (x.center() - e.center()).length < 1e-4]
                part = bd.fillet(match, r)
                ok += 1
            except Exception:
                pass
        log.append((label, len(edges), f"{ok} ok (edge-by-edge)"))
        return part


# ======================================================================== shell: plate + rails + lip
def _shell() -> bd.Part:
    """Outer block drafted from the PL (outer face, Y 20) down to the rail tips, then cored."""
    block = _prism(_xz_rect(0, g.WIDTH, g.Z_BOTTOM, g.Z_TOP, g.Y_OUTER), g.Y_OUTER, g.Y_RIB_TIP, DRAFT_CORE)
    r0, r1 = g.RAIL_Z
    lip0, lip1 = g.LIP_Z
    core_main = _xz_face(
        [(-1, g.Z_BOTTOM - 1), (g.WIDTH + 1, g.Z_BOTTOM - 1), (g.WIDTH + 1, r0), (g.WIDTH - g.RAIL_W, r0),
         (g.WIDTH - g.RAIL_W, lip0), (g.RAIL_W, lip0), (g.RAIL_W, r0), (-1, r0)], Y_IN)
    core_top = _xz_rect(-1, g.WIDTH + 1, lip1, g.Z_TOP + 1, Y_IN)
    body = block
    for f in (core_main, core_top):
        body = body - _prism(f, Y_IN, g.Y_RIB_TIP - 1, -DRAFT_CORE)
    top = [e for e in body.edges().filter_by(bd.Axis.X) if e.center().Z > g.Z_TOP - 0.2 and e.length > 20]
    return bd.fillet(top, g.TOP_EDGE_R)


def _ribs_and_legs() -> list[bd.Part]:
    y0 = Y_IN + 0.2
    parts = [_prism(_xz_rect(xc - RIB_W / 2, xc + RIB_W / 2, *g.RIB_Z, y0), y0, g.Y_RIB_TIP, DRAFT_CORE)
             for xc in g.RIB_X]
    hx0, hx1 = g.HOOK_X
    # leg bottoms face the hook gap, which A-side steel forms through the window: z rises with Y
    # plane through the window rim (Y_IN, Z 73): everything below it is reachable through the window
    gap_side = _tilt_halfspace(g.HOOK_BLOCK_Z[1], Y_IN, DRAFT_CORE)
    for x0 in (hx0, hx1 - g.HOOK_LEG_W):
        leg = _prism(_xz_rect(x0, x0 + g.HOOK_LEG_W, g.HOOK_BLOCK_Z[1] - 0.2, g.LIP_Z[0] + 0.2, y0),
                     y0, g.Y_RIB_TIP, DRAFT_CORE)
        parts.append(leg & gap_side)
    return parts


def _hook_block() -> bd.Part:
    y_top = g.HOOK_BLOCK_Y[1]
    return _prism(_xz_rect(*g.HOOK_X, *g.HOOK_BLOCK_Z, y_top), y_top, g.HOOK_BLOCK_Y[0], DRAFT_CORE)


def _hook_window() -> bd.Part:
    return _prism(_xz_rect(*WINDOW_X, *WINDOW_Z, Y_IN), Y_IN, g.Y_OUTER + 0.6, -DRAFT_SHUTOFF)


# ======================================================================== outer bumps (A side) + coring (B side)
def _bump(xc: float) -> bd.Part:
    x0, x1 = xc - g.BUMP_W / 2, xc + g.BUMP_W / 2
    y0 = g.Y_OUTER - 0.2
    solid = _prism(_xz_rounded(x0, x1, *g.BUMP_Z, 1.0, y0), y0, g.Y_OUTER + g.BUMP_H, DRAFT_CAVITY)
    top = [e for e in solid.edges() if e.bounding_box().min.Y > g.Y_OUTER + g.BUMP_H - 1e-3]
    return bd.fillet(top, 0.75)


def _bump_core(xc: float) -> bd.Part:
    x0, x1 = xc - g.CORE_W / 2, xc + g.CORE_W / 2
    y0 = Y_IN - 0.5
    pin = _prism(_xz_rect(x0, x1, *g.CORE_Z, y0), y0, g.CORE_TOP_Y, DRAFT_CORE)
    tip = [e for e in pin.edges() if e.bounding_box().min.Y > g.CORE_TOP_Y - 1e-3]
    width_tip = g.CORE_W - 2 * (g.CORE_TOP_Y - y0) * TAN_C
    return bd.fillet(tip, 0.45 * width_tip)  # near-full-round pin tip (width-limited)


# ======================================================================== snap latch
def _latch() -> bd.Part:
    """Latch profile of lib.geometry with 1 deg on the Z-facing faces and a latch-root radius;
    side walls drafted for the core (B) side."""
    t = TAN_C
    y0, y1 = g.LATCH_ARM_Y
    y_top = 19.0
    z_floor = lambda y: g.Z_BOTTOM + (y - y1) * t  # A-released floor underside  # noqa: E731
    r = R_MIN
    pts = [
        (y0, g.LATCH_TIP_Z),
        (y0 + g.LATCH_TIP_W, g.LATCH_TIP_Z + g.LATCH_TIP_W * t),
        (g.LATCH_TOOTH_Y, g.LATCH_CATCH_Z - g.LATCH_CATCH_FLAT),
        (g.LATCH_TOOTH_Y, g.LATCH_CATCH_Z - (g.LATCH_TOOTH_Y - y1) * t),
        (y1, g.LATCH_CATCH_Z),
        (y1, g.Z_BOTTOM - r),
    ]
    V = lambda y, z: bd.Vector(g.LATCH_X[0], y, z)  # noqa: E731
    edges = [bd.Line(V(*a), V(*b)) for a, b in zip(pts, pts[1:])]
    # R_MIN root between the arm face (Y = y1) and the floor underside
    c = (y1 + r, g.Z_BOTTOM - r)
    s45 = math.sqrt(0.5)
    edges.append(bd.ThreePointArc(V(y1, c[1]), V(c[0] - r * s45, c[1] + r * s45), V(c[0], g.Z_BOTTOM + r * t)))
    rest = [(c[0], g.Z_BOTTOM + r * t), (y_top, z_floor(y_top)),
            (y_top, g.LATCH_RAMP_Z0 + (y_top - y0) * g.LATCH_RAMP_DZ_DY), (y0, g.LATCH_RAMP_Z0), pts[0]]
    edges += [bd.Line(V(*a), V(*b)) for a, b in zip(rest, rest[1:])]
    prism = bd.extrude(bd.Face(bd.Wire(edges)), amount=g.LATCH_X[1] - g.LATCH_X[0], dir=(1, 0, 0))
    draft = _prism(_xz_rect(*g.LATCH_X, g.LATCH_TIP_Z - 1, 25, y_top + 0.5), y_top + 0.5, y0 - 0.5, DRAFT_CORE)
    return prism & draft


def _latch_slots() -> list[bd.Part]:
    """Coring slots (B-side pins): drafted walls, tilted floor, rounded floor corners."""
    tools = []
    y_start = g.LATCH_ARM_Y[0] - 1
    for x0, x1 in g.LATCH_SLOTS_X:
        pin = _prism(_xz_rect(x0, x1, g.LATCH_FLOOR_Z - 1, g.Z_BOTTOM + 10, y_start), y_start, Y_IN + 0.5, DRAFT_CORE)
        floor = _tilt_halfspace(g.LATCH_FLOOR_Z, g.LATCH_ARM_Y[0], DRAFT_CORE)
        tool = pin & floor
        low = [e for e in tool.edges() if e.center().Z < g.LATCH_FLOOR_Z + 0.2 and e.length > 1.0
               and abs(e.tangent_at(0.5).Y) > 0.9]
        tools.append(bd.fillet(low, R_MIN) if low else tool)
    return tools


# ======================================================================== assembly
def battery_cover_dfm_solid(log: list | None = None) -> bd.Part:
    log = [] if log is None else log
    body = _shell()
    for p in _ribs_and_legs():
        body = body + p
    body = body + _hook_block()
    body = body - _hook_window()

    # thumb recess: lib.geometry profiles; shell clipped to the drafted perimeter
    clip = _prism(_xz_rect(0, g.WIDTH, g.Z_BOTTOM, g.Z_BOTTOM + 15, g.Y_OUTER), g.Y_OUTER, g.Y_RIB_TIP - 1,
                  DRAFT_CORE)
    air = g._recess_air()
    body = body - air
    body = body + (g._recess_shell() & clip)

    # latch (drafted), coring slots bounded by the recess inner surface
    body = body + (_latch() - air)
    # A-side steel under the latch floor: one drafted plane across the latch width (removes the
    # opposite-draft sliver where the B-drafted plate end meets the A-drafted latch floor)
    y1 = g.LATCH_ARM_Y[1]
    under = _prism(_xz_rect(*g.LATCH_X, g.LATCH_TIP_Z - 2, g.Z_BOTTOM + 1, g.Y_OUTER + 1), g.Y_OUTER + 1,
                   y1, -DRAFT_CORE)
    body = body - (under - _tilt_halfspace(g.Z_BOTTOM, y1, DRAFT_CORE))
    above_inner = g._above_inner()
    for tool in _latch_slots():
        body = body - (tool - above_inner)

    # outer bumps + B-side coring
    for xc in g.BUMP_X:
        body = body + _bump(xc)
    for xc in g.BUMP_X:
        body = body - _bump_core(xc)

    # ---- internal-corner radii, filleted in connected groups (one combined call fails in OCC)
    def on_plane(e, y, tol=2e-3):
        bb = e.bounding_box()
        return abs(bb.min.Y - y) < tol and abs(bb.max.Y - y) < tol

    def mid(e):
        return e.position_at(0.5)

    inner = [e for e in body.edges() if on_plane(e, Y_IN)]

    def pick(pred):
        return [e for e in inner if pred(mid(e))]

    in_legs = lambda m: (g.HOOK_BLOCK_Z[1] + 0.05 < m.Z < g.LIP_Z[0] + 0.05  # noqa: E731
                         and g.HOOK_X[0] - 0.05 < m.X < g.HOOK_X[1] + 0.05)
    rail_lip = pick(lambda m: not in_legs(m) and (
        abs(m.X - g.RAIL_W) < 0.05 or abs(m.X - (g.WIDTH - g.RAIL_W)) < 0.05 or abs(m.Z - g.LIP_Z[0]) < 0.05
        or (abs(m.Z - g.RAIL_Z[0]) < 0.05 and (m.X < 1.1 or m.X > g.WIDTH - 1.1))))
    body = _safe_fillet(body, rail_lip, R_MIN, log, "rail / lip roots")
    inner = [e for e in body.edges() if on_plane(e, Y_IN)]
    legs = pick(in_legs)
    try:  # leg roots end on the shut-off window rim: R_MIN does not close there, R_LEG does
        body = bd.fillet(legs, R_MIN)
        log.append(("hook-leg roots", len(legs), f"ok R{R_MIN}"))
    except Exception:
        body = _safe_fillet(body, legs, R_LEG, log, f"hook-leg roots (R{R_LEG}, window-limited)")
    inner = [e for e in body.edges() if on_plane(e, Y_IN)]
    ribs = pick(lambda m: any(abs(m.X - xc) < RIB_W for xc in g.RIB_X) and g.RIB_Z[0] - 0.1 < m.Z < g.RIB_Z[1] + 0.1)
    body = _safe_fillet(body, ribs, R_MIN, log, "rib roots")
    inner = [e for e in body.edges() if on_plane(e, Y_IN)]
    recess = pick(lambda m: 7.5 < math.hypot(m.X - g.RECESS_AXIS_X, m.Z - g.RECESS_AXIS_Z) < 9.0)
    body = _safe_fillet(body, recess, R_MIN, log, "recess-to-plate junction")
    bump_roots = [e for e in body.edges() if on_plane(e, g.Y_OUTER) and 68 < e.center().Z < 76
                  and any(abs(e.center().X - xc) < 2.5 for xc in g.BUMP_X)]
    body = _safe_fillet(body, bump_roots, R_MIN, log, "bump roots")
    return body

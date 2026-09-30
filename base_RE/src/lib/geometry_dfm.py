"""DFM-corrected rear case (see ../../output/DFM.pptx and ../../dfm/README.md).

Built from the reverse-engineered model in geometry.py; the changes are:

1. Draft on the side walls, neutral plane at the parting line (Y_PL) so the PL outline is unchanged:
   outer walls DRAFT_CAVITY (cavity side), inner walls DRAFT_CORE (core side).
2. Thin up-to-skin ribs (<= RIB_MAX_W thick, away from the side walls) get DRAFT_RIB per side: the tip keeps its 0.8 mm and the
   root thickens towards the skin. Blocks, rims and rails keep their faces: the rims at X 10.62 / 41.62
   locate the battery cover rails and must not grow into them.
3. Weak / knife-edge steel: the wedge-shaped air gaps (< WEDGE_GAP) left where the thin side plates and
   ribs meet the R8 inner fillet are filled with plastic (features in dfm_features.json).

Unchanged on purpose (function first): the inner side walls inside the four front-case snap stations
(0.8 mm slots), the ten PL catch teeth (moulded with lifters), the cover opening,
slot, rails and rims, the finger recess and bosses, the cosmetic skin.

This module rebinds geometry.outer_block / geometry._inner_full, so import it in its own process.
"""

from __future__ import annotations

import functools
import json

from cadgen import build123d as bd
from cadgen.inputs import declare_input

from . import geometry as g

DRAFT_CAVITY = 1.0  # deg, outer side walls (cavity half)
DRAFT_CORE = 0.5  # deg, inner side walls (core half)
DRAFT_RIB = 0.5  # deg per side, thin ribs (core half)
RIB_MAX_W = 1.35  # ribs up to this thickness get the rib draft ...
RIB_X_RANGE = (5.5, 46.74)  # ... unless they sit next to a side wall: those plates form the 0.8 mm front-case
#                             slots with the wall, and a tapered plate would close the slot (function first)
WEDGE_GAP = 0.75  # air gaps narrower than this, against the side fillets, are filled
# front-case snap stations: plates + 0.8 mm slots against the inner side walls. The inner walls keep 0 deg here so
# the slot width (mating interface) is unchanged; elsewhere they get DRAFT_CORE.
SNAP_STATIONS_Z = [(14.663, 18.653), (63.853, 69.443), (102.861, 108.451), (138.642, 142.632)]
STATION_MARGIN = 0.5


def _drafted_block(ctrl, x0, x1, y_floor, radius, angle) -> bd.Part:
    body = bd.extrude(g._yz_spline_face(ctrl, x0, y_floor), amount=x1 - x0, dir=(1, 0, 0))
    sides = [f for f in body.faces() if f.geom_type == bd.GeomType.PLANE and abs(abs(f.normal_at().X) - 1) < 1e-6]
    body = bd.draft(sides, bd.Plane(origin=(26.12, g.Y_PL, 70), z_dir=(0, 1, 0)), angle)
    top = max((f for f in body.faces() if f.geom_type != bd.GeomType.PLANE), key=lambda f: f.center().Y)
    sides = [f for f in body.faces() if f.geom_type == bd.GeomType.PLANE and abs(f.normal_at().X) > 0.9]
    edges = [e for e in body.edges() if _shared(e, top, sides)]
    return bd.fillet(edges, radius)


def _shared(edge, top, sides) -> bool:
    in_top = any(edge.is_same(e) for e in top.edges())
    return in_top and any(edge.is_same(e) for f in sides for e in f.edges())


@functools.cache
def outer_block_dfm(y_floor: float = g.Y_PL) -> bd.Part:
    return _drafted_block(g._profile("outer"), g.X0, g.X1, y_floor, g.CORNER_R, DRAFT_CAVITY)


_inner_full_orig = g._inner_full


@functools.cache
def inner_full_dfm() -> bd.Part:
    drafted = _drafted_block(g._profile("inner"), g.X0 + g.WALL, g.X1 - g.WALL, g.Y_PL - 10, g.CORNER_R - g.WALL,
                             DRAFT_CORE)
    keep = [g._zbox(a - STATION_MARGIN, b + STATION_MARGIN) for a, b in SNAP_STATIONS_Z]
    return drafted.fuse(_inner_full_orig() & g._fuse(keep))  # 0 deg walls inside the snap stations


# rebind: every envelope operation in geometry.py now uses the drafted blocks
g.outer_block = outer_block_dfm
g._inner_full = inner_full_dfm


def _rib_width(rings) -> float:
    from shapely.geometry import Polygon

    poly = Polygon(rings[0], rings[1:])
    lo, hi = 0.0, 5.0  # thickness = 2 x largest inscribed radius (bisection on erosion)
    for _ in range(18):
        mid = (lo + hi) / 2
        lo, hi = (mid, hi) if not poly.buffer(-mid / 2).is_empty else (lo, mid)
    return lo


def ribs_dfm() -> list[bd.Part]:
    """Up-to-skin sketches; thin ribs extruded with a (growing) taper, the rest straight."""
    parts = []
    for e in g._features()["T"]:
        for rings in e["rings"]:
            face = g._sketch([rings], 1, e["y0"])[0]
            xs = [p[0] for p in rings[0]]
            zs = [p[1] for p in rings[0]]
            inside = RIB_X_RANGE[0] <= min(xs) and max(xs) <= RIB_X_RANGE[1]
            # ribs under the battery opening are formed through the opening by the cavity: a core-side taper
            # would be a reverse draft there
            under_opening = (g.SLOT_X[0] - 0.5 <= min(xs) and max(xs) <= g.SLOT_X[1] + 0.5
                             and max(zs) > g.OPENING_Z[0] - 3.0)
            inside = inside and not under_opening
            taper = -DRAFT_RIB if (_rib_width(rings) <= RIB_MAX_W and inside) else 0.0
            try:
                p = bd.extrude(face, amount=30.0 - e["y0"], dir=(0, 1, 0), taper=taper)
            except Exception:  # a sketch OCC cannot taper keeps its straight walls (listed in the report)
                p = bd.extrude(face, amount=30.0 - e["y0"], dir=(0, 1, 0))
            parts.append(p & g._skin_clip())
    return [p for p in parts if p.volume > 1e-6]


@functools.cache
def _dfm_features() -> dict:
    return json.loads(declare_input(g.HERE / "dfm_features.json").read_text())


def wedge_fills() -> list[bd.Part]:
    out = []
    for e in _dfm_features()["wedges"]:
        out += g._prism(e["rings"], 2, e["v0"], e["v1"])
    return [p for p in out if p.volume > 1e-6]


def base_dfm() -> bd.Part:
    data = g._features()
    body = g.envelope().fuse(g._fuse(ribs_dfm()))
    detail = []
    fr = g._recess_keepout().bounding_box()
    for p in g._feature_solids(data["F"]) + wedge_fills():
        bb = p.bounding_box()
        if bb.max.Z > fr.min.Z and bb.min.Z < fr.max.Z and bb.max.X > fr.min.X and bb.min.X < fr.max.X:
            p = p - g._recess_keepout()
        if p.volume > 1e-4:
            detail.append(p)
    body = body.fuse(g._fuse_seq(detail))
    body = body - g.battery_opening()
    for cut in g._feature_solids(data["G"], cut=True):
        body = body - cut
    body = body - g.boss_holes()
    return bd.split(body, bisect_by=g._bottom_plane(), keep=bd.Keep.BOTTOM).clean()

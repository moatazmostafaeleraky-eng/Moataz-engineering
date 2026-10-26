"""Rebuild a closed mesh as feature CAD: analytic surfaces only, no mesh triangles.

The mesh is used as a measuring reference, never copied into the B-rep. The solid is
built from ordinary CAD operations, each of which can only produce analytic faces:

1. Silhouette hull - the outline of the part seen along each frame axis is extruded
   along that axis and the three prisms are intersected (planar faces). Openings
   that go right through the part are holes in the outlines.
2. Revolve envelopes - for every axis the mesh turns about (cylinder/cone patches
   found by the primitive segmentation), the largest radius of the part is measured
   per axial station and angular sector and revolved (cones, cylinders, planes).
3. Bores - concave cylinder patches are cut as cylinders, extended to the open end,
   after checking that the volume they remove is empty in the mesh.

Steps 1-2 are conservative envelopes of the part, so they only ever remove air.
Each refinement is kept only when it improves the measured deviation, so a step
that does not suit a part is simply skipped. The report gives the deviation of the
result against the mesh; external form only - the mesh carries no internal design.
"""
from __future__ import annotations

import itertools
import math
import time
from typing import Any

import numpy as np

ANALYTIC = ("plane", "cylinder", "cone", "sphere", "torus")
FUSE_TOL = 0.001


# ---- geometry helpers ----------------------------------------------------------------
def _cq():
    import cadquery as cq
    return cq


def _orthonormal(axis: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    a = axis / np.linalg.norm(axis)
    ref = np.array([1.0, 0, 0]) if abs(a[0]) < 0.9 else np.array([0, 1.0, 0])
    e1 = np.cross(a, ref)
    e1 /= np.linalg.norm(e1)
    return e1, np.cross(a, e1)


def surface_types(shape) -> dict[str, int]:
    from OCP.BRepAdaptor import BRepAdaptor_Surface
    from OCP.GeomAbs import (
        GeomAbs_BSplineSurface,
        GeomAbs_Cone,
        GeomAbs_Cylinder,
        GeomAbs_Plane,
        GeomAbs_Sphere,
        GeomAbs_Torus,
    )
    from OCP.TopAbs import TopAbs_FACE
    from OCP.TopExp import TopExp_Explorer
    from OCP.TopoDS import TopoDS

    names = {GeomAbs_Plane: "plane", GeomAbs_Cylinder: "cylinder", GeomAbs_Cone: "cone", GeomAbs_Sphere: "sphere",
             GeomAbs_Torus: "torus", GeomAbs_BSplineSurface: "bspline"}
    out: dict[str, int] = {}
    exp = TopExp_Explorer(shape, TopAbs_FACE)
    while exp.More():
        kind = names.get(BRepAdaptor_Surface(TopoDS.Face_s(exp.Current())).GetType(), "other")
        out[kind] = out.get(kind, 0) + 1
        exp.Next()
    return out


# ---- measurement against the mesh ------------------------------------------------------
class _Reference:
    """The mesh as a measuring reference: area-weighted samples, volume and inside test."""

    def __init__(self, vertices: np.ndarray, faces: np.ndarray, samples: int = 60000, seed: int = 7):
        import trimesh

        self.mesh = trimesh.Trimesh(vertices, faces, process=True)
        rng = np.random.default_rng(seed)
        self.points, _ = trimesh.sample.sample_surface(self.mesh, samples, seed=rng)
        self.volume = float(abs(self.mesh.volume))

    def score(self, shape) -> dict[str, Any]:
        import trimesh

        verts, tris = _tessellate(shape, 0.2)
        if not len(tris):
            return {"within_1mm_pct": 0.0, "volume_diff_pct": 1e9}
        cad = trimesh.Trimesh(verts, tris, process=True)
        _, dist, _ = trimesh.proximity.closest_point(cad, self.points)
        vol = _volume(shape)
        return {
            "mean_mm": round(float(dist.mean()), 3),
            "p95_mm": round(float(np.percentile(dist, 95)), 3),
            "within_0.5mm_pct": round(100 * float((dist <= 0.5).mean()), 1),
            "within_1mm_pct": round(100 * float((dist <= 1.0).mean()), 1),
            "volume_diff_pct": round(100 * (vol - self.volume) / self.volume, 2),
        }

    def empty_fraction(self, points: np.ndarray) -> float:
        return float((~self.mesh.contains(points)).mean()) if len(points) else 1.0


def _tessellate(shape, deflection: float):
    from OCP.BRep import BRep_Tool
    from OCP.BRepMesh import BRepMesh_IncrementalMesh
    from OCP.TopAbs import TopAbs_FACE, TopAbs_REVERSED
    from OCP.TopExp import TopExp_Explorer
    from OCP.TopLoc import TopLoc_Location
    from OCP.TopoDS import TopoDS

    BRepMesh_IncrementalMesh(shape, deflection, False, 0.3)
    verts, tris, base = [], [], 0
    exp = TopExp_Explorer(shape, TopAbs_FACE)
    while exp.More():
        face = TopoDS.Face_s(exp.Current())
        loc = TopLoc_Location()
        tri = BRep_Tool.Triangulation_s(face, loc)
        if tri is not None:
            trsf = loc.Transformation()
            for i in range(1, tri.NbNodes() + 1):
                p = tri.Node(i).Transformed(trsf)
                verts.append((p.X(), p.Y(), p.Z()))
            rev = face.Orientation() == TopAbs_REVERSED
            for i in range(1, tri.NbTriangles() + 1):
                a, b, c = tri.Triangle(i).Get()
                tris.append((base + a - 1, base + c - 1, base + b - 1) if rev else (base + a - 1, base + b - 1, base + c - 1))
            base += tri.NbNodes()
        exp.Next()
    return np.asarray(verts, float).reshape(-1, 3), np.asarray(tris, int).reshape(-1, 3)


def _volume(shape) -> float:
    from OCP.BRepGProp import BRepGProp
    from OCP.GProp import GProp_GProps

    props = GProp_GProps()
    BRepGProp.VolumeProperties_s(shape, props)
    return abs(props.Mass())


# ---- outlines: lines and arcs ---------------------------------------------------------
def _circle(points: np.ndarray):
    """Least-squares circle through 2-D points: (centre, radius, max residual)."""
    x, y = points[:, 0], points[:, 1]
    A = np.c_[2 * x, 2 * y, np.ones(len(x))]
    sol, *_ = np.linalg.lstsq(A, x * x + y * y, rcond=None)
    c = sol[:2]
    r = math.sqrt(max(sol[2] + c @ c, 0.0))
    return c, r, float(np.abs(np.hypot(x - c[0], y - c[1]) - r).max())


def _line_fits(points: np.ndarray, tol: float) -> bool:
    a, b = points[0], points[-1]
    d = b - a
    n = math.hypot(*d)
    if n < 1e-9:
        return False
    rel = points - a
    return float(np.abs(d[0] * rel[:, 1] - d[1] * rel[:, 0]).max()) / n <= tol


def _arc_fits(points: np.ndarray, tol: float, span: float) -> bool:
    if len(points) < 5:
        return False
    c, r, res = _circle(points)
    if res > tol or not 0.5 <= r <= 50 * span:
        return False
    # 10..180 degrees of sweep, points in order along the arc (no doubling back), and no gap between
    # samples long enough to hide a straight run (a chord c on radius r sags c^2 / 8r).
    ang = np.unwrap(np.arctan2(points[:, 1] - c[1], points[:, 0] - c[0]))
    step = np.diff(ang)
    sweep = abs(ang[-1] - ang[0])
    chords = np.hypot(*np.diff(points, axis=0).T)
    return (math.radians(10) <= sweep <= math.pi and (np.all(step > 0) or np.all(step < 0))
            and float(np.abs(step).max()) <= math.radians(25) and float(chords.max()) <= math.sqrt(8 * r * 0.6))


def _longest(points: np.ndarray, i: int, fits, first: int) -> int:
    """Largest j >= i + first such that points[i..j] satisfy ``fits`` (doubling, then bisection); i if none."""
    n = len(points) - 1
    good = i + first
    if good > n or not fits(points[i:good + 1]):
        return i
    step = 1
    while good + step <= n and fits(points[i:good + step + 1]):
        good += step
        step *= 2
    lo, hi = good, min(good + step, n + 1)
    while hi - lo > 1:
        mid = (lo + hi) // 2
        if fits(points[i:mid + 1]):
            lo = mid
        else:
            hi = mid
    return lo


def fit_segments(ring: np.ndarray, tol: float = 0.12) -> list[tuple]:
    """Split a closed polyline into straight lines and circular arcs within ``tol``.

    Returns ('line', p, q) and ('arc', p, mid, q) items that chain end to start.
    """
    pts = np.asarray(ring, float)
    if np.allclose(pts[0], pts[-1]):
        pts = pts[:-1]
    if len(pts) < 3:
        return []
    # Start at the sharpest corner so no arc is split by the seam.
    prev, nxt = np.roll(pts, 1, axis=0), np.roll(pts, -1, axis=0)
    u, w = pts - prev, nxt - pts
    turn = np.abs(np.arctan2(u[:, 0] * w[:, 1] - u[:, 1] * w[:, 0], (u * w).sum(1)))
    k = int(np.argmax(turn))
    pts = np.r_[pts[k:], pts[:k], pts[k:k + 1]]
    span = float(np.ptp(pts, axis=0).max())
    out, i = [], 0
    while i < len(pts) - 1:
        j_line = max(_longest(pts, i, lambda q: _line_fits(q, tol), 1), i + 1)
        j_arc = _longest(pts, i, lambda q: _arc_fits(q, tol, span), 4)
        if j_arc > j_line + 1:
            c, r, _ = _circle(pts[i:j_arc + 1])
            m = pts[(i + j_arc) // 2] - c
            mid = c + m / np.linalg.norm(m) * r
            out.append(("arc", pts[i], mid, pts[j_arc]))
            i = j_arc
        else:
            out.append(("line", pts[i], pts[j_line]))
            i = j_line
    return out


# ---- step 1: silhouette hull -------------------------------------------------------------
def silhouette(vertices: np.ndarray, faces: np.ndarray, axis: int, simplify_mm: float = 0.05, min_area_mm2: float = 2.0):
    """Outline of the mesh seen along a frame axis, as shapely polygons in (u, v) = (axis+1, axis+2)."""
    import shapely
    from shapely.ops import unary_union

    u, v = (axis + 1) % 3, (axis + 2) % 3
    tri = vertices[faces][:, :, [u, v]]
    d1, d2 = tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0]
    area = 0.5 * np.abs(d1[:, 0] * d2[:, 1] - d1[:, 1] * d2[:, 0])
    tri = tri[area > 1e-6]
    rings = np.concatenate([tri, tri[:, :1]], axis=1)
    union = unary_union(shapely.polygons(rings)).buffer(0.05, join_style="mitre").buffer(-0.05, join_style="mitre")
    union = union.simplify(simplify_mm, preserve_topology=True)
    polys = [union] if union.geom_type == "Polygon" else list(getattr(union, "geoms", []))
    out = []
    for p in polys:
        if p.area < min_area_mm2:
            continue
        holes = [h for h in p.interiors if shapely.Polygon(h).area >= min_area_mm2]
        out.append(shapely.Polygon(p.exterior, holes))
    return out


def _axis_plane(axis: int, offset: float):
    cq = _cq()
    e = np.eye(3)
    u = (axis + 1) % 3
    origin = e[axis] * offset
    return cq.Plane(origin=tuple(origin), xDir=tuple(e[u]), normal=tuple(e[axis]))


def _prism(polygons, axis: int, lo: float, hi: float):
    cq = _cq()
    plane = _axis_plane(axis, lo)
    solids = []
    for poly in polygons:
        outer, holes = _wires(poly, lambda x, y: tuple(plane.toWorldCoords((float(x), float(y))).toTuple()), 2.0)
        solids.append(cq.Solid.extrudeLinear(cq.Face.makeFromWires(outer, holes), cq.Vector(*(np.eye(3)[axis] * (hi - lo)))))
    return _fuse_all(solids)


def silhouette_hull(vertices: np.ndarray, faces: np.ndarray, simplify_mm: float = 0.05):
    lo, hi = vertices.min(0) - 1.0, vertices.max(0) + 1.0
    hull = None
    for axis in range(3):
        prism = _prism(silhouette(vertices, faces, axis, simplify_mm), axis, lo[axis], hi[axis])
        if prism is None:
            continue
        hull = prism if hull is None else hull.intersect(prism)
    return hull


# ---- step 2: revolve envelopes --------------------------------------------------------------
def _snap(axis: np.ndarray, point: np.ndarray, deg: float = 1.0, mm: float = 0.5):
    """Snap a fitted axis onto the frame axis it nearly is, so revolved faces come out as exact cones."""
    a = axis / np.linalg.norm(axis)
    k = int(np.argmax(np.abs(a)))
    if abs(a[k]) >= math.cos(math.radians(deg)):
        a = np.eye(3)[k] * np.sign(a[k])
        point = point - (point @ a) * a
        point = np.where(np.abs(point) < mm, 0.0, point)
    return a, point


def segment_features(vertices: np.ndarray, faces: np.ndarray, tol: float = 0.1, min_share: float = 0.02, limit: int = 4):
    """Primitive segmentation of the mesh, summarised for the rebuild.

    Returns the axes the part turns about (cylinder/cone patches grouped by axis line,
    largest area first), the concave cylinder patches (bores) and the planar patches.
    """
    from raedbots.cad import smooth_surface as ss

    v, f, _ = ss.clean_mesh(vertices, faces)
    mesh = ss.Mesh(v, f)
    labels, prims = ss.segment(mesh, tol)
    labels, prims = ss.merge_facet_strips(mesh, labels, prims, tol)
    labels = ss.absorb_slivers(mesh, labels, prims, tol)
    area = np.bincount(labels, weights=mesh.area, minlength=len(prims))
    total = float(mesh.area.sum())
    groups: list[dict] = []
    bores: list[dict] = []
    planes: list[tuple[np.ndarray, float, float]] = []
    for pid, p in enumerate(prims):
        if area[pid] <= 0:
            continue
        if p["kind"] == ss.PLANE:
            n = np.asarray(p["normal"], float)
            planes.append((n, float(n @ np.asarray(p["point"], float)), float(area[pid] / total)))
            continue
        if p["kind"] not in (ss.CYLINDER, ss.CONE):
            continue
        a, point = _snap(np.asarray(p["axis"], float), np.asarray(p["point"], float))
        fids = np.where(labels == pid)[0]
        radial = mesh.centroid[fids] - point - np.outer((mesh.centroid[fids] - point) @ a, a)
        rn = np.linalg.norm(radial, axis=1)
        ok = rn > 1e-6
        concave = bool(ok.any()) and float(np.average(np.einsum("ij,ij->i", mesh.normal[fids][ok], radial[ok] / rn[ok, None]),
                                                        weights=mesh.area[fids][ok])) < 0
        t = (v[np.unique(f[fids])] - point) @ a
        if p["kind"] == ss.CYLINDER and concave and area[pid] / total >= 0.002:
            bores.append({"axis": a, "point": point, "radius": float(p["radius"]), "t": (float(t.min()), float(t.max())),
                          "share": float(area[pid] / total)})
        for g in groups:
            if abs(abs(g["axis"] @ a) - 1) < 1e-3:
                d = point - g["point"]
                if np.linalg.norm(d - (d @ g["axis"]) * g["axis"]) < 1.0:
                    g["area"] += float(area[pid])
                    break
        else:
            groups.append({"axis": a, "point": point - (point @ a) * a, "area": float(area[pid])})
    groups = [g for g in groups if g["area"] / total >= min_share]
    groups.sort(key=lambda g: -g["area"])
    for g in groups:
        g["share"] = g.pop("area") / total
    return groups[:limit], bores, planes


def _plane_sections(mesh, origin: np.ndarray, normal: np.ndarray, eu: np.ndarray, ev: np.ndarray):
    """Cross-section of the mesh in a plane as a shapely geometry in the (eu, ev) coordinates of that plane."""
    import shapely

    sec = mesh.section(plane_origin=origin, plane_normal=normal)
    region = shapely.Polygon()
    if sec is None:
        return region
    for loop in sec.discrete:
        if len(loop) < 4:
            continue
        rel = loop - origin
        poly = shapely.Polygon(np.c_[rel @ eu, rel @ ev]).buffer(0)
        if not poly.is_empty:
            region = region.symmetric_difference(poly)   # even-odd: inner loops become holes
    return region


def _polygons(geom, min_area: float):
    parts = [geom] if geom.geom_type == "Polygon" else list(getattr(geom, "geoms", []))
    return [p for p in parts if p.geom_type == "Polygon" and p.area >= min_area]


def _wires(poly, to_world, min_hole: float):
    """Outer and inner wires of a polygon, with runs of points on a circle turned into true arcs."""
    import shapely

    cq = _cq()

    def wire(coords):
        edges = []
        for seg in fit_segments(np.asarray(coords)):
            pts = [cq.Vector(*to_world(*p)) for p in seg[1:]]
            edges.append(cq.Edge.makeLine(*pts) if seg[0] == "line" else cq.Edge.makeThreePointArc(*pts))
        return cq.Wire.assembleEdges(edges)
    return wire(poly.exterior.coords), [wire(h.coords) for h in poly.interiors if shapely.Polygon(h).area >= min_hole]


def _fuse_all(pieces):
    if not pieces:
        return None
    return pieces[0].fuse(*pieces[1:], tol=FUSE_TOL) if len(pieces) > 1 else pieces[0]


def revolved_hull(mesh, axis: np.ndarray, origin: np.ndarray, sectors: int, step_deg: float = 3.0,
                  pad_mm: float = 0.25, simplify_mm: float = 0.05):
    """Union of the half-plane sections through the axis, per angular sector, revolved over that sector.

    Recesses, bores and shoulders that turn about the axis are kept (unlike a largest-radius envelope).
    """
    import shapely
    from shapely.ops import unary_union

    cq = _cq()
    a = axis / np.linalg.norm(axis)
    e1, e2 = _orthonormal(a)
    span = 360.0 / sectors
    reach = float(np.linalg.norm(mesh.bounds[1] - mesh.bounds[0])) + 10.0
    half_plane = shapely.box(0.0, -reach, reach, reach)
    pieces = []
    for s in range(sectors):
        lo = s * span
        regions = []
        for ang in np.linspace(lo, lo + span, max(2, math.ceil(span / step_deg) + 1)):
            d = math.cos(math.radians(ang)) * e1 + math.sin(math.radians(ang)) * e2
            sec = _plane_sections(mesh, origin, np.cross(a, d), d, a)       # (r, t) coordinates
            if not sec.is_empty:
                regions.append(sec.intersection(half_plane))
        if not regions:
            continue
        region = unary_union(regions).buffer(pad_mm, join_style="mitre").simplify(simplify_mm, preserve_topology=True)
        region = region.intersection(half_plane)          # padding must not cross the axis
        start = math.cos(math.radians(lo)) * e1 + math.sin(math.radians(lo)) * e2
        for poly in _polygons(region, 1.0):
            outer, holes = _wires(poly, lambda r, t, start=start: tuple(origin + r * start + t * a), 1.0)
            try:
                pieces.append(cq.Solid.revolve(outer, holes, 360.0 if sectors == 1 else span,
                                               cq.Vector(*origin), cq.Vector(*(origin + a))))
            except Exception:
                return None
    return _fuse_all(pieces)


def step_levels(mesh, axis: int, planes: list[tuple[np.ndarray, float, float]], min_gap: float = 1.0):
    """Heights along a frame axis where the part steps: planar patches facing that axis."""
    lo, hi = float(mesh.bounds[0][axis]), float(mesh.bounds[1][axis])
    levels = sorted([lo, hi] + [float(offset * np.sign(n[axis])) for n, offset, share in planes
                                if abs(abs(n[axis]) - 1.0) < 1e-3 and share >= 0.002 and lo < offset * np.sign(n[axis]) < hi])
    out = [levels[0]]
    for z in levels[1:]:
        if z - out[-1] >= min_gap:
            out.append(z)
    out[-1] = hi
    return out


def layered_hull(mesh, axis: int, levels: list[float], step_mm: float = 1.0, pad_mm: float = 0.25,
                 simplify_mm: float = 0.05):
    """Between consecutive step heights, the union of the cross-sections is extruded over that band."""
    from shapely.ops import unary_union

    cq = _cq()
    e = np.eye(3)
    u, v = (axis + 1) % 3, (axis + 2) % 3
    pieces = []
    for z0, z1 in itertools.pairwise(levels):
        regions = []
        for z in np.linspace(z0 + 0.05, z1 - 0.05, max(2, math.ceil((z1 - z0) / step_mm) + 1)):
            sec = _plane_sections(mesh, e[axis] * z, e[axis], e[u], e[v])
            if not sec.is_empty:
                regions.append(sec)
        if not regions:
            continue
        region = unary_union(regions).buffer(pad_mm, join_style="mitre").simplify(simplify_mm, preserve_topology=True)
        lo = z0 - (0.5 if z0 == levels[0] else 0.0)
        hi = z1 + (0.5 if z1 == levels[-1] else 0.0)
        for poly in _polygons(region, 1.0):
            outer, holes = _wires(poly, lambda x, y, lo=lo: tuple(e[axis] * lo + x * e[u] + y * e[v]), 1.0)
            pieces.append(cq.Solid.extrudeLinear(cq.Face.makeFromWires(outer, holes), cq.Vector(*(e[axis] * (hi - lo)))))
    return _fuse_all(pieces)


# ---- step 3: bores ------------------------------------------------------------------------------
def _cylinder_points(axis, origin, radius, t0, t1, n=1500, seed=3):
    rng = np.random.default_rng(seed)
    e1, e2 = _orthonormal(axis)
    rr = radius * np.sqrt(rng.random(n)) * 0.97
    th = rng.random(n) * 2 * math.pi
    tt = t0 + (t1 - t0) * rng.random(n)
    return origin + np.outer(tt, axis) + np.outer(rr * np.cos(th), e1) + np.outer(rr * np.sin(th), e2)


def bore_cut(ref: _Reference, bore: dict, extent: tuple[float, float], step_mm: float = 2.0, empty: float = 0.97):
    """Cylinder for a concave patch, extended towards the open end while the extension is empty."""
    cq = _cq()
    a, p, r = bore["axis"], bore["point"], bore["radius"]
    t0, t1 = bore["t"]
    if ref.empty_fraction(_cylinder_points(a, p, r, t0, t1)) < empty:
        return None
    lo, hi = extent
    while t1 < hi and ref.empty_fraction(_cylinder_points(a, p, r, t1, t1 + step_mm, 300)) >= empty:
        t1 += step_mm
    while t0 > lo and ref.empty_fraction(_cylinder_points(a, p, r, t0 - step_mm, t0, 300)) >= empty:
        t0 -= step_mm
    e1, _ = _orthonormal(a)
    plane = cq.Plane(origin=tuple(p + a * t0), xDir=tuple(e1), normal=tuple(a))
    return cq.Workplane(plane).circle(r).extrude(t1 - t0).val()


# ---- driver ---------------------------------------------------------------------------------
def _valid(shape) -> bool:
    from OCP.BRepCheck import BRepCheck_Analyzer
    return shape is not None and BRepCheck_Analyzer(shape.wrapped if hasattr(shape, "wrapped") else shape).IsValid()


def _better(new: dict, old: dict) -> bool:
    """Keep a refinement only if it fits the mesh better: more surface within 1 mm, or the same with less excess volume."""
    if new["within_1mm_pct"] > old["within_1mm_pct"] + 0.2:
        return new["volume_diff_pct"] > -3.0
    return new["within_1mm_pct"] >= old["within_1mm_pct"] - 0.2 and abs(new["volume_diff_pct"]) < abs(old["volume_diff_pct"]) - 0.2


def feature_solid(vertices_mm: np.ndarray, faces: np.ndarray, *, part_name: str = "part") -> tuple[Any, dict[str, Any]]:
    """Return (OCP solid, report). Raises ValueError when no valid analytic solid can be built."""
    started = time.monotonic()
    ref = _Reference(vertices_mm, faces)
    v, f = ref.mesh.vertices, ref.mesh.faces
    steps: list[dict[str, Any]] = []
    shape = silhouette_hull(v, f)
    if not _valid(shape):
        shape = shape.fix() if shape is not None else None
    if not _valid(shape):
        raise ValueError(f"{part_name}: silhouette hull did not validate")
    score = ref.score(shape.wrapped)
    steps.append({"step": "silhouette_hull", **score})

    def candidate(build, *args, cut=False):
        """Intersect with (or cut) the tool ``build(*args)`` and score the result.

        None when it fails, does not validate or brings a non-analytic face.
        """
        try:
            tool = build(*args)
            cand = None if tool is None else (shape.cut(tool) if cut else shape.intersect(tool))
        except Exception:
            return None
        if cand is None or not _valid(cand) or not cand.Solids():
            return None
        if not all(k in ANALYTIC for k in surface_types(cand.wrapped)):
            return None
        return cand, ref.score(cand.wrapped)

    axes, bores, planes = segment_features(v, f)
    # Revolved hulls about every axis the part turns on.
    for g in axes:
        best = None
        for sectors in (1, 4, 8):
            got = candidate(revolved_hull, ref.mesh, g["axis"], g["point"], sectors)
            if got and _better(got[1], score) and (best is None or _better(got[1], best[1])):
                best = (*got, sectors)
        if best:
            shape, score = best[0], best[1]
            steps.append({"step": "revolved_hull", "axis": np.round(g["axis"], 4).tolist(),
                          "through": np.round(g["point"], 2).tolist(), "sectors": best[2], **score})
    # Layered hulls: pockets and steps seen between the step heights along each frame axis.
    for axis in range(3):
        levels = step_levels(ref.mesh, axis, planes)
        got = candidate(layered_hull, ref.mesh, axis, levels)
        if got and _better(got[1], score):
            shape, score = got
            steps.append({"step": "layered_hull", "axis": "XYZ"[axis], "bands": len(levels) - 1, **score})
    # Bores the outlines cannot see (blind holes), checked empty before they are cut.
    lo, hi = v.min(0) - 2.0, v.max(0) + 2.0
    for bore in sorted(bores, key=lambda b: -b["share"])[:24]:
        proj = np.array([lo, hi]) @ bore["axis"] - bore["point"] @ bore["axis"]
        got = candidate(bore_cut, ref, bore, (float(proj.min()), float(proj.max())), cut=True)
        if got and got[1]["volume_diff_pct"] > -2.0 and (
                _better(got[1], score) or (got[1]["within_1mm_pct"] >= score["within_1mm_pct"]
                                           and got[1]["volume_diff_pct"] < score["volume_diff_pct"])):
            shape, score = got
            steps.append({"step": "bore", "radius": round(bore["radius"], 3), **score})

    types = surface_types(shape.wrapped)
    report = {
        "part": part_name,
        "status": "feature_cad",
        "valid": _valid(shape),
        "solid_count": len(shape.Solids()),
        "surface_types": types,
        "analytic_only": all(k in ANALYTIC for k in types),
        "deviation": score,
        "steps": steps,
        "turning_axes": [{"axis": np.round(g["axis"], 4).tolist(), "through": np.round(g["point"], 2).tolist(),
                          "share": round(g["share"], 3)} for g in axes],
        "seconds": round(time.monotonic() - started, 1),
        "scope": "External form rebuilt from the mesh as a measuring reference; internal design is not in the source.",
    }
    return shape.wrapped, report
